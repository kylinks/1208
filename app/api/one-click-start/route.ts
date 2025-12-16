/**
 * 一键启动 API（性能优化版本）
 * POST /api/one-click-start
 * 
 * 优化点：
 * 1. 并行处理广告系列（使用并发控制）
 * 2. 预加载共享数据（代理供应商、系统配置、已用IP）
 * 3. 批量数据库更新
 * 4. 使用Promise.allSettled确保部分失败不影响其他
 * 
 * 功能：
 * 1. 获取所有启用的广告系列的今日点击数（通过Google Ads API）
 * 2. 与数据库中的上次点击数比较
 * 3. 如果今日点击 > 上次点击：
 *    - 将新链接写入原链接
 *    - 调用验证功能获取带后缀参数的链接和真实出口IP
 *    - IP在同广告系列24小时内不能重复
 *    - 更新上次点击、今日点击、检测时间
 */

import { NextRequest, NextResponse } from 'next/server'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getGoogleAdsService } from '@/lib/googleAdsService'
import { replacePlaceholders } from '@/lib/proxyPlaceholder'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

// ============== 并发控制配置 ==============
const CONCURRENCY_LIMIT = 10 // 同时处理的广告系列数量
const GOOGLEADS_MCC_CONCURRENCY_LIMIT = Number.parseInt(process.env.ONECLICK_GOOGLEADS_MCC_CONCURRENCY || '2', 10) || 2 // 同时拉取点击数的 MCC 数量（防止洪峰触发 429）
const IP_CHECK_TIMEOUT = 8000 // IP检查超时时间（毫秒）
const REDIRECT_TIMEOUT = 15000 // 重定向超时时间（毫秒）
const PROXY_CONNECT_TIMEOUT = 10000 // 代理连接超时时间（毫秒）
const PROXY_RETRY_COUNT = 3 // 单个供应商重试次数
const PROXY_RETRY_DELAY_BASE = 1000 // 重试基础延迟（毫秒）

// ============== 缓存的共享数据类型 ==============
interface SharedData {
  providers: any[]
  maxRedirects: number
  usedIpsByampaign: Map<string, Set<string>> // campaignId -> Set<ip>
}

/**
 * 对指定 userId 执行一次“一键启动/监控”任务（可被 cron 复用）
 * - 不依赖 next-auth session
 * - 返回结构与 API 响应 data 基本一致
 */
