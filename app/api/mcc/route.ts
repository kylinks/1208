/**
 * MCC 账号管理 API
 * GET  /api/mcc - 获取 MCC 列表
 * POST /api/mcc - 创建 MCC 账号
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getGoogleAdsService } from '@/lib/googleAdsService';

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireEmployee() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'employee') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const, session }
}

/**
 * GET - 获取 MCC 列表
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    // 查询 MCC 列表
    const mccAccounts = await prisma.mccAccount.findMany({
      where: {
        userId: auth.session.user.id,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        mccId: true,
        name: true,
        authStatus: true,
        totalCids: true,
        activeCids: true,
        suspendedCids: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: mccAccounts,
    });
  } catch (error: any) {
    console.error('获取 MCC 列表失败:', error);
    return NextResponse.json(
      { success: false, error: '获取 MCC 列表失败' },
      { status: 500 }
    );
  }
}

/**
 * POST - 创建 MCC 账号
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    // 解析请求体
    const body = await request.json();
    const { mccId, mccName, skipVerify } = body;

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

    // 检查是否已存在
    const existingMcc = await prisma.mccAccount.findFirst({
      where: {
        userId: auth.session.user.id,
        mccId,
        deletedAt: null,
      },
    });

    if (existingMcc) {
      return NextResponse.json(
        { success: false, error: '该 MCC 账号已存在' },
        { status: 400 }
      );
    }

    let totalCids = 0;
    let activeCids = 0;
    let suspendedCids = 0;
    let finalMccName = mccName || `MCC账户-${mccId}`;

    // 如果不跳过验证，调用 Google Ads API 获取数据
    if (!skipVerify) {
      try {
        const googleAdsService = getGoogleAdsService();
        const verifyResult = await googleAdsService.verifyMccAccount(mccId);
        totalCids = verifyResult.totalCids;
        activeCids = verifyResult.activeCids;
        suspendedCids = verifyResult.suspendedCids;
        finalMccName = verifyResult.mccName;
      } catch (error: any) {
        console.error('验证 MCC 失败，将创建待授权状态的账号:', error);
        // 验证失败不影响创建，只是状态为 pending
      }
    }

    // 创建 MCC 账号
    const mccAccount = await prisma.mccAccount.create({
      data: {
        userId: auth.session.user.id,
        mccId,
        name: finalMccName,
        authStatus: skipVerify ? 'pending' : 'authorized',
        totalCids,
        activeCids,
        suspendedCids,
      },
    });

    return NextResponse.json({
      success: true,
      data: mccAccount,
      message: 'MCC 账号添加成功',
    });
  } catch (error: any) {
    console.error('创建 MCC 账号失败:', error);
    return NextResponse.json(
      { success: false, error: error.message || '创建 MCC 账号失败' },
      { status: 500 }
    );
  }
}
