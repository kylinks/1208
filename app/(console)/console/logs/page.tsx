'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Table,
  Tag,
  Space,
  DatePicker,
  Select,
  Button,
  Descriptions,
  Modal,
  Input,
  Card,
  message,
  Tooltip,
  Typography,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
  SearchOutlined,
  ReloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'
import dayjs, { Dayjs } from 'dayjs'
import { OverviewKpiCard } from '../components/OverviewKpiCard'

const { RangePicker } = DatePicker
const { Text, Paragraph } = Typography

// 批次日志详情项
interface LogDetailItem {
  campaignId: string
  campaignName: string
  status: 'updated' | 'skipped' | 'error'
  todayClicks?: number
  lastClicks?: number
  newClicks?: number
  newLink?: string
  proxyIp?: string
  googleAdsUpdated?: boolean
  googleAdsError?: string
  reason?: string
  error?: string
}

interface MonitoringLog {
  id: string
  isBatchLog?: boolean
  // 批次日志字段
  triggeredAt: string
  status: 'success' | 'failed' | 'skipped'
  executionTime?: number
  intervalMinutes?: number
  processed?: number
  updated?: number
  skipped?: number
  errors?: number
  details?: LogDetailItem[]
  successDetails?: LogDetailItem[]
  failedDetails?: LogDetailItem[]
  skippedDetails?: LogDetailItem[]
  // 单条日志字段（兼容旧数据）
  campaignId?: string
  campaignName?: string
  countryCode?: string
  todayClicks?: number
  lastClicks?: number
  newClicks?: number
  proxyIp?: string
  proxyPort?: number
  providerId?: string
  providerName?: string
  affiliateLink?: string
  finalUrl?: string
  redirectCount?: number
  errorMessage?: string
  createdAt: string
}

interface MonitorStats {
  totalCount: number
  todayCount: number
  yesterdayCount: number
  successCount: number
  failedCount: number
  skippedCount: number
  successRate: number
  // 广告系列处理统计
  campaignStats?: {
    totalProcessed: number
    totalUpdated: number
    totalSkipped: number
    totalErrors: number
  }
}

const statusMap = {
  success: { text: '成功', color: 'success', icon: <CheckCircleOutlined /> },
  failed: { text: '失败', color: 'error', icon: <CloseCircleOutlined /> },
  skipped: { text: '跳过', color: 'default', icon: <MinusCircleOutlined /> },
}

