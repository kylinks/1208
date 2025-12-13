'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, InputNumber, Switch, Table, Tag, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ReloadOutlined, LinkOutlined, PlayCircleOutlined } from '@ant-design/icons'

type ClickManagement = {
  enabled: boolean
  orderCount: number
  conversionRate: number // 0~1
  pendingClicks: number
  updatedAt: string
  createdAt: string
}

type ClickManagementItem = {
  id: string // Campaign.id
  campaignId: string // Google campaignId
  campaignName: string
  countryCode: string
  campaignEnabled: boolean
  domain: string | null
  referrer: string | null
  affiliateLink: string | null
  clickManagement: ClickManagement | null
}

// 用于表格显示的扩展类型（包含行内编辑状态）
type TableRow = ClickManagementItem & {
  index: number
  // 编辑状态
  editEnabled: boolean
  editOrderCount: number
  editConversionRate: number // 百分比形式 (0~100)
  editPendingClicks: number
}

/**
 * 计算待刷点击：订单数/转化率，取整后随机增减1-10，不能为负数
 */
function calculatePendingClicks(orderCount: number, conversionRatePercent: number): number {
  if (orderCount <= 0 || conversionRatePercent <= 0) return 0
  const conversionRate = conversionRatePercent / 100
  const base = Math.floor(orderCount / conversionRate)
  // 随机增减1-10
  const randomOffset = Math.floor(Math.random() * 10) + 1
  const addOrSubtract = Math.random() > 0.5 ? 1 : -1
  const result = base + addOrSubtract * randomOffset
  // 不能为负数
  return Math.max(0, result)
}

