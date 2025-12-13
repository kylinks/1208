import type { Metadata } from 'next'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AuthSessionProvider from '@/components/providers/session-provider'
import './globals.css'

export const metadata: Metadata = {
  title: 'KyLinks自动换链接系统',
  description: '自动监控Google Ads点击并更新联盟链接',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthSessionProvider>
          <ConfigProvider
            locale={zhCN}
            theme={{
              token: {
                colorPrimary: '#1890ff',
                borderRadius: 6,
              },
            }}
          >
            {children}
          </ConfigProvider>
        </AuthSessionProvider>
      </body>
    </html>
  )
}
