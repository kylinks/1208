import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status })
}

async function requireEmployee() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: false as const, res: jsonError('未授权访问', 401) }
  if (session.user.role !== 'employee') return { ok: false as const, res: jsonError('无权限', 403) }
  return { ok: true as const, session }
}

// 获取联盟链接配置列表
export async function GET(request: NextRequest) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const configs = await prisma.affiliateConfig.findMany({
      where: {
        deletedAt: null,
        campaign: {
          userId: auth.session.user.id,
        },
      },
      include: {
        campaign: {
          select: {
            name: true,
            countryCode: true
          }
        }
      },
      orderBy: [
        { priority: 'asc' },
        { createdAt: 'desc' }
      ]
    })

    // 转换 BigInt 为 string
    const result = configs.map(config => ({
      ...config,
      id: config.id.toString(),
      campaignId: config.campaignId.toString(),
      campaignName: config.campaign.name
    }))

    return NextResponse.json({ success: true, data: result })

  } catch (error) {
    console.error('获取联盟配置失败:', error)
    return NextResponse.json(
      { error: '获取联盟配置失败' },
      { status: 500 }
    )
  }
}

// 创建联盟链接配置
export async function POST(request: NextRequest) {
  try {
    const auth = await requireEmployee()
    if (!auth.ok) return auth.res

    const body = await request.json()
    
    const {
      campaignId,
      affiliateLink,
      targetDomain,
      countryCode,
      maxRedirects = 10,
      priority = 0,
      enabled = true
    } = body

    // 验证必填字段
    if (!campaignId || !affiliateLink || !targetDomain || !countryCode) {
      return NextResponse.json(
        { error: '缺少必填字段' },
        { status: 400 }
      )
    }

    // 校验 campaign 归属
    const campaign = await prisma.campaign.findFirst({
      where: {
        id: campaignId,
        userId: auth.session.user.id,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!campaign) return jsonError('广告系列不存在或无权限', 404)

    const config = await prisma.affiliateConfig.create({
      data: {
        campaignId,
        affiliateLink,
        targetDomain,
        countryCode,
        maxRedirects,
        priority,
        enabled
      }
    })

    return NextResponse.json(
      {
        success: true,
        data: {
          ...config,
          id: config.id.toString(),
          campaignId: config.campaignId.toString(),
        },
      },
      { status: 201 }
    )

  } catch (error) {
    console.error('创建联盟配置失败:', error)
    return NextResponse.json(
      { error: '创建联盟配置失败' },
      { status: 500 }
    )
  }
}
