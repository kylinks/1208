/**
 * 广告系列管理 API
 * GET    /api/campaigns/[id] - 获取单个广告系列
 * PUT    /api/campaigns/[id] - 更新广告系列
 * DELETE /api/campaigns/[id] - 删除广告系列
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic';

/**
 * GET - 获取单个广告系列
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      );
    }

    const { id } = await params;

    const campaign = await prisma.campaign.findFirst({
      where: {
        id,
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
          },
          orderBy: {
            priority: 'asc',
          },
        },
      },
    });

    if (!campaign) {
      return NextResponse.json(
        { success: false, error: '广告系列不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: campaign,
    });
  } catch (error: any) {
    console.error('获取广告系列失败:', error);
    return NextResponse.json(
      { success: false, error: '获取广告系列失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT - 更新广告系列
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const { countryCode, finalUrl, referrer, affiliateLink, enabled } = body;

    // 检查广告系列是否存在
    const existingCampaign = await prisma.campaign.findFirst({
      where: {
        id,
        userId: session.user.id,
        deletedAt: null,
      },
    });

    if (!existingCampaign) {
      return NextResponse.json(
        { success: false, error: '广告系列不存在' },
        { status: 404 }
      );
    }

    // 构建更新数据
    const updateData: any = {
      updatedAt: new Date(),
    };
    
    if (countryCode !== undefined) {
      updateData.countryCode = countryCode;
    }
    if (finalUrl !== undefined) {
      // finalUrl 在 Campaign 模型中对应的字段是 lastNewUrl
      updateData.lastNewUrl = finalUrl;
    }
    if (referrer !== undefined) {
      updateData.referrer = referrer;
    }
    if (enabled !== undefined) {
      updateData.enabled = enabled;
    }

    // 更新广告系列
    const updatedCampaign = await prisma.campaign.update({
      where: { id },
      data: updateData,
    });

    // 如果提供了联盟链接，更新或创建联盟配置
    if (affiliateLink) {
      const existingConfig = await prisma.affiliateConfig.findFirst({
        where: {
          campaignId: id,
          deletedAt: null,
        },
        orderBy: {
          priority: 'asc',
        },
      });

      if (existingConfig) {
        // 更新现有配置
        await prisma.affiliateConfig.update({
          where: { id: existingConfig.id },
          data: {
            affiliateLink,
            updatedAt: new Date(),
          },
        });
      } else {
        // 创建新配置
        await prisma.affiliateConfig.create({
          data: {
            campaignId: id,
            affiliateLink,
            targetDomain: new URL(affiliateLink).hostname,
            countryCode: countryCode || existingCampaign.countryCode,
            maxRedirects: 10,
            enabled: true,
            priority: 0,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: updatedCampaign,
      message: '更新成功',
    });
  } catch (error: any) {
    console.error('更新广告系列失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '更新广告系列失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除广告系列（软删除）
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      );
    }

    const { id } = await params;

    // 检查广告系列是否存在
    const existingCampaign = await prisma.campaign.findFirst({
      where: {
        id,
        userId: session.user.id,
        deletedAt: null,
      },
    });

    if (!existingCampaign) {
      return NextResponse.json(
        { success: false, error: '广告系列不存在' },
        { status: 404 }
      );
    }

    // 软删除广告系列
    await prisma.campaign.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    // 同时软删除关联的联盟配置
    await prisma.affiliateConfig.updateMany({
      where: {
        campaignId: id,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: '删除成功',
    });
  } catch (error: any) {
    console.error('删除广告系列失败:', error);
    return NextResponse.json(
      { success: false, error: '删除广告系列失败' },
      { status: 500 }
    );
  }
}