export async function runOneClickStartForUser(userId: string) {
  const startTime = Date.now()

  console.log(`🚀 一键启动开始... userId=${userId}`)

  // 获取所有启用的广告系列（带联盟链接配置）
  const campaigns = await prisma.campaign.findMany({
    where: {
      userId,
      deletedAt: null,
      enabled: true,
      affiliateConfigs: {
        some: {
          deletedAt: null,
          enabled: true,
          affiliateLink: { not: '' },
        },
      },
    },
    include: {
      cidAccount: {
        select: {
          cid: true,
          name: true,
          mccAccount: {
            select: {
              mccId: true,
              name: true,
            },
          },
        },
      },
      affiliateConfigs: {
        where: {
          deletedAt: null,
          enabled: true,
          affiliateLink: { not: '' },
        },
        orderBy: { priority: 'asc' },
        take: 1,
      },
    },
  })

  if (campaigns.length === 0) {
    return {
      processed: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      results: [],
      executedAt: new Date().toISOString(),
      duration: Date.now() - startTime,
      message: '没有启用的广告系列',
    }
  }

  console.log(`📋 找到 ${campaigns.length} 个广告系列 userId=${userId}`)

  // 预加载共享数据（一次性查询，只获取分配给当前用户的代理供应商）
  const campaignIds = campaigns.map(c => c.id)
  const sharedData = await preloadSharedData(campaignIds, userId)
  console.log(`📦 预加载完成: ${sharedData.providers.length} 个代理供应商（已分配给当前用户）, 最大跳转 ${sharedData.maxRedirects} 次`)

  // 按 MCC 分组获取点击数
  const googleAdsService = getGoogleAdsService()
  const mccGroups = new Map<string, typeof campaigns>()

  for (const campaign of campaigns) {
    const mccId = campaign.cidAccount.mccAccount.mccId
    const group = mccGroups.get(mccId) || []
    group.push(campaign)
    mccGroups.set(mccId, group)
  }

  // 并行获取各MCC的今日点击数
  const clicksMap = new Map<string, number>()
  const mccEntries = Array.from(mccGroups.entries())
  await runWithConcurrencyLimit<[string, typeof campaigns], void>(
    mccEntries,
    Math.max(1, GOOGLEADS_MCC_CONCURRENCY_LIMIT),
    async ([mccId, mccCampaigns]) => {
      const campaignInfos = mccCampaigns.map(c => ({
        cidId: c.cidAccount.cid,
        campaignId: c.campaignId,
      }))

      try {
        const batchClicks = await googleAdsService.getBatchCampaignClicks(mccId, campaignInfos)
        for (const [campaignId, clicks] of batchClicks) {
          clicksMap.set(campaignId, clicks)
        }
      } catch (error) {
        console.error(`获取 MCC ${mccId} 点击数失败:`, error)
      }
    }
  )
  console.log(`📊 获取点击数完成，耗时 ${Date.now() - startTime}ms userId=${userId}`)

  // 并行处理广告系列（使用并发控制）
  const pendingGoogleAdsUpdates: {
    mccId: string
    cidId: string
    campaignId: string
    finalUrlSuffix: string
  }[] = []

  const processResults = await runWithConcurrencyLimit<typeof campaigns[number], ProcessResult>(
    campaigns,
    CONCURRENCY_LIMIT,
    async (campaign) => {
      const todayClicks = clicksMap.get(campaign.campaignId) || 0
      return processSingleCampaign(
        campaign as CampaignWithConfig,
        todayClicks,
        sharedData,
        googleAdsService,
        pendingGoogleAdsUpdates
      )
    }
  )

  // ============== 批量提交 Google Ads 后缀更新（按 MCC/CID 聚合） ==============
  if (pendingGoogleAdsUpdates.length > 0) {
    console.log(`🧩 待批量更新 Google Ads 后缀数: ${pendingGoogleAdsUpdates.length} 条 userId=${userId}`)

    // 按 MCC 分组（login-customer-id 维度）
    const mccUpdateGroups = new Map<string, typeof pendingGoogleAdsUpdates>()
    for (const u of pendingGoogleAdsUpdates) {
      const group = mccUpdateGroups.get(u.mccId) || []
      group.push(u)
      mccUpdateGroups.set(u.mccId, group)
    }

    const googleAdsResultMap = new Map<string, { success: boolean; error?: string }>()
    for (const [mccId, updates] of mccUpdateGroups) {
      const perMccUpdates = updates.map(u => ({
        cidId: u.cidId,
        campaignId: u.campaignId,
        finalUrlSuffix: u.finalUrlSuffix,
      }))

      const resultMap = await googleAdsService.batchUpdateCampaignFinalUrlSuffix(mccId, perMccUpdates)
      for (const [campaignId, r] of resultMap) {
        googleAdsResultMap.set(campaignId, r)
      }
    }

    // 回填到结果里（仅对本次尝试过更新的 campaign）
    const attemptedSet = new Set(pendingGoogleAdsUpdates.map(u => u.campaignId))
    let attempted = 0
    let succeeded = 0
    let failed = 0

    for (const r of processResults) {
      if (r.status !== 'updated') continue
      if (!r.newLink) continue
      if (!attemptedSet.has(r.campaignId)) continue

      attempted += 1
      const res = googleAdsResultMap.get(r.campaignId)
      if (res?.success) {
        r.googleAdsUpdated = true
        r.googleAdsError = undefined
        succeeded += 1
      } else {
        r.googleAdsUpdated = false
        r.googleAdsError = res?.error || '批量更新未返回该 campaign 的结果'
        failed += 1
      }
    }

    console.log(`🧾 Google Ads 批量更新完成 userId=${userId} attempted=${attempted} success=${succeeded} failed=${failed}`)
  }

  // 统计结果
  let processed = 0
  let updated = 0
  let skipped = 0
  let errors = 0
  const results: ProcessResult[] = []

  for (const result of processResults) {
    processed++
    if (result.status === 'updated') {
      updated++
    } else if (result.status === 'skipped') {
      skipped++
    } else if (result.status === 'error') {
      errors++
    }
    results.push(result)
  }

  const duration = Date.now() - startTime
  console.log(`✅ 一键启动完成 userId=${userId}，总耗时 ${duration}ms，处理 ${processed} 个，更新 ${updated} 个，跳过 ${skipped} 个，错误 ${errors} 个`)

  // 获取当前监控间隔配置
  let intervalMinutes = 5 // 默认值
  try {
    const intervalConfig = await prisma.systemConfig.findUnique({
      where: { key: 'cronInterval' }
    })
    if (intervalConfig) {
      intervalMinutes = parseInt(intervalConfig.value) || 5
    }
  } catch (e) {
    console.warn('获取监控间隔配置失败，使用默认值')
  }

  // 创建批次汇总日志（每次监控周期只生成一条日志）
  const batchLogStatus = errors > 0 ? 'failed' : (updated > 0 ? 'success' : 'skipped')

  // 构建详情数组，包含每个广告系列的处理结果
  const logDetails = results.map(r => ({
    campaignId: r.campaignId,
    campaignName: r.campaignName,
    status: r.status,
    todayClicks: r.todayClicks,
    lastClicks: r.lastClicks,
    newClicks: r.newClicks,
    newLink: r.newLink,
    proxyIp: r.proxyIp,
    googleAdsUpdated: r.googleAdsUpdated,
    googleAdsError: r.googleAdsError,
    reason: r.reason,
    error: r.error,
  }))

  // 为每个成功更新的广告系列创建单独的监控日志（用于统计换链次数）
  const successResults = results.filter(r => r.status === 'updated')
  if (successResults.length > 0) {
    const now = new Date()
    const singleLogPromises = successResults.map(r => {
      const campaign = campaigns.find(c => c.campaignId === r.campaignId)
      return prisma.monitoringLog.create({
        data: {
          userId,
          campaignId: campaign?.id || null,
          triggeredAt: now,
          todayClicks: r.todayClicks || 0,
          lastClicks: r.lastClicks || 0,
          newClicks: r.newClicks || 0,
          proxyIp: r.proxyIp || null,
          affiliateLink: r.affiliateLink || campaign?.affiliateConfigs?.[0]?.affiliateLink || null,
          // 记录最终落地页 URL（用于日志详情展示/排查），避免误写成 suffix
          finalUrl: r.finalUrl || null,
          status: 'success',
          executionTime: duration,
          isBatchLog: false,
        },
      })
    })
    await Promise.all(singleLogPromises)
    console.log(`📝 已创建 ${successResults.length} 条单独监控日志 userId=${userId}`)
  }

  // 创建批次汇总日志（每次监控周期只生成一条日志）
  await prisma.monitoringLog.create({
    data: {
      userId,
      triggeredAt: new Date(),
      status: batchLogStatus,
      executionTime: duration,
      isBatchLog: true,
      processed: processed,
      updated: updated,
      skipped: skipped,
      errors: errors,
      details: logDetails,
      intervalMinutes: intervalMinutes,
      // 批次日志不关联单个广告系列
      campaignId: null,
      providerId: null,
    },
  })

  console.log(`📝 已创建批次监控日志，状态: ${batchLogStatus} userId=${userId}`)

  return {
    processed,
    updated,
    skipped,
    errors,
    results,
    executedAt: new Date().toISOString(),
    duration,
    intervalMinutes,
    batchLogStatus,
  }
}

