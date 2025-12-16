'use client'

import { Card, Table, Tag, Space, Tooltip, Button, Badge } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  SyncOutlined,
  GlobalOutlined,
  LinkOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { useEffect, useState, useCallback } from 'react'
import { useMonitor } from '../MonitorContext'
import { OverviewKpiCard } from './components/OverviewKpiCard'

interface DashboardStats {
  totalCampaigns: number
  todayReplacements: number
  successRate: number
  todayClicks: number
  clicksChange: number
}

interface CampaignMonitoringItem {
  id: string
  campaignName: string
  domain: string
  countryCode: string
  affiliateLink: string
  lastClicks: number
  todayClicks: number
  originalLink: string | null
  checkTime: string | null
  newLink: string | null
  proxyIp: string | null
  totalReplacements: number
}

// 提取名称前3个数字用于排序
const extractFirst3Digits = (name: string): number => {
  const match = name.match(/^(\d{1,3})/)
  return match ? parseInt(match[1], 10) : 0
}

// 国家代码映射
const countryMap: Record<string, { name: string; flag: string }> = {
  US: { name: '美国', flag: '🇺🇸' },
  UK: { name: '英国', flag: '🇬🇧' },
  GB: { name: '英国', flag: '🇬🇧' },
  CA: { name: '加拿大', flag: '🇨🇦' },
  AU: { name: '澳大利亚', flag: '🇦🇺' },
  DE: { name: '德国', flag: '🇩🇪' },
  FR: { name: '法国', flag: '🇫🇷' },
  JP: { name: '日本', flag: '🇯🇵' },
  CN: { name: '中国', flag: '🇨🇳' },
  HK: { name: '香港', flag: '🇭🇰' },
  TW: { name: '台湾', flag: '🇹🇼' },
  SG: { name: '新加坡', flag: '🇸🇬' },
  KR: { name: '韩国', flag: '🇰🇷' },
  IN: { name: '印度', flag: '🇮🇳' },
  BR: { name: '巴西', flag: '🇧🇷' },
  MX: { name: '墨西哥', flag: '🇲🇽' },
  ES: { name: '西班牙', flag: '🇪🇸' },
  IT: { name: '意大利', flag: '🇮🇹' },
  NL: { name: '荷兰', flag: '🇳🇱' },
  PL: { name: '波兰', flag: '🇵🇱' },
}

