/**
 * MCC 验证 API
 * POST /api/google-ads/mcc/verify
 * 验证 MCC 账户是否存在且服务账号有权限访问
 * 
 * 优化：
 * 1. 内存缓存 - 短期内重复验证同一 MCC，直接返回缓存
 * 2. 数据库缓存 - 如果已有用户添加过该 MCC，复用已有数据
 * 3. 失败缓存 - 短期内同一 MCC 连续失败（尤其 429）直接快速失败，避免打爆配额
 * 4. In-flight 去重 - 同一进程内并发验证同一 MCC 复用同一次请求
 * 5. 全局限流 - 由 GoogleAdsService 统一处理（排队限流 + 退避重试）
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAdsService } from '@/lib/googleAdsService';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// 强制动态渲染，避免构建时静态生成
export const dynamic = 'force-dynamic';

// ============== 内存缓存配置 ==============
interface MccCacheEntry {
  data: {
    mccId: string;
    mccName: string;
    totalCids: number;
    activeCids: number;
    suspendedCids: number;
    verified: boolean;
    verifiedAt: string;
  };
  expireAt: number;
}

// 内存缓存（缓存有效期 1 小时）
const mccVerifyCache = new Map<string, MccCacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时

// 失败缓存（避免短时间内重复触发 429/网络抖动）
interface MccFailCacheEntry {
  error: string;
  expireAt: number;
}
const mccVerifyFailCache = new Map<string, MccFailCacheEntry>();
const FAIL_CACHE_TTL_MS = 2 * 60 * 1000; // 2 分钟

// 数据库缓存 TTL（复用已存在的 authorized MCC 记录，但要避免太旧）
const DB_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 小时

// 同一进程内的并发去重：相同 mccId 同时验证只打一次 Google Ads API
const inFlightVerify = new Map<string, Promise<any>>();

/**
 * 清理过期缓存
 */
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of mccVerifyCache.entries()) {
    if (now > entry.expireAt) {
      mccVerifyCache.delete(key);
    }
  }

  for (const [key, entry] of mccVerifyFailCache.entries()) {
    if (now > entry.expireAt) {
      mccVerifyFailCache.delete(key);
    }
  }
}

/**
 * POST - 验证 MCC 账户
 */
