import { NextRequest, NextResponse } from 'next/server'
import { recordProxyUsage } from '@/lib/proxyService'

/**
 * POST /api/proxy/record
 * 记录代理使用
 * Body:
 * - proxyConfig: 代理配置对象
 * - campaignId: 广告系列ID
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { proxyConfig, campaignId } = body

    if (!proxyConfig || !campaignId) {
      return NextResponse.json(
        { error: '缺少必填参数: proxyConfig 和 campaignId' },
        { status: 400 }
      )
    }

    await recordProxyUsage(proxyConfig, campaignId)

    return NextResponse.json({
      success: true,
      message: '代理使用记录成功'
    })

  } catch (error) {
    console.error('记录代理使用失败:', error)
    return NextResponse.json(
      { error: '记录代理使用失败' },
      { status: 500 }
    )
  }
}
