import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireEmployee() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'employee') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const, session }
}

// 更新联盟链接配置
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const body = await request.json()
    const { id } = params

    const existing = await prisma.affiliateConfig.findFirst({
      where: {
        id,
        deletedAt: null,
        campaign: { userId: auth.session.user.id },
      },
      select: { id: true },
    })
    if (!existing) return jsonError('联盟配置不存在或无权限', 404)

    const config = await prisma.affiliateConfig.update({
      where: { id },
      data: body
    })

    return NextResponse.json({
      success: true,
      data: {
        ...config,
        id: config.id.toString(),
        campaignId: config.campaignId.toString(),
      },
    })

  } catch (error) {
    console.error('更新联盟配置失败:', error)
    return NextResponse.json(
      { error: '更新联盟配置失败' },
      { status: 500 }
    )
  }
}

// 删除联盟链接配置(软删除)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const { id } = params

    const existing = await prisma.affiliateConfig.findFirst({
      where: {
        id,
        deletedAt: null,
        campaign: { userId: auth.session.user.id },
      },
      select: { id: true },
    })
    if (!existing) return jsonError('联盟配置不存在或无权限', 404)

    await prisma.affiliateConfig.update({
      where: { id },
      data: { deletedAt: new Date() }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('删除联盟配置失败:', error)
    return NextResponse.json(
      { error: '删除联盟配置失败' },
      { status: 500 }
    )
  }
}
