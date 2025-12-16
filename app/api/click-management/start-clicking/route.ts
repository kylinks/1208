/**
 * 开始刷点击 API
 * POST /api/click-management/start-clicking
 * 
 * 功能：
 * 1. 批量提取当前列表下所有启用状态下且待刷点击数大于0的数据
 * 2. 取当前数据的国家，去提取对应的代理IP
 * 3. 使用代理IP，附上来路，去访问联盟链接，以达到刷点击的目的
 * 4. 以当前时间离当天23:59还有多少个小时，然后将待刷点击/剩余小时数，计算出每小时需要刷多少个点击
 * 5. 重复2-3步，直到刷满待刷点击数，或者'跨日清零'
 */

import { NextRequest, NextResponse } from 'next/server'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { replacePlaceholders } from '@/lib/proxyPlaceholder'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

// 配置
const REQUEST_TIMEOUT = 15000 // 请求超时时间（毫秒）
const MAX_CONCURRENT_CLICKS = 5 // 最大并发点击数

interface ClickTask {
  campaignId: string
  campaignName: string
  countryCode: string
  referrer: string | null
  affiliateLink: string
  pendingClicks: number
  clickManagementId: string
}

interface ClickResult {
  campaignId: string
  campaignName: string
  success: boolean
  clickedCount: number
  remainingClicks: number
  error?: string
  proxyIp?: string
}

/**
 * 计算到当天23:59还有多少小时
 */
function getHoursUntilMidnight(): number {
  const now = new Date()
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)
  
  const diffMs = endOfDay.getTime() - now.getTime()
  const diffHours = diffMs / (1000 * 60 * 60)
  
  // 至少返回1小时，避免除以0
  return Math.max(1, diffHours)
}

/**
 * 计算每小时需要刷多少点击
 */
function calculateClicksPerHour(pendingClicks: number): number {
  const hoursRemaining = getHoursUntilMidnight()
  const clicksPerHour = Math.ceil(pendingClicks / hoursRemaining)
  return clicksPerHour
}

/**
 * 检查是否跨日（新的一天）
 */
function isNewDay(lastClickTime: Date | null): boolean {
  if (!lastClickTime) return false
  
  const now = new Date()
  const lastDate = new Date(lastClickTime)
  
  return now.getDate() !== lastDate.getDate() ||
         now.getMonth() !== lastDate.getMonth() ||
         now.getFullYear() !== lastDate.getFullYear()
}

/**
 * 使用代理访问联盟链接
 */
async function clickWithProxy(
  affiliateLink: string,
  referrer: string,
  proxyConfig: {
    host: string
    port: number
    username: string
    password: string
  }
): Promise<{ success: boolean; proxyIp?: string; error?: string }> {
  try {
    const proxyUrl = `http://${encodeURIComponent(proxyConfig.username)}:${encodeURIComponent(proxyConfig.password)}@${proxyConfig.host}:${proxyConfig.port}`
    
    const proxyAgent = new ProxyAgent({
      uri: proxyUrl,
      requestTls: { rejectUnauthorized: false }
    })

    // 获取实际代理IP
    let actualProxyIp = ''
    try {
      // 优先使用 https 的 IP 查询服务，避免云环境拦截 http 出站请求
      const ipResponse = await undiciFetch('https://checkip.amazonaws.com', {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ProxyIpCheck/1.0)',
          'Accept': '*/*',
          'Cache-Control': 'no-cache',
        },
        dispatcher: proxyAgent,
        signal: AbortSignal.timeout(8000)
      })
      if (ipResponse.ok) {
        actualProxyIp = (await ipResponse.text()).trim()
      }
    } catch (e) {
      console.warn('获取代理IP失败，继续执行点击')
    }

    // 访问联盟链接
    const response = await undiciFetch(affiliateLink, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': referrer,
        'Connection': 'keep-alive',
      },
      dispatcher: proxyAgent,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT)
    })

    console.log(`✅ 点击成功: ${affiliateLink.substring(0, 50)}..., 状态: ${response.status}, 代理IP: ${actualProxyIp}`)
    
    return { success: true, proxyIp: actualProxyIp }
  } catch (error: any) {
    console.error(`❌ 点击失败: ${error.message}`)
    return { success: false, error: error.message }
  }
}

