import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

// 获取MCC账号列表
export async function GET(request: NextRequest) {
  try {
    // TODO: 添加身份验证和多租户过滤
    
    const mccAccounts = await prisma.mccAccount.findMany({
      where: { deletedAt: null },
      include: {
        user: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const result = mccAccounts.map(account => ({
      ...account,
      id: account.id.toString(),
      userId: account.userId.toString()
    }))

    return NextResponse.json(result)

  } catch (error) {
    console.error('获取MCC账号失败:', error)
    return NextResponse.json(
      { error: '获取MCC账号失败' },
      { status: 500 }
    )
  }
}

// 创建MCC账号
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const { userId, mccId, name } = body

    if (!userId || !mccId) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      )
    }

    const mccAccount = await prisma.mccAccount.create({
      data: {
        userId,
        mccId,
        name: name || mccId, // 如果没有提供name，使用mccId作为name
        authStatus: 'pending'
      }
    })

    return NextResponse.json({
      ...mccAccount,
      id: mccAccount.id.toString(),
      userId: mccAccount.userId.toString()
    }, { status: 201 })

  } catch (error) {
    console.error('创建MCC账号失败:', error)
    return NextResponse.json(
      { error: '创建MCC账号失败' },
      { status: 500 }
    )
  }
}
