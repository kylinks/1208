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
  Tag,
  Popconfirm,
  Spin,
  Timeline,
  Tooltip,
  Alert,
  Steps,
  Card,
  Descriptions,
  Divider,
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
  ReloadOutlined,
  SyncOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  GlobalOutlined,
  ArrowRightOutlined,
  ExperimentOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

interface AffiliateConfig {
  id: string
  campaignId: string
  campaignName?: string
  affiliateLink: string
  targetDomain: string
  countryCode: string
  maxRedirects: number
  enabled: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

// 验证结果接口
interface VerifyResult {
  success: boolean
  proxyIp?: string
  proxyProvider?: string
  redirectChain: {
    step: number
    url: string
    domain: string
    statusCode?: number
    redirectType?: string // http, meta, js
  }[]
  finalUrl?: string
  finalDomain?: string
  targetDomain?: string
  matched: boolean
  totalRedirects: number
  error?: string
  message?: string
}

// 从 Google Ads 同步的广告系列数据
interface CampaignData {
  id: string
  campaignId: string
  campaignName: string
  cidId: string
  cidName: string
  mccId: string
  mccName: string
  countryCode: string
  finalUrl: string | null
  referrer: string | null  // 来路
  affiliateLink: string | null  // 联盟链接
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export default function LinksManagement() {
  const [links, setLinks] = useState<AffiliateConfig[]>([])
  const [campaigns, setCampaigns] = useState<CampaignData[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [modalVisible, setModalVisible] = useState(false)
  const [editingLink, setEditingLink] = useState<AffiliateConfig | null>(null)
  const [editingCampaign, setEditingCampaign] = useState<CampaignData | null>(null)
  const [campaignModalVisible, setCampaignModalVisible] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [currentPage, setCurrentPage] = useState(1)
  const [form] = Form.useForm()
  const [campaignForm] = Form.useForm()
  
  // 验证相关状态
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  useEffect(() => {
    fetchCampaigns()
  }, [])

  // 提取名称前3个数字用于排序
  const extractFirst3Digits = (name: string): number => {
    const match = name.match(/^(\d{1,3})/)
    return match ? parseInt(match[1], 10) : 0
  }

  // 获取已同步的广告系列
  const fetchCampaigns = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/google-ads/campaigns/sync')
      const data = await response.json()
      
      if (data.success) {
        // 按广告系列名称前3个数字从大到小排序
        const sortedCampaigns = (data.data.campaigns || []).sort((a: CampaignData, b: CampaignData) => {
          const numA = extractFirst3Digits(a.campaignName || '')
          const numB = extractFirst3Digits(b.campaignName || '')
          return numB - numA // 从大到小
        })
        setCampaigns(sortedCampaigns)
      } else {
        message.error(data.error || '获取广告系列失败')
      }
    } catch (error) {
      message.error('获取广告系列失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  // 刷新广告系列 - 从 Google Ads API 同步
  const handleRefreshCampaigns = async () => {
    try {
      setSyncing(true)
      message.loading({ content: '正在从 Google Ads 同步广告系列...', key: 'sync', duration: 0 })
      
      const response = await fetch('/api/google-ads/campaigns/sync', {
        method: 'POST',
      })
      const data = await response.json()
      
      if (data.success) {
        const { totalCampaigns, newCount, updatedCount, removedCount, errors } = data.data
        
        message.destroy('sync')
        
        // 构建同步结果消息
        let syncMessage = `同步完成！共 ${totalCampaigns} 个启用的广告系列`
        const changes = []
        if (newCount > 0) changes.push(`新增 ${newCount} 个`)
        if (updatedCount > 0) changes.push(`更新 ${updatedCount} 个`)
        if (removedCount > 0) changes.push(`移除 ${removedCount} 个已暂停`)
        if (changes.length > 0) {
          syncMessage += `，${changes.join('，')}`
        }
        
        message.success(syncMessage)
        
        if (errors && errors.length > 0) {
          console.warn('部分 MCC 同步失败:', errors)
        }
        
        // 重新获取数据
        await fetchCampaigns()
      } else {
        message.destroy('sync')
        message.error(data.error || '同步广告系列失败')
      }
    } catch (error) {
      message.destroy('sync')
      message.error('同步广告系列失败')
      console.error(error)
    } finally {
      setSyncing(false)
    }
  }

  const fetchLinks = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/affiliate-configs')
      const data = await response.json()
      
      if (data.success) {
        setLinks(data.data || [])
      }
    } catch (error) {
      message.error('获取链接配置失败')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingLink(null)
    form.resetFields()
    setModalVisible(true)
  }

  const handleEdit = (record: AffiliateConfig) => {
    setEditingLink(record)
    form.setFieldsValue(record)
    setModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      // TODO: 调用API删除
      // await fetch(`/api/affiliate-configs/${id}`, { method: 'DELETE' })
      message.success('删除成功')
      fetchLinks()
    } catch (error) {
      message.error('删除失败')
      console.error(error)
    }
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      
      if (editingLink) {
        // TODO: 调用API更新
        // await fetch(`/api/affiliate-configs/${editingLink.id}`, {
        //   method: 'PUT',
        //   body: JSON.stringify(values),
        // })
        message.success('更新成功')
      } else {
        // TODO: 调用API创建
        // await fetch('/api/affiliate-configs', {
        //   method: 'POST',
        //   body: JSON.stringify(values),
        // })
        message.success('创建成功')
      }
      
      setModalVisible(false)
      fetchLinks()
    } catch (error) {
      message.error('操作失败')
      console.error(error)
    }
  }

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      // TODO: 调用API更新启用状态
      // await fetch(`/api/affiliate-configs/${id}/toggle`, {
      //   method: 'PATCH',
      //   body: JSON.stringify({ enabled }),
      // })
      message.success(enabled ? '已启用' : '已禁用')
      fetchLinks()
    } catch (error) {
      message.error('操作失败')
      console.error(error)
    }
  }

  // 提取根域名（去除 http/https 和 www）
  const extractRootDomain = (url: string | null): string => {
    if (!url) return ''
    try {
      const urlObj = new URL(url)
      return urlObj.hostname.replace(/^www\./, '')
    } catch {
      // 如果不是有效的 URL，尝试直接去除 www
      return url.replace(/^(https?:\/\/)?(www\.)?/, '')
    }
  }

  // 编辑广告系列
  const handleEditCampaign = (record: CampaignData) => {
    setEditingCampaign(record)
    campaignForm.setFieldsValue({
      campaignName: record.campaignName,
      countryCode: record.countryCode,
      finalUrl: extractRootDomain(record.finalUrl),
      referrer: record.referrer || 'https://t.co',
      affiliateLink: record.affiliateLink || '',
      enabled: record.enabled,
    })
    // 重置验证结果
    setVerifyResult(null)
    setCampaignModalVisible(true)
  }

  // 验证联盟链接
  const handleVerifyAffiliateLink = async () => {
    try {
      // 获取当前表单值
      const values = campaignForm.getFieldsValue()
      const { affiliateLink, countryCode, referrer, finalUrl } = values

      // 验证必填参数
      if (!affiliateLink) {
        message.warning('请先填写联盟链接')
        return
      }
      if (!countryCode) {
        message.warning('请先填写国家代码')
        return
      }

      setVerifying(true)
      setVerifyResult(null)

      const response = await fetch('/api/affiliate-configs/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          affiliateLink,
          countryCode,
          referrer: referrer || 'https://t.co',
          targetDomain: finalUrl || '', // 使用域名字段作为目标域名
          campaignId: editingCampaign?.id,
        }),
      })

      const data = await response.json()
      setVerifyResult(data)

      if (data.success) {
        if (data.matched) {
          message.success('验证成功！最终域名与目标域名一致')
        } else {
          message.info(`验证完成，共跳转 ${data.totalRedirects} 次`)
        }
      } else {
        message.error(data.error || '验证失败')
      }
    } catch (error) {
      console.error('验证失败:', error)
      message.error('验证请求失败')
    } finally {
      setVerifying(false)
    }
  }

  // 删除广告系列
  const handleDeleteCampaign = async (id: string) => {
    try {
      const response = await fetch(`/api/campaigns/${id}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      
      if (data.success) {
        message.success('删除成功')
        fetchCampaigns()
      } else {
        message.error(data.error || '删除失败')
      }
    } catch (error) {
      message.error('删除失败')
      console.error(error)
    }
  }

  // 保存广告系列编辑
  const handleCampaignSubmit = async () => {
    try {
      const values = await campaignForm.validateFields()
      
      if (!editingCampaign) return

      const response = await fetch(`/api/campaigns/${editingCampaign.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })
      const data = await response.json()
      
      if (data.success) {
        message.success('更新成功')
        setCampaignModalVisible(false)
        fetchCampaigns()
      } else {
        message.error(data.error || '更新失败')
      }
    } catch (error) {
      message.error('操作失败')
      console.error(error)
    }
  }

  // 广告系列表格列定义
  const campaignColumns: ColumnsType<CampaignData> = [
    {
      title: '序号',
      key: 'index',
      width: 60,
      render: (_, __, index) => index + 1,
    },
    {
      title: '广告系列',
      dataIndex: 'campaignName',
      key: 'campaignName',
      ellipsis: true,
      sorter: (a, b) => extractFirst3Digits(a.campaignName || '') - extractFirst3Digits(b.campaignName || ''),
      defaultSortOrder: 'descend',
      render: (text, record) => (
        <Tooltip title={`${text} (ID: ${record.campaignId})`}>
          <span className="font-medium">{text}</span>
        </Tooltip>
      ),
    },
    {
      title: '国家',
      dataIndex: 'countryCode',
      key: 'countryCode',
      width: 80,
      render: (code) => code ? <Tag color="blue">{code}</Tag> : <Tag color="default">未知</Tag>,
    },
    {
      title: '域名',
      dataIndex: 'finalUrl',
      key: 'finalUrl',
      ellipsis: true,
      render: (text) => {
        if (!text) return <span className="text-gray-400">-</span>
        try {
          const url = new URL(text)
          // 去除 www. 前缀，只显示根域名
          const rootDomain = url.hostname.replace(/^www\./, '')
          return (
            <a href={text} target="_blank" rel="noopener noreferrer" className="text-blue-500">
              <LinkOutlined className="mr-1" />
              {rootDomain}
            </a>
          )
        } catch {
          return <span className="text-gray-400">{text}</span>
        }
      },
    },
    {
      title: '来路',
      dataIndex: 'referrer',
      key: 'referrer',
      ellipsis: true,
      render: (text) => text ? (
        <span className="text-gray-600">{text}</span>
      ) : (
        <span className="text-gray-400">-</span>
      ),
    },
    {
      title: '联盟链接',
      dataIndex: 'affiliateLink',
      key: 'affiliateLink',
      ellipsis: true,
      render: (text) => text ? (
        <a href={text} target="_blank" rel="noopener noreferrer" className="text-blue-500">
          <LinkOutlined className="mr-1" />
          {text.length > 30 ? text.substring(0, 30) + '...' : text}
        </a>
      ) : (
        <span className="text-gray-400">-</span>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditCampaign(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除此广告系列吗?"
            description="删除后将无法恢复"
            onConfirm={() => handleDeleteCampaign(record.id)}
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

  const columns: ColumnsType<AffiliateConfig> = [
    {
      title: '广告系列',
      dataIndex: 'campaignName',
      key: 'campaignName',
      render: (text) => text || '-',
    },
    {
      title: '联盟链接',
      dataIndex: 'affiliateLink',
      key: 'affiliateLink',
      render: (text) => (
        <a href={text} target="_blank" rel="noopener noreferrer" className="text-blue-500">
          <LinkOutlined className="mr-1" />
          {text.substring(0, 40)}...
        </a>
      ),
    },
    {
      title: '目标域名',
      dataIndex: 'targetDomain',
      key: 'targetDomain',
    },
    {
      title: '国家',
      dataIndex: 'countryCode',
      key: 'countryCode',
      render: (code) => <Tag color="blue">{code}</Tag>,
    },
    {
      title: '最大跳转',
      dataIndex: 'maxRedirects',
      key: 'maxRedirects',
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      sorter: (a, b) => a.priority - b.priority,
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
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除此链接配置吗?"
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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold m-0">链接管理</h2>
          <p className="text-gray-600 mt-2">管理广告系列的联盟链接配置（从 Google Ads 同步）</p>
        </div>
        <Button 
          type="primary" 
          icon={syncing ? <SyncOutlined spin /> : <ReloadOutlined />} 
          onClick={handleRefreshCampaigns}
          loading={syncing}
        >
          刷新广告系列
        </Button>
      </div>

      <Table
        columns={campaignColumns}
        dataSource={campaigns}
        rowKey="id"
        loading={loading || syncing}
        size="small"
        pagination={{
          current: currentPage,
          pageSize: pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 条广告系列`,
          onChange: (page, size) => {
            setCurrentPage(page)
            if (size !== pageSize) {
              setPageSize(size)
              setCurrentPage(1) // 切换每页条数时回到第一页
            }
          },
        }}
        locale={{
          emptyText: (
            <div className="py-8 text-center">
              <p className="text-gray-500 mb-4">暂无广告系列数据</p>
              <Button type="primary" onClick={handleRefreshCampaigns} disabled={syncing}>
                {syncing ? '同步中...' : '点击刷新从 Google Ads 同步'}
              </Button>
            </div>
          ),
        }}
      />

      <Modal
        title={editingLink ? '编辑链接配置' : '添加链接配置'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={600}
        okText="确定"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            name="campaignId"
            label="广告系列ID"
            rules={[{ required: true, message: '请输入广告系列ID' }]}
          >
            <Input placeholder="请输入广告系列ID" />
          </Form.Item>

          <Form.Item
            name="affiliateLink"
            label="联盟链接"
            rules={[
              { required: true, message: '请输入联盟链接' },
              { type: 'url', message: '请输入有效的URL' },
            ]}
          >
            <Input.TextArea
              placeholder="https://affiliate.example.com/track?id=12345"
              rows={2}
            />
          </Form.Item>

          <Form.Item
            name="targetDomain"
            label="目标根域名"
            rules={[{ required: true, message: '请输入目标根域名' }]}
          >
            <Input placeholder="example.com" />
          </Form.Item>

          <Form.Item
            name="countryCode"
            label="国家代码"
            rules={[{ required: true, message: '请输入国家代码' }]}
          >
            <Input placeholder="US" maxLength={10} />
          </Form.Item>

          <Form.Item
            name="maxRedirects"
            label="最大跳转次数"
            initialValue={10}
            rules={[{ required: true, message: '请输入最大跳转次数' }]}
          >
            <InputNumber min={1} max={20} className="w-full" />
          </Form.Item>

          <Form.Item
            name="priority"
            label="优先级"
            initialValue={0}
            rules={[{ required: true, message: '请输入优先级' }]}
            extra="数字越小优先级越高"
          >
            <InputNumber min={0} max={100} className="w-full" />
          </Form.Item>

          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑广告系列弹窗 */}
      <Modal
        title="编辑广告系列"
        open={campaignModalVisible}
        onOk={handleCampaignSubmit}
        onCancel={() => {
          setCampaignModalVisible(false)
          setVerifyResult(null)
        }}
        width={700}
        okText="保存"
        cancelText="取消"
      >
        <Form form={campaignForm} layout="vertical" className="mt-4">
          <Form.Item
            name="campaignName"
            label="广告系列"
          >
            <Input disabled />
          </Form.Item>

          <Form.Item
            name="countryCode"
            label="国家"
            rules={[{ required: true, message: '请输入国家代码' }]}
          >
            <Input placeholder="US" maxLength={10} />
          </Form.Item>

          <Form.Item
            name="finalUrl"
            label="域名"
            extra="用于验证联盟链接最终是否跳转到此域名"
          >
            <Input placeholder="example.com" />
          </Form.Item>

          <Form.Item
            name="referrer"
            label="来路"
            extra="访问联盟链接时使用的 Referer"
          >
            <Input placeholder="https://t.co" />
          </Form.Item>

          <Form.Item
            name="affiliateLink"
            label={
              <Space>
                <span>联盟链接</span>
                <Button
                  type="primary"
                  size="small"
                  icon={verifying ? <LoadingOutlined /> : <ExperimentOutlined />}
                  onClick={handleVerifyAffiliateLink}
                  loading={verifying}
                >
                  验证
                </Button>
              </Space>
            }
            rules={[
              { type: 'url', message: '请输入有效的URL' },
            ]}
          >
            <Input.TextArea
              placeholder="https://affiliate.example.com/track?id=12345"
              rows={2}
            />
          </Form.Item>

          {/* 验证结果展示 */}
          {verifyResult && (
            <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-base">
                  {verifyResult.success ? (
                    verifyResult.matched ? (
                      <Tag color="success" icon={<CheckCircleOutlined />}>验证成功</Tag>
                    ) : (
                      <Tag color="warning" icon={<ExperimentOutlined />}>验证完成</Tag>
                    )
                  ) : (
                    <Tag color="error" icon={<CloseCircleOutlined />}>验证失败</Tag>
                  )}
                </span>
                <span className="text-gray-500 text-sm">
                  共 {verifyResult.totalRedirects} 次跳转
                </span>
              </div>

              {/* 代理信息 */}
              {verifyResult.proxyProvider && (
                <div className="mb-3 text-sm">
                  <GlobalOutlined className="mr-2 text-blue-500" />
                  <span className="text-gray-600">代理: </span>
                  <span className="font-medium">{verifyResult.proxyProvider}</span>
                  {verifyResult.proxyIp && (
                    <span className="text-gray-400 ml-2">({verifyResult.proxyIp})</span>
                  )}
                </div>
              )}

              {/* 重定向链 */}
              {verifyResult.redirectChain && verifyResult.redirectChain.length > 0 && (
                <div className="mb-3">
                  <div className="text-sm text-gray-600 mb-2">重定向链:</div>
                  <div className="max-h-48 overflow-y-auto">
                    <Steps
                      direction="vertical"
                      size="small"
                      current={verifyResult.redirectChain.length - 1}
                      items={verifyResult.redirectChain.map((item, index) => ({
                        title: (
                          <span className="text-xs font-medium">
                            {item.domain}
                            {item.statusCode && item.statusCode > 0 && (
                              <Tag 
                                color={item.statusCode >= 200 && item.statusCode < 400 ? 'blue' : 'red'} 
                                className="ml-2"
                                style={{ fontSize: '10px' }}
                              >
                                {item.statusCode}
                              </Tag>
                            )}
                            {item.redirectType && item.redirectType !== 'http' && (
                              <Tag 
                                color={item.redirectType === 'meta' ? 'purple' : 'orange'} 
                                className="ml-1"
                                style={{ fontSize: '10px' }}
                              >
                                {item.redirectType === 'meta' ? 'Meta' : 'JS'}
                              </Tag>
                            )}
                          </span>
                        ),
                        description: (
                          <Tooltip title={item.url}>
                            <span className="text-xs text-gray-400 break-all">
                              {item.url.length > 60 ? item.url.substring(0, 60) + '...' : item.url}
                            </span>
                          </Tooltip>
                        ),
                        status: index === verifyResult.redirectChain.length - 1 
                          ? (verifyResult.matched ? 'finish' : 'process')
                          : 'finish',
                      }))}
                    />
                  </div>
                </div>
              )}

              {/* 最终结果 */}
              <div className="pt-3 border-t">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-600">最终域名:</span>
                  <span className={`font-medium ${verifyResult.matched ? 'text-green-600' : 'text-orange-500'}`}>
                    {verifyResult.finalDomain || '-'}
                  </span>
                </div>
                {verifyResult.targetDomain && (
                  <div className="flex justify-between items-center text-sm mt-1">
                    <span className="text-gray-600">目标域名:</span>
                    <span className="font-medium">{verifyResult.targetDomain}</span>
                  </div>
                )}
                {verifyResult.message && (
                  <div className="mt-2 text-xs text-gray-500">{verifyResult.message}</div>
                )}
                {verifyResult.error && (
                  <div className="mt-2 text-xs text-red-500">{verifyResult.error}</div>
                )}
              </div>
            </div>
          )}

          <Form.Item 
            name="enabled" 
            label="启用状态" 
            valuePropName="checked"
          >
            <Switch checkedChildren="启用" unCheckedChildren="禁用" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