/**
 * 处理单个广告系列的点击任务
 */
async function processClickTask(
  task: ClickTask,
  providers: any[],
  maxClicksThisBatch: number
): Promise<ClickResult> {
  let clickedCount = 0
  let lastError: string | undefined
  let lastProxyIp: string | undefined

  // 找到匹配国家的代理供应商
  const provider = providers[0] // 使用第一个可用的供应商
  if (!provider) {
    return {
      campaignId: task.campaignId,
      campaignName: task.campaignName,
      success: false,
      clickedCount: 0,
      remainingClicks: task.pendingClicks,
      error: '没有可用的代理供应商'
    }
  }

  // 执行点击
  const clicksToExecute = Math.min(maxClicksThisBatch, task.pendingClicks)
  
  for (let i = 0; i < clicksToExecute; i++) {
    // 替换用户名和密码中的占位符
    const usernameReplaced = replacePlaceholders(provider.username, task.countryCode)
    const passwordReplaced = replacePlaceholders(provider.password, task.countryCode)

    const result = await clickWithProxy(
      task.affiliateLink,
      task.referrer || 'https://t.co',
      {
        host: provider.proxyHost,
        port: provider.proxyPort,
        username: usernameReplaced.result,
        password: passwordReplaced.result
      }
    )

    if (result.success) {
      clickedCount++
      lastProxyIp = result.proxyIp
    } else {
      lastError = result.error
      // 如果连续失败，可以考虑中断
      if (clickedCount === 0 && i >= 2) {
        break
      }
    }

    // 添加随机延迟，避免请求过于频繁 (500ms - 2000ms)
    const delay = 500 + Math.random() * 1500
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  return {
    campaignId: task.campaignId,
    campaignName: task.campaignName,
    success: clickedCount > 0,
    clickedCount,
    remainingClicks: task.pendingClicks - clickedCount,
    error: clickedCount === 0 ? lastError : undefined,
    proxyIp: lastProxyIp
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  
  try {
    // 验证用户登录
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      )
    }

    // 检查用户角色
    if (session.user.role !== 'employee') {
      return NextResponse.json(
        { success: false, error: '无权限' },
        { status: 403 }
      )
    }

    console.log('🚀 开始刷点击...')

    // 1. 获取所有启用状态且待刷点击数>0的广告系列
    const campaigns = await prisma.campaign.findMany({
      where: {
        userId: session.user.id,
        deletedAt: null,
        clickManagement: {
          enabled: true,
          pendingClicks: { gt: 0 }
        }
      },
      include: {
        clickManagement: true,
        affiliateConfigs: {
          where: {
            deletedAt: null,
            enabled: true,
            affiliateLink: { not: '' }
          },
          orderBy: { priority: 'asc' },
          take: 1
        }
      }
    })

    if (campaigns.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: '没有需要刷点击的广告系列',
          processed: 0,
          totalClicked: 0,
          duration: Date.now() - startTime
        }
      })
    }

    console.log(`📋 找到 ${campaigns.length} 个需要刷点击的广告系列`)

    // 2. 获取代理供应商
    const providers = await prisma.proxyProvider.findMany({
      where: { enabled: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }]
    })

    if (providers.length === 0) {
      return NextResponse.json({
        success: false,
        error: '没有可用的代理供应商，请先配置代理'
      }, { status: 400 })
    }

    // 3. 构建点击任务列表
    const tasks: ClickTask[] = campaigns
      .filter(c => c.clickManagement && c.affiliateConfigs[0])
      .map(c => ({
        campaignId: c.id,
        campaignName: c.name,
        countryCode: c.countryCode,
        referrer: c.referrer,
        affiliateLink: c.affiliateConfigs[0].affiliateLink,
        pendingClicks: c.clickManagement!.pendingClicks,
        clickManagementId: c.clickManagement!.id
      }))

    if (tasks.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: '没有配置联盟链接的广告系列',
          processed: 0,
          totalClicked: 0,
          duration: Date.now() - startTime
        }
      })
    }

    // 4. 计算每小时需要刷的点击数，并执行本批次点击
    const hoursRemaining = getHoursUntilMidnight()
    console.log(`⏰ 距离今天结束还有 ${hoursRemaining.toFixed(2)} 小时`)

    const results: ClickResult[] = []
    let totalClicked = 0

    // 并行处理任务（限制并发数）
    for (let i = 0; i < tasks.length; i += MAX_CONCURRENT_CLICKS) {
      const batch = tasks.slice(i, i + MAX_CONCURRENT_CLICKS)
      
      const batchResults = await Promise.all(
        batch.map(task => {
          // 计算本批次每个任务最多刷多少点击
          const clicksPerHour = calculateClicksPerHour(task.pendingClicks)
          // 本次调用最多刷 clicksPerHour 个，确保均匀分布到全天
          const maxClicksThisBatch = Math.max(1, Math.min(clicksPerHour, 100)) // 单次最多100个点击
          
          console.log(`📊 ${task.campaignName}: 待刷${task.pendingClicks}个, 每小时${clicksPerHour}个, 本批次最多${maxClicksThisBatch}个`)
          
          return processClickTask(task, providers, maxClicksThisBatch)
        })
      )

      results.push(...batchResults)
      totalClicked += batchResults.reduce((sum, r) => sum + r.clickedCount, 0)
    }

    // 5. 更新数据库中的待刷点击数
    const updatePromises = results
      .filter(r => r.clickedCount > 0)
      .map(r => {
        const task = tasks.find(t => t.campaignId === r.campaignId)
        if (!task) return Promise.resolve()
        
        return prisma.clickManagement.update({
          where: { id: task.clickManagementId },
          data: {
            pendingClicks: Math.max(0, r.remainingClicks),
            updatedAt: new Date()
          }
        })
      })

    await Promise.all(updatePromises)

    const duration = Date.now() - startTime
    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    console.log(`✅ 刷点击完成，总耗时 ${duration}ms，成功 ${successCount} 个，失败 ${failCount} 个，共点击 ${totalClicked} 次`)

    return NextResponse.json({
      success: true,
      data: {
        processed: results.length,
        successCount,
        failCount,
        totalClicked,
        hoursRemaining: hoursRemaining.toFixed(2),
        results: results.map(r => ({
          campaignName: r.campaignName,
          success: r.success,
          clickedCount: r.clickedCount,
          remainingClicks: r.remainingClicks,
          error: r.error,
          proxyIp: r.proxyIp
        })),
        duration,
        executedAt: new Date().toISOString()
      }
    })

  } catch (error: any) {
    console.error('刷点击失败:', error)
    return NextResponse.json(
      { success: false, error: error.message || '刷点击失败', duration: Date.now() - startTime },
      { status: 500 }
    )
  }
}

