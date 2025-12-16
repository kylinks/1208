import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runOneClickStartForUser } from '@/app/api/one-click-start/route'
import { enqueueMonitorJobs, MonitorJobData, getQueueStats } from '@/lib/queue'

export const dynamic = 'force-dynamic'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

function getCronSecret() {
  return process.env.CRON_SECRET || ''
}

// 配置
const DISPATCH_BATCH_SIZE = Number(process.env.DISPATCH_BATCH_SIZE) || 20 // 每次最多调度多少用户
const LOCK_TTL_MS = Number(process.env.DISPATCH_LOCK_TTL) || 15 * 60 * 1000 // 锁 TTL（15 分钟）
const DEFAULT_INTERVAL_MINUTES = Number(process.env.DEFAULT_INTERVAL_MINUTES) || 5 // 默认间隔

const nowIso = () => new Date().toISOString()

/**
 * 服务器侧 cron 触发入口（Dispatcher 模式）
 *
 * 调用方式：
 * - POST /api/cron/one-click-start
 * - Header: x-cron-secret: <CRON_SECRET>
 * - Body(可选):
 *   - 无参数：调度模式，从 DB 找到期用户并入队
 *   - { "userId": "..." } 或 { "email": "..." }：直接执行模式（用于调试/手动触发）
 *   - { "mode": "sync" }：同步执行所有到期用户（不走队列，用于没有 Redis 的环境）
 *
 * 调度模式流程：
 * 1. 从 UserMonitorSchedule 找出 enabled=true 且 nextRunAt <= now 且未被锁定的用户
 * 2. 原子抢占（设置 lockedUntil/lockedBy）
 * 3. 入队到 BullMQ，由 Worker 异步执行
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

  const { userId, email, mode } = body || {}

  // ============ 直接执行模式（指定用户） ============
  if (userId || email) {
    return handleDirectExecution(userId, email)
  }

  // ============ 同步执行模式（不走队列） ============
  if (mode === 'sync') {
    return handleSyncExecution()
  }

  // ============ 调度模式（默认） ============
  return handleDispatch()
}

/**
 * 直接执行模式：指定 userId 或 email，立即执行（用于调试/手动触发）
 */
async function handleDirectExecution(userId?: string, email?: string) {
  let user: { id: string; email: string } | null = null

  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: String(userId) },
      select: { id: true, email: true },
    })
  } else if (email) {
    user = await prisma.user.findUnique({
      where: { email: String(email) },
      select: { id: true, email: true },
    })
  }

  if (!user) {
    return jsonError('用户不存在', 404)
  }

  const startedAt = Date.now()
  try {
    const result = await runOneClickStartForUser(user.id)
    return NextResponse.json({
      success: true,
      data: {
        mode: 'direct',
        userId: user.id,
        email: user.email,
        duration: Date.now() - startedAt,
        result,
        executedAt: nowIso(),
      },
    })
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || '执行失败',
      data: {
        mode: 'direct',
        userId: user.id,
        email: user.email,
        duration: Date.now() - startedAt,
        executedAt: nowIso(),
      },
    }, { status: 500 })
  }
}

/**
 * 同步执行模式：不走队列，直接串行执行所有到期用户
 * 适用于没有 Redis 的环境，或者小规模部署
 */
async function handleSyncExecution() {
  const now = new Date()

  // 找出到期用户
  const dueSchedules = await prisma.userMonitorSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
      ],
    },
    include: {
      user: {
        select: { id: true, email: true },
      },
    },
    take: DISPATCH_BATCH_SIZE,
    orderBy: { nextRunAt: 'asc' },
  })

  if (dueSchedules.length === 0) {
    return NextResponse.json({
      success: true,
      data: {
        mode: 'sync',
        dispatched: 0,
        message: '没有到期的用户需要执行',
        executedAt: nowIso(),
      },
    })
  }

  // 逐个执行
  const results: any[] = []
  for (const schedule of dueSchedules) {
    const startedAt = Date.now()
    try {
      const result = await runOneClickStartForUser(schedule.userId)
      const duration = Date.now() - startedAt

      // 更新 nextRunAt
      await prisma.userMonitorSchedule.update({
        where: { userId: schedule.userId },
        data: {
          nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60 * 1000),
          lastRunAt: new Date(),
          lastStatus: result.errors > 0 ? 'failed' : (result.updated > 0 ? 'success' : 'skipped'),
          lastError: null,
          lastDuration: duration,
        },
      })

      results.push({
        userId: schedule.userId,
        email: schedule.user.email,
        ok: true,
        duration,
        processed: result.processed,
        updated: result.updated,
      })
    } catch (e: any) {
      const duration = Date.now() - startedAt
      const errMsg = e?.message || '执行失败'

      // 更新 nextRunAt（即使失败也推进，避免卡住）
      await prisma.userMonitorSchedule.update({
        where: { userId: schedule.userId },
        data: {
          nextRunAt: new Date(Date.now() + schedule.intervalMinutes * 60 * 1000),
          lastRunAt: new Date(),
          lastStatus: 'failed',
          lastError: errMsg.slice(0, 2000),
          lastDuration: duration,
        },
      })

      results.push({
        userId: schedule.userId,
        email: schedule.user.email,
        ok: false,
        duration,
        error: errMsg,
      })
    }
  }

  const okCount = results.filter(r => r.ok).length
  const failCount = results.length - okCount

  return NextResponse.json({
    success: true,
    data: {
      mode: 'sync',
      executed: results.length,
      okCount,
      failCount,
      results,
      executedAt: nowIso(),
    },
  })
}