/**
 * 提取 URL 的根域名
 */
function extractRootDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    const hostWithoutWww = hostname.replace(/^www\./, '')
    const parts = hostWithoutWww.split('.')
    
    if (parts.length <= 2) {
      return hostWithoutWww
    }
    
    // 常见的二级域名后缀
    const multiLevelTlds = [
      'co.uk', 'org.uk', 'com.cn', 'net.cn', 'com.au', 'co.jp', 'co.kr',
      'com.br', 'co.in', 'co.nz', 'co.za', 'com.hk', 'com.tw', 'com.sg',
    ]
    
    const lastTwoParts = parts.slice(-2).join('.')
    if (multiLevelTlds.includes(lastTwoParts)) {
      if (parts.length >= 3) {
        return parts.slice(-3).join('.')
      }
      return hostWithoutWww
    }
    
    return parts.slice(-2).join('.')
  } catch {
    return ''
  }
}

/**
 * 从 HTML 内容中提取重定向链接
 */
function extractRedirectFromHtml(html: string, baseUrl: string): string | null {
  // Meta refresh 标签
  const metaRefreshPatterns = [
    /<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)["']?/i,
    /<meta[^>]*content\s*=\s*["']?\d+\s*;\s*url\s*=\s*["']?([^"'\s>]+)["']?[^>]*http-equiv\s*=\s*["']?refresh["']?/i,
  ]
  
  for (const pattern of metaRefreshPatterns) {
    const match = html.match(pattern)
    if (match && match[1]) {
      return resolveUrl(match[1], baseUrl)
    }
  }

  // JavaScript 重定向
  const jsRedirectPatterns = [
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
    /window\.location\s*=\s*["']([^"']+)["']/i,
    /location\.href\s*=\s*["']([^"']+)["']/i,
    /(?<![.\w])location\s*=\s*["']([^"']+)["']/i,
    /window\.location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
    /location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
  ]

  for (const pattern of jsRedirectPatterns) {
    const match = html.match(pattern)
    if (match && match[1]) {
      const url = match[1]
      if (url && !url.startsWith('#') && !url.startsWith('javascript:')) {
        return resolveUrl(url, baseUrl)
      }
    }
  }

  return null
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    const base = new URL(baseUrl)
    return new URL(url, base.origin).toString()
  } catch {
    return url
  }
}

