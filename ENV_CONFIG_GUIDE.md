# 环境变量配置指南

## ✅ 已完成

1. ✅ 创建了 `config/` 文件夹
2. ✅ 移动了 `service-account-key.json` 到 `config/` 文件夹

## 📋 需要配置 .env 文件

请在 `.env` 文件中添加以下配置：

```bash
# ============================================
# Google Ads API 配置
# ============================================

# Google Ads 开发者令牌（必填）
GOOGLE_ADS_DEVELOPER_TOKEN="你的开发者令牌"

# ============================================
# Google 服务账号配置
# ============================================

# 服务账号邮箱地址（可选，用于日志记录）
GOOGLE_SERVICE_ACCOUNT_EMAIL="你的服务账号@项目ID.iam.gserviceaccount.com"

# 服务账号私钥文件路径（必填）
GOOGLE_SERVICE_ACCOUNT_KEY_PATH="./config/service-account-key.json"
```

## 📝 配置步骤

### 1. 打开 .env 文件

```bash
# 在项目根目录
open .env
# 或使用编辑器打开
```

### 2. 添加开发者令牌

从 Google Ads 管理界面获取开发者令牌：
- 登录 [Google Ads](https://ads.google.com/)
- 点击 **工具和设置** > **设置** > **API中心**
- 复制开发者令牌

### 3. 添加服务账号邮箱（可选）

从 `config/service-account-key.json` 文件中找到 `client_email` 字段的值。

### 4. 添加密钥文件路径

```bash
GOOGLE_SERVICE_ACCOUNT_KEY_PATH="./config/service-account-key.json"
```

## 🔐 在 Google Ads 中授权服务账号

**重要：** 必须在 Google Ads MCC 账号中授权服务账号，否则会提示"未绑定服务账号"。

### 步骤：

1. 登录 [Google Ads](https://ads.google.com/)
2. 进入 MCC 账号（968-646-8564）
3. 点击 **工具和设置** ⚙️
4. 选择 **访问和安全** > **用户访问权限**
5. 点击 **+** 按钮添加用户
6. 输入服务账号邮箱（`client_email` 的值）
7. 选择访问级别：**管理员（标准访问权限）**
8. 点击 **发送邀请**

## ✅ 验证配置

配置完成后，刷新页面并重新点击"获取"按钮测试。

### 预期结果：

- ✅ **成功**：显示 MCC 账号信息和子账号列表
- ❌ **失败 - 未绑定服务账号**：需要在 Google Ads 中完成授权步骤
- ❌ **失败 - 认证失败**：检查服务账号配置是否正确

## 🔍 故障排查

### 错误：未配置 Google Ads API 凭据或服务账号

**检查项：**
- [ ] `.env` 文件中是否配置了 `GOOGLE_ADS_DEVELOPER_TOKEN`
- [ ] `.env` 文件中是否配置了 `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`
- [ ] `config/service-account-key.json` 文件是否存在
- [ ] JSON 文件内容是否完整

### 错误：未绑定服务账号

**检查项：**
- [ ] 是否在 Google Ads MCC 账号中添加了服务账号邮箱
- [ ] 是否授予了管理员权限
- [ ] 邮箱地址是否正确（从 JSON 文件的 `client_email` 字段获取）

## 📚 参考文档

详细配置说明请查看：`SERVICE_ACCOUNT_SETUP.md`
