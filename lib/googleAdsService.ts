/**
 * Google Ads API 服务
 * 使用服务账号认证方式访问 Google Ads API
 */

import { GoogleAuth } from 'google-auth-library';

/**
 * MCC 账户数据接口
 */
interface MccAccountsData {
  mccName: string | null;
  totalCids: number;
  activeCids: number;
  suspendedCids: number;
  cidAccounts: CidAccountData[];
}

/**
 * CID 账户数据接口
 */
interface CidAccountData {
  cidId: string;
  cidName: string;
  status: 'active' | 'suspended';
  currencyCode?: string;
  timezone?: string;
}

/**
 * MCC 验证结果接口
 */
interface MccVerifyResult {
  mccId: string;
  mccName: string;
  totalCids: number;
  activeCids: number;
  suspendedCids: number;
  verified: true;
  verifiedAt: string;
}

/**
 * Google Ads API 客户端结果接口
 */
interface CustomerClientResult {
  customerClient: {
    id: string;
    descriptive_name?: string;
    descriptiveName?: string;
    status: string | number;
    level: number;
    manager: boolean;
    currency_code?: string;
    currencyCode?: string;
    time_zone?: string;
    timeZone?: string;
  };
}

class GoogleAdsService {
  private developerToken: string;
  private serviceAccountKeyPath: string;
  private accessToken: string | null = null;
  private tokenExpiresAt: number = 0;
  private apiVersion: string = 'v22';
  
  // 重试配置（简化版：小团队场景）
  private maxRetries: number = 3;
  private baseRetryDelayMs: number = 5000; // 5 秒

  // ============== 简化限流（小团队版：互斥锁 + 固定延迟） ==============
  // 适用场景：12 人左右的小团队，每人管理约 50 个广告系列
  // 原理：每次 API 调用后固定等待，确保请求间隔足够长
  private requestDelayMs: number = 1000; // 每次请求后等待 1 秒（可通过 GOOGLEADS_DELAY_MS 覆盖）

  private getEnvInt(key: string, fallback: number) {
    const raw = process.env[key];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  // 全局互斥锁：确保同一时间只有一个请求在执行
  private getGlobalLock(): { locked: boolean; queue: (() => void)[] } {
    const g = globalThis as any;
    if (!g.__googleAdsLock) {
      g.__googleAdsLock = { locked: false, queue: [] };
    }
    return g.__googleAdsLock;
  }

  // 获取锁（排队等待）
  private async acquireLock(): Promise<void> {
    const lock = this.getGlobalLock();
    
    if (!lock.locked) {
      lock.locked = true;
      return;
    }

    // 排队等待
    return new Promise<void>((resolve) => {
      lock.queue.push(resolve);
    });
  }

  // 释放锁（通知下一个等待者）
  private releaseLock(): void {
    const lock = this.getGlobalLock();
    
    if (lock.queue.length > 0) {
      const next = lock.queue.shift();
      next?.();
    } else {
      lock.locked = false;
    }
  }

  constructor() {
    this.developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
    this.serviceAccountKeyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || '';

    if (!this.developerToken) {
      throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN 环境变量未配置');
    }
    if (!this.serviceAccountKeyPath) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH 环境变量未配置');
    }

    // 简化配置：只需一个延迟参数
    // GOOGLEADS_DELAY_MS: 每次请求后的固定延迟（毫秒）
    this.requestDelayMs = this.getEnvInt('GOOGLEADS_DELAY_MS', this.requestDelayMs);
  }

  /**
   * 延迟函数
   * @param ms - 延迟毫秒数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 带重试机制的 fetch 请求（简化版：互斥锁 + 固定延迟 + 基础重试）
   * @param url - 请求 URL
   * @param options - fetch 选项
   * @param retryCount - 当前重试次数
   * @returns fetch 响应
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retryCount: number = 0
  ): Promise<Response> {
    // 获取全局锁，确保同一时间只有一个请求（注意：锁不可重入，因此这里用循环重试，避免递归再次抢锁导致死锁）
    await this.acquireLock();

    try {
      let attempt = retryCount;
      let lastResponse: Response | null = null;

      while (true) {
        const response = await fetch(url, options);
        lastResponse = response;

        // 需要重试的状态码：429 配额/限流、5xx 临时不可用
        const shouldRetryStatus =
          response.status === 429 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;

        // 可重试且仍有次数：等待后继续循环
        if (shouldRetryStatus && attempt < this.maxRetries) {
          // 优先尊重 Retry-After（若有），否则指数退避
          const retryAfterHeader = response.headers.get('Retry-After');
          let delayMs: number | null = null;

          if (retryAfterHeader) {
            const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
            if (Number.isFinite(retryAfterSeconds)) {
              delayMs = retryAfterSeconds * 1000;
            } else {
              const retryDate = new Date(retryAfterHeader);
              const ms = retryDate.getTime() - Date.now();
              delayMs = Number.isFinite(ms) ? Math.max(ms, this.baseRetryDelayMs) : null;
            }
          }

          if (delayMs == null) {
            delayMs = this.baseRetryDelayMs * Math.pow(2, attempt);
          }

          console.log(
            `⏳ Google Ads API 错误 (${response.status})，${(delayMs / 1000).toFixed(0)} 秒后重试... ` +
            `(第 ${attempt + 1}/${this.maxRetries} 次)`
          );

          await this.delay(delayMs);
          attempt += 1;
          continue;
        }

        return response;
      }
    } finally {
      // 每次请求完成后固定延迟再释放锁（削峰防 429）
      await this.delay(this.requestDelayMs);
      this.releaseLock();
    }
  }

  /**
   * 初始化服务，获取访问令牌
   */
  async initialize(): Promise<void> {
    // 如果 token 还有效，直接返回
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      console.log('🔑 使用缓存的访问令牌');
      return;
    }

