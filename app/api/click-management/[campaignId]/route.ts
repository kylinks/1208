import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
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

function normalizeNumber(value: any) {
  if (value === null || value === undefined) return NaN
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : NaN
}

/**
 * 计算待刷点击：订单数/转化率，取整后随机增减1-10，不能为负数
 */
function calculatePendingClicks(orderCount: number, conversionRate: number): number {
  if (orderCount <= 0 || conversionRate <= 0) return 0
  const base = Math.floor(orderCount / conversionRate)
  // 随机增减1-10
  const randomOffset = Math.floor(Math.random() * 10) + 1
  const addOrSubtract = Math.random() > 0.5 ? 1 : -1
  const result = base + addOrSubtract * randomOffset
  // 不能为负数
  return Math.max(0, result)
}

export async function PUT(request: NextRequest, { params }: { params: { campaignId: string } }) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const { campaignId } = params
    if (!campaignId) return jsonError('缺少 campaignId', 400)

    const body = await request.json().catch(() => null)
    if (!body) return jsonError('请求体无效', 400)

    const enabled = Boolean(body.enabled)
    const orderCountRaw = normalizeNumber(body.orderCount)
    const conversionRateRaw = normalizeNumber(body.conversionRate)

    if (!Number.isFinite(orderCountRaw) || orderCountRaw < 0) {
      return jsonError('orderCount 无效', 400)
    }
    if (!Number.isFinite(conversionRateRaw) || conversionRateRaw <= 0 || conversionRateRaw > 1) {
      return jsonError('conversionRate 无效（必须在 0~1 之间且大于 0）', 400)
    }

    const orderCount = Math.floor(orderCountRaw)
    const conversionRate = conversionRateRaw

    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        userId: auth.session.user.id,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!campaign) return jsonError('广告系列不存在或无权限', 404)

    // 如果有显式传入 pendingClicks，使用传入值；否则根据规则计算
    let pendingClicks: number
    if (body.pendingClicks !== undefined && body.pendingClicks !== null) {
      pendingClicks = Math.max(0, Math.floor(normalizeNumber(body.pendingClicks)))
      if (!Number.isFinite(pendingClicks)) pendingClicks = 0
    } else {
      pendingClicks = enabled ? calculatePendingClicks(orderCount, conversionRate) : 0
    }

    const cm = await prisma.clickManagement.upsert({
      where: { campaignId },
      create: {
        campaignId,
        enabled,
        orderCount,
        conversionRate: new Prisma.Decimal(String(conversionRate)),
        pendingClicks,
      },
      update: {
        enabled,
        orderCount,
        conversionRate: new Prisma.Decimal(String(conversionRate)),
        pendingClicks,
      },
      select: {
        enabled: true,
        orderCount: true,
        conversionRate: true,
        pendingClicks: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        enabled: cm.enabled,
        orderCount: cm.orderCount,
        conversionRate: cm.conversionRate ? Number(cm.conversionRate) : 0,
        pendingClicks: cm.pendingClicks,
        updatedAt: cm.updatedAt,
      },
    })
  } catch (error) {
    console.error('更新点击管理失败:', error)
    return NextResponse.json({ success: false, error: '更新点击管理失败' }, { status: 500 })
  }
}

