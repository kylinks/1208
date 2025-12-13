# Google Ads API 服务账号配置指南

本系统使用Google服务账号方式访问Google Ads API，无需用户OAuth授权。

## 前置要求

1. Google Cloud项目
2. Google Ads开发者令牌（已批准）
3. Google服务账号及其凭证

## 配置步骤

### 1. 创建Google Cloud服务账号

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 选择或创建项目
3. 进入 **IAM & Admin** > **Service Accounts**
4. 点击 **CREATE SERVICE ACCOUNT**
5. 填写服务账号信息：
   - 名称：`google-ads-service-account`
   - 描述：`用于访问Google Ads API`
6. 点击 **CREATE AND CONTINUE**
7. 授予角色（可选，不需要特殊权限）
8. 点击 **DONE**

### 2. 创建服务账号密钥

1. 在服务账号列表中找到刚创建的账号
2. 点击账号进入详情页
3. 切换到 **KEYS** 标签
4. 点击 **ADD KEY** > **Create new key**
5. 选择 **JSON** 格式
6. 点击 **CREATE** 下载密钥文件

### 3. 启用Google Ads API

1. 在Google Cloud Console中进入 **APIs & Services** > **Library**
2. 搜索 "Google Ads API"
3. 点击进入并启用API

### 4. 在Google Ads中授权服务账号

**重要步骤：**

1. 登录 [Google Ads](https://ads.google.com/)
2. 进入MCC账号管理界面
3. 点击 **工具和设置** > **访问和安全** > **用户访问权限**
4. 点击 **+** 按钮添加用户
5. 输入服务账号邮箱地址（格式：`xxx@xxx.iam.gserviceaccount.com`）
6. 授予 **管理员** 权限
7. 点击 **发送邀请**

> ⚠️ 必须完成此步骤，否则会提示"未绑定服务账号"

### 5. 配置环境变量

在项目根目录的 `.env` 文件中添加以下配置：

```bash
# Google Ads 开发者令牌
GOOGLE_ADS_DEVELOPER_TOKEN="your-developer-token-here"

# 服务账号邮箱地址
GOOGLE_SERVICE_ACCOUNT_EMAIL="xxx@xxx.iam.gserviceaccount.com"

# 方式1：使用JSON文件路径（推荐）
GOOGLE_SERVICE_ACCOUNT_KEY_PATH="./config/service-account-key.json"

# 方式2：使用Base64编码的JSON内容（可选）
# GOOGLE_SERVICE_ACCOUNT_KEY="base64-encoded-json-content"
```

### 6. 放置服务账号密钥文件

如果使用文件路径方式：

1. 在项目根目录创建 `config` 文件夹
2. 将下载的JSON密钥文件放入 `config` 文件夹
3. 重命名为 `service-account-key.json`

```
项目根目录/
├── config/
│   └── service-account-key.json  ← 服务账号密钥文件
├── .env
└── ...
```

> ⚠️ 请确保 `config/` 文件夹已添加到 `.gitignore` 中，避免泄露密钥！

### 7. 安装依赖

```bash
npm install
```

## 使用方式

配置完成后，系统会自动使用服务账号认证：

1. 在MCC管理模块点击"添加MCC账号"
2. 输入MCC账号ID（格式：123-456-7890）
3. 点击"获取"按钮
4. 系统会自动使用服务账号验证权限并获取子账号列表

## 故障排查

### 错误：未绑定服务账号

**原因：** 服务账号未在Google Ads MCC账号中授权

**解决方案：**
1. 登录Google Ads MCC账号
2. 进入 **用户访问权限** 设置
3. 添加服务账号邮箱并授予管理员权限

### 错误：认证失败

**原因：** 服务账号凭证配置错误

**解决方案：**
1. 检查 `.env` 文件中的配置是否正确
2. 确认JSON密钥文件路径正确
3. 验证JSON密钥文件内容完整

### 错误：开发者令牌无效

**原因：** 开发者令牌未配置或未批准

**解决方案：**
1. 申请Google Ads API开发者令牌
2. 等待Google审批
3. 在 `.env` 中配置正确的令牌

## 安全建议

1. ✅ 将 `config/` 文件夹添加到 `.gitignore`
2. ✅ 不要在代码中硬编码密钥
3. ✅ 定期轮换服务账号密钥
4. ✅ 限制服务账号的权限范围
5. ✅ 使用环境变量管理敏感信息

## 参考文档

- [Google Ads API文档](https://developers.google.com/google-ads/api/docs/start)
- [服务账号文档](https://cloud.google.com/iam/docs/service-accounts)
- [Google Auth Library](https://github.com/googleapis/google-auth-library-nodejs)
