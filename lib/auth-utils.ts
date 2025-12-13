import { getServerSession } from 'next-auth/next'
import { authOptions } from './auth'

/**
 * 获取服务器端 session
 * 用于 Server Components 和 API Routes
 */
export async function getSession() {
  return await getServerSession(authOptions)
}

/**
 * 获取当前用户信息
 * 如果未登录返回 null
 */
export async function getCurrentUser() {
  const session = await getSession()
  return session?.user || null
}

/**
 * 检查用户是否已登录
 */
export async function isAuthenticated() {
  const session = await getSession()
  return !!session?.user
}

/**
 * 检查用户是否是管理员
 */
export async function isAdmin() {
  const user = await getCurrentUser()
  return user?.role === 'admin'
}

/**
 * 获取当前用户的租户 ID
 */
export async function getCurrentTenantId() {
  const user = await getCurrentUser()
  return user?.tenantId || null
}
