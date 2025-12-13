# 代理管理模块使用指南

## 功能概述

代理管理模块支持基于账密认证的方式提取代理IP，并实现了24小时IP去重机制，确保同一广告系列在24小时内不会重复使用相同的代理IP。

## 核心特性

### 1. 账密认证方式
- 使用 `proxyHost`、`proxyPort`、`username`、`password` 进行代理认证
- 支持多种占位符，实现动态认证信息生成
- **国家代码占位符**:
  - `{country}` - 小写国家代码 (如: `au`, `us`)
  - `{COUNTRY}` - 大写国家代码 (如: `AU`, `US`)
- **随机Session占位符**:
  - `{session:N}` - N位随机数字 (如: `{session:8}` → `37557770`)
  - `{random:N}` - N位随机字母数字 (如: `{random:10}` → `a3b9d2f8g1`)
- **示例**:
  - `user-region-{country}-session-{session:8}` → `user-region-au-session-37557770`
  - `user-res-{COUNTRY}-Lsid-{session:9}` → `user-res-AU-Lsid-978668474`

### 2. 国家代码支持
- 可为每个代理供应商配置支持的国家代码列表
- 留空表示支持所有国家
- 系统会根据国家代码自动选择合适的代理供应商

### 3. 24小时IP去重
- 按广告系列(campaignId)进行IP去重
- 确保同一广告系列在24小时内不会重复使用相同的代理
- 自动清理24小时前的使用记录

### 4. 多供应商优先级管理
- 支持配置多个代理供应商
- 按优先级(priority)自动选择可用代理
- 数字越小优先级越高

## 数据库模型

```prisma
model ProxyProvider {
  id                   String    @id @default(uuid())
  name                 String    /// 供应商名称
  proxyHost            String    /// 代理服务器地址
  proxyPort            Int       /// 代理服务器端口
  username             String    /// 认证用户名（支持国家代码占位符）
  password             String    /// 认证密码（加密存储）
  supportedCountries   Json?     /// 支持的国家代码列表
  priority             Int       /// 优先级（数字越小优先级越高）
  enabled              Boolean   /// 是否启用
  maxRequestsPerMinute Int?      /// 每分钟最大请求次数限制
  successRate          Decimal?  /// 成功率（百分比）
  lastFailedAt         DateTime? /// 最后一次失败时间
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
}

model UsedProxyIp {
  id          String   @id @default(uuid())
  ip          String   /// 代理IP地址
  port        Int      /// 代理端口
  countryCode String   /// 代理IP所属国家代码
  providerId  String   /// 关联的代理供应商ID
  campaignId  String   /// 关联的广告系列ID
  usedAt      DateTime @default(now()) /// 使用时间
}
```

## API 使用示例

### 1. 添加代理供应商

**前端界面操作：**
1. 访问 `/console/proxy`
2. 点击"添加代理供应商"按钮
3. 填写表单：
   - 供应商名称: `Bright Data`
   - 代理服务器地址: `brd.superproxy.io`
   - 代理服务器端口: `22225`
   - 用户名: `brd-customer-{country}-session-{session:8}` (支持占位符)
   - 密码: `your_password`
   - 支持的国家: 选择 `US, GB, DE, FR, CA`
   - 优先级: `1`

**API调用：**
```javascript
const response = await fetch('/api/proxy-providers', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Bright Data',
    proxyHost: 'brd.superproxy.io',
    proxyPort: 22225,
    username: 'brd-customer-{country}-session-{session:8}',
    password: 'your_password',
    supportedCountries: ['US', 'GB', 'DE', 'FR', 'CA'],
    priority: 1,
    enabled: true,
    maxRequestsPerMinute: 60
  })
})
```

### 2. 获取可用代理

```javascript
// 获取美国地区的代理，用于广告系列 campaign-123
const response = await fetch(
  '/api/proxy?countryCode=US&campaignId=campaign-123'
)

const proxyConfig = await response.json()
/*
{
  host: 'brd.superproxy.io',
  port: 22225,
  username: 'brd-customer-us-session-37557770',  // 占位符已替换
  password: 'your_password',
  countryCode: 'US',
  providerId: 'provider-id',
  providerName: 'Bright Data',
  sessionId: '37557770'  // 用于24小时去重
}
*/
```

### 3. 记录代理使用

```javascript
// 在使用代理后，记录使用情况
await fetch('/api/proxy/record', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    proxyConfig: {
      host: 'brd.superproxy.io',
      port: 22225,
      username: 'brd-customer-us-session-37557770',
      password: 'your_password',
      countryCode: 'US',
      providerId: 'provider-id',
      providerName: 'Bright Data',
      sessionId: '37557770'  // 用于去重标识
    },
    campaignId: 'campaign-123'
  })
})
```

