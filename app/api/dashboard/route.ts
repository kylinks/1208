import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    // 验证用户登录（管理员也仅查看自己的数据）
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    // 广告系列监控列表的查询条件：启用状态且有联盟链接的广告系列
    const monitoringWhere = {
      userId: session.user.id,
      deletedAt: null,
      enabled: true,
      affiliateConfigs: {
        some: {
          deletedAt: null,
          enabled: true,
          affiliateLink: {
            not: '',
          },
        },
      },
    }

    // 获取监控列表中的广告系列总数
    const totalCampaigns = await prisma.campaign.count({
      where: monitoringWhere
    })

    // 获取监控列表中的所有广告系列（用于统计点击数和换链总数）
    const campaigns = await prisma.campaign.findMany({
      where: monitoringWhere,
      select: {
        id: true,
        todayClicks: true,
        lastClicks: true
      }
    })

    const campaignIds = campaigns.map(c => c.id)

    // 今日点击数：监控列表中所有广告系列今日点击数总和
    const todayClicks = campaigns.reduce((sum, c) => sum + c.todayClicks, 0)
    const yesterdayClicks = campaigns.reduce((sum, c) => sum + c.lastClicks, 0)
    const clicksChange = yesterdayClicks > 0 
      ? ((todayClicks - yesterdayClicks) / yesterdayClicks) * 100 
      : 0

    // 今日 0 点（跨日重新计算）
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // 今日换链总数：仅统计今日成功换链次数（跨日清零）
    const todayReplacements = await prisma.monitoringLog.count({
      where: {
        campaignId: {
          in: campaignIds
        },
        OR: [{ userId: session.user.id }, { userId: null }],
        triggeredAt: {
          gte: today
        },
        status: 'success'
      }
    })

    // 计算换链成功率（今日的成功率，跨日重新计算）
    
    const todaySuccessLogs = await prisma.monitoringLog.count({
      where: {
        campaignId: {
          in: campaignIds
        },
        OR: [{ userId: session.user.id }, { userId: null }],
        triggeredAt: {
          gte: today
        },
        status: 'success'
      }
    })

    const todayTotalLogs = await prisma.monitoringLog.count({
      where: {
        campaignId: {
          in: campaignIds
        },
        OR: [{ userId: session.user.id }, { userId: null }],
        triggeredAt: {
          gte: today
        }
      }
    })

    const successRate = todayTotalLogs > 0 ? (todaySuccessLogs / todayTotalLogs) * 100 : 0

    return NextResponse.json({
      totalCampaigns,
      todayReplacements,
      successRate: parseFloat(successRate.toFixed(2)),
      todayClicks,
      clicksChange: parseFloat(clicksChange.toFixed(2))
    })

  } catch (error) {
    console.error('获取仪表盘数据失败:', error)
    return NextResponse.json(
      { error: '获取仪表盘数据失败' },
      { status: 500 }
    )
  }
}
