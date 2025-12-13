/**
 * 广告系列同步 API
 * POST /api/google-ads/campaigns/sync
 * 从 Google Ads API 获取所有 MCC 下属 CID 的有效广告系列
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getGoogleAdsService } from '@/lib/googleAdsService';

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic';

/**
 * POST - 同步广告系列数据
 * 从所有已授权的 MCC 账户获取有效广告系列
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      );
    }

    // 获取用户所有已授权的 MCC 账户
    const mccAccounts = await prisma.mccAccount.findMany({
      where: {
        userId: session.user.id,
        authStatus: 'authorized',
        deletedAt: null,
      },
      select: {
        id: true,
        mccId: true,
        name: true,
      },
    });

    if (mccAccounts.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          totalCampaigns: 0,
          campaigns: [],
          message: '没有已授权的 MCC 账户',
        },
      });
    }

    const googleAdsService = getGoogleAdsService();
    const allCampaigns: any[] = [];
    const errors: string[] = [];

    // 遍历所有 MCC 账户获取广告系列
    for (const mcc of mccAccounts) {
      try {
        console.log(`📊 开始同步 MCC ${mcc.mccId} (${mcc.name}) 的广告系列...`);
        
        const result = await googleAdsService.getAllCampaignsForMcc(mcc.mccId);
        
        // 添加 MCC 信息到每个广告系列
        const campaignsWithMcc = result.campaigns.map(campaign => ({
          ...campaign,
          mccId: mcc.mccId,
          mccName: mcc.name,
        }));
        
        allCampaigns.push(...campaignsWithMcc);
        console.log(`✅ MCC ${mcc.mccId}: 同步了 ${result.totalCampaigns} 个广告系列`);
      } catch (error: any) {
        console.error(`❌ MCC ${mcc.mccId} 同步失败:`, error);
        errors.push(`MCC ${mcc.mccId}: ${error.message}`);
      }
    }

    // 【性能优化】批量同步到数据库
    console.log('📦 开始批量同步到数据库...');
    const syncStartTime = Date.now();
    
    let syncedCount = 0;
    let updatedCount = 0;
    let newCount = 0;
    let removedCount = 0;

    // 收集本次同步的所有广告系列ID
    const syncedCampaignIds = new Set<string>(allCampaigns.map(c => c.campaignId));

    // 【优化1】预先批量加载所有需要的数据
    const [existingCidAccounts, existingMccAccounts, existingCampaigns] = await Promise.all([
      // 获取所有 CID 账户
      prisma.cidAccount.findMany({
        where: {
          userId: session.user.id,
          deletedAt: null,
        },
        select: {
          id: true,
          cid: true,
          mccAccountId: true,
        },
      }),
      // 获取所有 MCC 账户
      prisma.mccAccount.findMany({
        where: {
          userId: session.user.id,
          deletedAt: null,
        },
        select: {
          id: true,
          mccId: true,
        },
      }),
      // 获取所有广告系列（包括已软删除的，以便恢复）
      prisma.campaign.findMany({
        where: {
          userId: session.user.id,
        },
        select: {
          id: true,
          campaignId: true,
          cidAccountId: true,
          countryCode: true,
          lastNewUrl: true,
          deletedAt: true,
        },
      }),
    ]);

    // 构建快速查找 Map
    const cidAccountMap = new Map(existingCidAccounts.map(c => [c.cid, c]));
    const mccAccountMap = new Map(existingMccAccounts.map(m => [m.mccId, m]));
    const campaignMap = new Map(existingCampaigns.map(c => [`${c.campaignId}_${c.cidAccountId}`, c]));

    // 【优化2】分类处理：需要创建的 CID、需要创建的广告系列、需要更新的广告系列
    const cidsToCreate: { userId: string; mccAccountId: string; cid: string; name: string; status: 'active' }[] = [];
    const campaignsToCreate: { userId: string; cidAccountId: string; campaignId: string; name: string; countryCode: string; lastNewUrl: string | null; enabled: boolean }[] = [];
    const campaignsToUpdate: { id: string; name: string; countryCode: string; lastNewUrl: string | null }[] = [];

    // 处理每个广告系列
    for (const campaign of allCampaigns) {
      let cidAccount = cidAccountMap.get(campaign.cidId);

      // 如果 CID 不存在，准备创建
      if (!cidAccount) {
        const mccAccount = mccAccountMap.get(campaign.mccId);
        if (mccAccount) {
          // 检查是否已经在待创建列表中
          const existingCreate = cidsToCreate.find(c => c.cid === campaign.cidId);
          if (!existingCreate) {
            cidsToCreate.push({
              userId: session.user.id,
              mccAccountId: mccAccount.id,
              cid: campaign.cidId,
              name: campaign.cidName || `CID-${campaign.cidId}`,
              status: 'active',
            });
          }
        } else {
          console.warn(`⚠️ 无法找到 MCC 账户: ${campaign.mccId}`);
          continue;
        }
      }
    }

    // 【优化3】批量创建缺失的 CID 账户
    if (cidsToCreate.length > 0) {
      console.log(`📝 批量创建 ${cidsToCreate.length} 个 CID 账户...`);
      await prisma.cidAccount.createMany({
        data: cidsToCreate,
        skipDuplicates: true,
      });

      // 重新加载 CID 账户映射
      const newCidAccounts = await prisma.cidAccount.findMany({
        where: {
          userId: session.user.id,
          cid: { in: cidsToCreate.map(c => c.cid) },
          deletedAt: null,
        },
        select: {
          id: true,
          cid: true,
          mccAccountId: true,
        },
      });
      
      for (const cid of newCidAccounts) {
        cidAccountMap.set(cid.cid, cid);
      }
    }

    // 【优化4】分类广告系列：创建 vs 更新
    for (const campaign of allCampaigns) {
      const cidAccount = cidAccountMap.get(campaign.cidId);
      if (!cidAccount) continue;

      const existingCampaign = campaignMap.get(`${campaign.campaignId}_${cidAccount.id}`);

      if (existingCampaign) {
        // 需要更新
        campaignsToUpdate.push({
          id: existingCampaign.id,
          name: campaign.campaignName,
          countryCode: campaign.countryCode || existingCampaign.countryCode || 'UNKNOWN',
          lastNewUrl: campaign.finalUrl || existingCampaign.lastNewUrl,
        });
        updatedCount++;
      } else {
        // 需要创建
        campaignsToCreate.push({
          userId: session.user.id,
          cidAccountId: cidAccount.id,
          campaignId: campaign.campaignId,
          name: campaign.campaignName,
          countryCode: campaign.countryCode || 'UNKNOWN',
          lastNewUrl: campaign.finalUrl || null,
          enabled: true,
        });
        newCount++;
      }
      syncedCount++;
    }

    // 【优化5】批量创建新广告系列
    if (campaignsToCreate.length > 0) {
      console.log(`📝 批量创建 ${campaignsToCreate.length} 个新广告系列...`);
      await prisma.campaign.createMany({
        data: campaignsToCreate,
        skipDuplicates: true,
      });
    }

    // 【优化6】批量更新现有广告系列（使用事务）
    if (campaignsToUpdate.length > 0) {
      console.log(`📝 批量更新 ${campaignsToUpdate.length} 个广告系列...`);
      // 分批处理更新，每批最多 100 个
      const batchSize = 100;
      for (let i = 0; i < campaignsToUpdate.length; i += batchSize) {
        const batch = campaignsToUpdate.slice(i, i + batchSize);
        await prisma.$transaction(
          batch.map(c => 
            prisma.campaign.update({
              where: { id: c.id },
              data: {
                name: c.name,
                countryCode: c.countryCode,
                lastNewUrl: c.lastNewUrl,
                deletedAt: null,
                enabled: true,
                updatedAt: new Date(),
              },
            })
          )
        );
      }
    }

    // 【优化7】批量清理已暂停的广告系列
    if (syncedCampaignIds.size > 0) {
      // 找出需要软删除的广告系列
      const activeExistingCampaigns = existingCampaigns.filter(c => c.deletedAt === null);
      const campaignsToRemove = activeExistingCampaigns.filter(
        (c) => !syncedCampaignIds.has(c.campaignId)
      );

      if (campaignsToRemove.length > 0) {
        console.log(`🗑️ 批量移除 ${campaignsToRemove.length} 个已暂停的广告系列`);
        
        await prisma.campaign.updateMany({
          where: {
            id: { in: campaignsToRemove.map(c => c.id) },
          },
          data: {
            deletedAt: new Date(),
            enabled: false,
          },
        });

        removedCount = campaignsToRemove.length;
      }
    }

    const syncDuration = Date.now() - syncStartTime;
    console.log(`✅ 数据库同步完成，耗时 ${syncDuration}ms`)

    return NextResponse.json({
      success: true,
      data: {
        totalCampaigns: allCampaigns.length,
        syncedCount,
        newCount,
        updatedCount,
        removedCount, // 本次同步中被移除（Google Ads 后台已暂停）的广告系列数量
        campaigns: allCampaigns,
        errors: errors.length > 0 ? errors : undefined,
        syncedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('广告系列同步失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || '广告系列同步失败',
      },
      { status: 500 }
    );
  }
}

/**
 * GET - 获取已同步的广告系列列表
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      );
    }

    // 从数据库获取广告系列
    const campaigns = await prisma.campaign.findMany({
      where: {
        userId: session.user.id,
        deletedAt: null,
      },
      include: {
        cidAccount: {
          select: {
            cid: true,
            name: true,
            mccAccount: {
              select: {
                mccId: true,
                name: true,
              },
            },
          },
        },
        affiliateConfigs: {
          where: {
            deletedAt: null,
            enabled: true,
          },
          orderBy: {
            priority: 'asc',
          },
          take: 1,
          select: {
            affiliateLink: true,
            targetDomain: true,
          },
        },
        monitoringLogs: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            affiliateLink: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 格式化返回数据
    const formattedCampaigns = campaigns.map(campaign => {
      // 获取联盟配置（优先级最高的）
      const affiliateConfig = campaign.affiliateConfigs[0];
      // 获取最近一次监控日志中的来路信息
      const latestLog = campaign.monitoringLogs[0];
      
      return {
        id: campaign.id,
        campaignId: campaign.campaignId,
        campaignName: campaign.name,
        cidId: campaign.cidAccount.cid,
        cidName: campaign.cidAccount.name,
        mccId: campaign.cidAccount.mccAccount.mccId,
        mccName: campaign.cidAccount.mccAccount.name,
        countryCode: campaign.countryCode,
        finalUrl: campaign.lastNewUrl,
        referrer: campaign.referrer,  // 来路URL
        affiliateLink: affiliateConfig?.affiliateLink || null,  // 联盟链接配置
        enabled: campaign.enabled,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        totalCampaigns: formattedCampaigns.length,
        campaigns: formattedCampaigns,
      },
    });
  } catch (error: any) {
    console.error('获取广告系列失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || '获取广告系列失败',
      },
      { status: 500 }
    );
  }
}
