/**
 * MCC 账号详情 API
 * GET    /api/mcc/[id] - 获取 MCC 详情
 * PUT    /api/mcc/[id] - 更新/同步 MCC
 * DELETE /api/mcc/[id] - 删除 MCC（软删除）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getGoogleAdsService } from '@/lib/googleAdsService';

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireEmployee() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'employee') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const, session }
}

/**
 * GET - 获取 MCC 详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const { id } = params;

    // 查询 MCC 详情
    const mccAccount = await prisma.mccAccount.findFirst({
      where: {
        id,
        userId: auth.session.user.id,
        deletedAt: null,
      },
      include: {
        cidAccounts: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            cid: true,
            name: true,
            status: true,
            currency: true,
            timezone: true,
            lastSyncAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (!mccAccount) {
      return NextResponse.json(
        { success: false, error: 'MCC 账号不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: mccAccount,
    });
  } catch (error: any) {
    console.error('获取 MCC 详情失败:', error);
    return NextResponse.json(
      { success: false, error: '获取 MCC 详情失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT - 更新/同步 MCC
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const { id } = params;
    const body = await request.json();
    const { sync } = body;

    // 查询 MCC
    const mccAccount = await prisma.mccAccount.findFirst({
      where: {
        id,
        userId: auth.session.user.id,
        deletedAt: null,
      },
    });

    if (!mccAccount) {
      return NextResponse.json(
        { success: false, error: 'MCC 账号不存在' },
        { status: 404 }
      );
    }

    // 如果是同步操作
    if (sync) {
      try {
        // 调用 Google Ads API 获取最新数据
        const googleAdsService = getGoogleAdsService();
        const accountsData = await googleAdsService.getMccAccounts(mccAccount.mccId);

        // 更新 MCC 统计信息
        const updatedMcc = await prisma.mccAccount.update({
          where: { id },
          data: {
            name: accountsData.mccName || mccAccount.name,
            totalCids: accountsData.totalCids,
            activeCids: accountsData.activeCids,
            suspendedCids: accountsData.suspendedCids,
            lastSyncAt: new Date(),
            authStatus: 'authorized',
          },
        });

        // 同步 CID 账户
        const now = new Date();
        const existingCids = await prisma.cidAccount.findMany({
          where: {
            mccAccountId: id,
            deletedAt: null,
          },
        });

        // 创建 CID ID 到数据库记录的映射
        const existingCidMap = new Map(
          existingCids.map(c => [c.cid, c])
        );

        // 从 API 返回的 CID ID 集合
        const apiCidIds = new Set(accountsData.cidAccounts.map(c => c.cidId));

        // 更新或创建 CID
        for (const cidData of accountsData.cidAccounts) {
          const existing = existingCidMap.get(cidData.cidId);

          if (existing) {
            // 更新现有 CID
            await prisma.cidAccount.update({
              where: { id: existing.id },
              data: {
                name: cidData.cidName,
                status: cidData.status,
                currency: cidData.currencyCode,
                timezone: cidData.timezone,
                lastSyncAt: now,
              },
            });
          } else {
            // 创建新 CID
            await prisma.cidAccount.create({
              data: {
                userId: auth.session.user.id,
                mccAccountId: id,
                cid: cidData.cidId,
                name: cidData.cidName,
                status: cidData.status,
                currency: cidData.currencyCode,
                timezone: cidData.timezone,
                lastSyncAt: now,
              },
            });
          }
        }

        // 软删除在 API 中不存在的 CID
        for (const existing of existingCids) {
          if (!apiCidIds.has(existing.cid)) {
            await prisma.cidAccount.update({
              where: { id: existing.id },
              data: { deletedAt: now },
            });
          }
        }

        return NextResponse.json({
          success: true,
          data: {
            id: updatedMcc.id,
            mccName: updatedMcc.name,
            totalCids: updatedMcc.totalCids,
            activeCids: updatedMcc.activeCids,
            suspendedCids: updatedMcc.suspendedCids,
            lastSyncAt: updatedMcc.lastSyncAt,
            syncedCidCount: accountsData.cidAccounts.length,
          },
          message: `MCC 账号同步成功，已同步 ${accountsData.cidAccounts.length} 个 CID 账户`,
        });
      } catch (error: any) {
        console.error('同步 MCC 失败:', error);
        return NextResponse.json(
          { success: false, error: error.message || '同步 MCC 失败' },
          { status: 500 }
        );
      }
    }

    // 普通更新操作
    const updatedMcc = await prisma.mccAccount.update({
      where: { id },
      data: body,
    });

    return NextResponse.json({
      success: true,
      data: updatedMcc,
      message: 'MCC 账号更新成功',
    });
  } catch (error: any) {
    console.error('更新 MCC 失败:', error);
    return NextResponse.json(
      { success: false, error: '更新 MCC 失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除 MCC（软删除）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const { id } = params;

    // 查询 MCC
    const mccAccount = await prisma.mccAccount.findFirst({
      where: {
        id,
        userId: auth.session.user.id,
        deletedAt: null,
      },
    });

    if (!mccAccount) {
      return NextResponse.json(
        { success: false, error: 'MCC 账号不存在' },
        { status: 404 }
      );
    }

    // 使用事务同时软删除 MCC 及所有关联数据（CID、Campaign、AffiliateConfig）
    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      // 1. 获取该 MCC 下所有 CID 的 ID
      const cidAccounts = await tx.cidAccount.findMany({
        where: {
          mccAccountId: id,
          deletedAt: null,
        },
        select: { id: true },
      });
      const cidIds = cidAccounts.map(c => c.id);

      let deletedCampaignsCount = 0;
      let deletedAffiliatesCount = 0;

      if (cidIds.length > 0) {
        // 2. 获取这些 CID 下所有 Campaign 的 ID
        const campaigns = await tx.campaign.findMany({
          where: {
            cidAccountId: { in: cidIds },
            deletedAt: null,
          },
          select: { id: true },
        });
        const campaignIds = campaigns.map(c => c.id);

        if (campaignIds.length > 0) {
          // 3. 软删除 AffiliateConfig（联盟配置）
          const deletedAffiliates = await tx.affiliateConfig.updateMany({
            where: {
              campaignId: { in: campaignIds },
              deletedAt: null,
            },
            data: { deletedAt: now },
          });
          deletedAffiliatesCount = deletedAffiliates.count;
        }

        // 4. 软删除 Campaign（广告系列）
        const deletedCampaigns = await tx.campaign.updateMany({
          where: {
            cidAccountId: { in: cidIds },
            deletedAt: null,
          },
          data: { deletedAt: now },
        });
        deletedCampaignsCount = deletedCampaigns.count;
      }

      // 5. 软删除 CID 账户
      const deletedCids = await tx.cidAccount.updateMany({
        where: {
          mccAccountId: id,
          deletedAt: null,
        },
        data: { deletedAt: now },
      });

      // 6. 软删除 MCC 账号
      await tx.mccAccount.update({
        where: { id },
        data: { deletedAt: now },
      });

      return {
        cidCount: deletedCids.count,
        campaignCount: deletedCampaignsCount,
        affiliateCount: deletedAffiliatesCount,
      };
    });

    return NextResponse.json({
      success: true,
      message: `MCC 账号删除成功`,
      data: {
        deletedCids: result.cidCount,
        deletedCampaigns: result.campaignCount,
        deletedAffiliateConfigs: result.affiliateCount,
      },
    });
  } catch (error: any) {
    console.error('删除 MCC 失败:', error);
    return NextResponse.json(
      { success: false, error: '删除 MCC 失败' },
      { status: 500 }
    );
  }
}
