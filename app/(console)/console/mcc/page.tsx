'use client'

import { useState, useEffect } from 'react'
import {
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  message,
  Tag,
  Popconfirm,
  Statistic,
  Card,
  Row,
  Col,
  Alert,
  Descriptions,
  Typography,
  Spin,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  SearchOutlined,
  CloudServerOutlined,
  TeamOutlined,
  StopOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { OverviewKpiCard } from '../components/OverviewKpiCard'

const { Text } = Typography

/**
 * MCC 账号接口
 */
interface MccAccount {
  id: string
  mccId: string
  name: string
  totalCids: number
  activeCids: number
  suspendedCids: number
  lastSyncAt?: string
  createdAt: string
}

/**
 * MCC 验证结果接口
 */
interface MccVerifyResult {
  mccId: string
  mccName: string
  totalCids: number
  activeCids: number
  suspendedCids: number
  verified: boolean
  verifiedAt: string
}

/**
 * MCC 管理页面
 */
export default function MccManagement() {
  const [mccAccounts, setMccAccounts] = useState<MccAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [form] = Form.useForm()
  
  // 验证状态
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<MccVerifyResult | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  
  // 同步状态
  const [syncingId, setSyncingId] = useState<string | null>(null)

  // 统计数据
  const [stats, setStats] = useState({
    totalMcc: 0,
    totalCids: 0,
    activeCids: 0,
    suspendedCids: 0,
  })

  useEffect(() => {
    fetchMccAccounts()
  }, [])

  /**
   * 获取 MCC 列表
   */
  const fetchMccAccounts = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/mcc')
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '获取 MCC 列表失败')
      }

      setMccAccounts(result.data || [])

      // 计算统计数据
      const totalMcc = result.data?.length || 0
      const totalCids = result.data?.reduce((sum: number, mcc: MccAccount) => sum + mcc.totalCids, 0) || 0
      const activeCids = result.data?.reduce((sum: number, mcc: MccAccount) => sum + mcc.activeCids, 0) || 0
      const suspendedCids = result.data?.reduce((sum: number, mcc: MccAccount) => sum + mcc.suspendedCids, 0) || 0

      setStats({ totalMcc, totalCids, activeCids, suspendedCids })
    } catch (error: any) {
      console.error('获取 MCC 列表失败:', error)
      message.error(error.message || '获取 MCC 列表失败')
    } finally {
      setLoading(false)
    }
  }

  /**
   * 打开添加弹窗
   */
  const handleAdd = () => {
    form.resetFields()
    setVerifyResult(null)
    setVerifyError(null)
    setModalVisible(true)
  }

  /**
   * 验证 MCC
   */
  const handleVerify = async () => {
    try {
      const mccId = form.getFieldValue('mccId')

      if (!mccId) {
        message.warning('请先输入 MCC 账号 ID')
        return
      }

      // 验证格式
      if (!/^\d{3}-\d{3}-\d{4}$/.test(mccId)) {
        message.error('MCC ID 格式无效，正确格式为：xxx-xxx-xxxx')
        return
      }

      // 检查是否已添加
      const existing = mccAccounts.find(m => m.mccId === mccId)
      if (existing) {
        message.error('该 MCC 账号已存在')
        return
      }

      setVerifying(true)
      setVerifyError(null)
      setVerifyResult(null)

      const response = await fetch('/api/google-ads/mcc/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mccId }),
      })

      // 尝试解析响应，处理非 JSON 响应的情况
      let result: any
      const contentType = response.headers.get('content-type')
      if (contentType && contentType.includes('application/json')) {
        result = await response.json()
      } else {
        // 如果响应不是 JSON（可能是 HTML 错误页面），提供友好的错误信息
        const text = await response.text()
        console.error('非 JSON 响应:', text.substring(0, 200))
        throw new Error('服务器响应异常，请稍后重试。可能是 Google Ads API 配额限制，请等待 1-2 分钟后再试。')
      }

      if (!response.ok) {
        throw new Error(result.error || '验证失败')
      }

      setVerifyResult(result.data)
      message.success('验证成功')
    } catch (error: any) {
      console.error('验证 MCC 失败:', error)
      setVerifyError(error.message || '验证失败')
      message.error(error.message || '验证失败')
    } finally {
      setVerifying(false)
    }
  }

  /**
   * 确认添加 MCC
   */
  const handleSubmit = async () => {
    try {
      if (!verifyResult) {
        message.warning('请先验证 MCC 账号')
        return
      }

      const response = await fetch('/api/mcc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mccId: verifyResult.mccId,
          mccName: verifyResult.mccName,
          skipVerify: true,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '添加失败')
      }

      message.success('MCC 账号添加成功')
      setModalVisible(false)
      
      // 自动同步 CID 数据
      await handleSync(result.data.id, false)
      
      // 刷新列表
      fetchMccAccounts()
    } catch (error: any) {
      console.error('添加 MCC 失败:', error)
      message.error(error.message || '添加失败')
    }
  }

  /**
   * 同步 MCC
   */
  const handleSync = async (id: string, showMessage = true) => {
    try {
      setSyncingId(id)

      const response = await fetch(`/api/mcc/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync: true }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '同步失败')
      }

      if (showMessage) {
        message.success(result.message || '同步成功')
      }
      fetchMccAccounts()
    } catch (error: any) {
      console.error('同步 MCC 失败:', error)
      if (showMessage) {
        message.error(error.message || '同步失败')
      }
    } finally {
      setSyncingId(null)
    }
  }

  /**
   * 删除 MCC
   */
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/mcc/${id}`, {
        method: 'DELETE',
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '删除失败')
      }

      message.success(result.message || '删除成功')
      fetchMccAccounts()
    } catch (error: any) {
      console.error('删除 MCC 失败:', error)
      message.error(error.message || '删除失败')
    }
  }

  /**
   * 表格列定义
   */
  const columns: ColumnsType<MccAccount> = [
    {
      title: '序号',
      key: 'index',
      width: 60,
      render: (_, __, index) => index + 1,
    },
    {
      title: 'MCC 账号 ID',
      dataIndex: 'mccId',
      key: 'mccId',
      render: (text) => <code className="text-blue-600">{text}</code>,
    },
    {
      title: 'MCC 账号名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '所有 CID',
      dataIndex: 'totalCids',
      key: 'totalCids',
      render: (num) => <Tag color="blue">{num}</Tag>,
    },
    {
      title: '有效 CID',
      dataIndex: 'activeCids',
      key: 'activeCids',
      render: (num) => <Tag color="green">{num}</Tag>,
    },
    {
      title: '规避 CID',
      dataIndex: 'suspendedCids',
      key: 'suspendedCids',
      render: (num) => <Tag color="orange">{num}</Tag>,
    },
    {
      title: '最后同步时间',
      dataIndex: 'lastSyncAt',
      key: 'lastSyncAt',
      render: (text) => text ? new Date(text).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<SyncOutlined />}
            loading={syncingId === record.id}
            onClick={() => handleSync(record.id)}
          >
            同步
          </Button>
          <Popconfirm
            title="确定要删除此 MCC 账号吗？"
            description="删除后关联的 CID 账户也将被删除"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      {/* 页面标题 */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold m-0">MCC 账号管理</h2>
          <p className="text-gray-600 mt-2">管理 Google Ads MCC 账号和子账户（CID）</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          添加 MCC 账号
        </Button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <OverviewKpiCard
          title="MCC 账号总数"
          icon={<CloudServerOutlined style={{ fontSize: 18 }} />}
          value={<span className="tabular-nums">{stats.totalMcc.toLocaleString()}</span>}
          loading={loading}
          theme={{
            bg: 'bg-orange-50',
            border: 'border-orange-200',
            titleText: 'text-orange-700',
            valueText: 'text-orange-600',
            iconBg: 'bg-orange-100',
            iconText: 'text-orange-700',
          }}
        />

        <OverviewKpiCard
          title="所有 CID"
          icon={<TeamOutlined style={{ fontSize: 18 }} />}
          value={<span className="tabular-nums">{stats.totalCids.toLocaleString()}</span>}
          loading={loading}
          theme={{
            bg: 'bg-sky-50',
            border: 'border-sky-200',
            titleText: 'text-sky-700',
            valueText: 'text-sky-600',
            iconBg: 'bg-sky-100',
            iconText: 'text-sky-700',
          }}
        />

        <OverviewKpiCard
          title="有效 CID"
          icon={<CheckCircleOutlined style={{ fontSize: 18 }} />}
          value={<span className="tabular-nums">{stats.activeCids.toLocaleString()}</span>}
          loading={loading}
          theme={{
            bg: 'bg-emerald-50',
            border: 'border-emerald-200',
            titleText: 'text-emerald-700',
            valueText: 'text-emerald-600',
            iconBg: 'bg-emerald-100',
            iconText: 'text-emerald-700',
          }}
        />

        <OverviewKpiCard
          title="规避 CID"
          icon={<StopOutlined style={{ fontSize: 18 }} />}
          value={<span className="tabular-nums">{stats.suspendedCids.toLocaleString()}</span>}
          loading={loading}
          theme={{
            bg: 'bg-violet-50',
            border: 'border-violet-200',
            titleText: 'text-violet-700',
            valueText: 'text-violet-600',
            iconBg: 'bg-violet-100',
            iconText: 'text-violet-700',
          }}
        />
      </div>

      {/* MCC 列表表格 */}
      <Table
        columns={columns}
        dataSource={mccAccounts}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
      />

      {/* 添加 MCC 弹窗 */}
      <Modal
        title="添加 MCC 账号"
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={700}
        okText="确认添加"
        cancelText="取消"
        okButtonProps={{ disabled: !verifyResult || verifying }}
        cancelButtonProps={{ disabled: verifying }}
        closable={!verifying}
        maskClosable={!verifying}
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="mccId"
            label="MCC 账号 ID"
            rules={[
              { required: true, message: '请输入 MCC 账号 ID' },
              { pattern: /^\d{3}-\d{3}-\d{4}$/, message: '格式：xxx-xxx-xxxx' },
            ]}
          >
            <Input.Search
              placeholder="格式：968-646-8564"
              enterButton={
                <Button type="primary" icon={verifying ? <LoadingOutlined /> : <SearchOutlined />} disabled={verifying}>
                  {verifying ? '验证中...' : '验证'}
                </Button>
              }
              onSearch={handleVerify}
              loading={verifying}
              disabled={verifying}
              onChange={() => {
                setVerifyResult(null)
                setVerifyError(null)
              }}
            />
          </Form.Item>

          {/* 验证中提示 */}
          {verifying && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-3">
                <Spin indicator={<LoadingOutlined style={{ fontSize: 24, color: '#1890ff' }} spin />} />
                <div>
                  <div className="font-medium text-blue-700">正在验证 MCC 账号...</div>
                  <div className="text-sm text-blue-600 mt-1">
                    正在连接 Google Ads API，请稍候（可能需要 10-30 秒）
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 验证错误提示 */}
          {!verifying && verifyError && (
            <Alert
              message="验证失败"
              description={verifyError}
              type="error"
              showIcon
              className="mb-4"
            />
          )}

          {/* 验证成功展示 */}
          {!verifying && verifyResult && (
            <Card
              size="small"
              style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}
              className="mb-4"
            >
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                  <Text strong style={{ color: '#52c41a' }}>
                    验证成功
                  </Text>
                </div>
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="MCC 账号名称">
                    {verifyResult.mccName}
                  </Descriptions.Item>
                  <Descriptions.Item label="MCC 账号 ID">
                    {verifyResult.mccId}
                  </Descriptions.Item>
                </Descriptions>
                <Row gutter={16}>
                  <Col span={8}>
                    <Statistic
                      title="所有 CID"
                      value={verifyResult.totalCids}
                      valueStyle={{ color: '#1890ff', fontSize: 20 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="有效 CID"
                      value={verifyResult.activeCids}
                      valueStyle={{ color: '#52c41a', fontSize: 20 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="规避 CID"
                      value={verifyResult.suspendedCids}
                      valueStyle={{ color: '#faad14', fontSize: 20 }}
                    />
                  </Col>
                </Row>
              </Space>
            </Card>
          )}

          {/* 提示信息 */}
          {!verifying && !verifyResult && !verifyError && (
            <Alert
              message="使用说明"
              description="请输入 MCC 账号 ID 并点击「验证」按钮。系统将调用 Google Ads API 验证该 MCC 是否存在且服务账号有权限访问。"
              type="info"
              showIcon
            />
          )}
        </Form>
      </Modal>
    </div>
  )
}
