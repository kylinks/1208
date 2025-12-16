'use client'

import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import { message } from 'antd'

interface MonitorContextType {
  isMonitorRunning: boolean
  oneClickLoading: boolean
  monitorInterval: number
  runCount: number
  countdown: number
  lastExecutionTime: number // 上次执行完成的时间戳，用于触发数据刷新
  startMonitor: () => Promise<void>
  stopMonitor: (silent?: boolean) => void
  fetchMonitorConfig: () => Promise<void>
}

// 兼容旧版本：曾经的“浏览器端循环监控”会把状态写入 localStorage，导致用户一直看到“监控运行中”。
// 现在监控已迁移到服务器侧定时任务(crontab)，前端只保留“手动执行一次”的入口，因此启动/恢复/倒计时等浏览器端逻辑全部废弃。
const LEGACY_MONITOR_STORAGE_KEY = 'monitor_status'
const clearLegacyMonitorStatus = () => {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(LEGACY_MONITOR_STORAGE_KEY)
  } catch {
    // ignore
  }
}

const MonitorContext = createContext<MonitorContextType | null>(null)

export function MonitorProvider({ children }: { children: React.ReactNode }) {
  const [isMonitorRunning, setIsMonitorRunning] = useState(false)
  const [oneClickLoading, setOneClickLoading] = useState(false)
  const [monitorInterval, setMonitorInterval] = useState(5) // 默认5分钟
  const [runCount, setRunCount] = useState(0)
  const [countdown, setCountdown] = useState(0)
  const [lastExecutionTime, setLastExecutionTime] = useState(0) // 上次执行完成时间戳

  const monitorIntervalRef = useRef(5) // 使用 ref 保存最新的监控间隔
  const oneClickLoadingRef = useRef(false) // 防止并发重复触发
  const lockOwnerRef = useRef<string | null>(null)

  // 跨 Tab/窗口防重锁（localStorage 共享）
  const TASK_LOCK_KEY = 'one_click_task_lock'
  const TASK_LOCK_TTL_MS = 2 * 60 * 1000 // 2分钟，覆盖一次任务的最长执行窗口

  const tryAcquireTaskLock = (): boolean => {
    if (typeof window === 'undefined') return true
    const now = Date.now()

    // 本 tab 已持有锁
    if (lockOwnerRef.current) return true

    const owner = `${now}-${Math.random().toString(16).slice(2)}`
    try {
      const raw = localStorage.getItem(TASK_LOCK_KEY)
      if (raw) {
        const existing = JSON.parse(raw) as { owner: string; ts: number }
        if (existing?.ts && now - existing.ts < TASK_LOCK_TTL_MS) {
          // 未过期：其他 tab/窗口正在执行
          return false
        }
      }

      // 尝试写入锁（非原子，但足够降低重复概率；配合后续校验）
      localStorage.setItem(TASK_LOCK_KEY, JSON.stringify({ owner, ts: now }))

      // 二次校验：确认写入的是自己
      const confirmRaw = localStorage.getItem(TASK_LOCK_KEY)
      const confirm = confirmRaw ? (JSON.parse(confirmRaw) as { owner: string; ts: number }) : null
      if (confirm?.owner !== owner) {
        return false
      }

      lockOwnerRef.current = owner
      return true
    } catch {
      // localStorage 不可用时退化为单 tab 防重
      return true
    }
  }

  const releaseTaskLock = () => {
    if (typeof window === 'undefined') return
    const owner = lockOwnerRef.current
    if (!owner) return
    try {
      const raw = localStorage.getItem(TASK_LOCK_KEY)
      if (!raw) {
        lockOwnerRef.current = null
        return
      }
      const existing = JSON.parse(raw) as { owner: string; ts: number }
      if (existing?.owner === owner) {
        localStorage.removeItem(TASK_LOCK_KEY)
      }
    } catch {
      // ignore
    } finally {
      lockOwnerRef.current = null
    }
  }

  // 获取系统配置中的监控间隔
  const fetchMonitorConfig = useCallback(async () => {
    try {
      // 获取所有系统配置（不按category过滤，因为保存时使用的是通用category）
      const response = await fetch('/api/system-config')
      if (response.ok) {
        const data = await response.json()
        if (data.cronInterval) {
          const newInterval = Number(data.cronInterval) || 5
          setMonitorInterval(newInterval)
          monitorIntervalRef.current = newInterval
          console.log(`📝 已读取监控间隔配置: ${newInterval} 分钟`)
        }
      }
    } catch (error) {
      console.error('获取监控配置失败:', error)
    }
  }, [])

  // 执行单次一键启动任务
  const executeOneClickTask = async (): Promise<boolean> => {
    // 防止并发/重复触发（例如：恢复执行 + 定时器触发叠加，或 StrictMode 导致的重复执行）
    if (oneClickLoadingRef.current) return false
    // 跨 Tab/窗口防重：若其他 tab 正在执行则直接跳过
    if (!tryAcquireTaskLock()) return false
    try {
      setOneClickLoading(true)
      oneClickLoadingRef.current = true

      const response = await fetch('/api/one-click-start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      const data = await response.json()
      
      if (data.success) {
        const { processed, updated, skipped, errors } = data.data
        
        if (updated > 0) {
          message.success(`执行完成！处理 ${processed} 个，更新 ${updated} 个，跳过 ${skipped} 个${errors > 0 ? `，错误 ${errors} 个` : ''}`)
        } else if (processed > 0) {
          message.info(`执行完成，处理 ${processed} 个，无需更新`)
        }
        // 触发数据刷新
        setLastExecutionTime(Date.now())
        return true
      } else {
        message.error(data.error || '执行失败')
        return false
      }
    } catch (error) {
      message.error('执行请求失败')
      console.error('一键启动失败:', error)
      return false
    } finally {
      setOneClickLoading(false)
      oneClickLoadingRef.current = false
      releaseTaskLock()
    }
  }

  // “开始监控”保留为：手动执行一次（服务器侧 crontab 监控不依赖浏览器）
  const startMonitor = async () => {
    if (oneClickLoadingRef.current) return
    await fetchMonitorConfig()
    await executeOneClickTask()
  }

  // “停止监控”保留为：清理旧版本残留状态（静默），不再控制服务器侧 cron
  const stopMonitor = useCallback((silent = false) => {
    setIsMonitorRunning(false)
    setRunCount(0)
    setCountdown(0)

    // 清除旧版本 localStorage 状态，避免误提示“监控运行中”
    clearLegacyMonitorStatus()

    if (!silent) {
      message.info('已清理本地监控状态（服务器端定时任务不受影响）')
    }
  }, [])

  // 初始化时获取配置
  useEffect(() => {
    fetchMonitorConfig()
  }, [fetchMonitorConfig])

  // 页面加载时清掉旧版本残留，避免“误认为浏览器监控在运行”
  useEffect(() => {
    clearLegacyMonitorStatus()
  }, [])

  return (
    <MonitorContext.Provider
      value={{
        isMonitorRunning,
        oneClickLoading,
        monitorInterval,
        runCount,
        countdown,
        lastExecutionTime,
        startMonitor,
        stopMonitor,
        fetchMonitorConfig,
      }}
    >
      {children}
    </MonitorContext.Provider>
  )
}

export function useMonitor() {
  const context = useContext(MonitorContext)
  if (!context) {
    throw new Error('useMonitor must be used within a MonitorProvider')
  }
  return context
}