/**
 * 调度模式：从 DB 找到期用户，原子抢占后入队
 */
async function handleDispatch() {
  const now = new Date()
  const lockUntil = new Date(Date.now() + LOCK_TTL_MS)
  const lockToken = `dispatcher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  console.log(`[${nowIso()}] 🔍 Dispatcher 开始查找到期用户...`)

  // Step 1: 找出到期且未被锁定的用户
  // 使用原生 SQL 进行原子抢占（Prisma 不支持 UPDATE ... LIMIT + RETURNING）
  // 这里先用 Prisma 查，再用事务抢占

  const dueSchedules = await prisma.userMonitorSchedule.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
      ],
    },
    include: {
      user: {
        select: { id: true, email: true },
      },
    },
    take: DISPATCH_BATCH_SIZE,
    orderBy: { nextRunAt: 'asc' },
  })

  if (dueSchedules.length === 0) {
    console.log(`[${nowIso()}] ℹ️ 没有到期用户需要调度`)
    return NextResponse.json({
      success: true,
      data: {
        mode: 'dispatch',
        dispatched: 0,
        message: '没有到期的用户需要调度',
        executedAt: nowIso(),
      },
    })
  }

  console.log(`[${nowIso()}] 📋 找到 ${dueSchedules.length} 个到期用户，开始抢占...`)

  // Step 2: 原子抢占（使用事务）
  const lockedUserIds: string[] = []
  const jobsData: MonitorJobData[] = []

  for (const schedule of dueSchedules) {
    try {
      // 使用乐观锁：只有当 lockedUntil 仍然满足条件时才更新
      const updated = await prisma.userMonitorSchedule.updateMany({
        where: {
          userId: schedule.userId,
          OR: [
            { lockedUntil: null },
            { lockedUntil: { lt: now } },
          ],
        },
        data: {
          lockedUntil: lockUntil,
          lockedBy: lockToken,
        },
      })

      if (updated.count > 0) {
        lockedUserIds.push(schedule.userId)
        jobsData.push({
          userId: schedule.userId,
          userEmail: schedule.user.email,
          intervalMinutes: schedule.intervalMinutes,
          scheduledAt: nowIso(),
        })
      }
    } catch (e) {
      console.warn(`[${nowIso()}] ⚠️ 抢占用户 ${schedule.userId} 失败:`, e)
    }
  }

  if (lockedUserIds.length === 0) {
    console.log(`[${nowIso()}] ℹ️ 所有用户已被其他 dispatcher 抢占`)
    return NextResponse.json({
      success: true,
      data: {
        mode: 'dispatch',
        dispatched: 0,
        message: '所有到期用户已被其他调度器抢占',
        executedAt: nowIso(),
      },
    })
  }

  console.log(`[${nowIso()}] 🔒 成功抢占 ${lockedUserIds.length} 个用户，入队...`)

  // Step 3: 入队
  try {
    const jobs = await enqueueMonitorJobs(jobsData)
    console.log(`[${nowIso()}] ✅ 已入队 ${jobs.length} 个任务`)

    // 获取队列状态
    let queueStats = null
    try {
      queueStats = await getQueueStats()
    } catch (e) {
      console.warn(`[${nowIso()}] ⚠️ 获取队列状态失败:`, e)
    }

    return NextResponse.json({
      success: true,
      data: {
        mode: 'dispatch',
        dispatched: jobs.length,
        userIds: lockedUserIds,
        queueStats,
        executedAt: nowIso(),
      },
    })
  } catch (e: any) {
    console.error(`[${nowIso()}] ❌ 入队失败:`, e)

    // 入队失败，释放锁
    await prisma.userMonitorSchedule.updateMany({
      where: {
        userId: { in: lockedUserIds },
        lockedBy: lockToken,
      },
      data: {
        lockedUntil: null,
        lockedBy: null,
      },
    })

    return jsonError(`入队失败: ${e?.message || '未知错误'}`, 500)
  }
}

/**
 * 为用户初始化调度配置（如果不存在）
 * 可在用户登录/创建时调用，或在调度时自动创建
 */
async function ensureUserSchedule(userId: string, intervalMinutes?: number) {
  const existing = await prisma.userMonitorSchedule.findUnique({
    where: { userId },
  })

  if (existing) {
    return existing
  }

  // 获取默认间隔（从 SystemConfig 或环境变量）
  let defaultInterval = intervalMinutes || DEFAULT_INTERVAL_MINUTES
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { key: 'cronInterval' },
    })
    if (config) {
      defaultInterval = parseInt(config.value) || DEFAULT_INTERVAL_MINUTES
    }
  } catch (e) {
    // ignore
  }

  return prisma.userMonitorSchedule.create({
    data: {
      userId,
      enabled: true,
      intervalMinutes: defaultInterval,
      nextRunAt: new Date(), // 立即可执行
    },
  })
}
