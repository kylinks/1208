# MCC 配置 - 添加 MCC 账号验证功能 实现文档

> 本文档为完整实现指南，另一个 AI 编辑器可直接参考落地开发。

## 1. 功能概述

### 1.1 业务场景
- 用户输入 MCC ID（格式：`xxx-xxx-xxxx`，如 `968-646-8564`）
- 系统调用 Google Ads API 验证该 MCC 是否存在且服务账号有权限访问
- 验证成功后展示 MCC 名称、子账户（CID）统计信息
- 用户确认后将 MCC 信息保存到数据库
- 保存后自动同步该 MCC 下所有 CID 子账户到数据库

### 1.2 技术栈
- 前端：Next.js 14 App Router + Ant Design 5 + TypeScript
- 后端：Next.js Route Handlers
- 数据库：MySQL 8 + Prisma ORM
- Google Ads API：使用服务账号认证（Service Account）

## 2. 数据模型

### 2.1 MccAccount 表
```prisma
model MccAccount {
  id            Int       @id @default(autoincrement())
  userId        Int       @map("user_id")
  mccId         String    @map("mcc_id") @db.VarChar(50)        // 格式：xxx-xxx-xxxx
  mccName       String    @map("mcc_name") @db.VarChar(100)
  totalCids     Int       @default(0) @map("total_cids")        // 总 CID 数
  activeCids    Int       @default(0) @map("active_cids")       // 有效 CID 数
  suspendedCids Int       @default(0) @map("suspended_cids")    // 规避/暂停 CID 数
  lastSyncAt    DateTime? @map("last_sync_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  deletedAt     DateTime? @map("deleted_at")                    // 软删除

  user        User         @relation(fields: [userId], references: [id])
  cidAccounts CidAccount[]

  @@unique([userId, mccId, deletedAt])
  @@map("mcc_accounts")
}
```

### 2.2 CidAccount 表
```prisma
model CidAccount {
  id           Int       @id @default(autoincrement())
  mccId        Int       @map("mcc_id")                         // 关联 MccAccount.id
  cidId        String    @map("cid_id") @db.VarChar(50)         // Google Ads CID
  cidName      String    @map("cid_name") @db.VarChar(200)
  status       String    @default("active") @db.VarChar(20)     // active/suspended
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

## 3. API 设计

### 3.1 验证 MCC 账户
**POST /api/google-ads/mcc/verify**

请求：
```json
{ "mccId": "968-646-8564" }
```

成功响应（200）：
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

失败响应（400/500）：
```json
{
  "success": false,
  "error": "验证MCC访问权限失败，请确保服务账号已被授权访问该MCC"
}
```

### 3.2 获取 MCC 列表
**GET /api/mcc?userId=1**

响应：
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "mccId": "968-646-8564",
      "mccName": "My MCC Account",
      "totalCids": 10,
      "activeCids": 8,
      "suspendedCids": 2,
      "lastSyncAt": "2025-12-08T10:00:00.000Z",
      "createdAt": "2025-12-08T09:00:00.000Z"
    }
  ]
}
```

### 3.3 创建 MCC 账户
**POST /api/mcc**

请求：
```json
{
  "userId": 1,
  "mccId": "968-646-8564",
  "mccName": "My MCC Account",
  "skipVerify": true
}
```

响应：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "userId": 1,
    "mccId": "968-646-8564",
    "mccName": "My MCC Account",
    "totalCids": 0,
    "activeCids": 0,
    "suspendedCids": 0,
    "lastSyncAt": null,
    "createdAt": "2025-12-08T10:00:00.000Z"
  },
  "message": "MCC 账号添加成功"
}
```

### 3.4 同步 MCC 数据
**PUT /api/mcc/[id]**

请求：
```json
{ "sync": true }
```

响应：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "mccName": "My MCC Account",
    "totalCids": 10,
    "activeCids": 8,
    "suspendedCids": 2,
    "lastSyncAt": "2025-12-08T10:00:00.000Z",
    "syncedCidCount": 10
  },
  "message": "MCC 账号同步成功，已同步 10 个 CID 账户"
}
```

