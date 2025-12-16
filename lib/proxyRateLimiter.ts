/**
 * 代理请求限流（同一进程内）
 *
 * 设计目标：
 * - 给“通过代理发起的外部请求（IP 检测/联盟验证/刷点击等）”提供统一的节流入口
 * - 语义类似 GoogleAdsService 的令牌桶：补充速率 + 突发上限 + 排队等待
 *
 * 注意：
 * - 这是进程内限流（适合单实例/单进程部署）；多实例需要用 Redis/DB 才能全局一致
 */

type TokenBucket = {
  tokens: number
  lastRefillAt: number
}

function getEnvInt(key: string, fallback: number) {
  const raw = process.env[key]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

function getBuckets(): Map<string, TokenBucket> {
  const g = globalThis as any
  if (!g.__proxyTokenBuckets) {
    g.__proxyTokenBuckets = new Map<string, TokenBucket>()
  }
  return g.__proxyTokenBuckets as Map<string, TokenBucket>
}

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 获取/创建某个 scope 的令牌桶
 */
function getBucket(scope: string, burst: number): TokenBucket {
  const buckets = getBuckets()
  const existing = buckets.get(scope)
  if (existing) return existing
  const bucket: TokenBucket = { tokens: burst, lastRefillAt: Date.now() }
  buckets.set(scope, bucket)
  return bucket
}

/**
 * 申请一个“代理请求令牌”
 *
 * 默认配置可用 env 覆盖：
 * - PROXY_RPS: 每秒补充 token 数
 * - PROXY_BURST: 最大突发 token
 * - PROXY_MAX_WAIT_MS: 排队最长等待
 */
export async function acquireProxyToken(
  scope: string,
  overrides?: { rps?: number; burst?: number; maxWaitMs?: number }
): Promise<boolean> {
  const rps = overrides?.rps ?? getEnvInt('PROXY_RPS', 5)
  const burst = overrides?.burst ?? getEnvInt('PROXY_BURST', 10)
  const maxWaitMs = overrides?.maxWaitMs ?? getEnvInt('PROXY_MAX_WAIT_MS', 30_000)

  // rps <= 0 表示关闭限流
  if (rps <= 0) return true

  const start = Date.now()
  const bucket = getBucket(scope, burst)

  while (Date.now() - start < maxWaitMs) {
    const now = Date.now()
    const elapsedMs = Math.max(0, now - bucket.lastRefillAt)
    if (elapsedMs > 0) {
      const refill = (elapsedMs / 1000) * rps
      if (refill > 0) {
        bucket.tokens = Math.min(burst, bucket.tokens + refill)
        bucket.lastRefillAt = now
      }
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return true
    }

    await delay(120)
  }

  return false
}