export async function POST(request: NextRequest) {
  // 用于 catch 分支写入失败缓存（request.json() 只能读一次）
  let parsedMccId: string | null = null;

  try {
    // 验证用户登录
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: '未授权访问' },
        { status: 401 }
      );
    }

    // 解析请求体
    const body = await request.json();
    const { mccId, forceRefresh } = body; // 新增 forceRefresh 参数

    // 验证参数
    if (!mccId) {
      return NextResponse.json(
        { success: false, error: '缺少 mccId 参数' },
        { status: 400 }
      );
    }

    // 验证格式
    if (!/^\d{3}-\d{3}-\d{4}$/.test(mccId)) {
      return NextResponse.json(
        { success: false, error: 'MCC ID 格式无效，正确格式为：xxx-xxx-xxxx' },
        { status: 400 }
      );
    }

    parsedMccId = mccId;

    // ========== 优化 1: 检查内存缓存 ==========
    if (!forceRefresh) {
      cleanExpiredCache(); // 清理过期缓存
      const cachedResult = mccVerifyCache.get(mccId);
      if (cachedResult && Date.now() < cachedResult.expireAt) {
        console.log(`✅ MCC ${mccId} 命中内存缓存`);
        return NextResponse.json({
          success: true,
          data: cachedResult.data,
          cached: true,
          cacheSource: 'memory',
        });
      }

      const cachedFail = mccVerifyFailCache.get(mccId);
      if (cachedFail && Date.now() < cachedFail.expireAt) {
        // 失败缓存直接快速失败，减少对 Google Ads API 的冲击
        return NextResponse.json(
          {
            success: false,
            error: cachedFail.error,
            cached: true,
            cacheSource: 'memory-fail',
          },
          { status: 429 }
        );
      }
    }

    // ========== 优化 2: 检查数据库是否已有该 MCC ==========
    if (!forceRefresh) {
      const existingMcc = await prisma.mccAccount.findFirst({
        where: {
          mccId,
          deletedAt: null,
          authStatus: 'authorized', // 只使用已授权的
        },
        orderBy: {
          lastSyncAt: 'desc', // 优先使用最近同步的
        },
        select: {
          mccId: true,
          name: true,
          totalCids: true,
          activeCids: true,
          suspendedCids: true,
          lastSyncAt: true,
        },
      });

      // 只复用“足够新”的记录，避免把很久以前的数据当成最新验证结果
      const lastSyncAtMs = existingMcc?.lastSyncAt ? existingMcc.lastSyncAt.getTime() : 0;
      const isFreshEnough = !!existingMcc && lastSyncAtMs > 0 && (Date.now() - lastSyncAtMs) <= DB_CACHE_MAX_AGE_MS;

      if (existingMcc && isFreshEnough) {
        console.log(`✅ MCC ${mccId} 命中数据库缓存`);
        const cachedData = {
          mccId: existingMcc.mccId,
          mccName: existingMcc.name,
          totalCids: existingMcc.totalCids,
          activeCids: existingMcc.activeCids,
          suspendedCids: existingMcc.suspendedCids,
          verified: true,
          verifiedAt: existingMcc.lastSyncAt?.toISOString() || new Date().toISOString(),
        };

        // 同时存入内存缓存
        mccVerifyCache.set(mccId, {
          data: cachedData,
          expireAt: Date.now() + CACHE_TTL_MS,
        });

        return NextResponse.json({
          success: true,
          data: cachedData,
          cached: true,
          cacheSource: 'database',
        });
      }
    }

    // ========== 调用 Google Ads API 验证 ==========
    // 同一进程内并发去重：相同 mccId 同时验证只发起一次真实请求
    const existingInFlight = inFlightVerify.get(mccId);
    if (existingInFlight) {
      const result = await existingInFlight;
      return NextResponse.json({
        success: true,
        data: result,
        cached: false,
        deduped: true,
      });
    }

    const inFlightPromise = (async () => {
      console.log(`🔄 MCC ${mccId} 缓存未命中，准备调用 Google Ads API...`);

      const googleAdsService = getGoogleAdsService();
      return await googleAdsService.verifyMccAccount(mccId);
    })();

    inFlightVerify.set(mccId, inFlightPromise);
    inFlightPromise.finally(() => {
      // 清理 in-flight 记录
      inFlightVerify.delete(mccId);
    });

    const result = await inFlightPromise;

    // 存入内存缓存
    mccVerifyCache.set(mccId, {
      data: result,
      expireAt: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json({
      success: true,
      data: result,
      cached: false,
    });
  } catch (error: any) {
    console.error('MCC 验证失败:', error);

    // 针对配额/限流类错误做短期失败缓存（避免用户狂点导致雪崩）
    const msg = error?.message || '验证 MCC 账户失败';
    const isQuotaOrRate =
      msg.includes('429') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      msg.includes('配额') ||
      msg.includes('请求频率') ||
      msg.includes('验证请求过多');

    // 如果能从错误信息中判断是配额/频控类，给出 429 语义，并写入失败缓存
    // 这里用内存失败缓存（快速止血）；数据库级缓存可以在后续路线 1 再补
    if (isQuotaOrRate) {
      if (parsedMccId) {
        mccVerifyFailCache.set(parsedMccId, {
          error: msg,
          expireAt: Date.now() + FAIL_CACHE_TTL_MS,
        });
      }
      return NextResponse.json(
        { success: false, error: msg },
        { status: 429 }
      );
    }

    // 返回具体错误信息
    return NextResponse.json(
      {
        success: false,
        error: msg,
      },
      { status: 500 }
    );
  }
}
