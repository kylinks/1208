import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runOneClickStartForUser } from '@/app/api/one-click-start/route'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

function getCronSecret() {
  return process.env.CRON_SECRET || ''
}

/**
 * 服务器侧 cron 触发入口（不依赖 next-auth session）
 *
 * 调用方式：
 * - POST /api/cron/one-click-start
 * - Header: x-cron-secret: <CRON_SECRET>
 * - Body(可选): { "userId": "..."} 或 { "email": "user@example.com" }
 *
 * 默认行为：
 * - 不传 userId/email 时，会对“存在启用 campaign 且联盟配置可用”的用户逐个执行一次
 */
export async function POST(request: NextRequest) {
  const secret = getCronSecret()
  if (!secret) return jsonError('服务器未配置 CRON_SECRET', 500)

  const incoming = request.headers.get('x-cron-secret')
  if (!incoming || incoming !== secret) return jsonError('未授权访问', 401)

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const { userId, email } = body || {}

  // 选择要执行的用户
  let users: { id: string; email: string; role: string }[] = []
  if (userId) {
    const u = await prisma.user.findUnique({
      where: { id: String(userId) },
      select: { id: true, email: true, role: true },
    })
    if (!u) return jsonError('用户不存在', 404)
    users = [u]
  } else if (email) {
    const u = await prisma.user.findUnique({
      where: { email: String(email) },
      select: { id: true, email: true, role: true },
    })
    if (!u) return jsonError('用户不存在', 404)
    users = [u]
  } else {
    users = await prisma.user.findMany({
      where: {
        campaigns: {
          some: {
            enabled: true,
            deletedAt: null,
            affiliateConfigs: {
              some: {
                enabled: true,
                deletedAt: null,
                affiliateLink: { not: '' },
              },
            },
          },
        },
      },
      select: { id: true, email: true, role: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  if (users.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        executedUsers: 0,
        results: [],
        message: '没有可执行的用户（没有启用的广告系列）',
        executedAt: new Date().toISOString(),
      },
    })
  }

  // 逐个执行，避免单机资源被并发打爆（你当前单台服务器 + 单 next 进程的部署形态更稳）
  const results: any[] = []
  for (const u of users) {
    const startedAt = Date.now()
    try {
      const data = await runOneClickStartForUser(u.id)
      results.push({
        userId: u.id,
        email: u.email,
        role: u.role,
        ok: true,
        duration: Date.now() - startedAt,
        data,
      })
    } catch (e: any) {
      results.push({
        userId: u.id,
        email: u.email,
        role: u.role,
        ok: false,
        duration: Date.now() - startedAt,
        error: e?.message || '执行失败',
      })
    }
  }

  const okCount = results.filter(r => r.ok).length
  const failCount = results.length - okCount

  return NextResponse.json({
    success: true,
    data: {
      executedUsers: results.length,
      okCount,
      failCount,
      results,
      executedAt: new Date().toISOString(),
    },
  })
}


