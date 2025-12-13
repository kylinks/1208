import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

type UserRole = 'admin' | 'employee'

const DEFAULT_CONSOLE_PATH: Record<UserRole, string> = {
  admin: '/console/proxy',
  employee: '/console',
}

function getRoleFromToken(token: any): UserRole {
  return token?.role === 'admin' ? 'admin' : 'employee'
}

function isAllowedConsolePath(role: UserRole, pathname: string) {
  if (role === 'admin') {
    const allowedPrefixes = ['/console/proxy', '/console/users', '/console/settings', '/console/logs']
    return allowedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
  }

  // employee：允许 /console（仅精确匹配），以及其它模块前缀
  if (pathname === '/console') return true
  const allowedPrefixes = ['/console/links', '/console/mcc', '/console/clicks', '/console/logs']
  return allowedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function isAllowedApiPath(role: UserRole, pathname: string) {
  if (role === 'admin') {
    const allowedPrefixes = ['/api/proxy-providers', '/api/system-config', '/api/users', '/api/monitoring-logs']
    return allowedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
  }

  const allowedPrefixes = [
    '/api/dashboard',
    '/api/campaign-monitoring',
    '/api/one-click-start',
    '/api/monitoring-logs',
    '/api/mcc',
    '/api/google-ads',
    '/api/campaigns',
    '/api/affiliate-configs',
    '/api/click-management',
  ]
  return allowedPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export default withAuth(
  function middleware(req) {
    const pathname = req.nextUrl.pathname
    const token = (req as any).nextauth?.token
    const role = getRoleFromToken(token)

    // Console 路由：不允许则重定向到角色默认首页
    if (pathname.startsWith('/console')) {
      if (!isAllowedConsolePath(role, pathname)) {
        const url = req.nextUrl.clone()
        url.pathname = DEFAULT_CONSOLE_PATH[role]
        url.search = ''
        return NextResponse.redirect(url)
      }
    }

    // API 路由：不允许则直接 403
    if (pathname.startsWith('/api')) {
      if (!isAllowedApiPath(role, pathname)) {
        return NextResponse.json({ success: false, error: '无权限' }, { status: 403 })
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token }) => {
        // 只有有 token 的用户才能访问受保护的路由
        return !!token
      },
    },
    pages: {
      signIn: '/login',
    },
  }
)

// 配置需要保护的路由
export const config = {
  matcher: [
    '/console/:path*',
    '/api/affiliate-configs/:path*',
    '/api/campaign-monitoring/:path*',
    '/api/campaigns/:path*',
    '/api/mcc-accounts/:path*',
    '/api/mcc/:path*',
    '/api/monitoring-logs/:path*',
    '/api/google-ads/:path*',
    '/api/one-click-start/:path*',
    '/api/proxy-providers/:path*',
    '/api/system-config/:path*',
    '/api/users/:path*',
    '/api/dashboard/:path*',
    '/api/click-management/:path*',
  ],
}
