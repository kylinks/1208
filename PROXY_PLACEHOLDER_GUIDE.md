# 代理占位符使用指南

## 占位符功能说明

代理管理系统支持在用户名和密码中使用占位符，以实现动态生成认证信息。这对于需要根据国家代码和随机session进行IP去重的场景非常有用。

## 支持的占位符类型

### 1. 国家代码占位符

#### `{country}` - 小写国家代码
- **说明**: 自动替换为小写的国家代码
- **示例**: 
  - 模板: `user-region-{country}`
  - 请求澳大利亚代理: `user-region-au`
  - 请求英国代理: `user-region-gb`

#### `{COUNTRY}` - 大写国家代码
- **说明**: 自动替换为大写的国家代码
- **示例**:
  - 模板: `user-res-{COUNTRY}`
  - 请求澳大利亚代理: `user-res-AU`
  - 请求英国代理: `user-res-GB`

### 2. 随机Session占位符

#### `{session:N}` - N位随机数字
- **说明**: 生成N位随机数字，每次获取代理时都会生成新的随机值
- **用途**: 用于24小时IP去重，相同的session值在24小时内不会重复使用
- **示例**:
  - 模板: `user-session-{session:8}`
  - 生成结果: `user-session-37557770`
  - 再次生成: `user-session-89123456`

#### `{random:N}` - N位随机字母数字
- **说明**: 生成N位随机字母和数字组合
- **用途**: 适用于需要更复杂随机标识的场景
- **示例**:
  - 模板: `user-id-{random:10}`
  - 生成结果: `user-id-a3b9d2f8g1`
  - 再次生成: `user-id-k7m2p5n8q4`

## 实际使用案例

### 案例1: BrightData 代理配置

```javascript
{
  name: 'BrightData AU',
  proxyHost: 'brd.superproxy.io',
  proxyPort: 22225,
  username: 'brd-customer-{country}-session-{session:8}',
  password: 'your_password',
  supportedCountries: ['AU', 'US', 'GB']
}
```

**实际生成效果**:
- 请求澳大利亚代理:
  - username: `brd-customer-au-session-37557770`
  - 24小时内不会重复使用 `37557770` 这个session

### 案例2: 自定义Lsid配置

```javascript
{
  name: 'Custom Proxy',
  proxyHost: 'proxy.example.com',
  proxyPort: 8080,
  username: 'user-region-{COUNTRY}-Lsid-{session:9}',
  password: 'pass-{random:12}',
  supportedCountries: ['AU', 'GB', 'US']
}
```

**实际生成效果**:
- 请求澳大利亚代理:
  - username: `user-region-AU-Lsid-978668474`
  - password: `pass-a3k9m7n2p5q8`
- 请求英国代理:
  - username: `user-region-GB-Lsid-123456789`
  - password: `pass-b4l8n6m3r7s9`

### 案例3: 仅使用国家代码

```javascript
{
  name: 'Simple Proxy',
  proxyHost: 'simple.proxy.io',
  proxyPort: 7777,
  username: 'user-{country}',
  password: 'fixed_password'
}
```

**实际生成效果**:
- 请求美国代理: username = `user-us`
- 请求德国代理: username = `user-de`

### 案例4: 多个session组合

```javascript
{
  name: 'Complex Proxy',
  proxyHost: 'complex.proxy.io',
  proxyPort: 9000,
  username: '{country}-session-{session:8}-id-{session:6}',
  password: 'pass'
}
```

**实际生成效果**:
- username: `au-session-37557770-id-123456`
- 注意: 多个 `{session:N}` 会生成不同的随机值

## 24小时去重机制

### 工作原理

1. **Session生成**: 每次调用 `getAvailableProxy()` 时，系统会：
   - 替换用户名中的所有占位符
   - 提取第一个随机占位符的值作为 `sessionId`
   - 如果没有随机占位符，生成一个默认的8位随机数字

2. **去重检查**: 系统会检查这个 `sessionId` 是否在24小时内被同一广告系列使用过

3. **记录使用**: 使用代理后，调用 `recordProxyUsage()` 记录这个 `sessionId`

