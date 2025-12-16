/**
 * 服务器 cron 调用脚本（Node >= 18）
 *
 * 依赖：
 * - Next.js 服务已由 PM2 启动（例如 next start -p 10111）
 * - 环境变量 CRON_SECRET 已配置
 *
 * 可选环境变量：
 * - NEXT_PORT / PORT: Next.js 端口（默认 10111）
 * - CRON_BASE_URL: 覆盖 base url（默认 http://127.0.0.1:${port}）
 * - CRON_USER_ID: 仅执行某个 userId
 * - CRON_USER_EMAIL: 仅执行某个邮箱
 * - CRON_LOCK_PATH: 锁文件路径（默认 /tmp/google-ads-monitoring-cron.lock）
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const nowIso = () => new Date().toISOString()

function tryLoadDotEnvFromCwd(filenames = ['.env.production', '.env']) {
  for (const name of filenames) {
    const p = path.resolve(process.cwd(), name)
    try {
      if (!fs.existsSync(p)) continue
      const content = fs.readFileSync(p, 'utf8')
      for (const rawLine of content.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const idx = line.indexOf('=')
        if (idx <= 0) continue
        const k = line.slice(0, idx).trim()
        let v = line.slice(idx + 1).trim()
        // 去掉包裹引号
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1)
        }
        if (process.env[k] === undefined) process.env[k] = v
      }
      return true
    } catch {
      // ignore
    }
  }
  return false
}

function getEnv(name, fallback = '') {
  const v = process.env[name]
  return (v === undefined || v === null || v === '') ? fallback : v
}

function acquireLock(lockPath, ttlMs) {
  const ts = Date.now()
  try {
    const fd = fs.openSync(lockPath, 'wx')
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts, host: os.hostname() }) + '\n')
    fs.closeSync(fd)
    return { ok: true, release: () => { try { fs.unlinkSync(lockPath) } catch {} } }
  } catch (e) {
    // lock 已存在：若过期则抢占
    try {
      const st = fs.statSync(lockPath)
      const age = ts - st.mtimeMs
      if (age > ttlMs) {
        try { fs.unlinkSync(lockPath) } catch {}
        const fd = fs.openSync(lockPath, 'wx')
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, ts, host: os.hostname(), stolen: true }) + '\n')
        fs.closeSync(fd)
        return { ok: true, release: () => { try { fs.unlinkSync(lockPath) } catch {} } }
      }
    } catch {}

    return { ok: false }
  }
}

async function main() {
  // 允许 cron 场景下“cd 到项目目录”后自动读取 .env.production/.env
  tryLoadDotEnvFromCwd()

  const secret = getEnv('CRON_SECRET')
  if (!secret) {
    console.error(`[${nowIso()}] CRON_SECRET 未配置，退出`)
    process.exitCode = 2
    return
  }

  const port = Number(getEnv('NEXT_PORT', getEnv('PORT', '10111'))) || 10111
  const baseUrl = getEnv('CRON_BASE_URL', `http://127.0.0.1:${port}`)
  const url = `${baseUrl}/api/cron/one-click-start`

  // 任务通常 30s~3min，这里把锁 TTL 设到 10min，避免异常时永远卡死
  const lockPath = getEnv('CRON_LOCK_PATH', path.join(os.tmpdir(), 'google-ads-monitoring-cron.lock'))
  const lock = acquireLock(lockPath, 10 * 60 * 1000)
  if (!lock.ok) {
    console.log(`[${nowIso()}] 已有任务在执行（lock=${lockPath}），本次跳过`)
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000) // 12min 超时兜底

  const body = {}
  const userId = getEnv('CRON_USER_ID')
  const email = getEnv('CRON_USER_EMAIL')
  if (userId) body.userId = userId
  if (email) body.email = email

  console.log(`[${nowIso()}] cron 触发开始 url=${url} ${userId ? `userId=${userId}` : ''}${email ? ` email=${email}` : ''}`)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': secret,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) {
      console.error(`[${nowIso()}] cron 触发失败 status=${res.status} body=${text}`)
      process.exitCode = 1
      return
    }

    console.log(`[${nowIso()}] cron 触发成功 body=${text}`)
  } catch (e) {
    console.error(`[${nowIso()}] cron 触发异常`, e)
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
    lock.release?.()
  }
}

await main()