/**
 * 提取URL的后缀（仅 query 参数，不含 '?'）
 * - 例如: https://a.com/path?a=1&b=2 -> a=1&b=2
 * - 无 query 时返回空字符串（用于跳过 Google Ads 后缀更新）
 */
function extractUrlSuffix(url: string): string {
  try {
    const urlObj = new URL(url)
    const search = urlObj.search || ''
    // search 形如 '?a=1&b=2'，Google Ads final_url_suffix 通常不包含 '?'
    if (!search || search === '?') return ''
    return search.startsWith('?') ? search.slice(1) : search
  } catch {
    return ''
  }
}

/**
 * 预加载所有共享数据（一次性查询，避免重复）
 * @param campaignIds 广告系列ID列表
 * @param userId 当前用户ID（用于筛选分配给该用户的代理供应商）
 */
async function preloadSharedData(campaignIds: string[], userId: string): Promise<SharedData> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  
  // 并行查询所有共享数据
  const [providers, configResult, usedIpsResult] = await Promise.all([
    // 1. 获取代理供应商（只获取分配给当前用户的，未分配则不可用）
    prisma.proxyProvider.findMany({
      where: { 
        enabled: true,
        // 必须分配给当前用户才能使用
        assignedUsers: {
          some: {
            userId: userId
          }
        }
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }]
    }),
    // 2. 获取系统配置
    prisma.systemConfig.findUnique({
      where: { key: 'maxRedirects' }
    }),
    // 3. 批量获取所有广告系列24小时内已使用的IP
    prisma.usedProxyIp.findMany({
      where: {
        campaignId: { in: campaignIds },
        usedAt: { gte: twentyFourHoursAgo }
      },
      select: { campaignId: true, ip: true }
    })
  ])

  // 构建已用IP映射表
  const usedIpsByampaign = new Map<string, Set<string>>()
  for (const record of usedIpsResult) {
    if (!usedIpsByampaign.has(record.campaignId)) {
      usedIpsByampaign.set(record.campaignId, new Set())
    }
    usedIpsByampaign.get(record.campaignId)!.add(record.ip)
  }

  return {
    providers,
    maxRedirects: configResult ? parseInt(configResult.value) || 10 : 10,
    usedIpsByampaign
  }
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 带重试的代理IP获取
 */