export default function ClicksManagementPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ClickManagementItem[]>([])
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set())
  const [clicking, setClicking] = useState(false) // 刷点击状态
  // 存储每行的编辑值
  const [editValues, setEditValues] = useState<Record<string, {
    enabled: boolean
    orderCount: number
    conversionRatePercent: number
    pendingClicks: number
  }>>({})

  const fetchList = useCallback(async () => {
    try {
      setLoading(true)
      const resp = await fetch('/api/click-management')
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) {
        throw new Error(json?.error || '获取点击管理数据失败')
      }
      const items = json.data || []
      setData(items)
      // 初始化编辑值
      const initialEditValues: Record<string, any> = {}
      items.forEach((item: ClickManagementItem) => {
        const cm = item.clickManagement
        initialEditValues[item.id] = {
          enabled: cm?.enabled ?? false,
          orderCount: cm?.orderCount ?? 0,
          conversionRatePercent: cm ? Math.round((cm.conversionRate || 0.1) * 10000) / 100 : 10, // 默认 10%
          pendingClicks: cm?.pendingClicks ?? 0,
        }
      })
      setEditValues(initialEditValues)
    } catch (e: any) {
      message.error(e?.message || '获取点击管理数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  // 开始刷点击
  const startClicking = useCallback(async () => {
    try {
      setClicking(true)
      message.loading({ content: '正在执行刷点击...', key: 'clicking', duration: 0 })
      
      const resp = await fetch('/api/click-management/start-clicking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const json = await resp.json().catch(() => null)
      
      if (!resp.ok || !json?.success) {
        throw new Error(json?.error || '刷点击失败')
      }
      
      const { totalClicked, successCount, failCount, hoursRemaining } = json.data
      message.destroy('clicking')
      message.success(`刷点击完成！成功 ${successCount} 个广告系列，共点击 ${totalClicked} 次，距离今天结束还有 ${hoursRemaining} 小时`)
      
      // 刷新列表以显示更新后的待刷点击数
      fetchList()
    } catch (e: any) {
      message.destroy('clicking')
      message.error(e?.message || '刷点击失败')
    } finally {
      setClicking(false)
    }
  }, [fetchList])

  // 保存单行数据
  const saveRow = async (id: string) => {
    const values = editValues[id]
    if (!values) return

    setSavingRows(prev => new Set(prev).add(id))
    try {
      const resp = await fetch(`/api/click-management/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: values.enabled,
          orderCount: values.orderCount,
          conversionRate: values.conversionRatePercent / 100,
          pendingClicks: values.pendingClicks,
        }),
      })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) {
        throw new Error(json?.error || '保存失败')
      }
      message.success('保存成功')
      // 更新本地数据
      setData(prev => prev.map(item => {
        if (item.id === id) {
          return {
            ...item,
            clickManagement: {
              enabled: json.data.enabled,
              orderCount: json.data.orderCount,
              conversionRate: json.data.conversionRate,
              pendingClicks: json.data.pendingClicks,
              updatedAt: json.data.updatedAt,
              createdAt: item.clickManagement?.createdAt || new Date().toISOString(),
            }
          }
        }
        return item
      }))
      // 同步编辑值
      setEditValues(prev => ({
        ...prev,
        [id]: {
          enabled: json.data.enabled,
          orderCount: json.data.orderCount,
          conversionRatePercent: Math.round(json.data.conversionRate * 10000) / 100,
          pendingClicks: json.data.pendingClicks,
        }
      }))
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    } finally {
      setSavingRows(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // 切换启用状态
  const handleToggleEnabled = async (id: string, checked: boolean) => {
    setEditValues(prev => ({
      ...prev,
      [id]: { ...prev[id], enabled: checked }
    }))
    // 自动保存启用状态
    const values = editValues[id]
    if (!values) return
    
    setSavingRows(prev => new Set(prev).add(id))
    try {
      const resp = await fetch(`/api/click-management/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: checked,
          orderCount: values.orderCount,
          conversionRate: values.conversionRatePercent / 100,
          pendingClicks: values.pendingClicks,
        }),
      })
      const json = await resp.json().catch(() => null)
      if (!resp.ok || !json?.success) {
        throw new Error(json?.error || '保存失败')
      }
      // 更新本地数据
      setData(prev => prev.map(item => {
        if (item.id === id) {
          return {
            ...item,
            clickManagement: {
              enabled: json.data.enabled,
              orderCount: json.data.orderCount,
              conversionRate: json.data.conversionRate,
              pendingClicks: json.data.pendingClicks,
              updatedAt: json.data.updatedAt,
              createdAt: item.clickManagement?.createdAt || new Date().toISOString(),
            }
          }
        }
        return item
      }))
      setEditValues(prev => ({
        ...prev,
        [id]: {
          ...prev[id],
          enabled: json.data.enabled,
          pendingClicks: json.data.pendingClicks,
        }
      }))
    } catch (e: any) {
      message.error(e?.message || '保存失败')
      // 恢复原值
      setEditValues(prev => ({
        ...prev,
        [id]: { ...prev[id], enabled: !checked }
      }))
    } finally {
      setSavingRows(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // 更新编辑值
  const updateEditValue = (id: string, field: string, value: any) => {
    setEditValues(prev => {
      const current = prev[id] || { enabled: false, orderCount: 0, conversionRatePercent: 10, pendingClicks: 0 }
      const updated = { ...current, [field]: value }
      
      // 如果修改了订单数或转化率，自动重新计算待刷点击
      if (field === 'orderCount' || field === 'conversionRatePercent') {
        updated.pendingClicks = calculatePendingClicks(
          field === 'orderCount' ? value : current.orderCount,
          field === 'conversionRatePercent' ? value : current.conversionRatePercent
        )
      }
      
      return { ...prev, [id]: updated }
    })
  }

  // 表格数据（含序号）
  const tableData: TableRow[] = useMemo(() => {
    return data.map((item, index) => {
      const values = editValues[item.id] || {
        enabled: item.clickManagement?.enabled ?? false,
        orderCount: item.clickManagement?.orderCount ?? 0,
        conversionRatePercent: item.clickManagement ? Math.round((item.clickManagement.conversionRate || 0.1) * 10000) / 100 : 10,
        pendingClicks: item.clickManagement?.pendingClicks ?? 0,
      }
      return {
        ...item,
        index: index + 1,
        editEnabled: values.enabled,
        editOrderCount: values.orderCount,
        editConversionRate: values.conversionRatePercent,
        editPendingClicks: values.pendingClicks,
      }
    })
  }, [data, editValues])

  const columns: ColumnsType<TableRow> = useMemo(
    () => [
      {
        title: '序号',
        dataIndex: 'index',
        key: 'index',
        width: 50,
        align: 'center',
        render: (index: number) => <span className="text-gray-500">{index}</span>,
      },
      {
        title: '广告系列',
        dataIndex: 'campaignName',
        key: 'campaignName',
        width: 180,
        ellipsis: true,
        sorter: (a, b) => {
          // 提取广告系列名称的前3位数字
          const getFirst3Digits = (name: string): number => {
            const match = name.match(/^\d{1,3}/)
            return match ? parseInt(match[0], 10) : 0
          }
          return getFirst3Digits(a.campaignName) - getFirst3Digits(b.campaignName)
        },
        sortDirections: ['descend', 'ascend'],
        render: (name: string) => (
          <Tooltip title={name}>
            <span className="font-medium">{name}</span>
          </Tooltip>
        ),
      },
      {
        title: '国家',
        dataIndex: 'countryCode',
        key: 'countryCode',
        width: 60,
        align: 'center',
        render: (code: string) => (code ? <Tag color="blue">{code}</Tag> : <Tag>-</Tag>),
      },
      {
        title: '来路',
        dataIndex: 'referrer',
        key: 'referrer',
        width: 120,
        ellipsis: true,
        render: (referrer: string | null) => (
          referrer ? (
            <Tooltip title={referrer}>
              <span className="text-xs text-gray-600">{referrer}</span>
            </Tooltip>
          ) : <span className="text-gray-400">-</span>
        ),
      },
      {
        title: '联盟链接',
        dataIndex: 'affiliateLink',
        key: 'affiliateLink',
        width: 120,
        ellipsis: true,
        render: (link: string | null) => (
          link ? (
            <Tooltip title={link}>
              <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 flex items-center gap-1">
                <LinkOutlined />
                <span className="truncate max-w-24">{link}</span>
              </a>
            </Tooltip>
          ) : <span className="text-gray-400">-</span>
        ),
      },
      {
        title: '转化率',
        key: 'conversionRate',
        width: 90,
        align: 'center',
        render: (_, record) => (
          <InputNumber
            size="small"
            min={1}
            max={100}
            step={1}
            precision={0}
            value={record.editConversionRate}
            onChange={(val) => updateEditValue(record.id, 'conversionRatePercent', val ?? 10)}
            onBlur={() => saveRow(record.id)}
            onPressEnter={() => saveRow(record.id)}
            style={{ width: 70 }}
            suffix="%"
            disabled={!record.editEnabled || savingRows.has(record.id)}
          />
        ),
      },
      {
        title: '订单数',
        key: 'orderCount',
        width: 90,
        align: 'center',
        render: (_, record) => (
          <InputNumber
            size="small"
            min={0}
            precision={0}
            value={record.editOrderCount}
            onChange={(val) => updateEditValue(record.id, 'orderCount', val ?? 0)}
            onBlur={() => saveRow(record.id)}
            onPressEnter={() => saveRow(record.id)}
            style={{ width: 70 }}
            disabled={!record.editEnabled || savingRows.has(record.id)}
          />
        ),
      },
      {
        title: '待刷点击',
        key: 'pendingClicks',
        width: 90,
        align: 'center',
        render: (_, record) => (
          <InputNumber
            size="small"
            min={0}
            precision={0}
            value={record.editPendingClicks}
            onChange={(val) => updateEditValue(record.id, 'pendingClicks', val ?? 0)}
            onBlur={() => saveRow(record.id)}
            onPressEnter={() => saveRow(record.id)}
            style={{ width: 70 }}
            className="font-mono font-semibold text-blue-600"
            disabled={!record.editEnabled || savingRows.has(record.id)}
          />
        ),
      },
      {
        title: '启用',
        key: 'enabled',
        width: 60,
        align: 'center',
        render: (_, record) => (
          <Switch
            size="small"
            checked={record.editEnabled}
            onChange={(checked) => handleToggleEnabled(record.id, checked)}
            loading={savingRows.has(record.id)}
          />
        ),
      },
    ],
    [editValues, savingRows]
  )

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold m-0">点击管理</h2>
          <p className="text-gray-600 mt-2">为每个广告系列配置刷点击参数，修改后自动保存</p>
        </div>
        <div className="flex gap-2">
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={startClicking} loading={clicking}>
            开始刷点击
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchList} loading={loading}>
            刷新
          </Button>
        </div>
      </div>

      <Card>
        <Table<TableRow>
          columns={columns}
          dataSource={tableData}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 50, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          size="small"
        />
      </Card>
    </div>
  )
}
