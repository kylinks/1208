import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

// 广告系列监控数据接口
export interface CampaignMonitoringItem {
  id: string
  campaignName: string
  domain: string
  countryCode: string
  affiliateLink: string
  lastClicks: number
  todayClicks: number
  originalLink: string | null
  checkTime: string | null
  newLink: string | null
  proxyIp: string | null
  totalReplacements: number
}

// 从 URL 提取根域名（去除 http/https 和 www）
function extractRootDomain(url: string | null): string {
  if (!url) return '-'
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^www\./, '')
  } catch {
    // 如果不是有效的 URL，尝试直接去除 www
    return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0] || '-'
  }
}

// 从 URL 提取后缀（仅 query 参数，不含 '?'）
function extractUrlSuffix(url: string | null): string | null {
  if (!url) return null
  try {
    const urlObj = new URL(url)
    const search = urlObj.search || ''
    if (!search || search === '?') return null
    return search.startsWith('?') ? search.slice(1) : search
  } catch {
    // 如果不是有效的 URL，返回 null
    return null
  }
}

// 获取广告系列监控列表
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
    const search = searchParams.get('search') || ''
    const countryCode = searchParams.get('countryCode') || ''

    // 构建查询条件：只查询启用状态且有联盟链接的广告系列
    const where: any = {
      userId: session.user.id,
      deletedAt: null,
      enabled: true, // 广告系列启用状态
      // 必须有联盟链接配置
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

    if (search) {
      where.name = {
        contains: search,
      }
    }

    if (countryCode) {
      where.countryCode = countryCode
    }

    // 获取广告系列列表及其关联数据
    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where,
        include: {
          affiliateConfigs: {
            where: {
              deletedAt: null,
              enabled: true,
              affiliateLink: {
                not: '',
              },
            },
            orderBy: {
              priority: 'asc',
            },
            take: 1, // 只取优先级最高的配置
          },
          monitoringLogs: {
            orderBy: {
              triggeredAt: 'desc',
            },
            take: 1, // 只取最新的一条日志
          },
          usedProxyIps: {
            orderBy: {
              usedAt: 'desc',
            },
            take: 1, // 只取最新使用的代理IP
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.campaign.count({ where }),
    ])

    // 获取每个广告系列的“今日更换次数”（跨日清零）
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const campaignIds = campaigns.map((c) => c.id)
    const replacementCounts = await prisma.monitoringLog.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: {
          in: campaignIds,
        },
        triggeredAt: {
          gte: today,
        },
        status: 'success',
      },
      _count: {
        id: true,
      },
    })

    // 构建总更换次数映射
    const replacementCountMap = new Map<string, number>()
    replacementCounts.forEach((item) => {
      if (item.campaignId) {
        replacementCountMap.set(item.campaignId, item._count.id)
      }
    })

    // 转换为监控列表格式
    const result: CampaignMonitoringItem[] = campaigns.map((campaign) => {
      const affiliateConfig = campaign.affiliateConfigs[0]
      const latestLog = campaign.monitoringLogs[0]

      // 域名：从最终到达网址提取根域名
      const finalUrl = campaign.lastNewUrl
      const domain = extractRootDomain(finalUrl)
      
      // 新链接：最终到达网址的后缀部分
      const newLink = extractUrlSuffix(finalUrl)

      return {
        id: campaign.id,
        campaignName: campaign.name,
        domain: domain,
        countryCode: campaign.countryCode,
        affiliateLink: affiliateConfig?.affiliateLink || '-',
        lastClicks: campaign.lastClicks,
        todayClicks: campaign.todayClicks,
        originalLink: latestLog?.affiliateLink || null,
        checkTime: latestLog?.triggeredAt?.toISOString() || null,
        newLink: newLink,
        proxyIp: latestLog?.proxyIp || null,
        totalReplacements: replacementCountMap.get(campaign.id) || 0,
      }
    })

    return NextResponse.json({
      data: result,
      total,
      page,
      pageSize,
    })
  } catch (error) {
    console.error('获取广告系列监控数据失败:', error)
    return NextResponse.json(
      { error: '获取广告系列监控数据失败' },
      { status: 500 }
    )
  }
}
