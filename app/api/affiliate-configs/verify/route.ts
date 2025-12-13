import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { replacePlaceholders } from '@/lib/proxyPlaceholder'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireEmployee() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'employee') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const, session }
}

/**
 * 常见的二级域名后缀列表（Public Suffix）
 * 这些后缀需要特殊处理，比如 .co.uk, .com.cn 等
 */
const MULTI_LEVEL_TLDS = [
  // 英国
  'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ac.uk', 'gov.uk',
  // 中国
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
  // 澳大利亚
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  // 日本
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  // 韩国
  'co.kr', 'ne.kr', 'or.kr', 'go.kr',
  // 巴西
  'com.br', 'net.br', 'org.br', 'gov.br',
  // 印度
  'co.in', 'net.in', 'org.in', 'gov.in',
  // 新西兰
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  // 南非
  'co.za', 'net.za', 'org.za', 'gov.za',
  // 香港
  'com.hk', 'net.hk', 'org.hk', 'gov.hk',
  // 台湾
  'com.tw', 'net.tw', 'org.tw', 'gov.tw',
  // 新加坡
  'com.sg', 'net.sg', 'org.sg', 'gov.sg',
  // 马来西亚
  'com.my', 'net.my', 'org.my', 'gov.my',
  // 俄罗斯
  'com.ru', 'net.ru', 'org.ru',
  // 墨西哥
  'com.mx', 'net.mx', 'org.mx', 'gob.mx',
  // 阿根廷
  'com.ar', 'net.ar', 'org.ar', 'gov.ar',
  // 其他常见的
  'co.id', 'co.il', 'co.th', 'co.ve', 'com.pl', 'com.tr', 'com.ua', 'com.vn',
]

/**
 * 提取 URL 的根域名（主域名）
 * 例如：ca-en.caudalie.com -> caudalie.com
 *       www.example.co.uk -> example.co.uk
 *       shop.store.example.com -> example.com
 */
function extractRootDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.toLowerCase()
    
    // 去除 www. 前缀
    const hostWithoutWww = hostname.replace(/^www\./, '')
    
    // 将域名按点分割
    const parts = hostWithoutWww.split('.')
    
    // 如果只有两部分或更少，直接返回（已经是主域名）
    if (parts.length <= 2) {
      return hostWithoutWww
    }
    
    // 检查是否是二级域名后缀（如 .co.uk）
    const lastTwoParts = parts.slice(-2).join('.')
    if (MULTI_LEVEL_TLDS.includes(lastTwoParts)) {
      // 对于二级域名后缀，取最后三部分
      // 例如：shop.example.co.uk -> example.co.uk
      if (parts.length >= 3) {
        return parts.slice(-3).join('.')
      }
      return hostWithoutWww
    }
    
    // 对于普通域名后缀，取最后两部分
    // 例如：ca-en.caudalie.com -> caudalie.com
    return parts.slice(-2).join('.')
  } catch {
    return ''
  }
}

/**
 * 从 HTML 内容中提取重定向链接
 * 支持：
 * 1. <meta http-equiv="refresh" content="0;url=...">
 * 2. JavaScript 重定向: window.location.href, location.replace 等
 */
function extractRedirectFromHtml(html: string, baseUrl: string): string | null {
  // 1. 检查 meta refresh 标签
  // 支持格式: <meta http-equiv="refresh" content="0;url=https://example.com">
  // 或: <meta http-equiv="refresh" content="0; URL=https://example.com">
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

  // 2. 检查 JavaScript 重定向
  const jsRedirectPatterns = [
    // window.location.href = "url" 或 window.location.href = 'url'
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
    // window.location = "url"
    /window\.location\s*=\s*["']([^"']+)["']/i,
    // location.href = "url"
    /location\.href\s*=\s*["']([^"']+)["']/i,
    // location = "url"
    /(?<![.\w])location\s*=\s*["']([^"']+)["']/i,
    // window.location.replace("url")
    /window\.location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
    // location.replace("url")
    /location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
    // document.location.href = "url"
    /document\.location\.href\s*=\s*["']([^"']+)["']/i,
    // document.location = "url"
    /document\.location\s*=\s*["']([^"']+)["']/i,
    // window.open("url", "_self")
    /window\.open\s*\(\s*["']([^"']+)["']\s*,\s*["']_self["']\s*\)/i,
    // self.location = "url"
    /self\.location\s*=\s*["']([^"']+)["']/i,
    // top.location = "url"
    /top\.location\s*=\s*["']([^"']+)["']/i,
  ]

  for (const pattern of jsRedirectPatterns) {
    const match = html.match(pattern)
    if (match && match[1]) {
      const url = match[1]
      // 排除一些明显不是URL的情况
      if (url && !url.startsWith('#') && !url.startsWith('javascript:')) {
        return resolveUrl(url, baseUrl)
      }
    }
  }

  // 3. 检查 <script> 标签中的重定向（更宽松的匹配）
  const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi)
  if (scriptMatch) {
    for (const script of scriptMatch) {
      // 在脚本内容中查找 URL 赋值
      const urlMatch = script.match(/["'](https?:\/\/[^"'\s]+)["']/i)
      if (urlMatch && urlMatch[1]) {
        // 检查这个 URL 是否在某个重定向相关的上下文中
        const context = script.toLowerCase()
        if (context.includes('location') || context.includes('redirect') || context.includes('href')) {
          return resolveUrl(urlMatch[1], baseUrl)
        }
      }
    }
  }

  return null
}

/**
 * 解析相对 URL 为绝对 URL
 */
function resolveUrl(url: string, baseUrl: string): string {
  try {
    // 如果已经是绝对 URL，直接返回
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url
    }
    // 否则解析为绝对 URL
    const base = new URL(baseUrl)
    return new URL(url, base.origin).toString()
  } catch {
    return url
  }
}

