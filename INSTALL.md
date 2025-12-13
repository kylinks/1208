# Google Ads 联盟链接自动更换系统 - 安装指南

## 前置要求

- Node.js >= 18.0.0
- MySQL 8.0+
- npm 或 pnpm

## 安装步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 配置数据库

复制环境变量文件:

```bash
cp .env.example .env
```

编辑 `.env` 文件,配置数据库连接:

```env
DATABASE_URL="mysql://用户名:密码@localhost:3306/数据库名"
SHADOW_DATABASE_URL="mysql://用户名:密码@localhost:3306/数据库名_shadow"
```

### 3. 初始化数据库

生成 Prisma Client:

```bash
npm run db:generate
```

推送数据库结构:

```bash
npm run db:push
```

或者使用迁移(推荐用于生产环境):

```bash
npm run db:migrate
```

### 4. 运行种子数据(可选)

如果需要初始测试数据:

```bash
npm run db:seed
```

### 5. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:10111

## 生产部署

### 1. 构建项目

```bash
npm run build
```

### 2. 启动生产服务器

```bash
npm start
```

## 常用命令

- `npm run dev` - 启动开发服务器
- `npm run build` - 构建生产版本
- `npm start` - 启动生产服务器
- `npm run lint` - 运行代码检查
- `npm run type-check` - TypeScript 类型检查
- `npm run db:studio` - 打开 Prisma Studio 数据库管理界面
- `npm run db:generate` - 生成 Prisma Client
- `npm run db:push` - 推送数据库结构
- `npm run db:migrate` - 运行数据库迁移

## 故障排除

### 端口冲突

如果 10111 端口被占用,可以修改 `package.json` 中的端口号:

```json
"dev": "next dev -p 你的端口号",
"start": "next start -p 你的端口号"
```

### 数据库连接失败

检查:
1. MySQL 服务是否运行
2. `.env` 文件中的数据库连接信息是否正确
3. 数据库用户是否有足够的权限

### Prisma 相关错误

尝试重新生成 Prisma Client:

```bash
npm run db:generate
```

## 目录结构

```
├── app/                    # Next.js App Router
│   ├── (console)/         # 控制台页面组
│   │   ├── layout.tsx     # 控制台布局
│   │   └── console/       # 控制台页面
│   ├── api/               # API 路由
│   ├── globals.css        # 全局样式
│   └── layout.tsx         # 根布局
├── prisma/                # Prisma 配置
│   └── schema.prisma      # 数据模型
├── lib/                   # 工具库
│   └── prisma.ts          # Prisma 客户端
└── public/                # 静态资源
```

## 功能模块

- **控制台首页** - 仪表盘,展示系统概览和统计数据
- **链接管理** - 管理联盟链接配置
- **MCC管理** - 管理 Google Ads MCC 账号
- **代理管理** - 管理代理供应商
- **系统设置** - 配置系统参数
- **日志查看** - 查看监控日志

## 技术栈

- **框架**: Next.js 14 (App Router)
- **UI**: Ant Design 5 + Tailwind CSS 3
- **数据库**: Prisma ORM + MySQL 8
- **语言**: TypeScript 5
- **认证**: NextAuth.js
- **定时任务**: node-cron

## 下一步

1. 配置 Google Ads API 凭据
2. 设置代理供应商 API
3. 配置定时任务执行间隔
4. 添加用户认证和权限管理
5. 配置告警通知

## 支持

如有问题,请查看项目 README.md 或 PRD.md 文档。