### 4. 获取代理使用统计

```javascript
// 查看广告系列的代理使用统计
const response = await fetch(
  '/api/proxy/stats?campaignId=campaign-123&countryCode=US'
)

const stats = await response.json()
/*
{
  total: 5,
  byProvider: {
    'Bright Data': 3,
    'Oxylabs': 2
  },
  byCountry: {
    'US': 5
  },
  proxies: [
    {
      id: 'xxx',
      ip: '123.45.67.89',
      port: 22225,
      countryCode: 'US',
      providerId: 'xxx',
      campaignId: 'campaign-123',
      usedAt: '2024-01-15T10:30:00Z',
      provider: { name: 'Bright Data' }
    },
    // ...更多记录
  ]
}
*/
```

### 5. 清理过期记录

```javascript
// 清理24小时前的代理使用记录
const response = await fetch('/api/proxy', {
  method: 'POST'
})

const result = await response.json()
/*
{
  success: true,
  message: '清理了 10 条过期代理记录',
  count: 10
}
*/
```

## 在监控任务中使用代理

```typescript
import { getAvailableProxy, recordProxyUsage } from '@/lib/proxyService'

async function executeMonitoringTask(campaignId: string, countryCode: string) {
  // 1. 获取可用代理
  const proxy = await getAvailableProxy(countryCode, campaignId)
  
  if (!proxy) {
    console.error('没有可用的代理')
    return
  }

  try {
    // 2. 使用代理执行任务
    const result = await fetch('https://example.com', {
      // 配置代理
      // 具体实现取决于HTTP客户端
    })

    // 3. 记录代理使用
    await recordProxyUsage(proxy, campaignId)

    return result
  } catch (error) {
    console.error('任务执行失败:', error)
    throw error
  }
}
```

## 定期清理任务

建议设置定时任务定期清理过期的代理记录：

```typescript
// 使用 node-cron 或其他调度工具
import cron from 'node-cron'
import { cleanupOldProxyRecords } from '@/lib/proxyService'

// 每小时执行一次清理
cron.schedule('0 * * * *', async () => {
  console.log('开始清理过期代理记录...')
  const count = await cleanupOldProxyRecords()
  console.log(`清理完成，删除了 ${count} 条记录`)
})
```

## 部署步骤

1. **更新数据库结构**
   ```bash
   # 生成Prisma客户端
   npx prisma generate

   # 创建数据库迁移
   npx prisma migrate dev --name add_proxy_country_support

   # 或直接推送schema变更（开发环境）
   npx prisma db push
   ```

2. **重启开发服务器**
   ```bash
   npm run dev
   ```

3. **访问代理管理页面**
   - 打开浏览器访问 `http://localhost:10111/console/proxy`
   - 添加代理供应商配置

## 常见问题

### Q: 如何支持所有国家？
A: 在添加/编辑代理供应商时，将"支持的国家"字段留空即可。

### Q: 用户名占位符如何工作？
A: 系统支持多种占位符：
- **国家代码**: 
  - `{country}` → 小写，如: `au`, `us`
  - `{COUNTRY}` → 大写，如: `AU`, `US`
- **随机session**:
  - `{session:8}` → 8位随机数字，如: `37557770`
  - `{random:10}` → 10位字母数字，如: `a3b9d2f8g1`
- **示例**:
  - 配置: `user-region-{country}-session-{session:8}`
  - 请求AU代理: `user-region-au-session-37557770`
  - 再次请求: `user-region-au-session-89123456` (不同session)

### Q: session占位符的作用是什么？
A: session占位符用于生成唯一的随机标识，实现24小时IP去重：
- 每次获取代理时生成新的随机session
- 同一个session在24小时内不会重复使用
- 确保每次使用的都是"新的"代理配置

### Q: 如何处理24小时内所有代理都被使用的情况？
A: 系统会返回404错误，建议：
1. 增加更多代理供应商
2. 增加供应商支持的国家代码
3. 调整监控频率，避免过于频繁

### Q: 密码会加密存储吗？
A: 代码中已预留TODO注释，需要实现密码加密功能。建议使用bcrypt或其他加密库。

## 注意事项

1. **安全性**: 密码目前未加密存储，建议实现加密功能
2. **性能**: 24小时IP去重表会随时间增长，建议定期清理
3. **监控**: 建议监控代理供应商的成功率，及时调整优先级
4. **限流**: 注意各供应商的请求频率限制，避免被封禁