async function fetchProxyIpWithRetry(
  proxyAgent: InstanceType<typeof ProxyAgent>,
  retryCount: number = 0
): Promise<{ success: boolean; ip?: string; error?: string }> {
  // 注意：很多云环境会直接拦截/降级 http 出站请求，因此这里优先使用 https 的服务。
  // 同时保留多个不同厂商的服务，避免单点故障或被代理/机房封锁。
  const ipCheckServices: Array<{
    url: string
    type: 'json' | 'text'
    parser: (data: any) => string | undefined
  }> = [
    { url: 'https://checkip.amazonaws.com', type: 'text', parser: (text: string) => text?.trim() },
    { url: 'https://ifconfig.me/ip', type: 'text', parser: (text: string) => text?.trim() },
    { url: 'https://icanhazip.com', type: 'text', parser: (text: string) => text?.trim() },
    { url: 'https://api.ipify.org?format=json', type: 'json', parser: (data: any) => data?.ip },
    { url: 'https://httpbin.org/ip', type: 'json', parser: (data: any) => (data?.origin ? String(data.origin).split(',')[0].trim() : undefined) },
    { url: 'https://api.myip.com', type: 'json', parser: (data: any) => data?.ip },
    // 备用（仅 http，部分环境可能被拦截；放到最后）
    { url: 'http://ip-api.com/json', type: 'json', parser: (data: any) => data?.query },
  ]

  const failures: string[] = []

  for (const service of ipCheckServices) {
    try {
      const ipResponse = await undiciFetch(service.url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ProxyIpCheck/1.0)',
          'Accept': '*/*',
          'Cache-Control': 'no-cache',
        },
        dispatcher: proxyAgent,
        signal: AbortSignal.timeout(IP_CHECK_TIMEOUT),
      })

      if (!ipResponse.ok) {
        failures.push(`${service.url} -> HTTP ${ipResponse.status}`)
        continue
      }

      const raw = service.type === 'json' ? await ipResponse.json() : await ipResponse.text()
      const ip = service.parser(raw)
      if (ip) {
        return { success: true, ip }
      }

      failures.push(`${service.url} -> 无法解析IP`)
    } catch (e: any) {
      const errorMsg = e?.cause?.message || e?.message || '未知错误'
      const errorCode = e?.cause?.code || e?.code
      const reason = errorCode ? `${errorCode}: ${errorMsg}` : errorMsg
      console.warn(`IP查询服务 ${service.url} 失败:`, reason)
      failures.push(`${service.url} -> ${reason}`)

      // 判断是否需要重试（连接失败、超时等）
      const isRetryableError =
        String(reason).includes('fetch failed') ||
        String(reason).includes('ETIMEDOUT') ||
        String(reason).includes('ECONNREFUSED') ||
        String(reason).includes('ECONNRESET') ||
        String(reason).includes('timeout') ||
        String(reason).includes('UND_ERR_CONNECT_TIMEOUT') ||
        String(reason).includes('UND_ERR_SOCKET')

      if (isRetryableError && retryCount < PROXY_RETRY_COUNT) {
        const delayMs = PROXY_RETRY_DELAY_BASE * Math.pow(2, retryCount)
        console.log(`⏳ 代理连接失败，${delayMs / 1000} 秒后重试... (第 ${retryCount + 1}/${PROXY_RETRY_COUNT} 次)`)
        await delay(delayMs)
        return fetchProxyIpWithRetry(proxyAgent, retryCount + 1)
      }

      continue
    }
  }

  const details = failures.length ? `: ${failures.slice(0, 6).join('; ')}${failures.length > 6 ? ' ...' : ''}` : ''
  return { success: false, error: `所有IP查询服务均失败${details}` }
}

/**
 * 验证联盟链接并获取最终URL和代理IP（优化版本，使用预加载数据）
 * 支持供应商轮换和连接重试
 */
