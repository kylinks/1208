import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAdsService } from '@/lib/googleAdsService'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

/**
 * 验证MCC账号并获取子账号信息
 * POST /api/mcc-accounts/validate
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { mccId } = body

    if (!mccId) {
      return NextResponse.json(
        { error: '请提供MCC账号ID' },
        { status: 400 }
      )
    }

    // 验证MCC ID格式
    const mccIdPattern = /^\d{3}-\d{3}-\d{4}$/
    if (!mccIdPattern.test(mccId)) {
      return NextResponse.json(
        { error: 'MCC账号ID格式不正确，格式应为: 123-456-7890' },
        { status: 400 }
      )
    }

    // 统一走 GoogleAdsService：具备 429/5xx 重试 + 排队限流能力
    const googleAdsService = getGoogleAdsService()
    const accountsData = await googleAdsService.getMccAccounts(mccId)

    // 兼容旧接口返回结构
    const accounts = accountsData.cidAccounts.map((cid) => ({
      id: cid.cidId,
      name: cid.cidName,
      status: cid.status === 'active' ? 'ENABLED' : 'SUSPENDED',
      currency: cid.currencyCode || '',
      timezone: cid.timezone || '',
    }))

    return NextResponse.json({
      success: true,
      hasPermission: true,
      message: '获取成功',
      data: {
        totalAccounts: accounts.length,
        activeAccounts: accountsData.activeCids,
        inactiveAccounts: accountsData.suspendedCids,
        accounts,
      },
    })
  } catch (error: any) {
    console.error('验证MCC账号失败:', error)

    const msg = error?.message || '验证失败，请稍后重试'
    const isPermission =
      msg.includes('权限不足') ||
      msg.includes('未被授权') ||
      msg.includes('验证MCC访问权限失败') ||
      msg.includes('PERMISSION') ||
      msg.includes('403')

    const isRateOrQuota =
      msg.includes('429') ||
      msg.includes('请求频率') ||
      msg.includes('配额') ||
      msg.includes('排队') ||
      msg.includes('RESOURCE_EXHAUSTED')

    return NextResponse.json(
      {
        success: false,
        hasPermission: !isPermission,
        message: msg,
      },
      { status: isRateOrQuota ? 429 : 500 }
    )
  }
}