/**
 * 验证联盟链接的重定向结果
 */
interface VerifyResult {
  success: boolean
  proxyIp?: string
  proxyProvider?: string
  redirectChain: {
    step: number
    url: string
    domain: string
    statusCode?: number
    redirectType?: string // http, meta, js
  }[]
  finalUrl?: string
  finalDomain?: string
  targetDomain?: string
  matched: boolean
  totalRedirects: number
  error?: string
  message?: string
}

/**
 * POST /api/affiliate-configs/verify
 * 验证联盟链接通过代理访问后的重定向结果
 * 
 * Request Body:
 * - affiliateLink: 联盟链接 URL
 * - countryCode: 国家代码（用于获取对应国家的代理）
 * - referrer: 来路 URL
 * - targetDomain: 目标域名（用于匹配验证）
 * - campaignId: 广告系列 ID（可选，用于代理去重）
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const body = await request.json()
    const { affiliateLink, countryCode, referrer, targetDomain, campaignId } = body

    // 参数验证
    if (!affiliateLink || !countryCode) {
      return NextResponse.json(
        { success: false, error: '缺少必填参数: affiliateLink, countryCode' },
        { status: 400 }
      )
    }

    // 获取系统配置中的最大跳转次数
    let maxRedirects = 10 // 默认值
    try {
      const config = await prisma.systemConfig.findUnique({
        where: { key: 'maxRedirects' }
      })
      if (config) {
        maxRedirects = parseInt(config.value) || 10
      }
    } catch (e) {
      console.warn('获取系统配置失败，使用默认最大跳转次数:', e)
    }

    // 获取可用代理
    const providers = await prisma.proxyProvider.findMany({
      where: {
        enabled: true
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    })

    if (providers.length === 0) {
      return NextResponse.json({
        success: false,
        error: '没有可用的代理供应商',
        matched: false,
        redirectChain: [],
        totalRedirects: 0
      } as VerifyResult)
    }

    // 使用第一个可用的代理供应商
    const provider = providers[0]
    
    // 替换用户名中的占位符
    const usernameReplaced = replacePlaceholders(provider.username, countryCode)
    const username = usernameReplaced.result
    
    // 替换密码中的占位符
    const passwordReplaced = replacePlaceholders(provider.password, countryCode)
    const password = passwordReplaced.result

    // 构建代理URL（undici ProxyAgent 格式）
    const proxyUrl = `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${provider.proxyHost}:${provider.proxyPort}`
    
    // 创建 undici ProxyAgent（支持账密认证）
    const proxyAgent = new ProxyAgent({
      uri: proxyUrl,
      requestTls: {
        rejectUnauthorized: false // 允许自签名证书
      }
    })

    // 获取实际的代理IP地址（通过代理访问IP查询服务）
    // 使用多个备选服务，优先使用 HTTP 协议（避免 HTTPS 隧道认证问题）
    let actualProxyIp = `${provider.proxyHost}:${provider.proxyPort}` // 默认值
    const ipCheckServices = [
      { url: 'http://ip-api.com/json', parser: (data: any) => data.query },
      { url: 'http://httpbin.org/ip', parser: (data: any) => data.origin },
      { url: 'http://api.ipify.org?format=json', parser: (data: any) => data.ip },
    ]
    
    for (const service of ipCheckServices) {
      try {
        const ipResponse = await undiciFetch(service.url, {
          method: 'GET',
          dispatcher: proxyAgent,
          signal: AbortSignal.timeout(8000) // 8秒超时
        })
        if (ipResponse.ok) {
          const ipData = await ipResponse.json() as any
          const ip = service.parser(ipData)
          if (ip) {
            actualProxyIp = ip
            break // 成功获取到IP，退出循环
          }
        }
      } catch (e) {
        console.warn(`IP查询服务 ${service.url} 失败:`, (e as Error).message)
        // 继续尝试下一个服务
      }
    }

    // 重定向链
    const redirectChain: VerifyResult['redirectChain'] = []
    let currentUrl = affiliateLink
    const normalizedTargetDomain = targetDomain ? targetDomain.replace(/^www\./, '').toLowerCase() : ''
    let matched = false
    let finalUrl = affiliateLink
    let finalDomain = extractRootDomain(affiliateLink)
    let redirectCount = 0

    // 添加初始链接到重定向链（step 0 表示起始URL）
    redirectChain.push({
      step: 0,
      url: affiliateLink,
      domain: extractRootDomain(affiliateLink)
    })

    // 循环跟踪重定向
    for (let i = 0; i < maxRedirects; i++) {
      try {
        // 使用 undici fetch 通过代理发送请求（不自动跟踪重定向）
        const response = await undiciFetch(currentUrl, {
          method: 'GET',
          redirect: 'manual', // 不自动跟踪重定向
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': referrer || 'https://t.co',
            'Connection': 'keep-alive',
          },
          dispatcher: proxyAgent, // 使用 undici 的 dispatcher 选项传递代理
          signal: AbortSignal.timeout(15000) // 15秒超时
        })

        const statusCode = response.status
        let nextUrl: string | null = null
        let redirectType: string = 'http' // http, meta, js

        // 检查是否是 HTTP 重定向响应 (3xx)
        if (statusCode >= 300 && statusCode < 400) {
          const location = response.headers.get('location')
          
          if (location) {
            // 处理相对路径的重定向
            nextUrl = location
            if (!location.startsWith('http')) {
              const baseUrl = new URL(currentUrl)
              nextUrl = new URL(location, baseUrl.origin).toString()
            }
            redirectType = 'http'
          }
        }
        
        // 如果没有 HTTP 重定向，从 HTML 内容中寻找重定向
        if (!nextUrl && statusCode >= 200 && statusCode < 300) {
          try {
            const html = await response.text()
            const htmlRedirect = extractRedirectFromHtml(html, currentUrl)
            if (htmlRedirect) {
              nextUrl = htmlRedirect
              // 判断重定向类型
              if (html.toLowerCase().includes('http-equiv="refresh"') || html.toLowerCase().includes("http-equiv='refresh'")) {
                redirectType = 'meta'
              } else {
                redirectType = 'js'
              }
            }
          } catch (e) {
            console.warn('解析 HTML 内容失败:', e)
          }
        }

        // 如果找到了重定向链接
        if (nextUrl) {
          redirectCount++
          const nextDomain = extractRootDomain(nextUrl)
          
          redirectChain.push({
            step: redirectCount,
            url: nextUrl,
            domain: nextDomain,
            statusCode,
            redirectType
          })

          finalUrl = nextUrl
          finalDomain = nextDomain

          // 检查域名是否与目标域名一致
          if (normalizedTargetDomain && nextDomain === normalizedTargetDomain) {
            matched = true
            break
          }

          // 继续下一次重定向
          currentUrl = nextUrl
        } else {
          // 没有找到重定向，说明已到达最终页面
          // 更新 finalUrl 和 finalDomain 为当前请求的 URL（这是实际到达的最终页面）
          finalUrl = currentUrl
          finalDomain = extractRootDomain(currentUrl)
          
          // 更新重定向链中最后一个条目的状态码（这是我们刚刚请求得到的响应状态）
          if (redirectChain.length > 0) {
            const lastEntry = redirectChain[redirectChain.length - 1]
            lastEntry.statusCode = statusCode
            
            // 确保最后一个条目的URL和域名是正确的
            // （如果是初始URL没有任何重定向的情况，最后一个条目就是step 0）
            if (lastEntry.url !== currentUrl) {
              lastEntry.url = currentUrl
              lastEntry.domain = finalDomain
            }
          }
          
          // 检查最终域名是否与目标域名一致
          if (normalizedTargetDomain && finalDomain === normalizedTargetDomain) {
            matched = true
          }
          break
        }
      } catch (fetchError: any) {
        console.error('请求错误:', fetchError.message)
        
        // 添加错误信息到重定向链
        redirectChain.push({
          step: redirectCount + 1,
          url: currentUrl,
          domain: extractRootDomain(currentUrl),
          statusCode: 0
        })
        
        return NextResponse.json({
          success: false,
          proxyIp: actualProxyIp,
          proxyProvider: provider.name,
          redirectChain,
          finalUrl,
          finalDomain,
          targetDomain: normalizedTargetDomain,
          matched: false,
          totalRedirects: redirectCount,
          error: `请求失败: ${fetchError.message}`
        } as VerifyResult)
      }
    }

    // 如果没有设置目标域名，则始终认为不匹配
    if (!normalizedTargetDomain) {
      matched = false
    }

    return NextResponse.json({
      success: true,
      proxyIp: actualProxyIp,
      proxyProvider: provider.name,
      redirectChain,
      finalUrl,
      finalDomain,
      targetDomain: normalizedTargetDomain,
      matched,
      totalRedirects: redirectCount,
      message: matched 
        ? `验证成功！最终域名 (${finalDomain}) 与目标域名 (${normalizedTargetDomain}) 一致`
        : redirectCount >= maxRedirects
          ? `已达到最大跳转次数 (${maxRedirects})，最终域名: ${finalDomain}`
          : `验证完成，最终域名: ${finalDomain}` + (normalizedTargetDomain ? `，目标域名: ${normalizedTargetDomain}` : '')
    } as VerifyResult)

  } catch (error: any) {
    console.error('验证联盟链接失败:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: `验证失败: ${error.message}`,
        matched: false,
        redirectChain: [],
        totalRedirects: 0
      } as VerifyResult,
      { status: 500 }
    )
  }
}
