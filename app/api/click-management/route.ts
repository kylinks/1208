import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireEmployee() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'employee') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const, session }
}

export async function GET(_request: NextRequest) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const campaigns = await prisma.campaign.findMany({
      where: {
        userId: auth.session.user.id,
        deletedAt: null,
        // 与仪表盘逻辑一致：只获取联盟链接不为空的广告系列
        affiliateConfigs: {
          some: {
            deletedAt: null,
            enabled: true,
            affiliateLink: {
              not: '',
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        clickManagement: {
          select: {
            enabled: true,
            orderCount: true,
            conversionRate: true,
            pendingClicks: true,
            updatedAt: true,
            createdAt: true,
          },
        },
        affiliateConfigs: {
          where: {
            deletedAt: null,
            enabled: true,
          },
          orderBy: { priority: 'asc' },
          take: 1,
          select: {
            affiliateLink: true,
            targetDomain: true,
          },
        },
      },
    })

    const data = campaigns.map((c) => {
      const cm = c.clickManagement
      const affiliateConfig = c.affiliateConfigs[0] || null
      return {
        id: c.id,
        campaignId: c.campaignId,
        campaignName: c.name,
        countryCode: c.countryCode,
        campaignEnabled: c.enabled,
        // 新增字段
        domain: affiliateConfig?.targetDomain || null,
        referrer: c.referrer || null,
        affiliateLink: affiliateConfig?.affiliateLink || null,
        clickManagement: cm
          ? {
              enabled: cm.enabled,
              orderCount: cm.orderCount,
              conversionRate: cm.conversionRate ? Number(cm.conversionRate) : 0,
              pendingClicks: cm.pendingClicks,
              updatedAt: cm.updatedAt,
              createdAt: cm.createdAt,
            }
          : null,
      }
    })

    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('获取点击管理列表失败:', error)
    return NextResponse.json({ success: false, error: '获取点击管理列表失败' }, { status: 500 })
  }
}

