import { prisma } from './prisma'
import { replacePlaceholders } from './proxyPlaceholder'

export interface ProxyConfig {
  host: string
  port: number
  username: string
  password: string
  countryCode: string
  providerId: string
  providerName: string
  sessionId: string // 用于24小时去重的唯一session标识
}

/**
 * 获取可用的代理配置
 * @param countryCode 国家代码 (如: US, GB, DE)
 * @param campaignId 广告系列ID (用于24小时IP去重)
 * @returns 代理配置或null
 */
export async function getAvailableProxy(
  countryCode: string,
  campaignId: string
): Promise<ProxyConfig | null> {
  try {
    // 1. 获取启用的代理供应商（按优先级排序）
    const providers = await prisma.proxyProvider.findMany({
      where: {
        enabled: true,
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    })

    if (providers.length === 0) {
      console.warn('没有可用的代理供应商')
      return null
    }

    // 2. 对每个供应商，尝试获取未使用过的代理
    for (const provider of providers) {
      // 替换用户名中的占位符（包括国家代码和随机session）
      const usernameReplaced = replacePlaceholders(provider.username, countryCode)
      const username = usernameReplaced.result
      const sessionId = usernameReplaced.sessionId
      
      // 替换密码中的占位符（如果有的话）
      const passwordReplaced = replacePlaceholders(provider.password, countryCode)
      const password = passwordReplaced.result
      
      // 3. 检查该session在24小时内是否已被此广告系列使用
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const usedProxy = await prisma.usedProxyIp.findFirst({
        where: {
          campaignId,
          providerId: provider.id,
          countryCode,
          ip: sessionId, // 使用sessionId作为唯一标识
          usedAt: {
            gte: twentyFourHoursAgo
          }
        }
      })

      // 4. 如果该session未被使用，返回配置
      if (!usedProxy) {
        return {
          host: provider.proxyHost,
          port: provider.proxyPort,
          username,
          password,
          countryCode,
          providerId: provider.id,
          providerName: provider.name,
          sessionId
        }
      }
    }

    console.warn(`所有代理在24小时内都已被广告系列 ${campaignId} 使用过 (国家: ${countryCode})`)
    return null

  } catch (error) {
    console.error('获取代理配置失败:', error)
    return null
  }
}

/**
 * 记录代理使用
 * @param proxyConfig 代理配置
 * @param campaignId 广告系列ID
 */
export async function recordProxyUsage(
  proxyConfig: ProxyConfig,
  campaignId: string
): Promise<void> {
  try {
    await prisma.usedProxyIp.create({
      data: {
        ip: proxyConfig.sessionId, // 使用sessionId作为唯一标识
        port: proxyConfig.port,
        countryCode: proxyConfig.countryCode,
        providerId: proxyConfig.providerId,
        campaignId
      }
    })
  } catch (error) {
    console.error('记录代理使用失败:', error)
    throw error
  }
}

/**
 * 清理24小时前的代理使用记录
 */
export async function cleanupOldProxyRecords(): Promise<number> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const result = await prisma.usedProxyIp.deleteMany({
      where: {
        usedAt: {
          lt: twentyFourHoursAgo
        }
      }
    })

    console.log(`清理了 ${result.count} 条24小时前的代理记录`)
    return result.count
  } catch (error) {
    console.error('清理代理记录失败:', error)
    return 0
  }
}

/**
 * 获取代理使用统计
 * @param campaignId 广告系列ID
 * @param countryCode 国家代码（可选）
 */
export async function getProxyUsageStats(
  campaignId: string,
  countryCode?: string
) {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    
    const where: any = {
      campaignId,
      usedAt: {
        gte: twentyFourHoursAgo
      }
    }

    if (countryCode) {
      where.countryCode = countryCode
    }

    const usedProxies = await prisma.usedProxyIp.findMany({
      where,
      include: {
        provider: {
          select: {
            name: true
          }
        }
      },
      orderBy: {
        usedAt: 'desc'
      }
    })

    return {
      total: usedProxies.length,
      byProvider: usedProxies.reduce((acc: any, proxy) => {
        const providerName = proxy.provider.name
        acc[providerName] = (acc[providerName] || 0) + 1
        return acc
      }, {}),
      byCountry: usedProxies.reduce((acc: any, proxy) => {
        acc[proxy.countryCode] = (acc[proxy.countryCode] || 0) + 1
        return acc
      }, {}),
      proxies: usedProxies
    }
  } catch (error) {
    console.error('获取代理统计失败:', error)
    return null
  }
}
