import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// 强制动态渲染
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

// 获取代理供应商已分配的用户列表
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const { id } = await params

    // 检查代理供应商是否存在
    const provider = await prisma.proxyProvider.findUnique({
      where: { id }
    })

    if (!provider) {
      return jsonError('代理供应商不存在', 404)
    }

    // 获取已分配的用户ID列表
    const assignments = await prisma.proxyProviderUser.findMany({
      where: { providerId: id },
      select: {
        userId: true,
        assignedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          }
        }
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        providerId: id,
        providerName: provider.name,
        assignedUserIds: assignments.map(a => a.userId),
        assignedUsers: assignments.map(a => ({
          ...a.user,
          assignedAt: a.assignedAt,
        })),
      }
    })

  } catch (error) {
    console.error('获取分配用户失败:', error)
    return jsonError('获取分配用户失败', 500)
  }
}

// 更新代理供应商的用户分配
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const { id } = await params
    const body = await request.json()
    const { userIds } = body

    if (!Array.isArray(userIds)) {
      return jsonError('userIds 必须是数组', 400)
    }

    // 检查代理供应商是否存在
    const provider = await prisma.proxyProvider.findUnique({
      where: { id }
    })

    if (!provider) {
      return jsonError('代理供应商不存在', 404)
    }

    // 验证所有用户ID是否存在
    if (userIds.length > 0) {
      const existingUsers = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true }
      })

      const existingUserIds = new Set(existingUsers.map(u => u.id))
      const invalidIds = userIds.filter(uid => !existingUserIds.has(uid))

      if (invalidIds.length > 0) {
        return jsonError(`无效的用户ID: ${invalidIds.join(', ')}`, 400)
      }
    }

    // 使用事务更新分配关系
    await prisma.$transaction(async (tx) => {
      // 1. 删除现有的所有分配
      await tx.proxyProviderUser.deleteMany({
        where: { providerId: id }
      })

      // 2. 创建新的分配
      if (userIds.length > 0) {
        await tx.proxyProviderUser.createMany({
          data: userIds.map((userId: string) => ({
            providerId: id,
            userId,
            assignedBy: auth.session.user.id,
          }))
        })
      }
    })

    // 返回更新后的分配信息
    const updatedAssignments = await prisma.proxyProviderUser.findMany({
      where: { providerId: id },
      select: {
        userId: true,
        assignedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          }
        }
      }
    })

    return NextResponse.json({
      success: true,
      message: '分配更新成功',
      data: {
        providerId: id,
        providerName: provider.name,
        assignedUserIds: updatedAssignments.map(a => a.userId),
        assignedUsers: updatedAssignments.map(a => ({
          ...a.user,
          assignedAt: a.assignedAt,
        })),
      }
    })

  } catch (error) {
    console.error('更新分配失败:', error)
    return jsonError('更新分配失败', 500)
  }
}
