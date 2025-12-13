# 数据库设计文档

## � 概览

Google Ads 联盟链接自动更换系统的数据库设计，基于 **MySQL 8.0+** 和 **Prisma ORM**，支持多租户隔离、软删除等特性。

## 🗂️ 表结构总览

| 序号 | 表名 | 说明 | 软删除 |
|------|------|------|--------|
| 1 | User | 用户表（多租户基础） | ❌ |
| 2 | MccAccount | Google Ads MCC账号表 | ✅ |
| 3 | CidAccount | Google Ads CID账号表 | ✅ |
| 4 | Campaign | 广告系列表（核心业务） | ✅ |
| 5 | AffiliateConfig | 联盟链接配置表 | ✅ |
| 6 | ProxyProvider | 代理供应商表 | ❌ |
| 7 | UsedProxyIp | 已使用代理IP表（24h去重） | ❌ |
| 8 | MonitoringLog | 监控日志表 | ❌ |
| 9 | SystemConfig | 系统配置表 | ❌ |

## 🔑 核心设计决策

### 1. 软删除策略
**方案**：将 `deletedAt` 字段加入唯一约束

```sql
-- 示例：Campaign 表的唯一约束
UNIQUE KEY `Campaign_campaignId_cidAccountId_deletedAt_key` 
  (`campaignId`, `cidAccountId`, `deletedAt`)
```

**优点**：
- ✅ 简单直接，易于理解
- ✅ 软删除后可以重复添加同样的记录
- ✅ MySQL原生支持，无需额外配置

**实现**：
- Prisma中间件自动拦截 `delete` 操作，转换为 `update`
- 查询时自动过滤 `deletedAt IS NULL`

### 2. Google Ads 层级结构
**设计**：MCC → CID → Campaign （三层结构）

**关系说明**：
- 一个MCC账号可以管理多个CID账号
- 一个CID账号下可以有多个广告系列
- Campaign 直接关联 CidAccount，不直接关联 MccAccount

### 3. Campaign 与 AffiliateConfig 关系
**设计**：一对多关系（一个广告系列可配置多个联盟链接）

**业务场景**：
- 支持A/B测试：同一广告系列测试不同联盟链接
- 优先级机制：通过 `priority` 字段控制使用顺序
- 故障转移：主链接失败时自动切换备用链接

### 4. 代理IP去重粒度
**设计**：按广告系列去重（24小时窗口）

```sql
-- UsedProxyIp 表索引
INDEX `UsedProxyIp_ip_campaignId_usedAt_idx` 
  (`ip`, `campaignId`, `usedAt`)
```

**逻辑**：
- 同一代理IP在24小时内不能被**同一广告系列**重复使用
- 不同广告系列可以使用相同代理IP
- 定时任务清理24小时前的记录


## 📊 详细表结构

### 1. User（用户表）
```sql
核心字段：
- id: 主键
- email: 唯一，登录邮箱
- role: employee（员工）/ admin（管理员）
- tenantId: 租户ID，多租户隔离关键

关系：
- 1:N → MccAccount
- 1:N → Campaign
```

### 2. MccAccount（MCC账号表）
```sql
核心字段：
- mccId: Google Ads MCC账号ID
- authStatus: pending/authorized/expired/failed
- refreshToken: OAuth刷新令牌（加密存储）
- deletedAt: 软删除字段

唯一约束：(mccId, userId, deletedAt)
关系：1:N → CidAccount
```

### 3. CidAccount（CID账号表）
```sql
核心字段：
- cid: Google Ads客户账号ID（Customer ID）
- mccAccountId: 关联的MCC账号ID
- currency: 账号货币代码（USD/CNY等）
- timezone: 账号时区
- status: active/inactive/suspended
- deletedAt: 软删除字段

唯一约束：(cid, mccAccountId, deletedAt)
关系：
- N:1 → MccAccount
- 1:N → Campaign
```

### 4. Campaign（广告系列表）⭐核心表
```sql
核心字段：
- campaignId: Google Ads广告系列ID
- cidAccountId: 关联的CID账号ID（而非MCC）
- lastClicks / todayClicks: INT类型，点击数
- replacementCountToday: 当日换链次数
- lastNewUrl: 最后更新的Final URL
- enabled: 是否启用监控

唯一约束：(campaignId, cidAccountId, deletedAt)
索引：(enabled, deletedAt) - 用于定时任务筛选
关系：
- N:1 → CidAccount
- 1:N → AffiliateConfig
```

### 5. AffiliateConfig（联盟配置表）
```sql
核心字段：
- affiliateLink: 联盟起始链接
- targetDomain: 目标根域名（用于验证）
- maxRedirects: 最大跳转次数（默认10）
- priority: 优先级（数字越小优先级越高）

关系：N:1 → Campaign（一对多）
```

### 6. ProxyProvider（代理供应商表）
```sql
核心字段：
- name: 供应商名称
- apiEndpoint: API接口地址
- priority: 优先级（故障转移用）
- successRate: 成功率监控
- maxRequestsPerMinute: 限流配置
```

### 7. UsedProxyIp（已使用代理IP表）
```sql
核心字段：
- ip + port: 代理地址
- campaignId: 关联广告系列（按系列去重）
- usedAt: 使用时间（24h清理依据）

索引：
- (ip, campaignId, usedAt) - 快速查询是否用过
- (usedAt) - 定时清理
```

