# MCC 配置问题排查指南

## 当前问题

验证 MCC 时出现错误：`MCC 账户不存在或无法访问`

## 🔍 排查步骤

### 1️⃣ 检查配置文件

已确认 ✅：
- GOOGLE_ADS_DEVELOPER_TOKEN: 已设置
- GOOGLE_SERVICE_ACCOUNT_KEY_PATH: 已设置
- 服务账号密钥文件: 存在且格式正确
- 服务账号邮箱: `kyads-758@glassy-rush-474806-n7.iam.gserviceaccount.com`

### 2️⃣ 检查 Google Ads 权限

**这是最可能的问题！** 服务账号需要在 Google Ads MCC 中被授权。

#### 操作步骤：

1. **登录 Google Ads**
   - 访问：https://ads.google.com
   - 使用有管理员权限的账号登录 MCC `968-646-8564`

2. **添加服务账号用户**
   ```
   工具和设置 🔧 
   → 设置 
   → 访问权限和安全 
   → 访问权限（用户）
   → 点击 "+" 添加用户
   ```

3. **填写信息**
   - **电子邮件地址**: `kyads-758@glassy-rush-474806-n7.iam.gserviceaccount.com`
   - **访问级别**: 选择 **"标准访问"** 或 **"管理员"**
   - **接收电子邮件提醒和通知**: 取消勾选（服务账号不需要）

4. **保存并等待**
   - 点击「发送邀请」
   - **重要**: 服务账号会自动获得访问权限，无需手动接受邀请
   - 等待 1-2 分钟让权限生效

### 3️⃣ 检查 Developer Token 状态

Developer Token 有两种状态：
- **测试模式** - 只能访问自己的账户
- **已批准** - 可以访问授权的所有账户

#### 检查步骤：

1. **访问 Google Ads API Center**
   - 登录：https://ads.google.com/aw/apicenter
   - 查看 Developer Token 状态

2. **如果是"测试模式"**
   - 在测试模式下，需要满足以下条件之一：
     - Developer Token 所属的账号就是 MCC `968-646-8564` 本身
     - 或者申请将 Token 升级为"生产环境"状态

3. **申请生产环境访问（如果需要）**
   - 填写 Google Ads API 访问申请表
   - 说明使用目的
   - 通常需要 1-2 个工作日审批

### 4️⃣ 检查 MCC ID 格式

确认 MCC ID `968-646-8564` 是否正确：
- ✅ 格式正确：`xxx-xxx-xxxx`
- ❓ 这个 MCC ID 真的存在吗？
- ❓ 你的账号有权访问这个 MCC 吗？

### 5️⃣ 检查 API 版本

当前使用的 API 版本：`v17`

如果需要更改版本，修改 `lib/googleAdsService.ts`：
```typescript
private apiVersion: string = 'v17'; // 改为 'v16' 或其他版本
```

最新版本查询：https://developers.google.com/google-ads/api/docs/release-notes

### 6️⃣ 查看详细错误日志

重启开发服务器后，查看控制台输出：

```bash
# 停止当前服务器 (Ctrl+C)
# 重新启动
npm run dev
```

然后在浏览器中重新尝试验证 MCC，查看终端输出的详细日志：

```
🔐 初始化 Google Ads 服务...
✅ Google Ads 服务初始化成功
📡 调用 Google Ads API: { url: '...', mccId: '...', hasToken: true }
📥 API 响应状态: { status: 404, statusText: 'Not Found', ok: false }
❌ Google Ads API 错误响应: { ... }
```

**关键信息**：
- `status`: HTTP 状态码
- `responseText`: 详细错误信息

### 7️⃣ 常见错误码含义

| 状态码 | 含义 | 解决方案 |
|--------|------|---------|
| 400 | 请求参数错误 | 检查 MCC ID 格式、GAQL 查询语法 |
| 401 | 认证失败 | 检查 Developer Token、访问令牌 |
| 403 | 权限不足 | 在 MCC 中添加服务账号 |
| 404 | MCC 不存在 | 确认 MCC ID 是否正确 |

### 8️⃣ 测试 API 连接

使用 curl 测试 Google Ads API 连接：

```bash
# 先获取访问令牌
node -e "
const { GoogleAuth } = require('google-auth-library');
(async () => {
  const auth = new GoogleAuth({
    keyFile: './config/service-account-key.json',
    scopes: ['https://www.googleapis.com/auth/adwords'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  console.log(token.token);
})();
"

# 使用获取的 token 测试 API（替换下面的 YOUR_TOKEN 和 YOUR_DEVELOPER_TOKEN）
curl -X POST \
  https://googleads.googleapis.com/v22/customers/9686468564/googleAds:search \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "developer-token: YOUR_DEVELOPER_TOKEN" \
  -H "login-customer-id: 9686468564" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT customer_client.id, customer_client.descriptive_name FROM customer_client WHERE customer_client.level <= 1"
  }'
```

## 📋 完整检查清单

在重新测试之前，确保：

- [ ] 服务账号 `kyads-758@glassy-rush-474806-n7.iam.gserviceaccount.com` 已在 Google Ads MCC 中添加
- [ ] 服务账号的访问级别为「标准访问」或「管理员」
- [ ] 等待至少 2 分钟让权限生效
- [ ] Developer Token 不是"测试模式"，或者 MCC 就是 Token 所属的账号
- [ ] MCC ID `968-646-8564` 确实存在且你有权访问
- [ ] 已重启开发服务器
- [ ] 查看了详细的错误日志

## 🔧 快速修复建议

**最可能的原因**: 服务账号未被授权访问 MCC

**解决方案**:
1. 在 Google Ads MCC 中添加服务账号（步骤 2️⃣）
2. 等待 2 分钟
3. 重启开发服务器
4. 重新测试

## 📞 需要更多帮助？

如果问题仍然存在，请提供以下信息：

1. **详细错误日志**（来自终端的完整输出）
2. **HTTP 状态码**（从日志中的 `API 响应状态` 获取）
3. **错误响应文本**（从日志中的 `错误响应` 获取）
4. **Developer Token 状态**（测试模式 or 已批准）
5. **是否已在 MCC 中添加服务账号**

## 📖 相关文档

- [Google Ads API 文档](https://developers.google.com/google-ads/api/docs/start)
- [服务账号认证](https://developers.google.com/google-ads/api/docs/oauth/service-accounts)
- [Developer Token 申请](https://developers.google.com/google-ads/api/docs/get-started/dev-token)
- [错误码参考](https://developers.google.com/google-ads/api/docs/errors)
