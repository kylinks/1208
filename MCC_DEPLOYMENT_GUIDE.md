# MCC 配置功能部署指南

## 功能概述

已成功实现 Google Ads MCC 配置功能，包括：
- ✅ MCC 账号验证（基于服务账号认证）
- ✅ MCC 账号管理（添加、同步、删除）
- ✅ CID 子账户自动同步
- ✅ 统计数据展示

## 已实现的文件

### 1. 数据模型
- **文件**: `prisma/schema.prisma`
- **修改**: 为 `MccAccount` 模型添加 `totalCids`、`activeCids`、`suspendedCids` 字段

### 2. 后端服务
- **文件**: `lib/googleAdsService.ts`
- **功能**: 
  - Google Ads API 服务封装
  - 服务账号认证
  - MCC 验证
  - CID 账户数据获取

### 3. API 路由

#### MCC 验证 API
- **路径**: `POST /api/google-ads/mcc/verify`
- **文件**: `app/api/google-ads/mcc/verify/route.ts`
- **功能**: 验证 MCC 账号是否存在且有权限访问

#### MCC 列表和创建 API
- **路径**: 
  - `GET /api/mcc` - 获取 MCC 列表
  - `POST /api/mcc` - 创建 MCC 账号
- **文件**: `app/api/mcc/route.ts`

#### MCC 详情、更新和删除 API
- **路径**:
  - `GET /api/mcc/[id]` - 获取 MCC 详情
  - `PUT /api/mcc/[id]` - 更新/同步 MCC
  - `DELETE /api/mcc/[id]` - 删除 MCC（软删除）
- **文件**: `app/api/mcc/[id]/route.ts`

### 4. 前端页面
- **路径**: `/console/mcc`
- **文件**: `app/(console)/console/mcc/page.tsx`
- **功能**:
  - 统计卡片展示（MCC 总数、所有 CID、有效 CID、规避 CID）
  - MCC 列表表格
  - 添加 MCC 弹窗（验证 + 确认添加）
  - 同步和删除操作

## 部署步骤

### 1. 配置环境变量

在 `.env` 文件中添加以下配置：

```env
# Google Ads API 配置
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token

# Google 服务账号配置
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./config/service-account-key.json
```

### 2. 准备服务账号密钥文件

1. 在 Google Cloud Console 创建服务账号
2. 下载服务账号 JSON 密钥文件
3. 将文件保存到项目根目录（如 `./config/service-account-key.json`）
4. 在 Google Ads MCC 中添加服务账号邮箱并授权

### 3. 更新数据库

运行数据库迁移：

```bash
# 方式 1: 使用 Prisma Migrate（推荐用于生产环境）
npm run db:migrate

# 方式 2: 使用 Prisma Push（适用于开发环境）
npm run db:push
```

### 4. 重新生成 Prisma Client

```bash
npm run db:generate
```

### 5. 启动开发服务器

```bash
npm run dev
```

访问: `http://localhost:10111/console/mcc`

## 使用说明

### 添加 MCC 账号

1. 点击「添加 MCC 账号」按钮
2. 输入 MCC ID（格式：xxx-xxx-xxxx，如 968-646-8564）
3. 点击「验证」按钮
4. 系统调用 Google Ads API 验证并显示：
   - MCC 账号名称
   - 所有 CID 数量
   - 有效 CID 数量
   - 规避 CID 数量
5. 确认信息无误后，点击「确认添加」
6. 系统自动同步 CID 子账户数据到数据库

### 同步 MCC 数据

- 点击表格中的「同步」按钮
- 系统从 Google Ads API 获取最新数据
- 更新 MCC 统计信息
- 同步所有 CID 子账户（新增、更新、软删除）

### 删除 MCC 账号

- 点击表格中的「删除」按钮
- 确认删除操作
- 系统执行软删除（同时软删除所有关联的 CID 账户）

## API 接口文档

### 1. 验证 MCC 账户

**请求:**
```http
POST /api/google-ads/mcc/verify
Content-Type: application/json

{
  "mccId": "968-646-8564"
}
```