async function verifyAffiliateLinkOptimized(
  affiliateLink: string,
  countryCode: string,
  referrer: string,
  targetDomain: string,
  campaignId: string,
  sharedData: SharedData
): Promise<{
  success: boolean
  finalUrl?: string
  proxyIp?: string
  providerId?: string
  matched?: boolean
  error?: string
}> {
  try {
    const { providers, maxRedirects, usedIpsByampaign } = sharedData

    if (providers.length === 0) {
      return { success: false, error: '没有可用的代理供应商' }
    }

    const usedIpSet = usedIpsByampaign.get(campaignId) || new Set()
    const providerErrors: string[] = [] // 记录每个供应商的错误

    // 遍历所有供应商（供应商轮换）
    for (let providerIndex = 0; providerIndex < providers.length; providerIndex++) {
      const provider = providers[providerIndex]
      console.log(`🔌 尝试供应商 ${providerIndex + 1}/${providers.length}: ${provider.name}`)

      // 每个供应商最多尝试获取不同IP的次数
      const maxIpAttempts = 5
      let lastProviderError: string | null = null

      for (let ipAttempt = 0; ipAttempt < maxIpAttempts; ipAttempt++) {
        const usernameReplaced = replacePlaceholders(provider.username, countryCode)
        const passwordReplaced = replacePlaceholders(provider.password, countryCode)
        
        const proxyUrl = `http://${encodeURIComponent(usernameReplaced.result)}:${encodeURIComponent(passwordReplaced.result)}@${provider.proxyHost}:${provider.proxyPort}`
        
        console.log(`🔄 供应商 ${provider.name} 第 ${ipAttempt + 1} 次尝试，国家: ${countryCode}`)
        
        const proxyAgent = new ProxyAgent({
          uri: proxyUrl,
          requestTls: { rejectUnauthorized: false },
          connect: { timeout: PROXY_CONNECT_TIMEOUT }
        })

        // 获取实际代理IP（带重试）
        const ipResult = await fetchProxyIpWithRetry(proxyAgent)
        
        if (!ipResult.success) {
          lastProviderError = ipResult.error || '无法获取代理IP'
          console.warn(`⚠️ 供应商 ${provider.name} 第 ${ipAttempt + 1} 次尝试失败: ${lastProviderError}`)
          
          // 如果是连接级别的错误，直接跳到下一个供应商
          if (lastProviderError.includes('fetch failed') || 
              lastProviderError.includes('ETIMEDOUT') ||
              lastProviderError.includes('ECONNREFUSED')) {
            console.log(`❌ 供应商 ${provider.name} 连接失败，尝试下一个供应商`)
            break
          }
          continue
        }

        const actualProxyIp = ipResult.ip!
        console.log(`✅ 获取到代理IP: ${actualProxyIp}`)

        // 检查IP是否已被使用
        if (usedIpSet.has(actualProxyIp)) {
          console.log(`⚠️ IP ${actualProxyIp} 在24小时内已被使用，尝试获取新IP...`)
          continue
        }

      // 检查IP是否已被使用
      if (usedIpSet.has(actualProxyIp)) {
        console.log(`⚠️ IP ${actualProxyIp} 在24小时内已被使用，尝试获取新IP...`)
        continue
      }

      // 跟踪重定向获取最终URL
      let currentUrl = affiliateLink
      let finalUrl = affiliateLink
      const normalizedTargetDomain = targetDomain.replace(/^www\./, '').toLowerCase()
      let matched = false
      let redirectError: string | null = null
      let redirectCount = 0

      for (let i = 0; i < maxRedirects; i++) {
        try {
          console.log(`🔗 跳转 ${i + 1}: ${currentUrl.substring(0, 80)}...`)
          const response = await undiciFetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'Referer': referrer || 'https://t.co',
              'Connection': 'keep-alive',
            },
            dispatcher: proxyAgent,
            signal: AbortSignal.timeout(REDIRECT_TIMEOUT)
          })

          const statusCode = response.status
          console.log(`📡 响应状态: ${statusCode}`)
          let nextUrl: string | null = null

          if (statusCode >= 300 && statusCode < 400) {
            const location = response.headers.get('location')
            if (location) {
              nextUrl = location
              if (!location.startsWith('http')) {
                const baseUrl = new URL(currentUrl)
                nextUrl = new URL(location, baseUrl.origin).toString()
              }
            }
          }

          if (!nextUrl && statusCode >= 200 && statusCode < 300) {
            try {
              const html = await response.text()
              nextUrl = extractRedirectFromHtml(html, currentUrl)
            } catch (e) {
              // 忽略解析错误
            }
          }

          if (nextUrl) {
            finalUrl = nextUrl
            redirectCount++
            const nextDomain = extractRootDomain(nextUrl)
            
            if (normalizedTargetDomain && nextDomain === normalizedTargetDomain) {
              matched = true
              console.log(`✅ 域名匹配成功: ${nextDomain}`)
              break
            }
            currentUrl = nextUrl
          } else {
            finalUrl = currentUrl
            const finalDomain = extractRootDomain(currentUrl)
            if (normalizedTargetDomain && finalDomain === normalizedTargetDomain) {
              matched = true
            }
            break
          }
        } catch (fetchError: any) {
          const errorMsg = fetchError.cause?.message || fetchError.message || '未知错误'
          console.error(`❌ 请求错误 (${countryCode}):`, errorMsg)
          redirectError = errorMsg
          
          // 如果是第一次请求就失败，可能是代理问题
          if (i === 0) {
            lastProviderError = `代理请求失败 (${countryCode}): ${errorMsg}`
          }
          break
        }
      }

      // 检查最终URL的域名是否与目标域名一致
      const finalDomain = extractRootDomain(finalUrl)
      if (normalizedTargetDomain && finalDomain === normalizedTargetDomain) {
        matched = true
      }

      // 只要有跳转就算成功（即使域名不完全匹配也可以使用）
      if (redirectCount > 0 || finalUrl !== affiliateLink) {
        console.log(`✅ 验证完成: 最终URL=${finalUrl.substring(0, 80)}..., 匹配=${matched}, 跳转次数=${redirectCount}`)
        return {
          success: true,
          finalUrl: finalUrl,
          proxyIp: actualProxyIp,
          providerId: provider.id,
          matched: matched,
        }
      }

      // 如果没有任何跳转但也没有错误，可能是直接返回的页面
      if (!redirectError && finalUrl === affiliateLink) {
        // 尝试将当前URL作为最终URL使用
        console.log(`⚠️ 无跳转，使用原链接作为最终URL`)
        return {
          success: true,
          finalUrl: finalUrl,
          proxyIp: actualProxyIp,
          providerId: provider.id,
          matched: false,
        }
      }

        // 如果有重定向错误，记录下来
        if (redirectError) {
          lastProviderError = `链接验证失败 (${countryCode}): ${redirectError}`
        } else {
          lastProviderError = `无法获取有效的最终URL (${countryCode})`
        }
      }

      // 记录当前供应商的错误
      if (lastProviderError) {
        providerErrors.push(`${provider.name}: ${lastProviderError}`)
      }
    }

    // 所有供应商都失败了
    const errorSummary = providerErrors.length > 0 
      ? `所有代理供应商均失败:\n${providerErrors.join('\n')}`
      : '代理连接失败，请检查代理配置'
    
    return { success: false, error: errorSummary }
  } catch (error: any) {
    console.error('验证联盟链接失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 并发控制器 - 限制同时执行的Promise数量
 */
async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let currentIndex = 0
  
  const executeNext = async (): Promise<void> => {
    while (currentIndex < items.length) {
      const index = currentIndex++
      try {
        results[index] = await fn(items[index], index)
      } catch (error: any) {
        // 记录错误但继续处理
        console.error(`处理第 ${index} 项时出错:`, error.message)
        results[index] = { error: error.message } as any
      }
    }
  }
  
  // 启动多个并发worker
  const workers = Array(Math.min(limit, items.length))
    .fill(null)
    .map(() => executeNext())
  
  await Promise.all(workers)
  return results
}

/**
 * 处理单个广告系列（用于并行处理）
 */
interface ProcessResult {
  campaignId: string
  campaignName: string
  status: 'updated' | 'skipped' | 'error'
  todayClicks?: number
  lastClicks?: number
  newClicks?: number
  newLink?: string
  affiliateLink?: string
  finalUrl?: string
  proxyIp?: string
  googleAdsUpdated?: boolean
  googleAdsError?: string
  reason?: string
  error?: string
}

interface CampaignWithConfig {
  id: string
  campaignId: string
  name: string
  countryCode: string
  referrer: string | null
  lastClicks: number
  replacementCountToday: number
  cidAccount: {
    cid: string
    name: string
    mccAccount: {
      mccId: string
      name: string
    }
  }
  affiliateConfigs: {
    affiliateLink: string
    targetDomain: string
  }[]
}

async function processSingleCampaign(
  campaign: CampaignWithConfig,
  todayClicks: number,
  sharedData: SharedData,
  googleAdsService: any,
  pendingGoogleAdsUpdates: {
    mccId: string
    cidId: string
    campaignId: string
    finalUrlSuffix: string
  }[]
): Promise<ProcessResult> {
  let lastClicks = campaign.lastClicks
  let crossDayReset = false

  console.log(`📊 广告系列 ${campaign.name}: 今日点击=${todayClicks}, 上次点击=${lastClicks}`)

  // 跨日处理：Google Ads 的“今日点击”会在新的一天从 0 重新累计
  // 若出现“上次点击 > 今日点击”，判定为跨日，将上次点击清零（并写回数据库）
  if (lastClicks > todayClicks) {
    crossDayReset = true
    console.log(`🌙 检测到跨日：${campaign.name} 上次点击(${lastClicks}) > 今日点击(${todayClicks})，将上次点击清零`)

    // 写库失败不应阻塞本次流程：先按清零后的逻辑继续，下一次再尝试修正
    try {
      const resetAt = new Date()
      await prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          lastClicks: 0,
          todayClicks: todayClicks,
          updatedAt: resetAt,
        },
      })
    } catch (e: any) {
      console.warn(`⚠️ 跨日清零写库失败: ${campaign.name}`, e?.message || e)
    }

    lastClicks = 0
  }

  // 检查是否有新点击
  if (todayClicks <= lastClicks) {
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      status: 'skipped',
      reason: crossDayReset ? '跨日已清零，今日暂无新增点击' : '无新增点击',
      todayClicks,
      lastClicks,
    }
  }

  // 有新点击，执行验证
  const affiliateConfig = campaign.affiliateConfigs[0]
  if (!affiliateConfig) {
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      status: 'skipped',
      reason: '无联盟链接配置',
    }
  }

  // 调用验证功能（使用预加载的共享数据）
  console.log(`🚀 开始验证广告系列: ${campaign.name}`)
  const verifyResult = await verifyAffiliateLinkOptimized(
    affiliateConfig.affiliateLink,
    campaign.countryCode,
    campaign.referrer || 'https://t.co',
    affiliateConfig.targetDomain,
    campaign.id,
    sharedData
  )

  // 检查验证是否成功
  if (!verifyResult.success) {
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      status: 'error',
      error: verifyResult.error || '验证失败',
    }
  }

  // 检查是否获取到有效的最终URL
  if (!verifyResult.finalUrl) {
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      status: 'error',
      error: '无法获取最终URL',
    }
  }

  // 检查域名是否匹配
  if (!verifyResult.matched) {
    console.warn(`⚠️ 广告系列 ${campaign.name} 域名不匹配，但仍然继续处理`)
  }

  // 提取链接后缀
  const newLinkSuffix = extractUrlSuffix(verifyResult.finalUrl)
  const now = new Date()

  // 更新数据库
  try {
    // 使用事务批量更新（不再单独记录日志，改为最后统一记录批次日志）
    await prisma.$transaction([
      // 更新广告系列
      prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          lastClicks: todayClicks,
          todayClicks: todayClicks,
          lastNewUrl: verifyResult.finalUrl,
          lastReplacementAt: now,
          replacementCountToday: campaign.replacementCountToday + 1,
          updatedAt: now,
        },
      }),
      // 记录使用的代理IP
      ...(verifyResult.proxyIp && verifyResult.providerId ? [
        prisma.usedProxyIp.create({
          data: {
            ip: verifyResult.proxyIp,
            port: 0,
            countryCode: campaign.countryCode,
            providerId: verifyResult.providerId,
            campaignId: campaign.id,
            usedAt: now,
          },
        })
      ] : []),
    ])

    // 【建议 C：合并写】不在这里逐 campaign 调用 mutate（容易放大请求数触发 429）
    // 这里只收集待更新项，统一在 runOneClickStartForUser 结束时按 MCC/CID 聚合批量提交（每次最多 100 operations）
    if (newLinkSuffix) {
      pendingGoogleAdsUpdates.push({
        mccId: campaign.cidAccount.mccAccount.mccId,
        cidId: campaign.cidAccount.cid,
        campaignId: campaign.campaignId,
        finalUrlSuffix: newLinkSuffix,
      })
    }

    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      status: 'updated',
      todayClicks,
      lastClicks,
      newClicks: todayClicks - lastClicks,
      newLink: newLinkSuffix,
      affiliateLink: affiliateConfig.affiliateLink,
      finalUrl: verifyResult.finalUrl,
      proxyIp: verifyResult.proxyIp,
      // googleAdsUpdated / googleAdsError：后续批量提交后再回填
    }
  } catch (dbError: any) {
    console.error('数据库更新失败:', dbError)
    return {
      campaignId: campaign.campaignId,
      campaignName: campaign.name,
      status: 'error',
      error: '数据库更新失败',
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      )
    }
    const data = await runOneClickStartForUser(session.user.id)
    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    console.error('一键启动失败:', error)
    return NextResponse.json(
      { success: false, error: error.message || '一键启动失败' },
      { status: 500 }
    )
  }
}
