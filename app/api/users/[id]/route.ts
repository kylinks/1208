import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'admin') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const, session }
}

const ALLOWED_ROLES = new Set(['employee', 'admin'])

export async function GET(_request: NextRequest, context: { params: { id: string } }) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const id = context.params.id
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!user) return jsonError('用户不存在', 404)
    return NextResponse.json({ success: true, data: user })
  } catch (error) {
    console.error('获取用户失败:', error)
    return NextResponse.json({ success: false, error: '获取用户失败' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: { params: { id: string } }) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const id = context.params.id
    const body = await request.json().catch(() => null)
    if (!body) return jsonError('请求体无效', 400)

    const data: any = {}

    if (body.email !== undefined) {
      const email = String(body.email || '').trim()
      if (!email) return jsonError('email 不能为空', 400)
      data.email = email
    }

    if (body.name !== undefined) {
      const name = String(body.name || '').trim()
      if (!name) return jsonError('name 不能为空', 400)
      data.name = name
    }

    if (body.role !== undefined) {
      const role = String(body.role || '').trim()
      if (!ALLOWED_ROLES.has(role)) return jsonError('role 无效', 400)
      data.role = role as any
    }

    if (body.tenantId !== undefined) {
      const tenantId = String(body.tenantId || '').trim()
      if (!tenantId) return jsonError('tenantId 不能为空', 400)
      data.tenantId = tenantId
    }

    if (body.password !== undefined) {
      const password = String(body.password || '')
      if (!password) return jsonError('password 不能为空', 400)
      data.password = await bcrypt.hash(password, 10)
    }

    if (Object.keys(data).length === 0) return jsonError('没有可更新的字段', 400)

    const user = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ success: true, data: user })
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return jsonError('该邮箱已存在', 400)
    }
    if (error?.code === 'P2025') {
      return jsonError('用户不存在', 404)
    }
    console.error('更新用户失败:', error)
    return NextResponse.json({ success: false, error: '更新用户失败' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: { params: { id: string } }) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const id = context.params.id
    if (id === auth.session.user.id) {
      return jsonError('不能删除当前登录账号', 400)
    }

    await prisma.user.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return jsonError('用户不存在', 404)
    }
    console.error('删除用户失败:', error)
    return NextResponse.json({ success: false, error: '删除用户失败' }, { status: 500 })
  }
}

