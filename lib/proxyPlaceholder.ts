/**
 * 代理占位符替换工具
 * 支持的占位符:
 * - {country} - 国家代码 (小写), 如: us, gb, au
 * - {COUNTRY} - 国家代码 (大写), 如: US, GB, AU
 * - {session:N} - N位随机数字, 如: {session:8} -> 12345678
 * - {random:N} - N位随机字母数字, 如: {random:10} -> a3b9d2f8g1
 */

/**
 * 生成指定长度的随机数字字符串
 */
function generateRandomDigits(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString()
  }
  return result
}

/**
 * 生成指定长度的随机字母数字字符串
 */
function generateRandomAlphanumeric(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * 替换字符串中的占位符
 * @param template 模板字符串
 * @param countryCode 国家代码
 * @returns 替换后的字符串和使用的session值
 */
export function replacePlaceholders(
  template: string,
  countryCode: string
): { result: string; sessionId: string } {
  let result = template
  let sessionId = ''

  // 1. 替换 {country} - 小写国家代码
  result = result.replace(/\{country\}/g, countryCode.toLowerCase())

  // 2. 替换 {COUNTRY} - 大写国家代码
  result = result.replace(/\{COUNTRY\}/g, countryCode.toUpperCase())

  // 3. 替换 {session:N} - N位随机数字
  const sessionMatches = result.match(/\{session:(\d+)\}/g)
  if (sessionMatches) {
    sessionMatches.forEach(match => {
      const length = parseInt(match.match(/\d+/)?.[0] || '8')
      const randomDigits = generateRandomDigits(length)
      result = result.replace(match, randomDigits)
      // 保存第一个session值用于去重标识
      if (!sessionId) {
        sessionId = randomDigits
      }
    })
  }

  // 4. 替换 {random:N} - N位随机字母数字
  const randomMatches = result.match(/\{random:(\d+)\}/g)
  if (randomMatches) {
    randomMatches.forEach(match => {
      const length = parseInt(match.match(/\d+/)?.[0] || '10')
      const randomStr = generateRandomAlphanumeric(length)
      result = result.replace(match, randomStr)
      // 如果没有session，使用random值作为标识
      if (!sessionId) {
        sessionId = randomStr
      }
    })
  }

  // 如果没有任何随机占位符，生成一个默认的sessionId
  if (!sessionId) {
    sessionId = generateRandomDigits(8)
  }

  return { result, sessionId }
}

/**
 * 检测字符串中是否包含占位符
 */
export function hasPlaceholders(str: string): boolean {
  return /\{(country|COUNTRY|session:\d+|random:\d+)\}/.test(str)
}

/**
 * 获取字符串中的所有占位符
 */
export function extractPlaceholders(str: string): string[] {
  const matches = str.match(/\{[^}]+\}/g)
  return matches || []
}

/**
 * 示例用法说明
 */
export const PLACEHOLDER_EXAMPLES = {
  country: {
    template: 'user-region-{country}',
    description: '国家代码(小写)',
    example: 'user-region-au'
  },
  COUNTRY: {
    template: 'user-region-{COUNTRY}',
    description: '国家代码(大写)',
    example: 'user-region-AU'
  },
  session: {
    template: 'user-session-{session:8}',
    description: '8位随机数字',
    example: 'user-session-37557770'
  },
  random: {
    template: 'user-id-{random:10}',
    description: '10位随机字母数字',
    example: 'user-id-a3b9d2f8g1'
  },
  combined: {
    template: 'brd-customer-{country}-session-{session:8}',
    description: '组合多个占位符',
    example: 'brd-customer-us-session-37557770'
  }
}