export default function ConsoleDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalCampaigns: 0,
    todayReplacements: 0,
    successRate: 0,
    todayClicks: 0,
    clicksChange: 0,
  })
  const [monitoringData, setMonitoringData] = useState<CampaignMonitoringItem[]>([])
  const [loading, setLoading] = useState(true)
  const [monitoringLoading, setMonitoringLoading] = useState(true)
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 50,
    total: 0,
  })
  // 使用全局监控状态
  const {
    oneClickLoading,
    lastExecutionTime,
    startMonitor,
    monitorInterval,
  } = useMonitor()

  // 获取仪表盘统计数据
  const fetchDashboardStats = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/dashboard')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (error) {
      console.error('获取仪表盘数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 获取广告系列监控数据
  const fetchMonitoringData = useCallback(async (page = 1, pageSize = 50) => {
    try {
      setMonitoringLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      })

      const response = await fetch(`/api/campaign-monitoring?${params}`)
      if (response.ok) {
        const data = await response.json()
        setMonitoringData(data.data)
        setPagination({
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
        })
      }
    } catch (error) {
      console.error('获取广告系列监控数据失败:', error)
    } finally {
      setMonitoringLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboardStats()
    fetchMonitoringData()
  }, [fetchDashboardStats, fetchMonitoringData])

  // 监听执行完成，刷新数据
  useEffect(() => {
    if (lastExecutionTime > 0) {
      fetchDashboardStats()
      fetchMonitoringData(pagination.current, pagination.pageSize)
    }
  }, [lastExecutionTime, fetchDashboardStats, fetchMonitoringData, pagination.current, pagination.pageSize])

  // 处理表格分页变化
  const handleTableChange = (paginationConfig: any) => {
    fetchMonitoringData(paginationConfig.current, paginationConfig.pageSize)
  }

  // 格式化时间
  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return '-'
    const date = new Date(timeStr)
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  // 截断链接显示
  const truncateUrl = (url: string | null, maxLen = 30) => {
    if (!url) return '-'
    if (url.length <= maxLen) return url
    return url.substring(0, maxLen) + '...'
  }

  // 广告系列监控列表列定义
  const monitoringColumns: ColumnsType<CampaignMonitoringItem> = [
    {
      title: '序号',
      key: 'index',
      width: 60,
      fixed: 'left',
      render: (_, __, index) => (pagination.current - 1) * pagination.pageSize + index + 1,
    },
    {
      title: '广告系列',
      dataIndex: 'campaignName',
      key: 'campaignName',
      width: 180,
      fixed: 'left',
      ellipsis: true,
      sorter: (a, b) => extractFirst3Digits(a.campaignName || '') - extractFirst3Digits(b.campaignName || ''),
      defaultSortOrder: 'descend',
      render: (name: string) => (
        <Tooltip title={name}>
          <span className="font-medium">{name}</span>
        </Tooltip>
      ),
    },
    {
      title: '域名',
      dataIndex: 'domain',
      key: 'domain',
      width: 150,
      ellipsis: true,
      render: (domain: string) => (
        <Tooltip title={domain}>
          <span className="text-gray-600">{domain}</span>
        </Tooltip>
      ),
    },
    {
      title: '国家',
      dataIndex: 'countryCode',
      key: 'countryCode',
      width: 100,
      render: (code: string) => {
        const country = countryMap[code]
        return country ? (
          <span>
            {country.flag} {country.name}
          </span>
        ) : (
          <span>{code}</span>
        )
      },
    },
    {
      title: '联盟链接',
      dataIndex: 'affiliateLink',
      key: 'affiliateLink',
      width: 200,
      ellipsis: true,
      render: (link: string) =>
        link && link !== '-' ? (
          <Tooltip title={link}>
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
              <LinkOutlined className="mr-1" />
              {truncateUrl(link)}
            </a>
          </Tooltip>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      title: '上次点击',
      dataIndex: 'lastClicks',
      key: 'lastClicks',
      width: 90,
      align: 'right',
      sorter: (a, b) => a.lastClicks - b.lastClicks,
      render: (clicks: number) => <span className="font-mono">{clicks.toLocaleString()}</span>,
    },
    {
      title: '今日点击',
      dataIndex: 'todayClicks',
      key: 'todayClicks',
      width: 90,
      align: 'right',
      sorter: (a, b) => a.todayClicks - b.todayClicks,
      render: (clicks: number) => (
        <span className="font-mono font-semibold text-blue-600">{clicks.toLocaleString()}</span>
      ),
    },
    {
      title: '原链接',
      dataIndex: 'originalLink',
      key: 'originalLink',
      width: 180,
      ellipsis: true,
      render: (link: string | null) =>
        link ? (
          <Tooltip title={link}>
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-500">
              {truncateUrl(link)}
            </a>
          </Tooltip>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      title: '检测时间',
      dataIndex: 'checkTime',
      key: 'checkTime',
      width: 140,
      render: (time: string | null) => (
        <span className="text-gray-600 text-sm">{formatTime(time)}</span>
      ),
    },
    {
      title: '新链接',
      dataIndex: 'newLink',
      key: 'newLink',
      width: 200,
      ellipsis: true,
      render: (link: string | null) =>
        link ? (
          <Tooltip title={link}>
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:text-green-700">
              {truncateUrl(link)}
            </a>
          </Tooltip>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      title: '代理IP',
      dataIndex: 'proxyIp',
      key: 'proxyIp',
      width: 130,
      render: (ip: string | null) =>
        ip ? (
          <Tag color="blue" className="font-mono text-xs">
            {ip}
          </Tag>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      title: '更换总数',
      dataIndex: 'totalReplacements',
      key: 'totalReplacements',
      width: 90,
      align: 'right',
      fixed: 'right',
      sorter: (a, b) => a.totalReplacements - b.totalReplacements,
      render: (count: number) => (
        <Tag color={count > 0 ? 'green' : 'default'} className="font-mono">
          {count}
        </Tag>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">仪表盘概览</h2>
        <p className="text-gray-600 mb-6">
          查看广告系列状态和链接更换情况（数据由服务器定时任务每 {monitorInterval} 分钟更新）
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <OverviewKpiCard
          title="总广告系列"
          icon={<SyncOutlined spin={loading} />}
          value={<span className="tabular-nums">{stats.totalCampaigns.toLocaleString()}</span>}
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
          title="今日点击数"
          icon={stats.clicksChange >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
          value={<span className="tabular-nums">{stats.todayClicks.toLocaleString()}</span>}
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
          title="今日换链总数"
          icon={<ThunderboltOutlined />}
          value={<span className="tabular-nums">{stats.todayReplacements.toLocaleString()}</span>}
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
          title="换链成功率"
          icon={<CheckCircleOutlined />}
          value={<span className="tabular-nums">{stats.successRate.toFixed(0)}%</span>}
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

      {/* 广告系列监控列表 */}
      <Card
        title={
          <Space>
            <GlobalOutlined />
            <span>广告系列监控列表</span>
            {oneClickLoading && <Badge status="processing" />}
          </Space>
        }
        extra={
          <Space>
            <Button
              type="primary"
              icon={oneClickLoading ? <SyncOutlined spin /> : <ThunderboltOutlined />}
              onClick={startMonitor}
              loading={oneClickLoading}
              style={{ background: '#52c41a', borderColor: '#52c41a' }}
            >
              立即执行一次
            </Button>
          </Space>
        }
      >
        <Table
          columns={monitoringColumns}
          dataSource={monitoringData}
          rowKey="id"
          loading={monitoringLoading}
          pagination={{
            ...pagination,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
          onChange={handleTableChange}
          scroll={{ x: 1800 }}
          size="middle"
        />
      </Card>

    </div>
  )
}