### 8. MonitoringLog（监控日志表）
```sql
核心字段：
- todayClicks / lastClicks / newClicks: 点击数据
- proxyIp / proxyPort: 使用的代理
- finalUrl: 最终落地页
- status: success/failed/skipped
- executionTime: 执行耗时（ms）

索引：
- (campaignId, triggeredAt) - 按系列查询历史
- (status) - 统计成功率
```

### 9. SystemConfig（系统配置表）
```sql
预置配置项：
- cron_interval: 监控间隔（默认5分钟）
- max_redirects: 最大跳转次数（默认10）
- proxy_reuse_hours: 代理去重窗口（默认24小时）
- daily_replacement_limit: 每日换链上限（默认100）
- request_timeout: 请求超时（默认30秒）
```

## 🔧 Prisma 软删除中间件

### 工作原理

```typescript
// 1. 拦截 delete 操作 → 转换为 update
if (params.action === 'delete') {
  params.action = 'update';
  params.args['data'] = { deletedAt: new Date() };
}

// 2. 查询时自动过滤已删除记录
if (params.action === 'findMany') {
  params.args.where = {
    ...params.args.where,
    deletedAt: null,
  };
}
```

### 支持的模型
- MccAccount
- CidAccount
- Campaign
- AffiliateConfig

### 如何查询已删除记录

```typescript
// 包含已删除的记录
await prisma.campaign.findMany({
  where: {
    deletedAt: { not: null } // 明确指定查询已删除记录
  }
});

// 查询所有记录（包括已删除）
await prisma.campaign.findMany({
  where: {
    deletedAt: undefined // 跳过中间件过滤
  }
});
```

## 🚀 数据库初始化步骤

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，配置数据库连接
# DATABASE_URL="mysql://root:password@localhost:3306/google_ads_system"
```

### 3. 创建数据库
```bash
# 方式1：使用MySQL命令行
mysql -u root -p
CREATE DATABASE google_ads_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 方式2：使用Prisma自动创建
npm run db:push
```

### 4. 执行数据库迁移
```bash
# 开发环境：创建并应用迁移
npm run db:migrate

# 生产环境：仅应用迁移
npm run db:migrate:deploy
```

### 5. 初始化种子数据
```bash
npm run db:seed
```

### 6. 查看数据库（可选）
```bash
# 打开Prisma Studio可视化工具
npm run db:studio
```

## 🔐 安全建议

### 1. 敏感数据加密
需要加密的字段：
- `MccAccount.refreshToken` - OAuth刷新令牌
- `MccAccount.accessToken` - OAuth访问令牌
- `ProxyProvider.apiKey` - 代理供应商密钥

**实现方式**：
```typescript
import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex');

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  // ... 加密实现
}
```

### 2. 多租户隔离
**所有查询必须包含租户过滤**：
```typescript
// ❌ 错误：可能泄露其他租户数据
const campaigns = await prisma.campaign.findMany();

// ✅ 正确：通过用户关联自动过滤
const campaigns = await prisma.campaign.findMany({
  where: { userId: currentUser.id }
});
```

### 3. API权限校验
```typescript
// 检查资源归属
async function checkCampaignOwnership(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, userId }
  });
  
  if (!campaign) {
    throw new Error('Forbidden: 无权访问此资源');
  }
}
```

## 📈 性能优化建议

### 1. 索引优化
```sql
-- 已创建的关键索引
INDEX `Campaign_enabled_deletedAt_idx` (enabled, deletedAt)
INDEX `UsedProxyIp_ip_campaignId_usedAt_idx` (ip, campaignId, usedAt)
INDEX `MonitoringLog_campaignId_triggeredAt_idx` (campaignId, triggeredAt)
```

### 2. 定时清理任务
```typescript
// 清理24小时前的代理IP记录
import cron from 'node-cron';

cron.schedule('0 * * * *', async () => { // 每小时执行
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  await prisma.usedProxyIp.deleteMany({
    where: { usedAt: { lt: cutoffTime } }
  });
});
```

### 3. 批量操作优化
```typescript
// ❌ 慢：逐个更新
for (const campaign of campaigns) {
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { replacementCountToday: 0 }
  });
}

// ✅ 快：批量更新
await prisma.campaign.updateMany({
  where: { id: { in: campaignIds } },
  data: { replacementCountToday: 0 }
});
```

## 🐛 常见问题

### Q1: BigInt序列化错误
```
Error: Do not know how to serialize a BigInt
```

**解决方案**：已在 `lib/prisma.ts` 中全局处理
```typescript
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
```

### Q2: 软删除后无法重复添加
**检查项**：
1. 确保唯一约束包含 `deletedAt` 字段
2. 确认 Prisma 中间件正确加载

### Q3: 多租户数据泄露
**预防措施**：
1. 所有API必须先验证 `userId`
2. 使用Next.js中间件统一处理租户过滤
3. 定期检查关键数据与访问日志（如 `MonitoringLog`）

## 📝 数据库维护

### 备份建议
```bash
# 每日备份
mysqldump -u root -p google_ads_system > backup_$(date +%Y%m%d).sql

# 仅备份结构
mysqldump -u root -p --no-data google_ads_system > schema_backup.sql
```

### 监控指标
- 表行数增长速度（特别是 `MonitoringLog`）
- 索引使用率
- 慢查询日志
- 数据库连接池状态

---

**创建日期**: 2024年12月8日  
**版本**: v1.0  
**维护者**: 开发团队
