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
  stopMonitor: () => void
  fetchMonitorConfig: () => Promise<void>
}

// localStorage 持久化相关
const MONITOR_STORAGE_KEY = 'monitor_status'

interface MonitorStorageData {
  isRunning: boolean
  nextExecutionAt: number  // 下次执行的时间戳
  runCount: number
  storedDate: string  // 存储的日期（YYYY-MM-DD），用于跨日清零
}

// 获取当天日期字符串（YYYY-MM-DD）
const getTodayDateString = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const saveMonitorStatus = (data: Omit<MonitorStorageData, 'storedDate'>) => {
  if (typeof window !== 'undefined') {
    const dataWithDate: MonitorStorageData = {
      ...data,
      storedDate: getTodayDateString(),
    }
    localStorage.setItem(MONITOR_STORAGE_KEY, JSON.stringify(dataWithDate))
  }
}

const loadMonitorStatus = (): MonitorStorageData | null => {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(MONITOR_STORAGE_KEY)
  return stored ? JSON.parse(stored) : null
}

const clearMonitorStatus = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(MONITOR_STORAGE_KEY)
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
  
  const monitorTimerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isMonitorRunningRef = useRef(false)
  const monitorIntervalRef = useRef(5) // 使用 ref 保存最新的监控间隔
  const runCountRef = useRef(0) // 使用 ref 保存最新的运行轮数
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

  // 启动倒计时
  const startCountdown = useCallback((seconds: number) => {
    setCountdown(seconds)
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
    }
    countdownTimerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  // 调度下一次执行
  const scheduleNextRun = useCallback(async (currentRunCount?: number) => {
    // 每次调度前重新获取最新的监控间隔配置
    await fetchMonitorConfig()
    
    // 使用 ref 中的最新值
    const currentInterval = monitorIntervalRef.current
    const intervalMs = currentInterval * 60 * 1000 // 转换为毫秒
    const nextExecutionAt = Date.now() + intervalMs
    startCountdown(currentInterval * 60)

    // 保存持久化状态
    const runCountToSave = currentRunCount ?? runCountRef.current
    saveMonitorStatus({
      isRunning: true,
      nextExecutionAt,
      runCount: runCountToSave,
    })

    monitorTimerRef.current = setTimeout(async () => {
      // 使用 ref 检查最新状态
      if (!isMonitorRunningRef.current) return
      
      // 跨日清零：检查是否跨日
      const storedStatus = loadMonitorStatus()
      const todayDateString = getTodayDateString()
      const isCrossDay = storedStatus?.storedDate && storedStatus.storedDate !== todayDateString
      
      let newRunCount: number
      if (isCrossDay) {
        // 跨日了，轮次从1开始
        newRunCount = 1
        console.log(`🌙 检测到跨日：存储日期 ${storedStatus.storedDate} → 今日 ${todayDateString}，轮次清零为 1`)
      } else {
        newRunCount = runCountRef.current + 1
      }
      
      setRunCount(newRunCount)
      runCountRef.current = newRunCount
      await executeOneClickTask()
      
      // 继续调度下一次
      if (isMonitorRunningRef.current) {
        scheduleNextRun(newRunCount)
      }
    }, intervalMs)
  }, [startCountdown, fetchMonitorConfig])

  // 开始循环监控
  const startMonitor = useCallback(async () => {
    // 避免重复点击/重复启动
    if (isMonitorRunningRef.current || oneClickLoadingRef.current) return
    // 先获取最新的监控间隔配置
    await fetchMonitorConfig()
    
    setIsMonitorRunning(true)
    isMonitorRunningRef.current = true
    setRunCount(1)
    runCountRef.current = 1
    message.success(`监控已启动，间隔 ${monitorIntervalRef.current} 分钟循环执行`)
    
    // 立即执行一次
    await executeOneClickTask()
    
    // 调度下一次执行
    scheduleNextRun(1)
  }, [fetchMonitorConfig, scheduleNextRun])

  // 停止循环监控
  const stopMonitor = useCallback(() => {
    setIsMonitorRunning(false)
    isMonitorRunningRef.current = false
    setRunCount(0)
    runCountRef.current = 0
    setCountdown(0)
    
    if (monitorTimerRef.current) {
      clearTimeout(monitorTimerRef.current)
      monitorTimerRef.current = null
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
    
    // 清除持久化状态
    clearMonitorStatus()
    
    message.info('监控已停止')
  }, [])

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (monitorTimerRef.current) {
        clearTimeout(monitorTimerRef.current)
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current)
      }
    }
  }, [])

  // 初始化时获取配置
  useEffect(() => {
    fetchMonitorConfig()
  }, [fetchMonitorConfig])

  // 页面加载时恢复监控状态
  useEffect(() => {
    const restoreMonitorStatus = async () => {
      // React StrictMode（nextConfig.reactStrictMode=true）在开发环境会触发“挂载-卸载-再挂载”。
      // 如果这里带有副作用（立即执行任务），会导致同一轮任务被执行两次，写入两条批次日志。
      // 用 sessionStorage 做一次短窗口的防重，确保同一 Tab 在极短时间内只恢复一次。
      if (typeof window !== 'undefined') {
        const key = 'monitor_restore_guard_ts'
        const last = Number(sessionStorage.getItem(key) || '0')
        const now = Date.now()
        if (last && now - last < 5000) {
          return
        }
        sessionStorage.setItem(key, String(now))
      }

      const storedStatus = loadMonitorStatus()
      
      if (!storedStatus || !storedStatus.isRunning) {
        return
      }

      const now = Date.now()
      const { nextExecutionAt, runCount: storedRunCount, storedDate } = storedStatus
      const remainingMs = nextExecutionAt - now

      // 跨日清零：检查存储的日期是否与今天相同
      const todayDateString = getTodayDateString()
      const isCrossDay = storedDate && storedDate !== todayDateString
      const restoredRunCount = isCrossDay ? 1 : storedRunCount

      if (isCrossDay) {
        console.log(`🌙 检测到跨日：存储日期 ${storedDate} → 今日 ${todayDateString}，轮次清零为 1`)
      }

      // 恢复状态
      setIsMonitorRunning(true)
      isMonitorRunningRef.current = true
      setRunCount(restoredRunCount)
      runCountRef.current = restoredRunCount

      // 先获取最新的监控间隔配置
      await fetchMonitorConfig()

      if (remainingMs > 0) {
        // 还没到执行时间，恢复倒计时和定时器
        const remainingSeconds = Math.ceil(remainingMs / 1000)
        startCountdown(remainingSeconds)
        
        console.log(`🔄 恢复监控状态: 第 ${restoredRunCount} 轮，${remainingSeconds} 秒后执行下一次`)

        monitorTimerRef.current = setTimeout(async () => {
          if (!isMonitorRunningRef.current) return
          
          // 跨日清零：检查是否跨日
          const currentStoredStatus = loadMonitorStatus()
          const currentTodayDateString = getTodayDateString()
          const isTimerCrossDay = currentStoredStatus?.storedDate && currentStoredStatus.storedDate !== currentTodayDateString
          
          let newRunCount: number
          if (isTimerCrossDay) {
            // 跨日了，轮次从1开始
            newRunCount = 1
            console.log(`🌙 检测到跨日：存储日期 ${currentStoredStatus.storedDate} → 今日 ${currentTodayDateString}，轮次清零为 1`)
          } else {
            newRunCount = runCountRef.current + 1
          }
          
          setRunCount(newRunCount)
          runCountRef.current = newRunCount
          await executeOneClickTask()
          
          if (isMonitorRunningRef.current) {
            scheduleNextRun(newRunCount)
          }
        }, remainingMs)
      } else {
        // 已经过了执行时间，立即执行一次然后重新调度
        // 注意：isCrossDay 在上面已经计算过了，这里 restoredRunCount 已是清零后的值
        console.log(`🔄 恢复监控状态: 执行时间已过，立即执行`)
        
        const newRunCount = restoredRunCount + 1
        setRunCount(newRunCount)
        runCountRef.current = newRunCount
        await executeOneClickTask()
        
        if (isMonitorRunningRef.current) {
          scheduleNextRun(newRunCount)
        }
      }
    }

    restoreMonitorStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
