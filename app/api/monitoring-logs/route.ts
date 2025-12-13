import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

// 详情项类型
interface LogDetailItem {
  campaignId: string
  campaignName: string
  status: string
  todayClicks?: number
  lastClicks?: number
  newClicks?: number
  newLink?: string
  proxyIp?: string
  googleAdsUpdated?: boolean
  googleAdsError?: string
  reason?: string
  error?: string
}

// 获取监控日志列表
export async function GET(request: NextRequest) {
  try {
    // 验证用户登录（管理员也仅查看自己的数据）
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')
    const status = searchParams.get('status')
    const campaignId = searchParams.get('campaignId')
    const search = searchParams.get('search')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const providerId = searchParams.get('providerId')
    const logType = searchParams.get('logType') // 'batch' | 'single' | 'all'

    // 以 userId 为主隔离；兼容旧“单条日志”可能没写 userId 的情况（通过 campaign.userId 兜底）
    const where: any = {
      OR: [
        { userId: session.user.id },
        { userId: null, campaign: { userId: session.user.id } },
      ],
    }
    
    // 日志类型筛选（默认只显示批次日志）
    if (logType === 'single') {
      where.isBatchLog = false
    } else if (logType === 'all') {
      // 显示全部
    } else {
      // 默认只显示批次日志
      where.isBatchLog = true
    }
    
    // 状态筛选
    if (status) {
      where.status = status
    }
    
    // 广告系列筛选（仅对单条日志有效，或在批次日志详情中搜索）
    if (campaignId) {
      where.AND = where.AND || []
      where.AND.push({
        OR: [
          { campaignId: campaignId },
          // 批次日志中包含该广告系列（注意：details 里的 campaignId 可能是 Google campaignId）
          {
            isBatchLog: true,
            details: {
              path: '$[*].campaignId',
              array_contains: campaignId,
            },
          },
        ],
      })
    }

    // 代理供应商筛选
    if (providerId) {
      where.providerId = providerId
    }

    // 日期范围筛选
    if (startDate || endDate) {
      where.triggeredAt = {}
      if (startDate) {
        where.triggeredAt.gte = new Date(startDate)
      }
      if (endDate) {
        where.triggeredAt.lte = new Date(endDate)
      }
    }

    // 搜索（按广告系列名称 - 仅对单条日志有效）
    if (search) {
      where.AND = where.AND || []
      where.AND.push({
        isBatchLog: false,
        campaign: {
          name: {
            contains: search,
          },
        },
      })
    }

    const [logs, total] = await Promise.all([
      prisma.monitoringLog.findMany({
        where,
        include: {
          campaign: {
            select: {
              name: true,
              countryCode: true
            }
          },
          provider: {
            select: {
              name: true
            }
          }
        },
        orderBy: { triggeredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.monitoringLog.count({ where })
    ])

    const result = logs.map(log => {
      // 批次日志格式
      if (log.isBatchLog) {
        const detailsRaw = log.details
        const details: LogDetailItem[] = Array.isArray(detailsRaw)
          ? (detailsRaw as unknown as LogDetailItem[])
          : []
        
        // 统计成功和失败的详情
        const successDetails = details.filter(d => d.status === 'updated')
        const failedDetails = details.filter(d => d.status === 'error')
        const skippedDetails = details.filter(d => d.status === 'skipped')
        
        return {
          id: log.id,
          isBatchLog: true,
          triggeredAt: log.triggeredAt.toISOString(),
          status: log.status,
          executionTime: log.executionTime,
          intervalMinutes: log.intervalMinutes,
          // 批次统计
          processed: log.processed,
          updated: log.updated,
          skipped: log.skipped,
          errors: log.errors,
          // 详情列表
          details: details,
          successDetails: successDetails,
          failedDetails: failedDetails,
          skippedDetails: skippedDetails,
          createdAt: log.createdAt.toISOString()
        }
      }
      
      // 单条日志格式（兼容旧数据）
      return {
        id: log.id,
        isBatchLog: false,
        campaignId: log.campaignId,
        campaignName: log.campaign?.name || '-',
        countryCode: log.campaign?.countryCode || '-',
        triggeredAt: log.triggeredAt.toISOString(),
        todayClicks: log.todayClicks,
        lastClicks: log.lastClicks,
        newClicks: log.newClicks,
        proxyIp: log.proxyIp,
        proxyPort: log.proxyPort,
        providerId: log.providerId,
        providerName: log.provider?.name || null,
        affiliateLink: log.affiliateLink,
        finalUrl: log.finalUrl,
        redirectCount: log.redirectCount,
        status: log.status,
        errorMessage: log.errorMessage,
        executionTime: log.executionTime,
        createdAt: log.createdAt.toISOString()
      }
    })

    return NextResponse.json({
      data: result,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    })

  } catch (error) {
    console.error('获取监控日志失败:', error)
    return NextResponse.json(
      { error: '获取监控日志失败' },
      { status: 500 }
    )
  }
}

// 获取监控日志统计数据
export async function POST(request: NextRequest) {
  try {
    // 验证用户登录（管理员也仅查看自己的数据）
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const body = await request.json()
    const { type } = body

    if (type === 'stats') {
      // 获取统计数据（基于批次日志）
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

      const [
        totalBatchCount,
        todayBatchCount,
        batchSuccessCount,
        batchFailedCount,
        batchSkippedCount,
        weeklyStats,
        // 获取批次日志中的详细统计（总处理数、更新数等）
        batchAggregates
      ] = await Promise.all([
        // 批次日志总数
        prisma.monitoringLog.count({
          where: { isBatchLog: true, userId: session.user.id }
        }),
        // 今日批次日志数
        prisma.monitoringLog.count({
          where: {
            isBatchLog: true,
            userId: session.user.id,
            triggeredAt: { gte: today }
          }
        }),
        // 成功批次数
        prisma.monitoringLog.count({
          where: { isBatchLog: true, userId: session.user.id, status: 'success' }
        }),
        // 失败批次数
        prisma.monitoringLog.count({
          where: { isBatchLog: true, userId: session.user.id, status: 'failed' }
        }),
        // 跳过批次数
        prisma.monitoringLog.count({
          where: { isBatchLog: true, userId: session.user.id, status: 'skipped' }
        }),
        // 近7天每日批次统计
        prisma.monitoringLog.groupBy({
          by: ['status'],
          where: {
            isBatchLog: true,
            userId: session.user.id,
            triggeredAt: { gte: weekAgo }
          },
          _count: {
            id: true
          }
        }),
        // 批次日志的聚合统计
        prisma.monitoringLog.aggregate({
          where: { isBatchLog: true, userId: session.user.id },
          _sum: {
            processed: true,
            updated: true,
            skipped: true,
            errors: true
          }
        })
      ])

      // 计算批次成功率
      const totalBatchWithStatus = batchSuccessCount + batchFailedCount
      const batchSuccessRate = totalBatchWithStatus > 0 
        ? Math.round((batchSuccessCount / totalBatchWithStatus) * 100) 
        : 0

      // 获取昨日批次数用于对比
      const yesterdayBatchCount = await prisma.monitoringLog.count({
        where: {
          isBatchLog: true,
          userId: session.user.id,
          triggeredAt: {
            gte: yesterday,
            lt: today
          }
        }
      })

      return NextResponse.json({
        // 批次日志统计
        totalCount: totalBatchCount,
        todayCount: todayBatchCount,
        yesterdayCount: yesterdayBatchCount,
        successCount: batchSuccessCount,
        failedCount: batchFailedCount,
        skippedCount: batchSkippedCount,
        successRate: batchSuccessRate,
        weeklyStats: weeklyStats.reduce((acc, item) => {
          acc[item.status] = item._count.id
          return acc
        }, {} as Record<string, number>),
        // 广告系列处理统计（从批次日志聚合）
        campaignStats: {
          totalProcessed: batchAggregates._sum.processed || 0,
          totalUpdated: batchAggregates._sum.updated || 0,
          totalSkipped: batchAggregates._sum.skipped || 0,
          totalErrors: batchAggregates._sum.errors || 0
        }
      })
    }

    return NextResponse.json(
      { error: '未知操作类型' },
      { status: 400 }
    )

  } catch (error) {
    console.error('获取监控日志统计失败:', error)
    return NextResponse.json(
      { error: '获取统计数据失败' },
      { status: 500 }
    )
  }
}
