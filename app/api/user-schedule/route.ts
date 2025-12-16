/**
 * 用户监控调度配置 API
 * 
 * GET  - 获取当前用户的调度配置
 * POST - 更新当前用户的调度配置
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// 默认间隔（分钟）
const DEFAULT_INTERVAL_MINUTES = Number(process.env.DEFAULT_INTERVAL_MINUTES) || 5

/**
 * 获取当前用户的调度配置
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = session.user.id

    // 查询或创建
    let schedule = await prisma.userMonitorSchedule.findUnique({
      where: { userId },
    })

    if (!schedule) {
      // 获取系统默认间隔
      let defaultInterval = DEFAULT_INTERVAL_MINUTES
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

      // 创建默认配置
      schedule = await prisma.userMonitorSchedule.create({
        data: {
          userId,
          enabled: true,
          intervalMinutes: defaultInterval,
          nextRunAt: new Date(),
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        enabled: schedule.enabled,
        intervalMinutes: schedule.intervalMinutes,
        nextRunAt: schedule.nextRunAt?.toISOString() || null,
        lastRunAt: schedule.lastRunAt?.toISOString() || null,
        lastStatus: schedule.lastStatus,
        lastError: schedule.lastError,
        lastDuration: schedule.lastDuration,
        isLocked: schedule.lockedUntil ? schedule.lockedUntil > new Date() : false,
      },
    })
  } catch (error) {
    console.error('获取用户调度配置失败:', error)
    return NextResponse.json(
      { error: '获取用户调度配置失败' },
      { status: 500 }
    )
  }
}

/**
 * 更新当前用户的调度配置
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = session.user.id
    const body = await request.json()

    const { enabled, intervalMinutes } = body

    // 验证参数
    if (intervalMinutes !== undefined) {
      const interval = Number(intervalMinutes)
      if (isNaN(interval) || interval < 1 || interval > 1440) {
        return NextResponse.json(
          { error: '监控间隔必须在 1-1440 分钟之间' },
          { status: 400 }
        )
      }
    }

    // 更新或创建
    const updateData: any = {}
    if (enabled !== undefined) {
      updateData.enabled = Boolean(enabled)
    }
    if (intervalMinutes !== undefined) {
      updateData.intervalMinutes = Number(intervalMinutes)
    }

    const schedule = await prisma.userMonitorSchedule.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        enabled: enabled !== undefined ? Boolean(enabled) : true,
        intervalMinutes: intervalMinutes !== undefined ? Number(intervalMinutes) : DEFAULT_INTERVAL_MINUTES,
        nextRunAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        enabled: schedule.enabled,
        intervalMinutes: schedule.intervalMinutes,
        nextRunAt: schedule.nextRunAt?.toISOString() || null,
        lastRunAt: schedule.lastRunAt?.toISOString() || null,
        lastStatus: schedule.lastStatus,
        lastError: schedule.lastError,
        lastDuration: schedule.lastDuration,
      },
      message: '保存成功',
    })
  } catch (error) {
    console.error('更新用户调度配置失败:', error)
    return NextResponse.json(
      { error: '更新用户调度配置失败' },
      { status: 500 }
    )
  }
}

/**
 * 手动触发立即执行（将 nextRunAt 设为现在）
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = session.user.id

    // 将 nextRunAt 设为现在，并清除锁（如果有）
    const schedule = await prisma.userMonitorSchedule.upsert({
      where: { userId },
      update: {
        nextRunAt: new Date(),
        lockedUntil: null,
        lockedBy: null,
      },
      create: {
        userId,
        enabled: true,
        intervalMinutes: DEFAULT_INTERVAL_MINUTES,
        nextRunAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        enabled: schedule.enabled,
        intervalMinutes: schedule.intervalMinutes,
        nextRunAt: schedule.nextRunAt?.toISOString() || null,
      },
      message: '已标记为立即执行，将在下次调度时处理',
    })
  } catch (error) {
    console.error('触发立即执行失败:', error)
    return NextResponse.json(
      { error: '触发立即执行失败' },
      { status: 500 }
    )
  }
}

