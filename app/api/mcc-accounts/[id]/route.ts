import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

// 更新MCC账号
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { id } = params

    const mccAccount = await prisma.mccAccount.update({
      where: { id },
      data: body
    })

    return NextResponse.json({
      ...mccAccount,
      id: mccAccount.id.toString(),
      userId: mccAccount.userId.toString()
    })

  } catch (error) {
    console.error('更新MCC账号失败:', error)
    return NextResponse.json(
      { error: '更新MCC账号失败' },
      { status: 500 }
    )
  }
}

// 删除MCC账号(软删除)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    await prisma.mccAccount.update({
      where: { id },
      data: { deletedAt: new Date() }
    })

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('删除MCC账号失败:', error)
    return NextResponse.json(
      { error: '删除MCC账号失败' },
      { status: 500 }
    )
  }
}