    try {
      console.log('🔐 初始化 Google Ads 服务...', {
        keyPath: this.serviceAccountKeyPath,
        hasDeveloperToken: !!this.developerToken,
        apiVersion: this.apiVersion,
      });

      const auth = new GoogleAuth({
        keyFile: this.serviceAccountKeyPath,
        scopes: ['https://www.googleapis.com/auth/adwords'],
      });

      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();

      if (!tokenResponse.token) {
        throw new Error('无法获取访问令牌');
      }

      this.accessToken = tokenResponse.token;
      // 设置过期时间为 50 分钟后（token 通常是 1 小时有效）
      this.tokenExpiresAt = Date.now() + 50 * 60 * 1000;
      
      console.log('✅ Google Ads 服务初始化成功');
    } catch (error: any) {
      console.error('❌ Google Ads 服务初始化失败:', error);
      throw new Error(`Google Ads 服务初始化失败: ${error.message}`);
    }
  }

  /**
   * 格式化 MCC ID，移除破折号
   * @param mccId - MCC ID，格式如 "968-646-8564"
   * @returns 格式化后的 MCC ID，如 "9686468564"
   * @example
   * formatMccId("968-646-8564") // "9686468564"
   */
  formatMccId(mccId: string): string {
    return mccId.replace(/-/g, '');
  }

  /**
   * 验证 MCC ID 格式
   * @param mccId - 待验证的 MCC ID
   * @returns 格式是否正确
   */
  validateMccIdFormat(mccId: string): boolean {
    return /^\d{3}-\d{3}-\d{4}$/.test(mccId);
  }

  /**
   * 判断账户状态是否为有效
   * @param status - 账户状态
   * @returns 是否有效
   */
  private isActiveStatus(status: string | number): boolean {
    // status 可能是字符串 'ENABLED' 或数字 2
    return status === 'ENABLED' || status === 2;
  }

  /**
   * 处理 Google Ads API 响应
   * @param results - API 响应结果
   * @param mccId - MCC ID
   * @returns 处理后的 MCC 账户数据
   */
  private processAccountsResponse(results: CustomerClientResult[], mccId: string): MccAccountsData {
    let mccName: string | null = null;
    const cidAccounts: CidAccountData[] = [];

    for (const result of results) {
      const client = result.customerClient;
      
      // 处理字段名称的兼容性（API 可能返回下划线或驼峰命名）
      const descriptiveName = client.descriptive_name || client.descriptiveName || '';
      const currencyCode = client.currency_code || client.currencyCode;
      const timeZone = client.time_zone || client.timeZone;

      // 如果是 MCC 账户本身（manager = true），获取名称
      if (client.manager) {
        mccName = descriptiveName || `MCC账户-${mccId}`;
      } else {
        // 子账户（CID）
        const isActive = this.isActiveStatus(client.status);
        
        cidAccounts.push({
          cidId: client.id,
          cidName: descriptiveName || `CID-${client.id}`,
          status: isActive ? 'active' : 'suspended',
          currencyCode: currencyCode,
          timezone: timeZone,
        });
      }
    }

    // 统计数据
    const activeCids = cidAccounts.filter(c => c.status === 'active').length;
    const suspendedCids = cidAccounts.filter(c => c.status === 'suspended').length;

    return {
      mccName: mccName || `MCC账户-${mccId}`,
      totalCids: cidAccounts.length,
      activeCids,
      suspendedCids,
      cidAccounts,
    };
  }

  /**
   * 获取 MCC 子账户列表
   * @param mccId - MCC ID（格式如 "968-646-8564"）
   * @returns MCC 账户数据
   */
  async getMccAccounts(mccId: string): Promise<MccAccountsData> {
    await this.initialize();
    const formattedMccId = this.formatMccId(mccId);

    // GAQL 查询
    const query = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.status,
        customer_client.level,
        customer_client.manager,
        customer_client.currency_code,
        customer_client.time_zone
      FROM customer_client
      WHERE customer_client.level <= 1
    `;

    try {
      const apiUrl = `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedMccId}/googleAds:search`;
      
      console.log('📡 调用 Google Ads API:', {
        url: apiUrl,
        mccId: formattedMccId,
        hasToken: !!this.accessToken,
      });

      // 使用带重试机制的 fetch（处理 429 配额限制）
      const response = await this.fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'developer-token': this.developerToken,
          'login-customer-id': formattedMccId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      console.log('📥 API 响应状态:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });

      if (!response.ok) {
        // 尝试获取响应文本
        const responseText = await response.text();
        console.error('❌ Google Ads API 错误响应:', {
          status: response.status,
          statusText: response.statusText,
          responseText: responseText.substring(0, 500), // 只记录前 500 字符
        });

        // 尝试解析 JSON
        let errorData: any = {};
        try {
          errorData = JSON.parse(responseText);
        } catch (e) {
          // 如果不是 JSON，使用文本
          errorData = { message: responseText };
        }
        
        // 根据状态码返回友好的错误信息
        if (response.status === 401) {
          throw new Error('验证MCC访问权限失败，请确保服务账号已被授权访问该MCC');
        } else if (response.status === 403) {
          throw new Error('权限不足，服务账号可能未被添加到该MCC账户');
        } else if (response.status === 404) {
          throw new Error('MCC 账户不存在或无法访问');
        } else if (response.status === 400) {
          // 详细的 400 错误信息
          const errorMsg = errorData?.error?.message || errorData?.message || '请求参数错误';
          throw new Error(`请求参数错误: ${errorMsg}`);
        } else if (response.status === 429) {
          // 429 错误已重试多次仍失败，给出友好提示
          throw new Error('API 请求频率超限，请稍后再试（建议等待 1-2 分钟）');
        } else {
          const errorMsg = errorData?.error?.message || errorData?.message || response.statusText;
          throw new Error(`Google Ads API 请求失败 (${response.status}): ${errorMsg}`);
        }
      }

      const data = await response.json();
      console.log('✅ API 调用成功，返回结果数:', data.results?.length || 0);
      
      return this.processAccountsResponse(data.results || [], mccId);
    } catch (error: any) {
      console.error('❌ 获取 MCC 账户失败:', error);
      
      // 如果是我们自己抛出的错误，直接传递
      if (error.message.includes('验证MCC访问权限失败') || 
          error.message.includes('权限不足') || 
          error.message.includes('MCC 账户不存在') ||
          error.message.includes('请求参数错误') ||
          error.message.includes('Google Ads API 请求失败')) {
        throw error;
      }
      
      // 网络错误或其他错误
      throw new Error(`获取 MCC 账户信息失败: ${error.message}`);
    }
  }

  /**
   * 验证 MCC 账户
   * @param mccId - MCC ID（格式如 "968-646-8564"）
   * @returns 验证结果
   */
  async verifyMccAccount(mccId: string): Promise<MccVerifyResult> {
    if (!this.validateMccIdFormat(mccId)) {
      throw new Error('MCC ID 格式无效，正确格式为：xxx-xxx-xxxx');
    }

    const accountsData = await this.getMccAccounts(mccId);

    return {
      mccId,
      mccName: accountsData.mccName || `MCC账户-${mccId}`,
      totalCids: accountsData.totalCids,
      activeCids: accountsData.activeCids,
      suspendedCids: accountsData.suspendedCids,
      verified: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  /**
   * 获取 CID 账户下的有效广告系列
   * @param mccId - MCC ID（格式如 "968-646-8564"）
   * @param cidId - CID ID
   * @returns 广告系列数据列表
   */
  async getCampaignsForCid(mccId: string, cidId: string): Promise<CampaignData[]> {
    await this.initialize();
    const formattedMccId = this.formatMccId(mccId);
    const formattedCidId = cidId.replace(/-/g, '');

    // GAQL 查询获取有效的广告系列，包括地理定位和最终到达网址
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        ad_group_ad.ad.final_urls,
        geographic_view.country_criterion_id
      FROM geographic_view
      WHERE campaign.status = 'ENABLED'
        AND ad_group.status = 'ENABLED'
        AND ad_group_ad.status = 'ENABLED'
    `;

    try {
      const apiUrl = `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedCidId}/googleAds:search`;
      
      console.log('📡 获取 CID 广告系列:', {
        url: apiUrl,
        mccId: formattedMccId,
        cidId: formattedCidId,
      });

      const response = await this.fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'developer-token': this.developerToken,
          'login-customer-id': formattedMccId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.error('❌ 获取广告系列失败:', {
          status: response.status,
          cidId: formattedCidId,
          response: responseText.substring(0, 500),
        });
        // 对于单个 CID 的失败，返回空数组而不是抛出错误
        return [];
      }

      const data = await response.json();
      const results = data.results || [];
      
      // 使用 Map 进行去重，key 为 campaignId
      const campaignMap = new Map<string, CampaignData>();
      
      for (const result of results) {
        const campaignId = result.campaign?.id;
        if (!campaignId || campaignMap.has(campaignId)) {
          continue;
        }

        const campaign = result.campaign;
        const finalUrls = result.adGroupAd?.ad?.finalUrls || result.ad_group_ad?.ad?.final_urls || [];
        const countryId = result.geographicView?.countryCriterionId || result.geographic_view?.country_criterion_id;
        
        // 将地理代码转换为国家代码
        const countryCode = this.getCountryCodeFromGeoId(countryId);

        campaignMap.set(campaignId, {
          cidId: formattedCidId,
          cidName: '', // 稍后填充
          campaignId: campaignId,
          campaignName: campaign.name || `Campaign-${campaignId}`,
          countryCode: countryCode,
          finalUrl: finalUrls[0] || '',
          status: campaign.status || 'UNKNOWN',
        });
      }

      return Array.from(campaignMap.values());
    } catch (error: any) {
      console.error('❌ 获取 CID 广告系列异常:', error);
      return [];
    }
  }

  /**
   * 【高性能优化版】获取 CID 下所有有效广告系列
   * 使用单次批量查询替代多次串行查询，大幅提升性能
   */
  async getSimpleCampaignsForCid(mccId: string, cidId: string, cidName: string): Promise<CampaignData[]> {
    await this.initialize();
    const formattedMccId = this.formatMccId(mccId);
    const formattedCidId = cidId.replace(/-/g, '');

    try {
      const apiUrl = `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedCidId}/googleAds:search`;
      
      // 【优化】使用单次查询同时获取广告系列基本信息
      const campaignQuery = `
        SELECT
          campaign.id,
          campaign.name,
          campaign.status
        FROM campaign
        WHERE campaign.status = 'ENABLED'
      `;

      const campaignResponse = await this.fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'developer-token': this.developerToken,
          'login-customer-id': formattedMccId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: campaignQuery }),
      });

      if (!campaignResponse.ok) {
        console.error('❌ 获取广告系列失败:', campaignResponse.status);
        return [];
      }

      const campaignData = await campaignResponse.json();
      const campaigns = campaignData.results || [];

      if (campaigns.length === 0) {
        return [];
      }

      // 构建广告系列ID列表
      const campaignIds = campaigns.map((c: any) => c.campaign.id);

      // 【优化】使用单次批量查询获取所有广告系列的 Final URL
      const adQuery = `
        SELECT
          campaign.id,
          ad_group_ad.ad.final_urls
        FROM ad_group_ad
        WHERE campaign.id IN (${campaignIds.join(',')})
          AND ad_group_ad.status = 'ENABLED'
      `;

      // 【优化】使用单次批量查询获取所有广告系列的地理定位
      const geoQuery = `
        SELECT
          campaign.id,
          campaign_criterion.location.geo_target_constant
        FROM campaign_criterion
        WHERE campaign.id IN (${campaignIds.join(',')})
          AND campaign_criterion.type = 'LOCATION'
          AND campaign_criterion.negative = false
      `;

      // 【优化】并行执行两个批量查询
      const [adResponse, geoResponse] = await Promise.all([
        this.fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'developer-token': this.developerToken,
            'login-customer-id': formattedMccId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: adQuery }),
        }),
        this.fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'developer-token': this.developerToken,
            'login-customer-id': formattedMccId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: geoQuery }),
        }),
      ]);

      // 构建 Final URL 映射
      const finalUrlMap = new Map<string, string>();
      if (adResponse.ok) {
        const adData = await adResponse.json();
        const adResults = adData.results || [];
        for (const result of adResults) {
          const campaignId = result.campaign?.id;
          const finalUrls = result.adGroupAd?.ad?.finalUrls || 
                           result.ad_group_ad?.ad?.final_urls || [];
          if (campaignId && finalUrls.length > 0 && !finalUrlMap.has(campaignId)) {
            finalUrlMap.set(campaignId, finalUrls[0]);
          }
        }
      }

      // 构建地理定位映射
      const geoMap = new Map<string, string>();
      if (geoResponse.ok) {
        const geoData = await geoResponse.json();
        const geoResults = geoData.results || [];
        for (const result of geoResults) {
          const campaignId = result.campaign?.id;
          const geoConstant = result.campaignCriterion?.location?.geoTargetConstant ||
                             result.campaign_criterion?.location?.geo_target_constant;
          if (campaignId && geoConstant && !geoMap.has(campaignId)) {
            const geoId = geoConstant.split('/').pop();
            geoMap.set(campaignId, this.getCountryCodeFromGeoId(geoId));
          }
        }
      }

      // 组装最终结果
      return campaigns.map((campaignResult: any) => {
        const campaign = campaignResult.campaign;
        const campaignId = campaign.id;
        return {
          cidId: formattedCidId,
          cidName: cidName,
          campaignId: campaignId,
          campaignName: campaign.name || `Campaign-${campaignId}`,
          countryCode: geoMap.get(campaignId) || '',
          finalUrl: finalUrlMap.get(campaignId) || '',
          status: campaign.status || 'ENABLED',
        };
      });
    } catch (error: any) {
      console.error('❌ 获取 CID 广告系列异常:', error);
      return [];
    }
  }

  /**
   * 【高性能优化版】获取所有 MCC 下属 CID 的有效广告系列
   * 使用并行处理替代串行遍历，大幅提升性能
   * @param mccId - MCC ID（格式如 "968-646-8564"）
   * @returns 所有广告系列数据
   */
  async getAllCampaignsForMcc(mccId: string): Promise<AllCampaignsResult> {
    // 先获取所有 CID 账户
    const mccData = await this.getMccAccounts(mccId);
    
    // 只获取有效的 CID 账户
    const activeCids = mccData.cidAccounts.filter(cid => cid.status === 'active');
    
    console.log(`📊 找到 ${activeCids.length} 个有效 CID 账户，开始并行获取广告系列...`);

    // 【稳定性优化】限制 CID 并发，避免瞬时洪峰触发 429
    const cidConcurrency = this.getEnvInt('GOOGLEADS_CID_CONCURRENCY', 3);

    const runWithConcurrencyLimit = async <T, R>(
      items: T[],
      limit: number,
      fn: (item: T, index: number) => Promise<R>
    ): Promise<PromiseSettledResult<R>[]> => {
      const results: PromiseSettledResult<R>[] = new Array(items.length);
      let currentIndex = 0;

      const worker = async () => {
        while (currentIndex < items.length) {
          const i = currentIndex++;
          try {
            const value = await fn(items[i], i);
            results[i] = { status: 'fulfilled', value } as PromiseFulfilledResult<R>;
          } catch (reason) {
            results[i] = { status: 'rejected', reason } as PromiseRejectedResult;
          }
        }
      };

      const workers = Array(Math.min(limit, items.length))
        .fill(null)
        .map(() => worker());
      await Promise.all(workers);
      return results;
    };

    const results = await runWithConcurrencyLimit(
      activeCids,
      Math.max(1, cidConcurrency),
      async (cid) => {
        const campaigns = await this.getSimpleCampaignsForCid(mccId, cid.cidId, cid.cidName);
        console.log(`✅ CID ${cid.cidId} (${cid.cidName}): 获取到 ${campaigns.length} 个广告系列`);
        return campaigns;
      }
    );

    // 合并所有成功的结果
    const allCampaigns: CampaignData[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allCampaigns.push(...result.value);
      } else {
        const reason = (result as any).reason;
        console.error(`❌ CID 获取广告系列失败:`, reason);
      }
    }

    console.log(`📊 并行获取完成，共 ${allCampaigns.length} 个广告系列`);

    return {
      totalCampaigns: allCampaigns.length,
      campaigns: allCampaigns,
    };
  }

  /**
   * 将 Google Ads 地理 ID 转换为国家代码
   * @param geoId - 地理 ID
   * @returns 国家代码
   */
  private getCountryCodeFromGeoId(geoId: string | number | undefined): string {
    if (!geoId) return '';
    
    // Google Ads 常用国家地理代码映射
    const geoCodeMap: Record<string, string> = {
      '2840': 'US',  // 美国
      '2826': 'GB',  // 英国
      '2124': 'CA',  // 加拿大
      '2036': 'AU',  // 澳大利亚
      '2276': 'DE',  // 德国
      '2250': 'FR',  // 法国
      '2392': 'JP',  // 日本
      '2410': 'KR',  // 韩国
      '2156': 'CN',  // 中国
      '2356': 'IN',  // 印度
      '2076': 'BR',  // 巴西
      '2484': 'MX',  // 墨西哥
      '2380': 'IT',  // 意大利
      '2724': 'ES',  // 西班牙
      '2528': 'NL',  // 荷兰
      '2616': 'PL',  // 波兰
      '2792': 'TR',  // 土耳其
      '2643': 'RU',  // 俄罗斯
      '2702': 'SG',  // 新加坡
      '2344': 'HK',  // 香港
      '2158': 'TW',  // 台湾
      '2458': 'MY',  // 马来西亚
      '2764': 'TH',  // 泰国
      '2360': 'ID',  // 印尼
      '2704': 'VN',  // 越南
      '2608': 'PH',  // 菲律宾
      '2554': 'NZ',  // 新西兰
      '2710': 'ZA',  // 南非
      '2818': 'EG',  // 埃及
      '2784': 'AE',  // 阿联酋
      '2682': 'SA',  // 沙特阿拉伯
      '2376': 'IL',  // 以色列
    };

    const geoIdStr = String(geoId);
    return geoCodeMap[geoIdStr] || geoIdStr;
  }

  /**
   * 获取广告系列的今日点击数
   * @param mccId - MCC ID（格式如 "968-646-8564"）
   * @param cidId - CID ID
   * @param campaignIds - 广告系列ID列表
   * @returns 广告系列点击数据
   */
  async getCampaignClicks(mccId: string, cidId: string, campaignIds: string[]): Promise<CampaignClicksData[]> {
    await this.initialize();
    const formattedMccId = this.formatMccId(mccId);
    const formattedCidId = cidId.replace(/-/g, '');

    // 构建广告系列ID过滤条件
    const campaignIdFilter = campaignIds.join(',');
    
    // GAQL 查询获取今日点击数
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        metrics.clicks
      FROM campaign
      WHERE campaign.id IN (${campaignIdFilter})
        AND segments.date = '${this.getTodayDateString()}'
    `;

    try {
      const apiUrl = `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedCidId}/googleAds:search`;
      
      console.log('📡 获取广告系列今日点击数:', {
        cidId: formattedCidId,
        campaignIds: campaignIds.length,
      });

      const response = await this.fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'developer-token': this.developerToken,
          'login-customer-id': formattedMccId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        console.error('❌ 获取点击数失败:', {
          status: response.status,
          response: responseText.substring(0, 500),
        });
        return [];
      }

      const data = await response.json();
      const results = data.results || [];

      return results.map((result: any) => ({
        campaignId: result.campaign?.id || '',
        campaignName: result.campaign?.name || '',
        clicks: parseInt(result.metrics?.clicks || '0', 10),
      }));
    } catch (error: any) {
      console.error('❌ 获取广告系列点击数异常:', error);
      return [];
    }
  }

  /**
   * 批量获取多个 CID 下广告系列的今日点击数
   * @param mccId - MCC ID
   * @param campaigns - 广告系列信息列表（包含cidId和campaignId）
   * @returns 广告系列点击数据Map
   */
  async getBatchCampaignClicks(
    mccId: string, 
    campaigns: { cidId: string; campaignId: string }[]
  ): Promise<Map<string, number>> {
    await this.initialize();
    const formattedMccId = this.formatMccId(mccId);
    const clicksMap = new Map<string, number>();

    // 按 CID 分组
    const cidGroups = new Map<string, string[]>();
    for (const campaign of campaigns) {
      const cidCampaigns = cidGroups.get(campaign.cidId) || [];
      cidCampaigns.push(campaign.campaignId);
      cidGroups.set(campaign.cidId, cidCampaigns);
    }

    // 遍历每个 CID 获取点击数
    for (const [cidId, campaignIds] of cidGroups) {
      const formattedCidId = cidId.replace(/-/g, '');
      const campaignIdFilter = campaignIds.join(',');
      
      const query = `
        SELECT
          campaign.id,
          metrics.clicks
        FROM campaign
        WHERE campaign.id IN (${campaignIdFilter})
          AND segments.date = '${this.getTodayDateString()}'
      `;

      try {
        const apiUrl = `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedCidId}/googleAds:search`;
        
        const response = await this.fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'developer-token': this.developerToken,
            'login-customer-id': formattedMccId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query }),
        });

        if (response.ok) {
          const data = await response.json();
          const results = data.results || [];
          
          for (const result of results) {
            const campaignId = result.campaign?.id;
            const clicks = parseInt(result.metrics?.clicks || '0', 10);
            if (campaignId) {
              clicksMap.set(campaignId, clicks);
            }
          }
        }
      } catch (error) {
        console.error(`获取 CID ${cidId} 点击数失败:`, error);
      }
    }

    return clicksMap;
  }

  /**
   * 获取今日日期字符串（格式：YYYY-MM-DD）
   */
  private getTodayDateString(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 更新广告系列的最终到达网址后缀
   * @param mccId - MCC ID（格式如 "968-646-8564"）
   * @param cidId - CID ID
   * @param campaignId - 广告系列ID
   * @param finalUrlSuffix - 新的最终到达网址后缀
   * @returns 更新结果
   */
  async updateCampaignFinalUrlSuffix(
    mccId: string,
    cidId: string,
    campaignId: string,
    finalUrlSuffix: string
  ): Promise<{ success: boolean; error?: string }> {
    await this.initialize();
    const formattedMccId = this.formatMccId(mccId);
    const formattedCidId = cidId.replace(/-/g, '');

    try {
      const apiUrl = `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedCidId}/campaigns:mutate`;
      
      // 构建更新请求
      const requestBody = {
        operations: [
          {
            updateMask: 'finalUrlSuffix',
            update: {
              resourceName: `customers/${formattedCidId}/campaigns/${campaignId}`,
              finalUrlSuffix: finalUrlSuffix,
            },
          },
        ],
      };

      console.log('📡 更新广告系列最终到达网址后缀:', {
        cidId: formattedCidId,
        campaignId,
        finalUrlSuffix: finalUrlSuffix.substring(0, 50) + '...',
      });

      // 使用带重试+排队的 fetch，429 时会退避重试（用户选择：更稳地等待）
      const response = await this.fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'developer-token': this.developerToken,
          'login-customer-id': formattedMccId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const responseText = await response.text();
        const requestId =
          response.headers.get('request-id') ||
          response.headers.get('x-request-id') ||
          undefined;
        console.error('❌ 更新广告系列后缀失败:', {
          status: response.status,
          requestId,
          response: responseText.substring(0, 500),
        });
        
        // 解析错误信息
        let errorMsg = `更新失败(HTTP ${response.status})`;
        try {
          const errorData = JSON.parse(responseText);
          const apiError = errorData?.error || errorData;
          const code = apiError?.code;
          const statusText = apiError?.status;
          const message = apiError?.message;
          const details = apiError?.details;

          const parts: string[] = [];
          parts.push(`HTTP ${response.status}`);
          if (typeof code === 'number' || typeof code === 'string') parts.push(`code=${code}`);
          if (typeof statusText === 'string') parts.push(`status=${statusText}`);
          if (requestId) parts.push(`requestId=${requestId}`);
          if (typeof message === 'string' && message.trim()) parts.push(message.trim());

          // Google Ads API 经常把更细的原因放在 details 里；这里保留一段可读的截断信息。
          let detailsStr = '';
          if (details !== undefined) {
            try {
              detailsStr = JSON.stringify(details);
            } catch {
              detailsStr = String(details);
            }
          }
          if (detailsStr) {
            const truncated = detailsStr.length > 400 ? detailsStr.substring(0, 400) + '...' : detailsStr;
            parts.push(`details=${truncated}`);
          }

          errorMsg = parts.join(' | ');
        } catch {
          const safeText = responseText.substring(0, 200);
          errorMsg = requestId
            ? `HTTP ${response.status} | requestId=${requestId} | ${safeText}`
            : `HTTP ${response.status} | ${safeText}`;
        }
        
        return { success: false, error: errorMsg };
      }

      const data = await response.json();
      console.log('✅ 广告系列最终到达网址后缀更新成功:', data.results?.[0]?.resourceName);
      
      return { success: true };
    } catch (error: any) {
      console.error('❌ 更新广告系列后缀异常:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量更新多个广告系列的最终到达网址后缀
   * @param mccId - MCC ID
   * @param updates - 更新列表
   * @returns 更新结果Map
   */
  async batchUpdateCampaignFinalUrlSuffix(
    mccId: string,
    updates: { cidId: string; campaignId: string; finalUrlSuffix: string }[]
  ): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();
    if (!updates || updates.length === 0) return results;

    await this.initialize();

    const formattedMccId = this.formatMccId(mccId);
    const OPERATIONS_CHUNK_SIZE = 100; // 按你的要求：每次 mutate 最多 100 条

    const chunk = <T>(arr: T[], size: number): T[][] => {
      const out: T[][] = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };

    const extractCampaignIdFromResourceName = (resourceName: string | undefined): string | null => {
      if (!resourceName) return null;
      // resourceName 形如：customers/{cid}/campaigns/{campaignId}
      const m = /\/campaigns\/(\d+)$/.exec(resourceName);
      return m?.[1] ?? null;
    };

    const formatBatchError = (status: number, responseText: string, requestId?: string): string => {
      let errorMsg = `更新失败(HTTP ${status})`;
      try {
        const errorData = JSON.parse(responseText);
        const apiError = errorData?.error || errorData;
        const code = apiError?.code;
        const statusText = apiError?.status;
        const message = apiError?.message;
        const details = apiError?.details;

        const parts: string[] = [];
        parts.push(`HTTP ${status}`);
        if (typeof code === 'number' || typeof code === 'string') parts.push(`code=${code}`);
        if (typeof statusText === 'string') parts.push(`status=${statusText}`);
        if (requestId) parts.push(`requestId=${requestId}`);
        if (typeof message === 'string' && message.trim()) parts.push(message.trim());

        let detailsStr = '';
        if (details !== undefined) {
          try {
            detailsStr = JSON.stringify(details);
          } catch {
            detailsStr = String(details);
          }
        }
        if (detailsStr) {
          const truncated = detailsStr.length > 400 ? detailsStr.substring(0, 400) + '...' : detailsStr;
          parts.push(`details=${truncated}`);
        }
        errorMsg = parts.join(' | ');
      } catch {
        const safeText = responseText.substring(0, 200);
        errorMsg = requestId
          ? `HTTP ${status} | requestId=${requestId} | ${safeText}`
          : `HTTP ${status} | ${safeText}`;
      }
      return errorMsg;
    };

    // 按 CID 分组（Google Ads API 的天然边界：一次 mutate 只能针对一个 customer/CID）
    const cidGroups = new Map<string, typeof updates>();
    for (const u of updates) {
      const group = cidGroups.get(u.cidId) || [];
      group.push(u);
      cidGroups.set(u.cidId, group);
    }

    for (const [cidId, cidUpdates] of cidGroups) {
      const formattedCidId = cidId.replace(/-/g, '');
      const apiUrl = `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedCidId}/campaigns:mutate`;

      // 每 CID 再按 100 条 operations 分片
      const batches = chunk(cidUpdates, OPERATIONS_CHUNK_SIZE);
      for (const batch of batches) {
        const requestBody = {
          partialFailure: true,
          operations: batch.map((u) => ({
            updateMask: 'finalUrlSuffix',
            update: {
              resourceName: `customers/${formattedCidId}/campaigns/${u.campaignId}`,
              finalUrlSuffix: u.finalUrlSuffix,
            },
          })),
        };

        try {
          console.log('📡 批量更新广告系列最终到达网址后缀:', {
            mccId: formattedMccId,
            cidId: formattedCidId,
            operations: batch.length,
          });

          const response = await this.fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.accessToken}`,
              'developer-token': this.developerToken,
              'login-customer-id': formattedMccId,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const responseText = await response.text();
            const requestId =
              response.headers.get('request-id') ||
              response.headers.get('x-request-id') ||
              undefined;

            const errorMsg = formatBatchError(response.status, responseText, requestId);
            console.error('❌ 批量更新后缀失败:', {
              status: response.status,
              requestId,
              cidId: formattedCidId,
              operations: batch.length,
              error: errorMsg,
            });

            for (const u of batch) results.set(u.campaignId, { success: false, error: errorMsg });
            continue;
          }

          const data = await response.json();
          const okResourceNames: string[] = Array.isArray(data?.results)
            ? data.results.map((r: any) => r?.resourceName).filter(Boolean)
            : [];

          const successIds = new Set<string>();
          for (const rn of okResourceNames) {
            const id = extractCampaignIdFromResourceName(rn);
            if (id) successIds.add(id);
          }

          // 如果出现 partialFailureError，则无法精确映射每条 operation 的失败原因（需要解析 details protobuf）。
          // 这里采用稳妥策略：能从 results 推断成功的标为成功，其余标为失败，并带上可读的截断错误信息。
          const partialFailureMsg = data?.partialFailureError?.message
            ? String(data.partialFailureError.message)
            : data?.partial_failure_error?.message
              ? String(data.partial_failure_error.message)
              : '';

          for (const u of batch) {
            if (successIds.has(String(u.campaignId))) {
              results.set(u.campaignId, { success: true });
            } else if (partialFailureMsg) {
              results.set(u.campaignId, { success: false, error: `partialFailure: ${partialFailureMsg}`.slice(0, 800) });
            } else {
              // 没有 partialFailureError，但也没出现在 results：保守起见标记失败，便于审计
              results.set(u.campaignId, { success: false, error: '批量更新返回异常：未包含该 campaign 的结果' });
            }
          }
        } catch (e: any) {
          const msg = e?.message || String(e);
          console.error('❌ 批量更新后缀异常:', { cidId: formattedCidId, error: msg });
          for (const u of batch) results.set(u.campaignId, { success: false, error: msg });
        }
      }
    }

    return results;
  }
}

/**
 * 广告系列点击数据接口
 */
interface CampaignClicksData {
  campaignId: string;
  campaignName: string;
  clicks: number;
}

// 导出单例
let googleAdsServiceInstance: GoogleAdsService | null = null;

export function getGoogleAdsService(): GoogleAdsService {
  if (!googleAdsServiceInstance) {
    googleAdsServiceInstance = new GoogleAdsService();
  }
  return googleAdsServiceInstance;
}

/**
 * 广告系列数据接口
 */
interface CampaignData {
  cidId: string;
  cidName: string;
  campaignId: string;
  campaignName: string;
  countryCode: string;
  finalUrl: string;
  status: string;
}

/**
 * 获取所有广告系列结果接口
 */
interface AllCampaignsResult {
  totalCampaigns: number;
  campaigns: CampaignData[];
}

export type { MccVerifyResult, MccAccountsData, CidAccountData, CampaignData, AllCampaignsResult, CampaignClicksData };
