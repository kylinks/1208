import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const { searchParams } = new URL(request.url)
    const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1)
    const pageSizeRaw = parseInt(searchParams.get('pageSize') || '20', 10) || 20
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 100)
    const q = (searchParams.get('q') || '').trim()
    const tenantId = (searchParams.get('tenantId') || '').trim()

    const where: any = {}
    if (tenantId) where.tenantId = tenantId
    if (q) {
      where.OR = [
        { email: { contains: q } },
        { name: { contains: q } },
      ]
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          tenantId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      data: users,
      page,
      pageSize,
      total,
    })
  } catch (error) {
    console.error('获取用户列表失败:', error)
    return NextResponse.json({ success: false, error: '获取用户列表失败' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const body = await request.json().catch(() => null)
    if (!body) return jsonError('请求体无效', 400)

    const email = String(body.email || '').trim()
    const password = String(body.password || '')
    const name = String(body.name || '').trim()
    const role = String(body.role || 'employee').trim()
    const tenantId = String(auth.session.user.tenantId || '').trim() || `tenant-${randomUUID()}`

    if (!email) return jsonError('缺少 email', 400)
    if (!password) return jsonError('缺少 password', 400)
    if (!name) return jsonError('缺少 name', 400)
    if (!ALLOWED_ROLES.has(role)) return jsonError('role 无效', 400)

    const hashedPassword = await bcrypt.hash(password, 10)

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: role as any,
        tenantId,
      },
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
    // Prisma unique constraint error
    if (error?.code === 'P2002') {
      return jsonError('该邮箱已存在', 400)
    }
    console.error('创建用户失败:', error)
    return NextResponse.json({ success: false, error: '创建用户失败' }, { status: 500 })
  }
}

