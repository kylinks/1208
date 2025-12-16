import { NextRequest, NextResponse } from 'next/server'
import { getAvailableProxy, cleanupOldProxyRecords } from '@/lib/proxyService'
import { prisma } from '@/lib/prisma'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

/**
 * GET /api/proxy
 * 获取可用的代理配置
 * Query参数:
 * - countryCode: 国家代码 (必填)
 * - campaignId: 广告系列ID (必填)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const countryCode = searchParams.get('countryCode')
    const campaignId = searchParams.get('campaignId')

    if (!countryCode || !campaignId) {
      return NextResponse.json(
        { error: '缺少必填参数: countryCode 和 campaignId' },
        { status: 400 }
      )
    }

    // 通过 campaignId 获取所属用户ID
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { userId: true }
    })

    if (!campaign) {
      return NextResponse.json(
        { error: '广告系列不存在' },
        { status: 404 }
      )
    }

    const proxy = await getAvailableProxy(countryCode, campaignId, campaign.userId)

    if (!proxy) {
      return NextResponse.json(
        { 
          error: '没有可用的代理',
          message: `国家 ${countryCode} 没有分配给当前用户的可用代理，或所有代理在24小时内都已被使用` 
        },
        { status: 404 }
      )
    }

    return NextResponse.json(proxy)

  } catch (error) {
    console.error('获取代理失败:', error)
    return NextResponse.json(
      { error: '获取代理失败' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/proxy
 * 清理24小时前的代理记录
 */
export async function POST(request: NextRequest) {
  try {
    const count = await cleanupOldProxyRecords()

    return NextResponse.json({
      success: true,
      message: `清理了 ${count} 条过期代理记录`,
      count
    })

  } catch (error) {
    console.error('清理代理记录失败:', error)
    return NextResponse.json(
      { error: '清理代理记录失败' },
      { status: 500 }
    )
  }
}
