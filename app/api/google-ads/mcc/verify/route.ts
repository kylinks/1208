/**
 * MCC 验证 API
 * POST /api/google-ads/mcc/verify
 * 验证 MCC 账户是否存在且服务账号有权限访问
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAdsService } from '@/lib/googleAdsService';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic';

/**
 * POST - 验证 MCC 账户
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      );
    }

    // 解析请求体
    const body = await request.json();
    const { mccId } = body;

    // 验证参数
    if (!mccId) {
      return NextResponse.json(
        { success: false, error: '缺少 mccId 参数' },
        { status: 400 }
      );
    }

    // 验证格式
    if (!/^\d{3}-\d{3}-\d{4}$/.test(mccId)) {
      return NextResponse.json(
        { success: false, error: 'MCC ID 格式无效，正确格式为：xxx-xxx-xxxx' },
        { status: 400 }
      );
    }

    // 调用 Google Ads API 验证
    const googleAdsService = getGoogleAdsService();
    const result = await googleAdsService.verifyMccAccount(mccId);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('MCC 验证失败:', error);

    // 返回具体错误信息
    return NextResponse.json(
      {
        success: false,
        error: error.message || '验证 MCC 账户失败',
      },
      { status: 500 }
    );
  }
}
