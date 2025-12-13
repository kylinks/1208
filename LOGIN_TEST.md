# 登录功能测试步骤

## 快速测试

### 1. 配置环境变量

创建 `.env` 文件（如果还没有）：

```bash
cp .env.example .env
```

确保包含以下配置：
```env
DATABASE_URL="mysql://root:password@localhost:3306/google_ads_system"
NEXTAUTH_SECRET="your-secret-key-here"
NEXTAUTH_URL="http://localhost:10111"
```

### 2. 初始化数据库

```bash
# 安装依赖
npm install

# 生成 Prisma Client
npm run db:generate

# 推送数据库结构
npm run db:push

# 创建测试账号
npm run db:seed
```

### 3. 测试登录功能

#### 测试1：未登录访问控制台
1. 访问 `http://localhost:10111/console`
2. ✅ 应该自动跳转到 `/login` 页面

#### 测试2：登录成功
1. 在登录页面输入：
   - 邮箱：`admin@example.com`
   - 密码：`admin123456`
2. 点击"登录"按钮
3. ✅ 应该显示"登录成功"提示
4. ✅ 自动跳转到控制台首页
5. ✅ 右上角显示用户信息（头像、姓名、角色）

#### 测试3：登录失败
1. 输入错误的邮箱或密码
2. 点击"登录"按钮
3. ✅ 应该显示"邮箱或密码错误"提示

#### 测试4：已登录访问控制台
1. 登录成功后，刷新页面
2. ✅ 应该保持登录状态
3. ✅ 可以正常访问控制台各个页面

#### 测试5：退出登录
1. 点击右上角用户头像
2. 点击"退出登录"
3. ✅ 应该显示"已退出登录"提示
4. ✅ 自动跳转到登录页面
5. ✅ 再次访问控制台会要求重新登录

#### 测试6：直接访问 API
1. 退出登录状态下
2. 直接访问 `http://localhost:10111/api/dashboard/stats`
3. ✅ 应该返回 401 未授权错误或重定向到登录页

#### 测试7：普通用户登录
1. 使用普通用户账号登录：
   - 邮箱：`user@example.com`
   - 密码：`user123456`
2. ✅ 登录成功
3. ✅ 显示"员工"角色

## 测试账号

| 邮箱 | 密码 | 角色 | 租户ID |
|------|------|------|--------|
| admin@example.com | admin123456 | 管理员 | default-tenant |
| user@example.com | user123456 | 员工 | tenant-001 |

## 预期行为

### ✅ 正常流程
1. 未登录访问任何 `/console/*` 页面 → 自动跳转到登录页
2. 登录成功 → 跳转回原访问页面或控制台首页
3. 登录状态下访问控制台 → 正常显示页面
4. 退出登录 → 跳转到登录页，session 清除

### ✅ 安全保护
1. 所有 `/console/*` 路由受保护
2. 所有 API 路由（除了 `/api/auth/*`）受保护
3. 密码使用 bcrypt 加密存储
4. Session 使用 JWT，存储在 HTTP-only Cookie
5. 30天后自动过期，需要重新登录

## 常见问题排查

### 问题1：提示 "NEXTAUTH_SECRET not set"
**解决**: 在 `.env` 文件中设置 `NEXTAUTH_SECRET`
```bash
NEXTAUTH_SECRET=$(openssl rand -base64 32)
```

### 问题2：数据库连接失败
**解决**: 检查 MySQL 是否运行，数据库是否已创建
```bash
mysql -u root -p
CREATE DATABASE google_ads_system;
```

### 问题3：登录后仍然跳转到登录页
**解决**: 清除浏览器 Cookie 和缓存，重新登录

### 问题4：页面显示 "loading..." 不消失
**解决**: 检查 console 是否有错误，确认 NextAuth API 正常运行

### 问题5：TypeScript 类型错误
**解决**: 确保 `/types/next-auth.d.ts` 文件存在，重启 TypeScript 服务器

## 调试技巧

### 查看 Session 信息
在任何 Client Component 中：
```typescript
import { useSession } from 'next-auth/react'

const { data: session } = useSession()
console.log('Session:', session)
```

### 查看中间件日志
在 `/middleware.ts` 中添加：
```typescript
console.log('Middleware:', req.nextUrl.pathname, token)
```

### 查看 API 响应
浏览器开发者工具 → Network → 查看 `/api/auth` 请求

## 下一步

登录功能已完成，可以继续开发：
1. 用户管理功能（创建、编辑、删除用户）
2. 角色权限细化
3. 密码找回功能
4. 多因素认证（MFA）
5. 登录日志记录
