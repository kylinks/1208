'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'

type UserRole = 'employee' | 'admin'

interface UserItem {
  id: string
  email: string
  name: string
  role: UserRole
  tenantId: string
  createdAt: string
  updatedAt: string
}

function roleTag(role: UserRole) {
  return role === 'admin' ? <Tag color="gold">管理员</Tag> : <Tag color="blue">员工</Tag>
}

function formatTime(timeStr?: string) {
  if (!timeStr) return '-'
  const d = new Date(timeStr)
  if (Number.isNaN(d.getTime())) return timeStr
  return d.toLocaleString('zh-CN')
}

export default function UsersPage() {
  const router = useRouter()
  const { data: session, status } = useSession()

  const isAdmin = session?.user?.role === 'admin'

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<UserItem[]>([])
  const [q, setQ] = useState('')
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })

  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'reset'>('create')
  const [currentUser, setCurrentUser] = useState<UserItem | null>(null)
  const [form] = Form.useForm()

  const canRender = status !== 'loading' && !!session

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=' + encodeURIComponent('/console/users'))
    }
  }, [status, router])

  useEffect(() => {
    if (!canRender) return
    if (!isAdmin) {
      message.error('无权限访问用户管理')
      router.push('/console')
    }
  }, [canRender, isAdmin, router])

  const fetchUsers = useCallback(
    async (page = pagination.current, pageSize = pagination.pageSize) => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        })
        const qTrim = q.trim()
        if (qTrim) params.set('q', qTrim)

        const resp = await fetch('/api/users?' + params.toString())
        const json = await resp.json()
        if (!resp.ok || !json?.success) {
          throw new Error(json?.error || '获取用户列表失败')
        }
        setData(json.data || [])
        setPagination({ current: json.page || page, pageSize: json.pageSize || pageSize, total: json.total || 0 })
      } catch (e: any) {
        message.error(e?.message || '获取用户列表失败')
      } finally {
        setLoading(false)
      }
    },
    [pagination.current, pagination.pageSize, q]
  )

  useEffect(() => {
    if (canRender && isAdmin) {
      fetchUsers(1, pagination.pageSize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRender, isAdmin])

  const columns: ColumnsType<UserItem> = useMemo(
    () => [
      {
        title: '姓名',
        dataIndex: 'name',
        key: 'name',
        width: 160,
        ellipsis: true,
      },
      {
        title: '邮箱',
        dataIndex: 'email',
        key: 'email',
        width: 220,
        ellipsis: true,
      },
      {
        title: '角色',
        dataIndex: 'role',
        key: 'role',
        width: 110,
        render: (role: UserRole) => roleTag(role),
      },
      {
        title: '租户',
        dataIndex: 'tenantId',
        key: 'tenantId',
        width: 180,
        ellipsis: true,
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        key: 'createdAt',
        width: 180,
        render: (t: string) => <span className="text-gray-600 text-sm">{formatTime(t)}</span>,
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        width: 180,
        render: (t: string) => <span className="text-gray-600 text-sm">{formatTime(t)}</span>,
      },
      {
        title: '操作',
        key: 'actions',
        width: 260,
        fixed: 'right',
        render: (_: any, record: UserItem) => (
          <Space>
            <Button
              size="small"
              onClick={() => {
                setCurrentUser(record)
                setModalMode('edit')
                setModalOpen(true)
                form.setFieldsValue({
                  name: record.name,
                  email: record.email,
                  role: record.role,
                  password: '',
                })
              }}
            >
              编辑
            </Button>
            <Button
              size="small"
              onClick={() => {
                setCurrentUser(record)
                setModalMode('reset')
                setModalOpen(true)
                form.setFieldsValue({ password: '' })
              }}
            >
              重置密码
            </Button>
            <Popconfirm
              title="确认删除该用户？"
              okText="删除"
              cancelText="取消"
              onConfirm={async () => {
                try {
                  const resp = await fetch('/api/users/' + record.id, { method: 'DELETE' })
                  const json = await resp.json().catch(() => ({}))
                  if (!resp.ok || !json?.success) throw new Error(json?.error || '删除失败')
                  message.success('已删除')
                  fetchUsers()
                } catch (e: any) {
                  message.error(e?.message || '删除失败')
                }
              }}
            >
              <Button size="small" danger>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [fetchUsers, form]
  )

  const openCreate = () => {
    setCurrentUser(null)
    setModalMode('create')
    setModalOpen(true)
    form.resetFields()
    form.setFieldsValue({
      role: 'employee',
    })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()

      if (modalMode === 'create') {
        const resp = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        })
        const json = await resp.json()
        if (!resp.ok || !json?.success) throw new Error(json?.error || '创建失败')
        message.success('创建成功')
        setModalOpen(false)
        fetchUsers(1, pagination.pageSize)
        return
      }

      if (modalMode === 'edit') {
        if (!currentUser) throw new Error('缺少用户信息')
        const payload: any = {
          name: values.name,
          email: values.email,
          role: values.role,
        }
        if (values.password) payload.password = values.password

        const resp = await fetch('/api/users/' + currentUser.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const json = await resp.json()
        if (!resp.ok || !json?.success) throw new Error(json?.error || '更新失败')
        message.success('更新成功')
        setModalOpen(false)
        fetchUsers()
        return
      }

      if (modalMode === 'reset') {
        if (!currentUser) throw new Error('缺少用户信息')
        const resp = await fetch('/api/users/' + currentUser.id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: values.password }),
        })
        const json = await resp.json()
        if (!resp.ok || !json?.success) throw new Error(json?.error || '重置失败')
        message.success('密码已重置')
        setModalOpen(false)
        return
      }
    } catch (e: any) {
      if (e?.errorFields) return // antd 表单校验错误
      message.error(e?.message || '操作失败')
    }
  }

  const modalTitle =
    modalMode === 'create' ? '新增用户' : modalMode === 'edit' ? '编辑用户' : '重置密码'

  if (status === 'loading') return null
  if (!session) return null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold m-0">用户管理</h2>
        <p className="text-gray-600 mt-2">仅管理员可对员工账号进行增删改查与角色设置</p>
      </div>

      <Card
        title="用户列表"
        extra={
          <Space>
            <Input.Search
              allowClear
              placeholder="搜索姓名/邮箱"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onSearch={() => fetchUsers(1, pagination.pageSize)}
              style={{ width: 260 }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => fetchUsers(1, pagination.pageSize)} disabled={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增用户
            </Button>
          </Space>
        }
      >
        <Table<UserItem>
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50', '100'],
            onChange: (page, pageSize) => fetchUsers(page, pageSize),
          }}
          scroll={{ x: 1200 }}
        />
      </Card>

      <Modal
        open={modalOpen}
        title={modalTitle}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        {modalMode !== 'reset' ? (
          <Form form={form} layout="vertical" preserve={false}>
            <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
              <Input placeholder="例如：张三" />
            </Form.Item>
            <Form.Item
              name="email"
              label="邮箱"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效邮箱' },
              ]}
            >
              <Input placeholder="user@example.com" />
            </Form.Item>
            <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
              <Select
                options={[
                  { value: 'employee', label: '员工' },
                  { value: 'admin', label: '管理员' },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="password"
              label={modalMode === 'create' ? '初始密码' : '新密码（不填则不修改）'}
              rules={modalMode === 'create' ? [{ required: true, message: '请输入密码' }] : []}
            >
              <Input.Password placeholder={modalMode === 'create' ? '请输入初始密码' : '留空表示不修改'} />
            </Form.Item>
          </Form>
        ) : (
          <Form form={form} layout="vertical" preserve={false}>
            <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }]}>
              <Input.Password placeholder="请输入新密码" />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  )
}

