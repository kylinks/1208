'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Form, Input, Button, Card, message, Spin } from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'

// 登录表单组件（使用 useSearchParams）
function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)

  const callbackUrl = searchParams.get('callbackUrl') || '/console'

  const onFinish = async (values: { email: string; password: string }) => {
    try {
      setLoading(true)
      const result = await signIn('credentials', {
        email: values.email,
        password: values.password,
        redirect: false,
      })

      if (result?.error) {
        message.error(result.error)
      } else if (result?.ok) {
        message.success('登录成功')
        router.push(callbackUrl)
        router.refresh()
      }
    } catch (error) {
      message.error('登录失败，请重试')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            Google Ads 自动换链系统
          </h1>
          <p className="text-gray-600">请登录以继续访问控制台</p>
        </div>

        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
          layout="vertical"
        >
          <Form.Item
            name="email"
            label="邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效的邮箱地址' },
            ]}
          >
            <Input
              prefix={<UserOutlined className="text-gray-400" />}
              placeholder="请输入邮箱"
              autoComplete="email"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-gray-400" />}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
              className="h-12"
            >
              登录
            </Button>
          </Form.Item>
        </Form>

        <div className="text-center text-sm text-gray-500 mt-4">
          <p>默认管理员账号</p>
          <p className="mt-1">
            邮箱: admin@example.com | 密码: admin123456
          </p>
        </div>
      </Card>
    </div>
  )
}

// 加载状态组件
function LoginLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="w-full max-w-md shadow-2xl">
        <div className="text-center py-12">
          <Spin size="large" />
          <p className="mt-4 text-gray-500">加载中...</p>
        </div>
      </Card>
    </div>
  )
}

// 主页面组件（使用 Suspense 包裹）
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginForm />
    </Suspense>
  )
}
