import { NextRequest, NextResponse } from 'next/server'
import { getAvailableProxy, cleanupOldProxyRecords } from '@/lib/proxyService'

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

    const proxy = await getAvailableProxy(countryCode, campaignId)

    if (!proxy) {
      return NextResponse.json(
        { 
          error: '没有可用的代理',
          message: `国家 ${countryCode} 的所有代理在24小时内都已被使用` 
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