### 3.5 删除 MCC 账户（软删除）
**DELETE /api/mcc/[id]**

响应：
```json
{
  "success": true,
  "message": "MCC 账号删除成功，同时删除了 10 个关联的 CID 账户"
}
```

## 4. Google Ads API 集成

### 4.1 认证方式
使用 **服务账号（Service Account）** 认证：
- 需要服务账号密钥文件（JSON）
- 需要 Google Ads 开发者令牌（Developer Token）
- MCC 需要授权服务账号访问

### 4.2 环境变量
```env
GOOGLE_ADS_DEVELOPER_TOKEN=你的开发者令牌
GOOGLE_ADS_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json
```

### 4.3 核心服务类（googleAdsService.ts）

```typescript
import { GoogleAuth } from 'google-auth-library';

class GoogleAdsService {
  private developerToken: string;
  private serviceAccountKeyPath: string;
  private accessToken: string | null = null;
  private apiVersion: string = 'v22';

  /**
   * 初始化服务，获取访问令牌
   */
  async initialize(): Promise<void> {
    const auth = new GoogleAuth({
      keyFile: this.serviceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/adwords']
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    this.accessToken = tokenResponse.token;
  }

  /**
   * 格式化 MCC ID，移除破折号
   * @example "968-646-8564" -> "9686468564"
   */
  formatMccId(mccId: string): string {
    return mccId.replace(/-/g, '');
  }

  /**
   * 验证 MCC ID 格式
   */
  validateMccIdFormat(mccId: string): boolean {
    return /^\d{3}-\d{3}-\d{4}$/.test(mccId);
  }

  /**
   * 获取 MCC 子账户列表
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

    const response = await fetch(
      `https://googleads.googleapis.com/${this.apiVersion}/customers/${formattedMccId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'developer-token': this.developerToken,
          'login-customer-id': formattedMccId,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query })
      }
    );

    const data = await response.json();
    return this.processAccountsResponse(data.results || [], mccId);
  }

  /**
   * 验证 MCC 账户
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
      verifiedAt: new Date().toISOString()
    };
  }
}
```

### 4.4 API 响应处理
- `customer_client.manager = true`：表示是 MCC 账户本身
- `customer_client.manager = false`：表示是 CID 子账户
- `customer_client.status = 'ENABLED'` 或 `= 2`：表示账户有效（active）
- 其他状态：表示账户规避/暂停（suspended）

## 5. 前端实现

### 5.1 页面路径
`src/app/(admin)/mcc/page.tsx`

### 5.2 核心组件结构
```
MccPage
├── 页面标题
├── 统计卡片（4个）
│   ├── MCC 账号总数
│   ├── 所有 CID 总数
│   ├── 有效 CID 总数
│   └── 规避 CID 总数
├── MCC 列表表格
│   ├── 序号
│   ├── MCC 账号 ID
│   ├── MCC 账号名称
│   ├── 所有/有效/规避 CID
│   ├── 最后同步时间
│   ├── 添加时间
│   └── 操作（同步/删除）
└── 添加 MCC 弹窗
    ├── MCC ID 输入框 + 验证按钮
    ├── 验证中状态
    ├── 验证错误提示
    ├── 验证成功展示
    └── 确认添加按钮
```

### 5.3 状态管理
```typescript
// 列表数据
const [data, setData] = useState<MccAccount[]>([]);
const [loading, setLoading] = useState(false);

// 弹窗
const [modalVisible, setModalVisible] = useState(false);
const [form] = Form.useForm();

// 验证状态
const [verifying, setVerifying] = useState(false);
const [verifyResult, setVerifyResult] = useState<MccVerifyResult | null>(null);
const [verifyError, setVerifyError] = useState<string | null>(null);

// 同步状态
const [syncingId, setSyncingId] = useState<number | null>(null);
```

### 5.4 验证流程
1. 用户输入 MCC ID
2. 点击「验证」按钮
3. 前端校验格式（`/^\d{3}-\d{3}-\d{4}$/`）
4. 检查是否已添加过
5. 调用 `/api/google-ads/mcc/verify` 验证
6. 成功：展示 MCC 信息；失败：展示错误提示
7. 用户点击「确认添加」
8. 调用 `/api/mcc` 创建记录（`skipVerify: true`）
9. 自动调用 `/api/mcc/[id]` 同步 CID 数据

### 5.5 关键 UI 组件
```tsx
// MCC ID 输入框 + 验证按钮
<Form.Item
  name="mccId"
  label="MCC 账号 ID"
  rules={[
    { required: true, message: '请输入 MCC 账号 ID' },
    { pattern: /^\d{3}-\d{3}-\d{4}$/, message: '请输入正确的 MCC ID 格式' },
  ]}
>
  <Input.Search
    placeholder="请输入 MCC 账号 ID，格式：968-646-8564"
    enterButton={<Button type="primary" icon={<SearchOutlined />}>验证</Button>}
    onSearch={handleVerify}
    loading={verifying}
    onChange={() => {
      setVerifyResult(null);
      setVerifyError(null);
    }}
  />
</Form.Item>

// 验证成功展示
{verifyResult && (
  <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
    <CheckCircleOutlined style={{ color: '#52c41a' }} />
    <Text strong style={{ color: '#52c41a' }}>验证成功</Text>
    <Descriptions column={1} size="small">
      <Descriptions.Item label="MCC 账号名称">{verifyResult.mccName}</Descriptions.Item>
      <Descriptions.Item label="MCC 账号 ID">{verifyResult.mccId}</Descriptions.Item>
    </Descriptions>
    <Row gutter={16}>
      <Col span={8}><Statistic title="所有 CID" value={verifyResult.totalCids} /></Col>
      <Col span={8}><Statistic title="有效 CID" value={verifyResult.activeCids} /></Col>
      <Col span={8}><Statistic title="规避 CID" value={verifyResult.suspendedCids} /></Col>
    </Row>
  </Card>
)}
```

## 6. 完整文件清单

| 文件路径 | 说明 |
|---------|------|
| `src/app/api/mcc/route.ts` | MCC 列表/创建 API |
| `src/app/api/mcc/[id]/route.ts` | MCC 详情/更新/删除 API |
| `src/app/api/google-ads/mcc/verify/route.ts` | MCC 验证 API |
| `src/lib/googleAdsService.ts` | Google Ads 服务封装 |
| `src/app/(admin)/mcc/page.tsx` | MCC 配置页面 |
| `prisma/schema.prisma` | 数据模型定义 |

## 7. 错误处理

### 7.1 常见错误
| 错误类型 | 错误信息 | 处理方式 |
|---------|---------|---------|
| 格式错误 | MCC ID 格式无效 | 前端校验提示 |
| 权限错误 | 验证MCC访问权限失败 | 提示授权服务账号 |
| 不存在 | MCC 账户不存在或无法访问 | 提示检查 MCC ID |
| 重复添加 | 该 MCC 账号已存在 | 前端检查/后端唯一约束 |
| 网络错误 | 请求超时/网络异常 | 提示重试 |

### 7.2 软删除处理
- 删除 MCC 时同时软删除所有关联 CID（事务）
- 唯一约束包含 `deletedAt`，允许软删后重新添加

## 8. 测试要点

- [ ] MCC ID 格式校验（必须是 xxx-xxx-xxxx）
- [ ] 验证成功后正确显示 MCC 信息和 CID 统计
- [ ] 验证失败显示正确错误提示
- [ ] 添加成功后自动同步 CID 数据
- [ ] 重复添加提示已存在
- [ ] 同步功能正常更新 CID 数据
- [ ] 删除功能同时删除关联 CID
- [ ] 软删除后可重新添加同一 MCC

## 9. 依赖包

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "antd": "^5.0.0",
    "@ant-design/icons": "^5.0.0",
    "@prisma/client": "^5.0.0",
    "google-auth-library": "^9.0.0",
    "node-fetch": "^3.0.0"
  },
  "devDependencies": {
    "prisma": "^5.0.0",
    "typescript": "^5.0.0"
  }
}
```