/**
 * GET /api/click-management/start-clicking
 * 获取刷点击状态（检查是否有待刷点击的任务）
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      )
    }

    if (session.user.role !== 'employee') {
      return NextResponse.json(
        { success: false, error: '无权限' },
        { status: 403 }
      )
    }

    // 统计待刷点击的任务数量
    const pendingTasks = await prisma.campaign.count({
      where: {
        userId: session.user.id,
        deletedAt: null,
        clickManagement: {
          enabled: true,
          pendingClicks: { gt: 0 }
        }
      }
    })

    // 统计总待刷点击数
    const clickManagements = await prisma.clickManagement.findMany({
      where: {
        enabled: true,
        pendingClicks: { gt: 0 },
        campaign: {
          userId: session.user.id,
          deletedAt: null
        }
      },
      select: {
        pendingClicks: true
      }
    })

    const totalPendingClicks = clickManagements.reduce((sum, cm) => sum + cm.pendingClicks, 0)
    const hoursRemaining = getHoursUntilMidnight()

    return NextResponse.json({
      success: true,
      data: {
        pendingTasks,
        totalPendingClicks,
        hoursRemaining: hoursRemaining.toFixed(2),
        clicksPerHour: totalPendingClicks > 0 ? Math.ceil(totalPendingClicks / hoursRemaining) : 0
      }
    })

  } catch (error: any) {
    console.error('获取刷点击状态失败:', error)
    return NextResponse.json(
      { success: false, error: error.message || '获取状态失败' },
      { status: 500 }
    )
  }
}

