/**
 * 监控任务队列配置（BullMQ）
 *
 * 用于"每用户不同间隔"的异步调度：
 * 1. dispatcher（cron 触发）从 DB 找到"到期用户"并 enqueue
 * 2. worker 消费队列，执行 runOneClickStartForUser，完成后更新 nextRunAt
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'

// ============== Redis 连接配置 ==============
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

// 创建共享的 Redis 连接（避免每次 new 时重复建连）
let _connection: IORedis | null = null

export function getRedisConnection(): IORedis {
  if (!_connection) {
    _connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null, // BullMQ 要求此设置
      enableReadyCheck: false,
    })
  }
  return _connection
}

// ============== 队列名称 ==============
export const MONITOR_QUEUE_NAME = 'monitor-user-tasks'

// ============== 队列实例（懒加载单例） ==============
let _monitorQueue: Queue | null = null

export function getMonitorQueue(): Queue {
  if (!_monitorQueue) {
    _monitorQueue = new Queue(MONITOR_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2, // 最多重试 2 次
        backoff: {
          type: 'exponential',
          delay: 5000, // 首次重试延迟 5s
        },
        removeOnComplete: {
          count: 500, // 最多保留 500 条已完成任务
          age: 24 * 3600, // 或 24 小时内的
        },
        removeOnFail: {
          count: 200, // 最多保留 200 条失败任务
          age: 7 * 24 * 3600, // 或 7 天内的
        },
      },
    })
  }
  return _monitorQueue
}

// ============== 队列事件（可选：用于日志/监控） ==============
let _queueEvents: QueueEvents | null = null

export function getQueueEvents(): QueueEvents {
  if (!_queueEvents) {
    _queueEvents = new QueueEvents(MONITOR_QUEUE_NAME, {
      connection: getRedisConnection(),
    })
  }
  return _queueEvents
}

// ============== 任务数据类型 ==============
export interface MonitorJobData {
  userId: string
  userEmail: string
  intervalMinutes: number
  scheduledAt: string // ISO 时间戳
}

// ============== 添加任务到队列 ==============
export async function enqueueMonitorJob(data: MonitorJobData): Promise<Job<MonitorJobData>> {
  const queue = getMonitorQueue()
  // jobId 用 userId 防止短时间重复入队
  const job = await queue.add('monitor', data, {
    jobId: `monitor-${data.userId}`,
  })
  return job
}

// ============== 批量添加任务 ==============
export async function enqueueMonitorJobs(items: MonitorJobData[]): Promise<Job<MonitorJobData>[]> {
  const queue = getMonitorQueue()
  const jobs = await queue.addBulk(
    items.map((data) => ({
      name: 'monitor',
      data,
      opts: {
        jobId: `monitor-${data.userId}`,
      },
    }))
  )
  return jobs
}

// ============== 获取队列状态（用于监控/调试） ==============
export async function getQueueStats() {
  const queue = getMonitorQueue()
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ])
  return { waiting, active, completed, failed, delayed }
}

// ============== 关闭连接（用于优雅退出） ==============
export async function closeQueue() {
  if (_monitorQueue) {
    await _monitorQueue.close()
    _monitorQueue = null
  }
  if (_queueEvents) {
    await _queueEvents.close()
    _queueEvents = null
  }
  if (_connection) {
    _connection.disconnect()
    _connection = null
  }
}

