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
  return { ok: true as const, session }
}

// 获取系统配置
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category')

    const where: any = {}
    if (category) {
      where.category = category
    }

    const configs = await prisma.systemConfig.findMany({
      where,
      orderBy: { key: 'asc' }
    })

    // 将配置转换为键值对对象
    const configMap: { [key: string]: any } = {}
    configs.forEach(config => {
      try {
        // 尝试解析JSON值
        configMap[config.key] = JSON.parse(config.value)
      } catch {
        // 如果不是JSON,直接使用字符串值
        configMap[config.key] = config.value
      }
    })

    return NextResponse.json(configMap)

  } catch (error) {
    console.error('获取系统配置失败:', error)
    return NextResponse.json(
      { error: '获取系统配置失败' },
      { status: 500 }
    )
  }
}

// 更新系统配置
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin()
    if (!auth.ok) return auth.res

    const body = await request.json()
    const { configs } = body // configs 是一个键值对对象

    if (!configs || typeof configs !== 'object') {
      return NextResponse.json(
        { success: false, error: '无效的配置数据' },
        { status: 400 }
      )
    }

    // 批量更新配置
    const updates = Object.entries(configs).map(([key, value]) => {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
      
      return prisma.systemConfig.upsert({
        where: { key },
        create: {
          key,
          value: stringValue,
          category: 'general'
        },
        update: {
          value: stringValue,
          updatedAt: new Date()
        }
      })
    })

    await Promise.all(updates)

    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('更新系统配置失败:', error)
    return NextResponse.json(
      { error: '更新系统配置失败' },
      { status: 500 }
    )
  }
}
