import { NextRequest, NextResponse } from 'next/server'
import { getProxyUsageStats } from '@/lib/proxyService'

/**
 * GET /api/proxy/stats
 * 获取代理使用统计
 * Query参数:
 * - campaignId: 广告系列ID (必填)
 * - countryCode: 国家代码 (可选)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('campaignId')
    const countryCode = searchParams.get('countryCode') || undefined

    if (!campaignId) {
      return NextResponse.json(
        { error: '缺少必填参数: campaignId' },
        { status: 400 }
      )
    }

    const stats = await getProxyUsageStats(campaignId, countryCode)

    if (!stats) {
      return NextResponse.json(
        { error: '获取统计失败' },
        { status: 500 }
      )
    }

    return NextResponse.json(stats)

  } catch (error) {
    console.error('获取代理统计失败:', error)
    return NextResponse.json(
      { error: '获取代理统计失败' },
      { status: 500 }
    )
  }
}
