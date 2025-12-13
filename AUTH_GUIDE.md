# 登录认证系统使用指南

## 功能概述

系统已实现完整的基于邮箱和密码的登录认证功能，包括：

- ✅ 邮箱密码登录
- ✅ Session 管理（30天有效期）
- ✅ 控制台访问权限保护
- ✅ API 路由保护
- ✅ 用户信息显示
- ✅ 安全退出登录

## 测试账号

系统提供了两个测试账号（运行 `npm run db:seed` 后自动创建）：

### 管理员账号
- **邮箱**: admin@example.com
- **密码**: admin123456
- **权限**: 可查看全部租户数据

### 普通员工账号
- **邮箱**: user@example.com
- **密码**: user123456
- **权限**: 仅查看自己的数据

## 使用步骤

### 1. 配置环境变量

确保 `.env` 文件包含以下配置：

```env
# NextAuth 配置
NEXTAUTH_SECRET="your-nextauth-secret-here-change-in-production"
NEXTAUTH_URL="http://localhost:10111"

# 数据库配置
DATABASE_URL="mysql://root:password@localhost:3306/google_ads_system"
```

生成 NEXTAUTH_SECRET：
```bash
openssl rand -base64 32
```

### 2. 初始化数据库

```bash
# 生成 Prisma Client
npm run db:generate

# 推送数据库结构
npm run db:push

# 创建测试账号和初始数据
npm run db:seed
```

### 3. 启动开发服务器

```bash
npm run dev
```

### 4. 访问登录页面

访问任意控制台页面（如 `http://localhost:10111/console`），系统会自动重定向到登录页面。

或直接访问：`http://localhost:10111/login`

## 受保护的路由

以下路由需要登录后才能访问：

### 前端页面
- `/console` - 控制台首页
- `/console/*` - 所有控制台子页面

### API 路由
- `/api/affiliate-configs/*` - 联盟配置 API
- `/api/dashboard/*` - 仪表板 API
- `/api/mcc-accounts/*` - MCC 账号 API
- `/api/monitoring-logs/*` - 监控日志 API
- `/api/proxy-providers/*` - 代理供应商 API
- `/api/system-config/*` - 系统配置 API

## 功能说明

### 登录页面
- 输入邮箱和密码
- 支持表单验证
- 登录成功后自动跳转到目标页面
- 登录失败显示错误提示

### 控制台界面
- 右上角显示用户信息（姓名、邮箱、角色）
- 用户头像下拉菜单
- 点击"退出登录"安全退出系统

### 中间件保护
- 未登录用户访问受保护页面自动跳转到登录页
- 登录后自动返回原访问页面
- Token 过期自动要求重新登录

## 在代码中使用认证

### Client Component

```typescript
'use client'

import { useSession } from 'next-auth/react'

export default function MyComponent() {
  const { data: session, status } = useSession()
  
  if (status === 'loading') {
    return <div>加载中...</div>
  }
  
  if (!session) {
    return <div>请先登录</div>
  }
  
  return (
    <div>
      <p>欢迎，{session.user.name}</p>
      <p>角色：{session.user.role}</p>
      <p>租户ID：{session.user.tenantId}</p>
    </div>
  )
}
```

### Server Component

```typescript
import { getCurrentUser, isAuthenticated, isAdmin } from '@/lib/auth-utils'

export default async function MyPage() {
  const user = await getCurrentUser()
  const authenticated = await isAuthenticated()
  const admin = await isAdmin()
  
  if (!authenticated) {
    return <div>未登录</div>
  }
  
  return (
    <div>
      <p>用户：{user?.name}</p>
      <p>是否管理员：{admin ? '是' : '否'}</p>
    </div>
  )
}
```

### API Route

```typescript
import { getSession } from '@/lib/auth-utils'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const session = await getSession()
  
  if (!session) {
    return NextResponse.json(
      { error: '未登录' },
      { status: 401 }
    )
  }
  
  // 根据用户角色和租户ID过滤数据
  const userId = session.user.id
  const tenantId = session.user.tenantId
  const isAdmin = session.user.role === 'admin'
  
  // 业务逻辑...
  
  return NextResponse.json({ success: true })
}
```

## 安全说明

1. **密码加密**: 使用 bcryptjs 加密存储，不存储明文密码
2. **Session 管理**: 使用 JWT token，存储在 HTTP-only Cookie 中
3. **CSRF 保护**: NextAuth 自动提供 CSRF 保护
4. **Token 过期**: 默认 30 天自动过期
5. **环境变量**: 敏感信息存储在环境变量中

## 常见问题

### Q: 如何创建新用户？
A: 目前需要通过数据库或 seed 脚本创建。后续可以添加用户注册页面。

### Q: 如何修改 Session 过期时间？
A: 在 `/lib/auth.ts` 中修改 `session.maxAge` 配置。

### Q: 如何实现"记住我"功能？
A: 可以在登录表单添加复选框，根据选择设置不同的 Session 过期时间。

### Q: 如何添加更多登录方式（如 Google OAuth）？
A: 在 `/lib/auth.ts` 的 `providers` 数组中添加其他 provider。

### Q: 密码忘记了怎么办？
A: 目前需要管理员通过数据库重置。后续可以添加找回密码功能。

## 相关文件

- `/lib/auth.ts` - NextAuth 配置
- `/lib/auth-utils.ts` - 认证工具函数
- `/app/api/auth/[...nextauth]/route.ts` - NextAuth API 路由
- `/app/login/page.tsx` - 登录页面
- `/middleware.ts` - 路由保护中间件
- `/types/next-auth.d.ts` - TypeScript 类型定义
- `/components/providers/session-provider.tsx` - Session Provider 组件
