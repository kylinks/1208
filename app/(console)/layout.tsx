'use client'

import { Layout, Menu, theme, message, Tooltip } from 'antd'
import { usePathname, useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useEffect, useState } from 'react'
import {
  DashboardOutlined,
  LinkOutlined,
  CloudServerOutlined,
  BarChartOutlined,
  ApiOutlined,
  SettingOutlined,
  FileTextOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import { MonitorProvider, useMonitor } from './MonitorContext'

const { Header, Content, Sider } = Layout

// 内部布局组件，可以使用 useMonitor hook
function ConsoleLayoutInner({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session, status } = useSession()
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken()
  
  // 侧边栏折叠状态
  const [collapsed, setCollapsed] = useState(false)
  
  // 获取监控状态
  const { stopMonitor } = useMonitor()

  const role = session?.user?.role === 'admin' ? 'admin' : 'employee'
  const defaultConsolePath = role === 'admin' ? '/console/proxy' : '/console'

  // 如果未登录，重定向到登录页面
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push(`/login?callbackUrl=${encodeURIComponent(pathname)}`)
    }
  }, [status, router, pathname])

  // 客户端兜底：越权路由自动跳回角色默认页
  useEffect(() => {
    if (status !== 'authenticated' || !session) return

    const isAllowed = (() => {
      if (role === 'admin') {
        const allowed = ['/console/proxy', '/console/users', '/console/settings', '/console/logs']
        return allowed.some((p) => pathname === p || pathname.startsWith(p + '/'))
      }
      if (pathname === '/console') return true
      const allowed = ['/console/links', '/console/mcc', '/console/clicks', '/console/logs']
      return allowed.some((p) => pathname === p || pathname.startsWith(p + '/'))
    })()

    if (!isAllowed) {
      router.replace(defaultConsolePath)
    }
  }, [status, session, role, pathname, router, defaultConsolePath])

  // 加载中显示空白
  if (status === 'loading') {
    return null
  }

  // 未登录不渲染内容
  if (!session) {
    return null
  }

  const menuItems =
    role === 'admin'
      ? [
          { key: '/console/proxy', icon: <ApiOutlined />, label: '代理管理' },
          { key: '/console/users', icon: <UserOutlined />, label: '用户管理' },
          { key: '/console/settings', icon: <SettingOutlined />, label: '系统设置' },
          { key: '/console/logs', icon: <FileTextOutlined />, label: '日志查看' },
        ]
      : [
          { key: '/console', icon: <DashboardOutlined />, label: '仪表盘' },
          { key: '/console/links', icon: <LinkOutlined />, label: '链接管理' },
          { key: '/console/mcc', icon: <CloudServerOutlined />, label: 'MCC管理' },
          { key: '/console/clicks', icon: <BarChartOutlined />, label: '点击管理' },
          { key: '/console/logs', icon: <FileTextOutlined />, label: '日志查看' },
        ]

  const handleMenuClick = ({ key }: { key: string }) => {
    router.push(key)
  }

  // 执行退出登录
  const doLogout = async () => {
    try {
      // 退出前先停止监控，清除 localStorage 状态
      stopMonitor(true)
      await signOut({ callbackUrl: '/login' })
      message.success('已退出登录')
    } catch (error) {
      message.error('退出登录失败')
    }
  }

  // 处理退出登录点击
  const handleLogout = () => {
    // 监控已迁移到服务器定时任务(crontab)，退出登录不应弹“浏览器依赖”的误导提示
    doLogout()
  }

  const displayName = session.user?.name || '未命名用户'
  const displayEmail = session.user?.email || ''

  const copyEmail = async () => {
    if (!displayEmail) return
    try {
      await navigator.clipboard.writeText(displayEmail)
      message.success('邮箱已复制')
    } catch {
      message.error('复制失败')
    }
  }

  const toggleSider = () => setCollapsed((v) => !v)

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        trigger={null}
        style={{
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div className="flex flex-col h-full">
          {/* 品牌区 */}
          <div className="flex items-center justify-center h-16 text-white text-lg font-bold">
            {collapsed ? 'Ky' : 'KyAdsLink'}
          </div>

          {/* 用户信息区（对齐截图：头像/姓名/邮箱） */}
          <div className={`px-4 pb-4 ${collapsed ? 'px-2' : ''}`}>
            <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'}`}>
              <Tooltip title={collapsed ? '展开侧边栏' : '折叠侧边栏'}>
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                  onClick={toggleSider}
                  aria-label="toggle-sider-from-user"
                >
                  {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 18 }} /> : <MenuFoldOutlined style={{ fontSize: 18 }} />}
                </div>
              </Tooltip>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-white text-sm font-medium truncate">{displayName}</div>
                  <div className="flex items-center gap-2 text-white/60 text-xs">
                    <span className="truncate">{displayEmail}</span>
                    {displayEmail && (
                      <Tooltip title="复制邮箱">
                        <span
                          className="cursor-pointer text-white/50 hover:text-white/80"
                          onClick={copyEmail}
                          aria-label="copy-email"
                        >
                          <CopyOutlined />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 主菜单 */}
          <div className="flex-1 overflow-auto">
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[pathname]}
              items={menuItems}
              onClick={handleMenuClick}
            />
          </div>

          {/* 底部操作区（退出登录/折叠） */}
          <div className="border-t border-white/10 p-2">
            <div
              className={`flex items-center rounded-md cursor-pointer text-white/80 hover:text-white hover:bg-white/10 transition-colors ${
                collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'
              }`}
              onClick={handleLogout}
            >
              <LogoutOutlined />
              {!collapsed && <span className="text-sm">退出登录</span>}
            </div>
          </div>
        </div>
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Header style={{ padding: '0 24px', background: colorBgContainer }}>
          <div className="flex items-center justify-between h-full">
            <h1 className="text-xl font-semibold m-0">
              KyAdsLink自动换链接系统
            </h1>
          </div>
        </Header>
        <Content style={{ margin: '24px 16px 0' }}>
          <div
            style={{
              padding: 24,
              minHeight: 360,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
            }}
          >
            {children}
          </div>
        </Content>
      </Layout>
    </Layout>
  )
}

// 外层组件，提供 MonitorProvider
export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <MonitorProvider>
      <ConsoleLayoutInner>{children}</ConsoleLayoutInner>
    </MonitorProvider>
  )
}
