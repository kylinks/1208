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
  Tag,
  Tooltip,
  Alert,
} from 'antd'
import {
  SaveOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import { useMonitor } from '../../MonitorContext'

interface SystemConfig {
  [key: string]: any
}

interface UserSchedule {
  enabled: boolean
  intervalMinutes: number
  nextRunAt: string | null
  lastRunAt: string | null
  lastStatus: 'success' | 'failed' | 'skipped' | null
  lastError: string | null
  lastDuration: number | null
  isLocked: boolean
}

export default function SystemSettings() {
  const [loading, setLoading] = useState(false)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [settingsForm] = Form.useForm()
  const [scheduleForm] = Form.useForm()
  const [userSchedule, setUserSchedule] = useState<UserSchedule | null>(null)
  const { fetchMonitorConfig } = useMonitor()

  useEffect(() => {
    fetchSettings()
    fetchUserSchedule()
  }, [])

  // 获取用户个人调度配置
  const fetchUserSchedule = async () => {
    try {
      setScheduleLoading(true)
      const response = await fetch('/api/user-schedule')
      const result = await response.json()
      if (result.success) {
        setUserSchedule(result.data)
        scheduleForm.setFieldsValue({
          enabled: result.data.enabled,
          intervalMinutes: result.data.intervalMinutes,
        })
      }
    } catch (error) {
      console.error('获取调度配置失败:', error)
    } finally {
      setScheduleLoading(false)
    }
  }

  // 保存用户个人调度配置
  const handleSaveSchedule = async () => {
    try {
      setScheduleLoading(true)
      const values = await scheduleForm.validateFields()
      const response = await fetch('/api/user-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const result = await response.json()
      if (result.success) {
        message.success('调度配置保存成功')
        setUserSchedule(result.data)
      } else {
        message.error(result.error || '保存失败')
      }
    } catch (error) {
      message.error('保存失败')
      console.error(error)
    } finally {
      setScheduleLoading(false)
    }
  }

  // 立即触发执行
  const handleTriggerNow = async () => {
    try {
      setScheduleLoading(true)
      const response = await fetch('/api/user-schedule', {
        method: 'PUT',
      })
      const result = await response.json()
      if (result.success) {
        message.success(result.message || '已标记为立即执行')
        await fetchUserSchedule()
      } else {
        message.error(result.error || '操作失败')
      }
    } catch (error) {
      message.error('操作失败')
      console.error(error)
    } finally {
      setScheduleLoading(false)
    }
  }

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

  // 格式化时间
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '-'
    return new Date(isoString).toLocaleString('zh-CN')
  }

  // 格式化耗时
  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}min`
  }

  // 状态标签
  const getStatusTag = (status: string | null) => {
    switch (status) {
      case 'success':
        return <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
      case 'failed':
        return <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>
      case 'skipped':
        return <Tag icon={<SyncOutlined />} color="default">跳过</Tag>
      default:
        return <Tag color="default">未执行</Tag>
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold m-0">系统设置</h2>
        <p className="text-gray-600 mt-2">配置监控调度、自动清理与告警通知</p>
      </div>

      {/* 我的监控调度 */}
      <Card title={<><ClockCircleOutlined className="mr-2" />我的监控调度</>} className="mb-4">
        <Alert
          message="个人监控间隔"
          description="设置您的广告系列自动检测间隔。系统会按照您设定的间隔自动检测点击数变化并执行换链操作。"
          type="info"
          showIcon
          className="mb-4"
        />

        <Form form={scheduleForm} layout="vertical">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Form.Item
              name="enabled"
              label="启用自动监控"
              valuePropName="checked"
            >
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>

            <Form.Item
              name="intervalMinutes"
              label="监控间隔（分钟）"
              rules={[{ required: true, message: '请输入监控间隔' }]}
              extra="建议设置 5-60 分钟，过短可能导致资源紧张"
            >
              <InputNumber min={1} max={1440} className="w-full" />
            </Form.Item>
          </div>

          {userSchedule && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">下次执行：</span>
                  <div className="font-medium">
                    {userSchedule.isLocked ? (
                      <Tooltip title="任务正在执行中">
                        <Tag color="processing" icon={<SyncOutlined spin />}>执行中</Tag>
                      </Tooltip>
                    ) : (
                      formatTime(userSchedule.nextRunAt)
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-gray-500">上次执行：</span>
                  <div className="font-medium">{formatTime(userSchedule.lastRunAt)}</div>
                </div>
                <div>
                  <span className="text-gray-500">上次状态：</span>
                  <div>{getStatusTag(userSchedule.lastStatus)}</div>
                </div>
                <div>
                  <span className="text-gray-500">上次耗时：</span>
                  <div className="font-medium">{formatDuration(userSchedule.lastDuration)}</div>
                </div>
              </div>
              {userSchedule.lastError && (
                <div className="mt-2 text-red-500 text-sm">
                  <span className="text-gray-500">错误信息：</span>
                  {userSchedule.lastError}
                </div>
              )}
            </div>
          )}

          <Form.Item>
            <Space>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={scheduleLoading}
                onClick={handleSaveSchedule}
              >
                保存调度配置
              </Button>
              <Button
                icon={<PlayCircleOutlined />}
                loading={scheduleLoading}
                onClick={handleTriggerNow}
              >
                立即执行
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={fetchUserSchedule}
                disabled={scheduleLoading}
              >
                刷新状态
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 系统设置（原有内容） */}
      <Card title="高级设置">
        <Form form={settingsForm} layout="vertical" onFinish={handleSave}>
          <Divider orientation="left">监控参数</Divider>

          <Form.Item
            name="cronInterval"
            label="系统默认间隔(分钟)"
            rules={[{ required: true, message: '请输入监控间隔' }]}
            extra="新用户的默认监控间隔（用户可在上方自定义）"
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
                保存高级设置
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
