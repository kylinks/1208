# MCC 配置 - 添加 MCC 账号验证功能 AI 提示词

> 复制以下提示词给 AI 编辑器，可完整实现 MCC 配置功能。

---

## 提示词

```
请帮我实现 Google Ads MCC 配置功能，包括添加 MCC 账号和验证功能。

## 技术栈
- Next.js 14 App Router + TypeScript
- Ant Design 5 组件库
- Prisma ORM + MySQL 8
- Google Ads API（服务账号认证）

## 功能需求

### 1. MCC 验证功能
用户输入 MCC ID（格式：xxx-xxx-xxxx，如 968-646-8564），系统调用 Google Ads API 验证：
- 验证 MCC 是否存在且服务账号有权限访问
- 获取 MCC 名称
- 获取子账户（CID）统计：总数、有效数、规避数
- 验证成功后展示信息，用户确认添加

### 2. MCC 管理功能
- 列表展示所有 MCC 账号
- 添加 MCC（先验证再添加）
- 同步 CID 数据（从 Google Ads 获取最新数据）
- 软删除 MCC（同时删除关联 CID）

## 数据模型（Prisma）

```prisma
model MccAccount {
  id            Int       @id @default(autoincrement())
  userId        Int       @map("user_id")
  mccId         String    @map("mcc_id") @db.VarChar(50)
  mccName       String    @map("mcc_name") @db.VarChar(100)
  totalCids     Int       @default(0) @map("total_cids")
  activeCids    Int       @default(0) @map("active_cids")
  suspendedCids Int       @default(0) @map("suspended_cids")
  lastSyncAt    DateTime? @map("last_sync_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  deletedAt     DateTime? @map("deleted_at")

  user        User         @relation(fields: [userId], references: [id])
  cidAccounts CidAccount[]

  @@unique([userId, mccId, deletedAt])
  @@map("mcc_accounts")
}

model CidAccount {
  id           Int       @id @default(autoincrement())
  mccId        Int       @map("mcc_id")
  cidId        String    @map("cid_id") @db.VarChar(50)
  cidName      String    @map("cid_name") @db.VarChar(200)
  status       String    @default("active") @db.VarChar(20)
  currencyCode String?   @map("currency_code") @db.VarChar(10)
  timezone     String?   @db.VarChar(50)
  lastSyncAt   DateTime? @map("last_sync_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")
  deletedAt    DateTime? @map("deleted_at")

  mccAccount MccAccount @relation(fields: [mccId], references: [id])

  @@unique([mccId, cidId, deletedAt])
  @@map("cid_accounts")
}
```

## API 设计

### POST /api/google-ads/mcc/verify
验证 MCC 账户，调用 Google Ads API。

请求：
```json
{ "mccId": "968-646-8564" }
```

成功响应：
```json
{
  "success": true,
  "data": {
    "mccId": "968-646-8564",
    "mccName": "My MCC Account",
    "totalCids": 10,
    "activeCids": 8,
    "suspendedCids": 2,
    "verified": true,
    "verifiedAt": "2025-12-08T10:00:00.000Z"
  }
}
```

### GET /api/mcc
获取 MCC 列表。

### POST /api/mcc
创建 MCC 账号。
请求：`{ userId, mccId, mccName, skipVerify? }`

### PUT /api/mcc/[id]
更新/同步 MCC。
请求：`{ sync: true }` 触发同步 CID 数据。

### DELETE /api/mcc/[id]
软删除 MCC（事务中同时软删除关联 CID）。

## Google Ads API 集成

### 认证方式
使用服务账号认证，需要：
- 服务账号密钥文件（JSON）
- Google Ads 开发者令牌

### 环境变量
```env
GOOGLE_ADS_DEVELOPER_TOKEN=开发者令牌
GOOGLE_ADS_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json
```

### 核心 GAQL 查询
```sql
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
```

### API 调用
```typescript
const response = await fetch(
  `https://googleads.googleapis.com/v22/customers/${formattedMccId}/googleAds:search`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'login-customer-id': formattedMccId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  }
);
```

### 响应处理
- `customer_client.manager = true`：MCC 账户本身，获取名称
- `customer_client.manager = false`：CID 子账户
- `status = 'ENABLED'` 或 `= 2`：有效账户
- 其他状态：规避/暂停账户

## 前端实现

### 页面路径
`src/app/(admin)/mcc/page.tsx`

### 页面结构
1. 页面标题和说明
2. 统计卡片（4个）：MCC总数、所有CID、有效CID、规避CID
3. MCC 列表表格
4. 添加 MCC 弹窗

### 添加弹窗流程
1. 输入 MCC ID（格式校验：xxx-xxx-xxxx）
2. 点击「验证」调用验证 API
3. 验证成功展示 MCC 信息和 CID 统计
4. 点击「确认添加」保存到数据库
5. 自动同步 CID 数据

### 关键组件
```tsx
<Form.Item
  name="mccId"
  label="MCC 账号 ID"
  rules={[
    { required: true, message: '请输入 MCC 账号 ID' },
    { pattern: /^\d{3}-\d{3}-\d{4}$/, message: '格式：xxx-xxx-xxxx' },
  ]}
