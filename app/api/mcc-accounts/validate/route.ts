import { NextRequest, NextResponse } from 'next/server'
import { validateMccAndGetAccounts } from '@/lib/google-ads-client'

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

    // 调用Google Ads API验证MCC账号（使用服务账号认证）
    const result = await validateMccAndGetAccounts(mccId)

    // 返回验证结果
    return NextResponse.json({
      success: result.isValid,
      hasPermission: result.hasPermission,
      message: result.message,
      data: result.accounts
        ? {
            totalAccounts: result.accounts.total,
            activeAccounts: result.accounts.active,
            inactiveAccounts: result.accounts.inactive,
            accounts: result.accounts.list,
          }
        : null,
    })
  } catch (error: any) {
    console.error('验证MCC账号失败:', error)
    return NextResponse.json(
      {
        success: false,
        hasPermission: false,
        message: error.message || '验证失败，请稍后重试',
      },
      { status: 500 }
    )
  }
}
