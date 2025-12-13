import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'admin') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const }
}

// 获取代理供应商列表
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const providers = await prisma.proxyProvider.findMany({
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    })

    const result = providers.map(provider => ({
      ...provider,
      id: provider.id.toString(),
      successRate: provider.successRate ? parseFloat(provider.successRate.toString()) : null
    }))

    // 保持返回结构与现有前端兼容（直接返回数组）
    return NextResponse.json(result)

  } catch (error) {
    console.error('获取代理供应商失败:', error)
    return NextResponse.json(
      { error: '获取代理供应商失败' },
      { status: 500 }
    )
  }
}

// 创建代理供应商
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const body = await request.json()
    console.log('收到创建代理供应商请求，数据：', JSON.stringify(body, null, 2))
    
    const {
      name,
      proxyHost,
      proxyPort = 8080,
      username,
      password,
      priority = 0,
      enabled = true,
    } = body

    console.log('解析后的字段：', {
      name,
      proxyHost,
      proxyPort,
      username,
      hasPassword: !!password,
      priority,
      enabled,
    })

    if (!name || !proxyHost || !username || !password) {
      const missingFields = []
      if (!name) missingFields.push('name')
      if (!proxyHost) missingFields.push('proxyHost')
      if (!username) missingFields.push('username')
      if (!password) missingFields.push('password')
      
      console.error('缺少必填字段:', missingFields)
      return NextResponse.json(
        { error: '缺少必填字段', details: `缺少: ${missingFields.join(', ')}` },
        { status: 400 }
      )
    }

    // TODO: 对 password 进行加密存储

    const createData = {
      name,
      proxyHost,
      proxyPort: Number(proxyPort),
      username,
      password,
      priority: Number(priority),
      enabled: Boolean(enabled),
    }
    
    console.log('准备创建数据：', createData)

    const provider = await prisma.proxyProvider.create({
      data: createData as any
    })

    return NextResponse.json(
      {
        ...provider,
        id: provider.id.toString(),
        successRate: provider.successRate ? parseFloat(provider.successRate.toString()) : null,
      },
      { status: 201 }
    )

  } catch (error: any) {
    console.error('创建代理供应商失败:', error)
    return NextResponse.json(
      { 
        error: '创建代理供应商失败',
        details: error.message || '未知错误'
      },
      { status: 500 }
    )
  }
}