>
  <Input.Search
    placeholder="格式：968-646-8564"
    enterButton="验证"
    onSearch={handleVerify}
    loading={verifying}
  />
</Form.Item>

{/* 验证成功展示 */}
{verifyResult && (
  <Card style={{ background: '#f6ffed' }}>
    <CheckCircleOutlined /> 验证成功
    <Descriptions>
      <Descriptions.Item label="MCC 名称">{verifyResult.mccName}</Descriptions.Item>
    </Descriptions>
    <Row>
      <Col><Statistic title="所有 CID" value={verifyResult.totalCids} /></Col>
      <Col><Statistic title="有效 CID" value={verifyResult.activeCids} /></Col>
      <Col><Statistic title="规避 CID" value={verifyResult.suspendedCids} /></Col>
    </Row>
  </Card>
)}
```

### 表格列
- 序号
- MCC 账号 ID（代码样式）
- MCC 账号名称
- 所有 CID（蓝色 Tag）
- 有效 CID（绿色 Tag）
- 规避 CID（橙色 Tag）
- 最后同步时间
- 添加时间
- 操作：同步、删除

## 文件结构
```
src/
├── app/
│   ├── api/
│   │   ├── mcc/
│   │   │   ├── route.ts          # GET 列表、POST 创建
│   │   │   └── [id]/
│   │   │       └── route.ts      # GET 详情、PUT 更新、DELETE 删除
│   │   └── google-ads/
│   │       └── mcc/
│   │           └── verify/
│   │               └── route.ts  # POST 验证
│   └── (admin)/
│       └── mcc/
│           └── page.tsx          # 前端页面
└── lib/
    ├── prisma.ts                 # Prisma 客户端
    └── googleAdsService.ts       # Google Ads 服务封装
```

## 错误处理
- 格式错误：MCC ID 格式无效，正确格式为：xxx-xxx-xxxx
- 权限错误：验证MCC访问权限失败，请确保服务账号已被授权访问该MCC
- 不存在：MCC 账户不存在或无法访问
- 重复添加：该 MCC 账号已存在

## 注意事项
1. MCC ID 需要移除破折号后调用 API（968-646-8564 → 9686468564）
2. 软删除：所有删除操作设置 deletedAt，查询时过滤 deletedAt = null
3. 唯一约束包含 deletedAt，允许软删后重新添加
4. 删除 MCC 时使用事务同时软删除所有关联 CID
5. 同步时对比现有 CID：存在则更新，不存在则创建，API 中不存在的则软删除
6. 使用 JSDoc 注释所有函数和接口

请按照以上规范实现完整功能，包括后端 API、Google Ads 服务、前端页面。
```

---

## 使用说明

1. 将上面「提示词」部分的内容完整复制
2. 粘贴给另一个 AI 编辑器
3. AI 将根据提示词生成完整代码
4. 如需分步实现，可以拆分为：
   - 第一步：实现 Google Ads 服务（googleAdsService.ts）
   - 第二步：实现后端 API（route.ts）
   - 第三步：实现前端页面（page.tsx）

## 补充提示词（按需使用）

### 只实现 Google Ads 服务
```
请只实现 src/lib/googleAdsService.ts，包含：
1. 服务账号认证初始化
2. 获取访问令牌（自动刷新）
3. 验证 MCC 账户方法
4. 获取 MCC 子账户列表方法
5. 完整的 TypeScript 类型定义
6. JSDoc 注释
```

### 只实现后端 API
```
请只实现 MCC 相关的 API 路由：
1. /api/google-ads/mcc/verify - 验证 MCC
2. /api/mcc - GET 列表、POST 创建
3. /api/mcc/[id] - GET 详情、PUT 更新/同步、DELETE 软删除

使用已有的 googleAdsService 和 prisma 客户端。
```

### 只实现前端页面
```
请只实现 src/app/(admin)/mcc/page.tsx 前端页面：
1. 使用 Ant Design 5 组件
2. 统计卡片展示
3. MCC 列表表格（支持同步、删除操作）
4. 添加弹窗（输入验证、展示结果、确认添加）
5. 完整的状态管理和错误处理

调用已有的 /api/mcc 和 /api/google-ads/mcc/verify 接口。
```
