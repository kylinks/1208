/**
 * Google Ads API v22 客户端工具类
 * 使用Google服务账号JWT认证方式
 * 通过直接HTTP API调用与Google Ads API交互，验证MCC账号权限并获取子账号信息
 * 
 * @requires google-auth-library ^9.0.0
 * @requires axios ^1.6.2
 */

import { JWT } from 'google-auth-library'
import fs from 'fs'
import path from 'path'
import axios from 'axios'

interface ServiceAccountConfig {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
  auth_provider_x509_cert_url: string
  client_x509_cert_url: string
}

interface MccValidationResult {
  isValid: boolean
  hasPermission: boolean
  message: string
  accounts?: {
    total: number
    active: number
    inactive: number
    list: Array<{
      id: string
      name: string
      status: string
      currency: string
      timezone: string
    }>
  }
}

/**
 * 读取服务账号凭证
 */
function getServiceAccountCredentials(): ServiceAccountConfig | null {
  try {
    // 优先从环境变量读取JSON文件路径
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
    if (keyPath) {
      const absolutePath = path.isAbsolute(keyPath) 
        ? keyPath 
        : path.join(process.cwd(), keyPath)
      
      if (fs.existsSync(absolutePath)) {
        const keyFileContent = fs.readFileSync(absolutePath, 'utf8')
        return JSON.parse(keyFileContent)
      }
    }

    // 尝试从环境变量读取Base64编码的JSON
    const keyBase64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    if (keyBase64) {
      const keyJson = Buffer.from(keyBase64, 'base64').toString('utf8')
      return JSON.parse(keyJson)
    }

    return null
  } catch (error) {
    console.error('读取服务账号凭证失败:', error)
    return null
  }
}

/**
 * 创建JWT客户端用于服务账号认证
 */
async function createJWTClient(): Promise<JWT | null> {
  try {
    const serviceAccount = getServiceAccountCredentials()
    
    if (!serviceAccount) {
      console.error('未找到服务账号凭证')
      return null
    }

    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/adwords'],
    })

    // 获取访问令牌
    await jwtClient.authorize()
    
    return jwtClient
  } catch (error) {
    console.error('创建JWT客户端失败:', error)
    return null
  }
}

/**
 * 执行Google Ads API查询（使用服务账号JWT认证）
 * @param customerId 客户ID（不含横杠）
 * @param loginCustomerId 登录客户ID（通常与customerId相同）
 * @param query GAQL查询语句
 * @param accessToken JWT访问令牌
 */
async function executeGoogleAdsQuery(
  customerId: string,
  loginCustomerId: string,
  query: string,
  accessToken: string
): Promise<any> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  
  if (!developerToken) {
    throw new Error('未配置GOOGLE_ADS_DEVELOPER_TOKEN')
  }

  const url = `https://googleads.googleapis.com/v22/customers/${customerId}/googleAds:search`
  
  console.log('正在调用Google Ads API:', {
    url,
    customerId,
    loginCustomerId,
    hasDeveloperToken: !!developerToken,
    hasAccessToken: !!accessToken,
  })
  
  try {
    const response = await axios.post(
      url,
      { query },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': developerToken,
          'login-customer-id': loginCustomerId,
          'Content-Type': 'application/json',
        },
      }
    )

    console.log('Google Ads API调用成功')
    return response.data
  } catch (error: any) {
    console.error('Google Ads API查询失败:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message,
      url,
    })
    throw error
  }
}

/**
 * 验证MCC账号并获取子账号列表
 * @param mccId MCC账号ID（格式：123-456-7890）
 */
export async function validateMccAndGetAccounts(
  mccId: string
): Promise<MccValidationResult> {
  try {
    // 创建JWT客户端
    const jwtClient = await createJWTClient()
    
    if (!jwtClient) {
      return {
        isValid: false,
        hasPermission: false,
        message: '服务账号认证失败',
      }
    }

    // 获取访问令牌
    const accessToken = jwtClient.credentials.access_token
    
    if (!accessToken) {
      return {
        isValid: false,
        hasPermission: false,
        message: '无法获取访问令牌',
      }
    }

    // 移除MCC ID中的横杠
    const customerId = mccId.replace(/-/g, '')

    // 查询MCC下的所有子账号 (Google Ads API v22)
    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.status,
        customer_client.currency_code,
        customer_client.time_zone
      FROM customer_client
      WHERE customer_client.manager = FALSE
    `

    // 使用直接HTTP API调用
    const response = await executeGoogleAdsQuery(
      customerId,
      customerId,
      query,
      accessToken
    )

    // 解析响应结果
    const results = response.results || []

    // 统计账号信息
    const accounts: Array<{
      id: string
      name: string
      status: string
      currency: string
      timezone: string
    }> = []
    let activeCount = 0
    let inactiveCount = 0

    for (const row of results) {
      if (!row.customerClient) continue

      const account = {
        id: row.customerClient.id?.toString() || '',
        name: row.customerClient.descriptiveName || '',
        status: row.customerClient.status || 'UNKNOWN',
        currency: row.customerClient.currencyCode || '',
        timezone: row.customerClient.timeZone || '',
      }
      
      accounts.push(account)

      // 统计活跃和非活跃账号
      if (row.customerClient.status === 'ENABLED') {
        activeCount++
      } else {
        inactiveCount++
      }
    }

    return {
      isValid: true,
      hasPermission: true,
      message: '获取成功',
      accounts: {
        total: accounts.length,
        active: activeCount,
        inactive: inactiveCount,
        list: accounts,
      },
    }
  } catch (error: any) {
    console.error('验证MCC账号失败:', error)

    // 处理HTTP错误响应
    if (error.response?.data?.error) {
      const apiError = error.response.data.error
      const errorMessage = apiError.message || ''
      const errorStatus = apiError.status || ''
      
      console.error('Google Ads API错误详情:', {
        status: errorStatus,
        message: errorMessage,
        details: apiError.details
      })

      if (errorStatus === 'PERMISSION_DENIED' || errorMessage.includes('permission')) {
        return {
          isValid: true,
          hasPermission: false,
          message: '未绑定服务账号，请在Google Ads MCC账号中添加服务账号邮箱并授予管理员权限',
        }
      }

      if (errorStatus === 'INVALID_ARGUMENT' || errorMessage.includes('INVALID_CUSTOMER_ID')) {
        return {
          isValid: false,
          hasPermission: false,
          message: 'MCC账号ID无效',
        }
      }

      if (errorStatus === 'UNAUTHENTICATED' || errorMessage.includes('authentication')) {
        return {
          isValid: true,
          hasPermission: false,
          message: '认证失败，请检查服务账号配置和开发者令牌',
        }
      }

      if (errorMessage.includes('DEVELOPER_TOKEN')) {
        return {
          isValid: false,
          hasPermission: false,
          message: '开发者令牌无效或未批准',
        }
      }

      return {
        isValid: false,
        hasPermission: false,
        message: errorMessage || '验证失败',
      }
    }

    // 处理网络或其他错误
    const errorMessage = error.message || ''
    
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('network')) {
      return {
        isValid: false,
        hasPermission: false,
        message: '网络连接失败，请检查网络设置',
      }
    }

    return {
      isValid: false,
      hasPermission: false,
      message: error.message || '验证失败，请稍后重试',
    }
  }
}

/**
 * 检查MCC账号是否已授权
 * @param mccId MCC账号ID
 */
export async function checkMccPermission(
  mccId: string
): Promise<{ hasPermission: boolean; message: string }> {
  const result = await validateMccAndGetAccounts(mccId)
  return {
    hasPermission: result.hasPermission,
    message: result.message,
  }
}
