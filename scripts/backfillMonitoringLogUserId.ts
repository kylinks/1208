import prisma from '../lib/prisma'

type DetailLike = {
  campaignId?: string
  campaignName?: string
}

function extractFirstCampaignHint(details: unknown): { campaignId?: string; campaignName?: string } | null {
  if (!Array.isArray(details)) return null
  for (const item of details as unknown[]) {
    if (item && typeof item === 'object') {
      const d = item as DetailLike
      if (typeof d.campaignId === 'string' && d.campaignId.trim()) {
        return { campaignId: d.campaignId, campaignName: typeof d.campaignName === 'string' ? d.campaignName : undefined }
      }
    }
  }
  return null
}

async function resolveUserIdFromCampaignHint(hint: { campaignId: string; campaignName?: string }) {
  // 1) 先按内部 Campaign.id 尝试（单条日志通常是 uuid）
  const byInternalId = await prisma.campaign.findUnique({
    where: { id: hint.campaignId },
    select: { userId: true },
  })
  if (byInternalId?.userId) return byInternalId.userId

  // 2) 再按 Google Ads campaignId 字段尝试（批次日志 details 里通常是这个）
  const byGoogleCampaignId = await prisma.campaign.findFirst({
    where: {
      campaignId: hint.campaignId,
      ...(hint.campaignName ? { name: hint.campaignName } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: { userId: true },
  })
  return byGoogleCampaignId?.userId || null
}

async function main() {
  const BATCH_SIZE = 200
  let updated = 0
  let skipped = 0

  // 循环直到没有待回填的数据
  while (true) {
    const logs = await prisma.monitoringLog.findMany({
      where: { userId: null },
      select: {
        id: true,
        userId: true,
        isBatchLog: true,
        campaignId: true,
        details: true,
        triggeredAt: true,
      },
      orderBy: { triggeredAt: 'desc' },
      take: BATCH_SIZE,
    })

    if (logs.length === 0) break

    for (const log of logs) {
      let userId: string | null = null

      // 单条日志：优先用 log.campaignId
      if (typeof log.campaignId === 'string' && log.campaignId) {
        userId = await resolveUserIdFromCampaignHint({ campaignId: log.campaignId })
      }

      // 批次日志：尝试从 details 里取一个 campaignId（通常是 Google campaignId）
      if (!userId && log.isBatchLog) {
        const hint = extractFirstCampaignHint(log.details as unknown)
        if (hint?.campaignId) {
          userId = await resolveUserIdFromCampaignHint({ campaignId: hint.campaignId, campaignName: hint.campaignName })
        }
      }

      if (!userId) {
        skipped++
        continue
      }

      await prisma.monitoringLog.update({
        where: { id: log.id },
        data: { userId },
      })
      updated++
    }
  }

  console.log(`[backfillMonitoringLogUserId] done. updated=${updated}, skipped=${skipped}`)
}

main()
  .catch((e) => {
    console.error('[backfillMonitoringLogUserId] failed:', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

