'use client'

import { Layout, Menu, theme, Dropdown, Avatar, Space, message, Modal } from 'antd'
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
  ExclamationCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
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
  const { isMonitorRunning, stopMonitor } = useMonitor()

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
      stopMonitor()
      await signOut({ callbackUrl: '/login' })
      message.success('已退出登录')
    } catch (error) {
      message.error('退出登录失败')
    }
  }

  // 处理退出登录点击
  const handleLogout = () => {
    if (isMonitorRunning) {
      // 如果监控正在运行，弹出确认对话框
      Modal.confirm({
        title: '监控正在运行中',
        icon: <ExclamationCircleOutlined />,
        content: (
          <div>
            <p>退出登录后，监控任务将会停止。</p>
            <p className="text-gray-500 text-sm mt-2">
              提示：监控任务依赖浏览器运行，退出登录或关闭页面后将无法继续执行。
              重新登录后需要手动启动监控。
            </p>
          </div>
        ),
        okText: '确认退出',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: doLogout,
      })
    } else {
      // 监控未运行，直接退出
      doLogout()
    }
  }

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '个人信息',
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ]

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
        <div className="flex items-center justify-center h-16 text-white text-lg font-bold">
          {collapsed ? '换链' : '自动换链接系统'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={menuItems}
          onClick={handleMenuClick}
        />
        {/* 折叠切换按钮 */}
        <div
          className="absolute bottom-4 left-0 right-0 flex justify-center cursor-pointer text-white/70 hover:text-white transition-colors"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <MenuUnfoldOutlined style={{ fontSize: 18 }} /> : <MenuFoldOutlined style={{ fontSize: 18 }} />}
        </div>
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Header style={{ padding: '0 24px', background: colorBgContainer }}>
          <div className="flex items-center justify-between h-full">
            <h1 className="text-xl font-semibold m-0">
              KyLinks自动换链接系统
            </h1>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space className="cursor-pointer">
                <Avatar icon={<UserOutlined />} />
                <span className="text-sm">
                  {session.user?.name || session.user?.email}
                </span>
                <span className="text-xs text-gray-500">
                  ({session.user?.role === 'admin' ? '管理员' : '员工'})
                </span>
              </Space>
            </Dropdown>
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
