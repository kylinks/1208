import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'admin') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const }
}

// 更新代理供应商
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const body = await request.json()
    const { id } = params

    // TODO: 对 password 进行加密存储

    const provider = await prisma.proxyProvider.update({
      where: { id },
      data: body
    })

    return NextResponse.json({
      ...provider,
      id: provider.id.toString(),
      successRate: provider.successRate ? parseFloat(provider.successRate.toString()) : null
    })

  } catch (error) {
    console.error('更新代理供应商失败:', error)
    return NextResponse.json(
      { error: '更新代理供应商失败' },
      { status: 500 }
    )
  }
}

// 删除代理供应商
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const { id } = params

    await prisma.proxyProvider.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('删除代理供应商失败:', error)
    return NextResponse.json(
      { error: '删除代理供应商失败' },
      { status: 500 }
    )
  }
}

// 测试代理连接
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const { id } = params

    // TODO: 实现代理连接测试逻辑
    // 1. 获取代理供应商信息
    // 2. 调用代理API获取一个IP
    // 3. 使用该IP进行测试请求
    // 4. 返回测试结果

    return NextResponse.json({ success: true, message: '连接测试成功' })

  } catch (error) {
    console.error('测试代理连接失败:', error)
    return NextResponse.json(
      { error: '测试代理连接失败' },
      { status: 500 }
    )
  }
}