**成功响应:**
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
    "verifiedAt": "2025-12-10T12:00:00.000Z"
  }
}
```

### 2. 获取 MCC 列表

**请求:**
```http
GET /api/mcc
```

**响应:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "mccId": "968-646-8564",
      "name": "My MCC Account",
      "totalCids": 10,
      "activeCids": 8,
      "suspendedCids": 2,
      "lastSyncAt": "2025-12-10T12:00:00.000Z",
      "createdAt": "2025-12-10T10:00:00.000Z"
    }
  ]
}
```

### 3. 创建 MCC 账号

**请求:**
```http
POST /api/mcc
Content-Type: application/json

{
  "mccId": "968-646-8564",
  "mccName": "My MCC Account",
  "skipVerify": true
}
```

### 4. 同步 MCC

**请求:**
```http
PUT /api/mcc/{id}
Content-Type: application/json

{
  "sync": true
}
```

### 5. 删除 MCC

**请求:**
```http
DELETE /api/mcc/{id}
```

## 错误处理

### 常见错误

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| MCC ID 格式无效 | 格式不正确 | 确保格式为 xxx-xxx-xxxx |
| 验证MCC访问权限失败 | 服务账号未被授权 | 在 Google Ads MCC 中添加服务账号 |
| MCC 账户不存在或无法访问 | MCC ID 错误或无权限 | 检查 MCC ID 和权限配置 |
| 该 MCC 账号已存在 | 重复添加 | 使用同步功能更新数据 |

## 技术特性

### 软删除机制

- 所有删除操作使用软删除（设置 `deletedAt` 字段）
- 删除 MCC 时自动软删除所有关联的 CID
- 软删除后可重新添加同一 MCC

### 数据同步机制

- 对比现有 CID 和 API 返回的 CID
- 存在的 CID：更新数据
- 不存在的 CID：创建新记录
- API 中不存在的 CID：软删除

### 认证方式

- 使用 Google 服务账号认证
- 自动管理访问令牌刷新
- 支持多租户隔离

## 数据库表结构

### MccAccount 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| userId | String | 用户 ID |
| mccId | String | MCC 账号 ID |
| name | String | MCC 账号名称 |
| authStatus | Enum | 授权状态 |
| totalCids | Int | 总 CID 数量 |
| activeCids | Int | 有效 CID 数量 |
| suspendedCids | Int | 规避 CID 数量 |
| lastSyncAt | DateTime? | 最后同步时间 |
| deletedAt | DateTime? | 软删除时间 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

### CidAccount 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| userId | String | 用户 ID |
| mccAccountId | String | MCC 账号 ID |
| cid | String | CID 账号 ID |
| name | String | CID 账号名称 |
| status | Enum | 账号状态（active/suspended） |
| currency | String? | 货币代码 |
| timezone | String? | 时区 |
| lastSyncAt | DateTime? | 最后同步时间 |
| deletedAt | DateTime? | 软删除时间 |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

## 注意事项

1. **服务账号配置**: 确保服务账号已在 Google Ads MCC 中被授权
2. **API 限制**: Google Ads API 有调用频率限制，避免频繁同步
3. **数据一致性**: 同步操作使用事务确保数据一致性
4. **权限管理**: API 已集成 NextAuth 认证，确保用户已登录
5. **错误日志**: 所有错误都会记录到控制台，便于调试

## 下一步优化建议

1. **批量同步**: 支持批量同步多个 MCC
2. **定时同步**: 使用 Cron 定时自动同步 MCC 数据
3. **同步历史**: 记录每次同步的详细历史
4. **CID 详情**: 添加 CID 账户详情页面
5. **权限细化**: 实现基于角色的权限控制

## 故障排查

### 问题：验证失败

**检查清单:**
- [ ] 环境变量是否正确配置
- [ ] 服务账号密钥文件路径是否正确
- [ ] 服务账号是否在 Google Ads MCC 中被授权
- [ ] Google Ads Developer Token 是否有效

### 问题：无法获取 CID 数据

**检查清单:**
- [ ] MCC ID 格式是否正确（xxx-xxx-xxxx）
- [ ] 服务账号是否有访问权限
- [ ] Google Ads API 是否正常运行
- [ ] 网络连接是否正常

## 联系支持

如有问题，请查看：
- Google Ads API 文档: https://developers.google.com/google-ads/api/docs
- Prisma 文档: https://www.prisma.io/docs
- Next.js 文档: https://nextjs.org/docs
