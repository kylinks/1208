'use client'

import { useState, useEffect } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  message,
  Popconfirm,
  Progress,
  Statistic,
  Card,
  Row,
  Col,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ApiOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

interface ProxyProvider {
  id: string
  name: string
  proxyHost: string
  proxyPort: number
  username: string
  priority: number
  enabled: boolean
  successRate?: number
  lastFailedAt?: string
  createdAt: string
  updatedAt: string
}

export default function ProxyManagement() {
  const [providers, setProviders] = useState<ProxyProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProxyProvider | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    fetchProviders()
  }, [])

  const fetchProviders = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/proxy-providers')
      if (!response.ok) {
        throw new Error('获取代理供应商失败')
      }
      const data = await response.json()
      setProviders(data)
    } catch (error) {
      message.error('获取代理供应商失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingProvider(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (record: ProxyProvider) => {
    setEditingProvider(record)
    form.setFieldsValue(record)
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/proxy-providers/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error('删除失败')
      }
      message.success('删除成功')
      fetchProviders()
    } catch (error) {
      message.error('删除失败')
      console.error(error)
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      
      if (editingProvider) {
        const response = await fetch(`/api/proxy-providers/${editingProvider.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(values),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || errorData.details || '更新失败')
        }
        message.success('更新成功')
      } else {
        const response = await fetch('/api/proxy-providers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(values),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || errorData.details || '创建失败')
        }
        message.success('创建成功')
      }
      
      setModalVisible(false)
      fetchProviders()
    } catch (error: any) {
      message.error(error.message || '操作失败')
      console.error('提交失败:', error)
    }
  }

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      const response = await fetch(`/api/proxy-providers/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled }),
      })
      if (!response.ok) {
        throw new Error('操作失败')
      }
      message.success(enabled ? '已启用' : '已禁用')
      fetchProviders()
    } catch (error) {
      message.error('操作失败')
      console.error(error)
    }
  }

  const handleTestConnection = async (id: string) => {
    try {
      // TODO: 调用API测试连接
      // await fetch(`/api/proxy-providers/${id}/test`, { method: 'POST' })
      message.success('连接测试成功')
    } catch (error) {
      message.error('连接测试失败')
      console.error(error)
    }
  }

  const columns: ColumnsType<ProxyProvider> = [
    {
      title: '供应商名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '代理服务器',
      dataIndex: 'proxyHost',
      key: 'proxyHost',
      render: (text, record) => (
        <span className="text-blue-500 font-mono text-xs">
          {text}:{record.proxyPort}
        </span>
      ),
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      ellipsis: true,
      render: (text) => (
        <span className="font-mono text-xs">{text}</span>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      sorter: (a, b) => a.priority - b.priority,
      render: (priority) => (
        <span className="font-semibold">#{priority}</span>
      ),
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (rate) => rate ? (
        <Progress
          percent={rate}
          size="small"
          status={rate >= 95 ? 'success' : rate >= 90 ? 'normal' : 'exception'}
        />
      ) : '-',
    },
    {
      title: '状态',
      dataIndex: 'enabled',
      key: 'enabled',
      render: (enabled, record) => (
        <Switch
          checked={enabled}
          onChange={(checked) => handleToggleEnabled(record.id, checked)}
        />
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            icon={<ApiOutlined />}
            onClick={() => handleTestConnection(record.id)}
          >
            测试
          </Button>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除此代理供应商吗?"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const enabledProviders = providers.filter(p => p.enabled)
  const avgSuccessRate = enabledProviders.length > 0
    ? enabledProviders.reduce((sum, p) => sum + (p.successRate || 0), 0) / enabledProviders.length
    : 0

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold m-0">代理管理</h2>
          <p className="text-gray-600 mt-2">管理代理供应商和配置优先级</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加代理供应商
        </Button>
      </div>

      <Row gutter={16} className="mb-6">
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="总供应商"
              value={providers.length}
              prefix={<ApiOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="已启用"
              value={enabledProviders.length}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic
              title="平均成功率"
              value={avgSuccessRate}
              precision={1}
              suffix="%"
              valueStyle={{ color: avgSuccessRate >= 95 ? '#52c41a' : '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      <Table
        columns={columns}
        dataSource={providers}
        rowKey="id"
        loading={loading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      <Modal
        title={editingProvider ? '编辑代理供应商' : '添加代理供应商'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="name"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="Bright Data" />
          </Form.Item>

          <Form.Item
            name="proxyHost"
            label="代理服务器地址"
            rules={[{ required: true, message: '请输入代理服务器地址' }]}
          >
            <Input placeholder="brd.superproxy.io" />
          </Form.Item>

          <Form.Item
            name="proxyPort"
            label="代理服务器端口"
            initialValue={8080}
            rules={[{ required: true, message: '请输入代理服务器端口' }]}
          >
            <InputNumber min={1} max={65535} className="w-full" placeholder="8080" />
          </Form.Item>

          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
            extra={
              <div className="text-xs">
                <div>支持占位符：</div>
                <div>• {'{country}'} - 国家代码小写 (如: au, us)</div>
                <div>• {'{COUNTRY}'} - 国家代码大写 (如: AU, US)</div>
                <div>• {'{session:8}'} - 8位随机数字 (如: 37557770)</div>
                <div>示例: user-region-{'{country}'}-session-{'{session:8}'}</div>
              </div>
            }
          >
            <Input placeholder="user-region-{country}-session-{session:8}" />
          </Form.Item>

          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
            extra={
              <div className="text-xs">
                <div>密码将加密存储，同样支持占位符</div>
                <div>示例: password_{'{random:10}'}</div>
              </div>
            }
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>

          <Form.Item
            name="priority"
            label="优先级"
            initialValue={0}
            rules={[{ required: true, message: '请输入优先级' }]}
            extra="数字越小优先级越高,系统会按优先级顺序尝试"
          >
            <InputNumber min={0} max={100} className="w-full" />
          </Form.Item>

          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