export default function LogsManagement() {
  // 监控日志状态
  const [monitorLogs, setMonitorLogs] = useState<MonitoringLog[]>([])
  const [monitorLoading, setMonitorLoading] = useState(false)
  const [monitorStats, setMonitorStats] = useState<MonitorStats | null>(null)
  const [monitorPagination, setMonitorPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  })
  const [monitorFilters, setMonitorFilters] = useState({
    dateRange: null as [Dayjs, Dayjs] | null,
    status: '',
    search: ''
  })

  // 详情弹窗状态
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [selectedLog, setSelectedLog] = useState<MonitoringLog | null>(null)

  const formatClicks = (value?: number) => {
    if (value === null || value === undefined) return '-'
    return value.toLocaleString()
  }

  // 获取监控日志
  const fetchMonitorLogs = useCallback(async () => {
    try {
      setMonitorLoading(true)
      const params = new URLSearchParams({
        page: monitorPagination.current.toString(),
        pageSize: monitorPagination.pageSize.toString()
      })

      if (monitorFilters.status) {
        params.append('status', monitorFilters.status)
      }
      if (monitorFilters.search) {
        params.append('search', monitorFilters.search)
      }
      if (monitorFilters.dateRange) {
        params.append('startDate', monitorFilters.dateRange[0].startOf('day').toISOString())
        params.append('endDate', monitorFilters.dateRange[1].endOf('day').toISOString())
      }

      const response = await fetch(`/api/monitoring-logs?${params}`)
      const data = await response.json()
      
      if (response.ok) {
        setMonitorLogs(data.data || [])
        setMonitorPagination(prev => ({
          ...prev,
          total: data.total || 0
        }))
      } else {
        message.error(data.error || '获取监控日志失败')
      }
    } catch (error) {
      console.error('获取监控日志失败:', error)
      message.error('获取监控日志失败')
    } finally {
      setMonitorLoading(false)
    }
  }, [monitorPagination.current, monitorPagination.pageSize, monitorFilters])

  // 获取监控日志统计
  const fetchMonitorStats = useCallback(async () => {
    try {
      const response = await fetch('/api/monitoring-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'stats' })
      })
      const data = await response.json()
      
      if (response.ok) {
        setMonitorStats(data)
      }
    } catch (error) {
      console.error('获取监控统计失败:', error)
    }
  }, [])

  // 初始化加载
  useEffect(() => {
    fetchMonitorStats()
    fetchMonitorLogs()
  }, [fetchMonitorStats, fetchMonitorLogs])

  // 监控日志搜索
  const handleMonitorSearch = () => {
    // 避免：setState + 立即fetch 造成双请求
    if (monitorPagination.current !== 1) {
      setMonitorPagination(prev => ({ ...prev, current: 1 }))
    } else {
      fetchMonitorLogs()
    }
  }

  // 监控日志表格分页变化
  const handleMonitorTableChange = (pagination: TablePaginationConfig) => {
    setMonitorPagination(prev => ({
      ...prev,
      current: pagination.current || 1,
      pageSize: pagination.pageSize || 20
    }))
  }

  // 刷新
  const handleRefresh = () => {
    fetchMonitorLogs()
    fetchMonitorStats()
    message.success('刷新成功')
  }

  // 查看监控日志详情
  const handleViewDetail = (record: MonitoringLog) => {
    setSelectedLog(record)
    setDetailModalVisible(true)
  }

  // 监控日志表格列（批次日志格式）
  const monitorColumns: ColumnsType<MonitoringLog> = [
    {
      title: '执行时间',
      dataIndex: 'triggeredAt',
      key: 'triggeredAt',
      width: 180,
      render: (text, record) => (
        <div>
          <Tooltip title={dayjs(text).format('YYYY-MM-DD HH:mm:ss')}>
            <span className="font-mono text-xs">
              {dayjs(text).format('MM-DD HH:mm:ss')}
            </span>
          </Tooltip>
          {record.intervalMinutes && (
            <div className="text-xs text-gray-400 mt-1">
              间隔: {record.intervalMinutes}分钟
            </div>
          )}
        </div>
      ),
      sorter: (a, b) => dayjs(a.triggeredAt).valueOf() - dayjs(b.triggeredAt).valueOf(),
    },
    {
      title: '处理结果',
      key: 'summary',
      width: 220,
      render: (_, record) => {
        if (record.isBatchLog) {
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <Tooltip title="总处理">
                <Tag color="default">{record.processed || 0} 个</Tag>
              </Tooltip>
              {(record.updated || 0) > 0 && (
                <Tooltip title="成功更新">
                  <Tag color="success">{record.updated} 更新</Tag>
                </Tooltip>
              )}
              {(record.skipped || 0) > 0 && (
                <Tooltip title="跳过（无新点击）">
                  <Tag color="default">{record.skipped} 跳过</Tag>
                </Tooltip>
              )}
              {(record.errors || 0) > 0 && (
                <Tooltip title="执行失败">
                  <Tag color="error">{record.errors} 失败</Tag>
                </Tooltip>
              )}
            </div>
          )
        }
        // 兼容旧数据
        return (
          <div>
            <div className="font-medium">{record.campaignName}</div>
            <Tag color="blue" className="mt-1">{record.countryCode}</Tag>
          </div>
        )
      },
    },
    {
      title: '成功详情',
      key: 'successInfo',
      width: 200,
      render: (_, record) => {
        if (!record.isBatchLog) return '-'
        const successDetails = record.successDetails || []
        if (successDetails.length === 0) {
          return <span className="text-gray-400">无更新</span>
        }
        return (
          <div className="text-xs">
            {successDetails.slice(0, 2).map((d, i) => (
              <div key={i} className="flex items-center gap-1">
                <CheckCircleOutlined className="text-green-500" />
                <span className="truncate max-w-32">{d.campaignName}</span>
                {d.newClicks && <Tag color="green" className="ml-1">+{d.newClicks}</Tag>}
              </div>
            ))}
            {successDetails.length > 2 && (
              <span className="text-gray-400">...还有 {successDetails.length - 2} 个</span>
            )}
          </div>
        )
      },
    },
    {
      title: '失败/跳过详情',
      key: 'failedInfo',
      width: 200,
      render: (_, record) => {
        if (!record.isBatchLog) {
          return record.errorMessage ? (
            <Text type="danger" className="text-xs">{record.errorMessage}</Text>
          ) : '-'
        }
        const failedDetails = record.failedDetails || []
        const skippedDetails = record.skippedDetails || []
        
        if (failedDetails.length === 0 && skippedDetails.length === 0) {
          return <span className="text-gray-400">-</span>
        }
        
        return (
          <div className="text-xs">
            {failedDetails.slice(0, 1).map((d, i) => (
              <div key={`f-${i}`} className="flex items-center gap-1 text-red-500">
                <CloseCircleOutlined />
                <span className="truncate max-w-28">{d.campaignName}</span>
                <Tooltip title={d.error}>
                  <span className="text-gray-400 truncate max-w-16">{d.error}</span>
                </Tooltip>
              </div>
            ))}
            {failedDetails.length > 1 && (
              <span className="text-red-400">...还有 {failedDetails.length - 1} 个失败</span>
            )}
            {skippedDetails.length > 0 && (
              <div className="text-gray-400">{skippedDetails.length} 个无新点击</div>
            )}
          </div>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: keyof typeof statusMap) => {
        const config = statusMap[status]
        return (
          <Tag icon={config.icon} color={config.color}>
            {config.text}
          </Tag>
        )
      },
    },
    {
      title: '耗时',
      dataIndex: 'executionTime',
      key: 'executionTime',
      width: 100,
      render: (time) => time ? (
        <span className={`font-mono text-xs ${time > 30000 ? 'text-red-500' : time > 15000 ? 'text-orange-500' : 'text-green-500'}`}>
          {time >= 1000 ? `${(time / 1000).toFixed(1)}s` : `${time}ms`}
        </span>
      ) : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          icon={<EyeOutlined />}
          onClick={() => handleViewDetail(record)}
        >
          详情
        </Button>
      ),
    },
  ]

  // 监控统计卡片
  const MonitorStatsCards = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
      <OverviewKpiCard
        title="监控批次"
        icon={<FileTextOutlined style={{ fontSize: 18 }} />}
        value={
          <>
            <span className="tabular-nums">{(monitorStats?.totalCount || 0).toLocaleString()}</span>
            <span className="ml-1 text-2xl sm:text-3xl font-bold opacity-80">次</span>
          </>
        }
        loading={monitorLoading}
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
        title="今日执行"
        icon={<ClockCircleOutlined style={{ fontSize: 18 }} />}
        value={
          <>
            <span className="tabular-nums">{(monitorStats?.todayCount || 0).toLocaleString()}</span>
            <span className="ml-1 text-2xl sm:text-3xl font-bold opacity-80">次</span>
          </>
        }
        loading={monitorLoading}
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
        title="批次成功率"
        icon={<CheckCircleOutlined style={{ fontSize: 18 }} />}
        value={<span className="tabular-nums">{(monitorStats?.successRate || 0).toFixed(0)}%</span>}
        loading={monitorLoading}
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
        title="广告系列处理统计"
        icon={<FileTextOutlined style={{ fontSize: 18 }} />}
        value={<span className="tabular-nums">{(monitorStats?.campaignStats?.totalProcessed || 0).toLocaleString()}</span>}
        loading={monitorLoading}
        theme={{
          bg: 'bg-violet-50',
          border: 'border-violet-200',
          titleText: 'text-violet-700',
          valueText: 'text-violet-600',
          iconBg: 'bg-violet-100',
          iconText: 'text-violet-700',
        }}
        footer={
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs sm:text-sm text-gray-600">处理</span>
              <span className="text-sm sm:text-base font-semibold text-violet-700 tabular-nums">
                {(monitorStats?.campaignStats?.totalProcessed || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs sm:text-sm text-gray-600">更新</span>
              <span className="text-sm sm:text-base font-semibold text-green-700 tabular-nums">
                {(monitorStats?.campaignStats?.totalUpdated || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs sm:text-sm text-gray-600">跳过</span>
              <span className="text-sm sm:text-base font-semibold text-gray-700 tabular-nums">
                {(monitorStats?.campaignStats?.totalSkipped || 0).toLocaleString()}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs sm:text-sm text-gray-600">失败</span>
              <span className="text-sm sm:text-base font-semibold text-red-600 tabular-nums">
                {(monitorStats?.campaignStats?.totalErrors || 0).toLocaleString()}
              </span>
            </div>
          </div>
        }
      />
    </div>
  )

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold m-0">日志查看</h2>
        <p className="text-gray-500 mt-2">查看监控执行日志</p>
      </div>
      
      <MonitorStatsCards />
      
      <Card size="small" className="mb-4">
        <Space wrap>
          <RangePicker
            showTime={{ format: 'HH:mm' }}
            format="YYYY-MM-DD HH:mm"
            value={monitorFilters.dateRange}
            onChange={(dates) => setMonitorFilters(prev => ({
              ...prev,
              dateRange: dates as [Dayjs, Dayjs] | null
            }))}
            placeholder={['开始时间', '结束时间']}
            style={{ width: 340 }}
          />
          <Select
            style={{ width: 120 }}
            placeholder="状态筛选"
            value={monitorFilters.status || undefined}
            onChange={(value) => setMonitorFilters(prev => ({ ...prev, status: value || '' }))}
            allowClear
            options={[
              { value: 'success', label: '成功' },
              { value: 'failed', label: '失败' },
              { value: 'skipped', label: '跳过' },
            ]}
          />
          <Input
            placeholder="搜索广告系列"
            prefix={<SearchOutlined className="text-gray-400" />}
            value={monitorFilters.search}
            onChange={(e) => setMonitorFilters(prev => ({ ...prev, search: e.target.value }))}
            onPressEnter={handleMonitorSearch}
            style={{ width: 200 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={handleMonitorSearch}
          >
            搜索
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleRefresh}
          >
            刷新
          </Button>
        </Space>
      </Card>

      <Table
        columns={monitorColumns}
        dataSource={monitorLogs}
        rowKey="id"
        loading={monitorLoading}
        pagination={{
          ...monitorPagination,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条`,
          pageSizeOptions: ['10', '20', '50', '100']
        }}
        onChange={handleMonitorTableChange}
        scroll={{ x: 1200 }}
        size="middle"
        rowClassName={(record) => 
          record.status === 'failed' ? 'bg-red-50' : ''
        }
      />

      {/* 监控日志详情弹窗 */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <FileTextOutlined />
            <span>监控日志详情</span>
          </div>
        }
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailModalVisible(false)}>
            关闭
          </Button>,
        ]}
        width={850}
      >
        {selectedLog && selectedLog.isBatchLog ? (
          // 批次日志详情
          <div>
            <Descriptions column={2} bordered size="small" className="mb-4">
              <Descriptions.Item label="执行时间" span={2}>
                {dayjs(selectedLog.triggeredAt).format('YYYY-MM-DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="监控间隔">
                {selectedLog.intervalMinutes || '-'} 分钟
              </Descriptions.Item>
              <Descriptions.Item label="执行耗时">
                {selectedLog.executionTime ? (
                  <span className={
                    selectedLog.executionTime > 30000 ? 'text-red-500' : 
                    selectedLog.executionTime > 15000 ? 'text-orange-500' : 'text-green-500'
                  }>
                    {selectedLog.executionTime >= 1000 
                      ? `${(selectedLog.executionTime / 1000).toFixed(1)}秒` 
                      : `${selectedLog.executionTime}毫秒`}
                  </span>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="总体状态" span={2}>
                <Tag
                  icon={statusMap[selectedLog.status].icon}
                  color={statusMap[selectedLog.status].color}
                >
                  {statusMap[selectedLog.status].text}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="处理数">{selectedLog.processed || 0}</Descriptions.Item>
              <Descriptions.Item label="更新数">
                <span className="text-green-600 font-medium">{selectedLog.updated || 0}</span>
              </Descriptions.Item>
              <Descriptions.Item label="跳过数">{selectedLog.skipped || 0}</Descriptions.Item>
              <Descriptions.Item label="错误数">
                <span className={`font-medium ${(selectedLog.errors || 0) > 0 ? 'text-red-500' : ''}`}>
                  {selectedLog.errors || 0}
                </span>
              </Descriptions.Item>
            </Descriptions>

            {/* 成功更新的广告系列 */}
            {selectedLog.successDetails && selectedLog.successDetails.length > 0 && (
              <Card 
                title={<span className="text-green-600"><CheckCircleOutlined className="mr-2" />成功更新 ({selectedLog.successDetails.length})</span>} 
                size="small" 
                className="mb-4"
              >
                <div className="max-h-48 overflow-auto">
                  {selectedLog.successDetails.map((detail, index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b last:border-b-0">
                      <div>
                        <span className="font-medium">{detail.campaignName}</span>
                        <div className="text-xs text-gray-500 mt-1">
                          点击: {detail.lastClicks} → {detail.todayClicks}
                          <Tag color="green" className="ml-2">+{detail.newClicks}</Tag>
                        </div>
                      </div>
                      <div className="text-right text-xs">
                        {detail.proxyIp && (
                          <div className="font-mono text-gray-500">IP: {detail.proxyIp}</div>
                        )}
                        {detail.newLink && (
                          <Tooltip title={detail.newLink}>
                            <div className="text-blue-500 truncate max-w-32">新链接: {detail.newLink}</div>
                          </Tooltip>
                        )}
                        {detail.googleAdsUpdated !== undefined && (
                          <Tag color={detail.googleAdsUpdated ? 'success' : 'warning'} className="mt-1">
                            {detail.googleAdsUpdated ? 'Google Ads已更新' : 'Google Ads更新失败'}
                          </Tag>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 失败的广告系列 */}
            {selectedLog.failedDetails && selectedLog.failedDetails.length > 0 && (
              <Card 
                title={<span className="text-red-600"><CloseCircleOutlined className="mr-2" />执行失败 ({selectedLog.failedDetails.length})</span>} 
                size="small" 
                className="mb-4"
              >
                <div className="max-h-48 overflow-auto">
                  {selectedLog.failedDetails.map((detail, index) => (
                    <div key={index} className="flex items-center justify-between py-2 border-b last:border-b-0">
                      <div>
                        <span className="font-medium">{detail.campaignName}</span>
                      </div>
                      <div className="text-right">
                        <Text type="danger" className="text-xs">{detail.error || '未知错误'}</Text>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* 跳过的广告系列 */}
            {selectedLog.skippedDetails && selectedLog.skippedDetails.length > 0 && (
              <Card 
                title={<span className="text-gray-500"><MinusCircleOutlined className="mr-2" />跳过（无新点击）({selectedLog.skippedDetails.length})</span>} 
                size="small"
              >
                <div className="max-h-32 overflow-auto">
                  <div className="flex flex-wrap gap-2">
                    {selectedLog.skippedDetails.map((detail, index) => (
                      <Tooltip key={index} title={detail.reason || '无新增点击'}>
                        <Tag color="default">
                          <div className="font-medium leading-tight">{detail.campaignName}</div>
                          <div className="text-xs text-gray-500 mt-0.5 leading-tight">
                            上次点击: {formatClicks(detail.lastClicks)} ｜ 今日点击: {formatClicks(detail.todayClicks)}
                          </div>
                        </Tag>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </div>
        ) : selectedLog ? (
          // 单条日志详情（兼容旧数据）
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="广告系列" span={2}>
              <span className="font-medium">{selectedLog.campaignName}</span>
              <Tag color="blue" className="ml-2">{selectedLog.countryCode}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="触发时间" span={2}>
              {dayjs(selectedLog.triggeredAt).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="上次点击">
              {selectedLog.lastClicks}
            </Descriptions.Item>
            <Descriptions.Item label="今日点击">
              {selectedLog.todayClicks}
            </Descriptions.Item>
            <Descriptions.Item label="新增点击" span={2}>
              <Tag color="green" className="text-base">+{selectedLog.newClicks}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="代理IP">
              {selectedLog.proxyIp ? (
                <span className="font-mono">{selectedLog.proxyIp}</span>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="代理端口">
              {selectedLog.proxyPort || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="代理供应商" span={2}>
              {selectedLog.providerName || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="跳转次数">
              {selectedLog.redirectCount !== null && selectedLog.redirectCount !== undefined 
                ? selectedLog.redirectCount : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="执行耗时">
              {selectedLog.executionTime ? (
                <span className={
                  selectedLog.executionTime > 3000 ? 'text-red-500' : 
                  selectedLog.executionTime > 1500 ? 'text-orange-500' : 'text-green-500'
                }>
                  {selectedLog.executionTime}ms
                </span>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="状态" span={2}>
              <Tag
                icon={statusMap[selectedLog.status].icon}
                color={statusMap[selectedLog.status].color}
              >
                {statusMap[selectedLog.status].text}
              </Tag>
            </Descriptions.Item>
            {selectedLog.affiliateLink && (
              <Descriptions.Item label="联盟链接" span={2}>
                <Paragraph 
                  copyable 
                  className="mb-0"
                  ellipsis={{ rows: 2, expandable: true }}
                >
                  <a href={selectedLog.affiliateLink} target="_blank" rel="noopener noreferrer">
                    {selectedLog.affiliateLink}
                  </a>
                </Paragraph>
              </Descriptions.Item>
            )}
            {selectedLog.finalUrl && (
              <Descriptions.Item label="最终URL" span={2}>
                <Paragraph 
                  copyable 
                  className="mb-0"
                  ellipsis={{ rows: 2, expandable: true }}
                >
                  <a href={selectedLog.finalUrl} target="_blank" rel="noopener noreferrer">
                    {selectedLog.finalUrl}
                  </a>
                </Paragraph>
              </Descriptions.Item>
            )}
            {selectedLog.errorMessage && (
              <Descriptions.Item label="错误信息" span={2}>
                <Text type="danger">{selectedLog.errorMessage}</Text>
              </Descriptions.Item>
            )}
          </Descriptions>
        ) : null}
      </Modal>
    </div>
  )
}
