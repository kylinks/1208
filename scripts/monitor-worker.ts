/**
 * 监控任务 Worker 进程
 *
 * 用法：
 *   npx tsx scripts/monitor-worker.ts
 *   # 或 pm2 start scripts/monitor-worker.ts --interpreter npx --interpreter-args "tsx"
 *
 * 环境变量：
 *   REDIS_URL          - Redis 连接地址（默认 redis://127.0.0.1:6379）
 *   WORKER_CONCURRENCY - 单 worker 进程并发数（默认 2）
 *   WORKER_LOCK_TTL    - 任务锁 TTL 毫秒（默认 15 分钟）
 */

import { Worker, Job } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import {
  MONITOR_QUEUE_NAME,
  getRedisConnection,
  MonitorJobData,
} from '../lib/queue'

// 动态导入 runOneClickStartForUser（避免循环依赖）
let runOneClickStartForUser: (userId: string) => Promise<any>

async function loadRunFunction() {
  // 延迟加载，确保 Prisma 等依赖就绪
  const mod = await import('../app/api/one-click-start/route')
  runOneClickStartForUser = mod.runOneClickStartForUser
}

// Prisma 客户端
const prisma = new PrismaClient()

// 配置
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 2
const LOCK_TTL_MS = Number(process.env.WORKER_LOCK_TTL) || 15 * 60 * 1000 // 15min

const nowIso = () => new Date().toISOString()

/**
 * 任务处理函数
 */
async function processMonitorJob(job: Job<MonitorJobData>): Promise<any> {
  const { userId, userEmail, intervalMinutes } = job.data
  const startedAt = Date.now()

  console.log(`[${nowIso()}] 🚀 开始处理任务 jobId=${job.id} userId=${userId} email=${userEmail}`)

  try {
    // 执行监控任务
    const result = await runOneClickStartForUser(userId)

    const duration = Date.now() - startedAt

    // 更新调度表：nextRunAt = now + intervalMinutes，清除锁，记录状态
    await prisma.userMonitorSchedule.update({
      where: { userId },
      data: {
        nextRunAt: new Date(Date.now() + intervalMinutes * 60 * 1000),
        lockedUntil: null,
        lockedBy: null,
        lastRunAt: new Date(),
        lastStatus: result.errors > 0 ? 'failed' : (result.updated > 0 ? 'success' : 'skipped'),
        lastError: null,
        lastDuration: duration,
      },
    })

    console.log(
      `[${nowIso()}] ✅ 任务完成 jobId=${job.id} userId=${userId} ` +
        `processed=${result.processed} updated=${result.updated} skipped=${result.skipped} errors=${result.errors} ` +
        `duration=${duration}ms nextRunAt=${new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString()}`
    )

    return result
  } catch (error: any) {
    const duration = Date.now() - startedAt
    const errMsg = error?.message || String(error)

    console.error(`[${nowIso()}] ❌ 任务失败 jobId=${job.id} userId=${userId} error=${errMsg}`)

    // 更新调度表：记录错误，但仍然推进 nextRunAt（避免永远卡住）
    try {
      await prisma.userMonitorSchedule.update({
        where: { userId },
        data: {
          nextRunAt: new Date(Date.now() + intervalMinutes * 60 * 1000),
          lockedUntil: null,
          lockedBy: null,
          lastRunAt: new Date(),
          lastStatus: 'failed',
          lastError: errMsg.slice(0, 2000), // 截断避免超长
          lastDuration: duration,
        },
      })
    } catch (e) {
      console.error(`[${nowIso()}] ⚠️ 更新调度表失败 userId=${userId}`, e)
    }

    // 抛出错误让 BullMQ 记录失败（可能触发重试）
    throw error
  }
}

/**
 * 启动 Worker
 */
async function main() {
  console.log(`[${nowIso()}] 🔧 加载 runOneClickStartForUser...`)
  await loadRunFunction()

  console.log(`[${nowIso()}] 🔧 启动 Worker concurrency=${CONCURRENCY} lockTTL=${LOCK_TTL_MS}ms`)

  const worker = new Worker<MonitorJobData>(
    MONITOR_QUEUE_NAME,
    processMonitorJob,
    {
      connection: getRedisConnection(),
      concurrency: CONCURRENCY,
      lockDuration: LOCK_TTL_MS, // BullMQ 内部锁（防止重复处理）
    }
  )

  // 事件监听
  worker.on('completed', (job) => {
    console.log(`[${nowIso()}] 📦 Job completed jobId=${job.id}`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[${nowIso()}] 📦 Job failed jobId=${job?.id} error=${err.message}`)
  })

  worker.on('error', (err) => {
    console.error(`[${nowIso()}] ⚠️ Worker error:`, err)
  })

  // 优雅退出
  const shutdown = async (signal: string) => {
    console.log(`[${nowIso()}] 🛑 收到 ${signal}，正在关闭 Worker...`)
    await worker.close()
    await prisma.$disconnect()
    console.log(`[${nowIso()}] 👋 Worker 已退出`)
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  console.log(`[${nowIso()}] ✅ Worker 启动成功，等待任务...`)
}

main().catch((err) => {
  console.error(`[${nowIso()}] ❌ Worker 启动失败:`, err)
  process.exit(1)
})

