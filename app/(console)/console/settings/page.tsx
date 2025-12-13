'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  message,
  Switch,
  Divider,
  Space,
} from 'antd'
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { useMonitor } from '../../MonitorContext'

interface SystemConfig {
  [key: string]: any
}

export default function SystemSettings() {
  const [loading, setLoading] = useState(false)
  const [settingsForm] = Form.useForm()
  const { fetchMonitorConfig } = useMonitor()

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/system-config')
      const data = await response.json()
      
      // 默认值
      const defaultSettings: SystemConfig = {
        // 自动清理
        autoCleanupDays: 30,

        // 监控设置
        cronInterval: 5,
        maxRedirects: 10,
        requestTimeout: 30,
        retryAttempts: 3,
        enableAutoReplace: true,
        proxyRotation: true,

        // 告警（并入系统设置）
        enableAlert: true,
        failureThreshold: 3,
        alertEmail: 'admin@example.com',
        webhookUrl: '',
        enableEmailAlert: true,
        enableWebhookAlert: false,
      }

      // 合并API返回的数据和默认值
      settingsForm.setFieldsValue({ ...defaultSettings, ...data })
    } catch (error) {
      message.error('获取系统配置失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setLoading(true)
      const values = await settingsForm.validateFields()
      const response = await fetch('/api/system-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configs: values }),
      })
      if (response.ok) {
        message.success('保存成功')
        // 通知 MonitorContext 重新加载配置
        await fetchMonitorConfig()
      } else {
        message.error('保存失败')
      }
    } catch (error) {
      message.error('保存失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    fetchSettings()
    message.info('已重置为保存的配置')
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold m-0">系统设置</h2>
        <p className="text-gray-600 mt-2">配置监控规则、自动清理与告警通知</p>
      </div>

      <Card>
        <Form form={settingsForm} layout="vertical" onFinish={handleSave}>
          <Divider orientation="left">监控设置</Divider>

          <Form.Item
            name="cronInterval"
            label="监控间隔(分钟)"
            rules={[{ required: true, message: '请输入监控间隔' }]}
            extra="系统每隔N分钟检查一次广告系列点击数"
          >
            <InputNumber min={1} max={60} className="w-full" />
          </Form.Item>

          <Form.Item
            name="maxRedirects"
            label="最大跳转次数"
            rules={[{ required: true, message: '请输入最大跳转次数' }]}
            extra="跟随联盟链接时的最大重定向次数"
          >
            <InputNumber min={1} max={20} className="w-full" />
          </Form.Item>

          <Form.Item
            name="requestTimeout"
            label="请求超时(秒)"
            rules={[{ required: true, message: '请输入请求超时时间' }]}
            extra="访问联盟链接的超时时间"
          >
            <InputNumber min={5} max={120} className="w-full" />
          </Form.Item>

          <Form.Item
            name="retryAttempts"
            label="重试次数"
            rules={[{ required: true, message: '请输入重试次数' }]}
            extra="失败后的重试次数"
          >
            <InputNumber min={0} max={5} className="w-full" />
          </Form.Item>

          <Form.Item name="enableAutoReplace" label="启用自动换链" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item
            name="proxyRotation"
            label="启用代理轮换"
            valuePropName="checked"
            extra="24小时内不重复使用同一代理IP"
          >
            <Switch />
          </Form.Item>

          <Divider orientation="left">自动清理</Divider>

          <Form.Item
            name="autoCleanupDays"
            label="自动清理天数"
            rules={[{ required: true, message: '请输入清理天数' }]}
            extra="自动清理N天前的已使用代理IP记录"
          >
            <InputNumber min={1} max={90} className="w-full" />
          </Form.Item>

          <Divider orientation="left">监控告警</Divider>

          <Form.Item name="enableAlert" label="启用告警" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item
            name="failureThreshold"
            label="失败次数阈值"
            rules={[{ required: true, message: '请输入失败次数阈值' }]}
            extra="连续失败N次后触发告警"
          >
            <InputNumber min={1} max={10} className="w-full" />
          </Form.Item>

          <Divider orientation="left">邮件告警</Divider>

          <Form.Item name="enableEmailAlert" label="启用邮件告警" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item
            name="alertEmail"
            label="告警邮箱"
            rules={[{ type: 'email', message: '请输入有效的邮箱地址' }]}
          >
            <Input placeholder="admin@example.com" />
          </Form.Item>

          <Divider orientation="left">Webhook告警</Divider>

          <Form.Item name="enableWebhookAlert" label="启用Webhook告警" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item
            name="webhookUrl"
            label="Webhook URL"
            rules={[{ type: 'url', message: '请输入有效的URL' }]}
          >
            <Input placeholder="https://hooks.slack.com/services/..." />
          </Form.Item>

          <Divider />

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                icon={<SaveOutlined />}
                loading={loading}
              >
                保存设置
              </Button>
              <Button icon={<ReloadOutlined />} onClick={handleReset} disabled={loading}>
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