4. **自动清理**: 24小时后，旧的记录会自动清理

### 代码示例

```typescript
// 1. 获取代理
const proxy = await getAvailableProxy('AU', 'campaign-123')
/*
proxy = {
  host: 'brd.superproxy.io',
  port: 22225,
  username: 'brd-customer-au-session-37557770',
  password: 'your_password',
  countryCode: 'AU',
  providerId: 'xxx',
  providerName: 'BrightData',
  sessionId: '37557770' // 用于去重
}
*/

// 2. 使用代理进行请求
// ... 你的业务逻辑 ...

// 3. 记录使用
await recordProxyUsage(proxy, 'campaign-123')

// 4. 同一广告系列在24小时内再次获取澳大利亚代理
const proxy2 = await getAvailableProxy('AU', 'campaign-123')
// proxy2 会生成不同的 sessionId，如: 89123456
// 确保不会使用相同的代理配置
```

## API使用示例

### 获取带占位符的代理

```bash
# 请求API
curl "http://localhost:10111/api/proxy?countryCode=AU&campaignId=campaign-123"

# 响应
{
  "host": "brd.superproxy.io",
  "port": 22225,
  "username": "brd-customer-au-session-37557770",
  "password": "your_password",
  "countryCode": "AU",
  "providerId": "xxx",
  "providerName": "BrightData",
  "sessionId": "37557770"
}
```

### 记录使用

```bash
curl -X POST "http://localhost:10111/api/proxy/record" \
  -H "Content-Type: application/json" \
  -d '{
    "proxyConfig": {
      "host": "brd.superproxy.io",
      "port": 22225,
      "username": "brd-customer-au-session-37557770",
      "password": "your_password",
      "countryCode": "AU",
      "providerId": "xxx",
      "providerName": "BrightData",
      "sessionId": "37557770"
    },
    "campaignId": "campaign-123"
  }'
```

## 前端配置示例

在代理管理界面 (`/console/proxy`) 添加供应商时：

1. **供应商名称**: `BrightData Australia`

2. **代理服务器地址**: `brd.superproxy.io`

3. **代理服务器端口**: `22225`

4. **用户名**: `brd-customer-{country}-session-{session:8}`
   - 系统会显示占位符说明
   - 支持的占位符: `{country}`, `{COUNTRY}`, `{session:N}`

5. **密码**: `your_password`

6. **支持的国家**: 选择 `AU`, `US`, `GB`

7. **优先级**: `1`

## 常见问题

### Q: 如果不使用随机占位符会怎样？
A: 系统会自动生成一个8位随机数字作为默认的sessionId进行去重。

### Q: 可以在密码中使用占位符吗？
A: 可以，密码同样支持所有占位符类型。

### Q: session的长度有限制吗？
A: 建议使用6-12位，太短可能重复，太长没有必要。

### Q: 多个 `{session:N}` 会生成相同的值吗？
A: 不会，每个 `{session:N}` 都会生成独立的随机值。但只有第一个会被用作sessionId进行去重。

### Q: 24小时内用完所有可用代理怎么办？
A: 系统会返回404错误。建议：
1. 增加更多代理供应商
2. 调整监控频率
3. 增加支持的国家代码

## 技术实现

占位符替换由 `lib/proxyPlaceholder.ts` 实现：

```typescript
import { replacePlaceholders } from '@/lib/proxyPlaceholder'

const template = 'user-{country}-session-{session:8}'
const { result, sessionId } = replacePlaceholders(template, 'AU')

console.log(result)    // user-au-session-37557770
console.log(sessionId) // 37557770
```

## 最佳实践

1. **使用session占位符**: 对于需要24小时去重的场景，务必使用 `{session:N}`
2. **合理的长度**: session建议使用8-10位数字
3. **国家代码大小写**: 根据代理供应商的要求选择 `{country}` 或 `{COUNTRY}`
4. **测试配置**: 添加供应商后，使用"测试"按钮验证配置是否正确
5. **监控成功率**: 定期检查代理供应商的成功率，及时调整配置
