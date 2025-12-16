# Google Ads 联盟链接自动更换系统

## 📝 项目简介

一个基于 Next.js 14 的自动化系统，用于监控 Google Ads 广告系列的点击变化，并自动通过代理访问联盟链接、追踪重定向、更新最终落地页URL，确保广告链接始终有效。

## 🎯 核心功能

- ✅ **多租户隔离**：支持多个用户/团队独立管理
- ✅ **自动监控**：定时检测广告系列点击数变化
- ✅ **智能换链**：代理访问+重定向追踪+域名验证
- ✅ **软删除**：数据安全，支持恢复
- ✅ **日志**：完整的监控日志
- ✅ **多代理支持**：供应商优先级与故障转移

## 🗂️ 数据库设计

已完成完整的数据库设计，包含9个核心表：

### 核心表结构

| 表名 | 说明 | 记录数量级 |
|------|------|-----------|
| **User** | 用户表 | 100+ |
| **MccAccount** | Google Ads MCC账号 | 1000+ |
| **CidAccount** | Google Ads CID账号 | 5000+ |
| **Campaign** | 广告系列（核心） | 10000+ |
| **AffiliateConfig** | 联盟链接配置 | 10000+ |
| **ProxyProvider** | 代理供应商 | 10+ |
| **UsedProxyIp** | 已用代理IP（24h） | 100000+ |
| **MonitoringLog** | 监控日志 | 1000000+ |
| **SystemConfig** | 系统配置 | 50+ |

详细设计请查看：[数据库设计文档](./database/README.md)

### Google Ads 账号层级关系

```
User (用户)
  └── MccAccount (MCC账号)
       └── CidAccount (CID客户账号)
            └── Campaign (广告系列)
                 └── AffiliateConfig (联盟链接配置)
```

**说明**：
- **User**：系统用户，可以绑定多个MCC账号
- **MccAccount**：Google Ads管理中心账号，用于OAuth授权
- **CidAccount**：Google Ads客户账号（实际投放账号），一个MCC可管理多个CID
- **Campaign**：广告系列，属于某个CID账号
- **AffiliateConfig**：联盟链接配置，一个Campaign可配置多个（用于A/B测试）

### 关键设计决策

1. **Google Ads层级结构**：MCC → CID → Campaign（三层架构）
   - 一个MCC账号管理多个CID账号
   - 一个CID账号下有多个广告系列
   - Campaign直接关联CidAccount，符合实际业务逻辑

2. **Prisma关系模式**：`relationMode = "prisma"`
   - ✅ **ORM层**：完整的关系查询功能（`include`、`select`等）
   - ❌ **数据库层**：无物理外键约束
   - 优势：更好的性能、灵活性，适合云数据库
   - 详情：[Prisma关系模式指南](./prisma/RELATION_MODE_GUIDE.md)

3. **软删除方案**：`deletedAt` 字段加入唯一约束

4. **一对多关系**：一个广告系列可配置多个联盟链接（支持A/B测试）

5. **代理去重**：按广告系列去重，24小时窗口

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp env.example .env

# 编辑 .env 文件，配置以下关键信息：
# - DATABASE_URL: MySQL数据库连接
# - NEXTAUTH_SECRET: NextAuth密钥
# - GOOGLE_ADS_DEVELOPER_TOKEN: Google Ads开发者令牌
# - GOOGLE_SERVICE_ACCOUNT_KEY_PATH: Google 服务账号密钥路径
# - （可选）GOOGLEADS_RPS/BURST/MAX_WAIT_MS: Google Ads 请求排队限流参数
# - （可选）GOOGLEADS_CID_CONCURRENCY / ONECLICK_GOOGLEADS_MCC_CONCURRENCY: 同步/监控削峰参数
```

### 3. 初始化数据库

```bash
# 生成Prisma Client
npm run db:generate

# 执行数据库迁移（创建表结构）
npm run db:migrate

# 初始化种子数据（可选，仅开发环境）
npm run db:seed
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问：http://localhost:10111

### 5. 查看数据库（可选）

```bash
# 启动Prisma Studio可视化工具
npm run db:studio
```

访问：http://localhost:5555

## 📁 项目结构

```
1208/
├── database/               # 数据库相关文件
│   ├── schema.sql         # SQL DDL文件（含完整注释）
│   └── README.md          # 数据库设计文档
├── prisma/                # Prisma配置
│   ├── schema.prisma      # Prisma Schema定义
│   └── seed.ts           # 数据库种子文件
├── lib/                   # 工具库
│   └── prisma.ts         # Prisma Client + 软删除中间件
├── env.example           # 环境变量模板（由于忽略规则，未使用 .env.example 命名）
├── package.json          # 项目依赖配置
├── PRD.md               # 产品需求文档
└── README.md            # 项目说明文档（本文件）
```

## 🔧 技术栈

- **框架**：Next.js 14 (App Router)
- **语言**：TypeScript 5.x
- **数据库**：MySQL 8.0+
- **ORM**：Prisma 5.x
- **UI**：Ant Design 5.x + Tailwind CSS 3.x
- **鉴权**：NextAuth.js
- **定时任务**：node-cron
- **API集成**：Google Ads API

## 📊 数据库操作命令

```bash
# Prisma相关
npm run db:generate        # 生成Prisma Client
npm run db:push           # 推送schema到数据库（快速原型）
npm run db:migrate        # 创建并应用迁移（开发环境）
npm run db:migrate:deploy # 仅应用迁移（生产环境）
npm run db:seed           # 执行种子数据
npm run db:studio         # 打开可视化工具
npm run db:reset          # 重置数据库（危险！）

# 开发相关
npm run dev               # 启动开发服务器
npm run build             # 构建生产版本
npm run start             # 启动生产服务器
npm run lint              # 代码检查
npm run type-check        # TypeScript类型检查
```

## 🔐 安全注意事项

### 必须加密的字段
- `MccAccount.refreshToken` - Google OAuth刷新令牌
- `MccAccount.accessToken` - Google OAuth访问令牌  
- `ProxyProvider.apiKey` - 代理供应商API密钥

### 多租户隔离
所有数据查询必须包含用户/租户过滤：
```typescript
// ✅ 正确
const campaigns = await prisma.campaign.findMany({
  where: { userId: currentUser.id }
});

// ❌ 错误：可能泄露其他租户数据
const campaigns = await prisma.campaign.findMany();
```

## 📈 性能优化

### 已创建的关键索引
```sql
-- 监控任务筛选
INDEX (enabled, deletedAt) ON Campaign

-- 代理IP去重查询
INDEX (ip, campaignId, usedAt) ON UsedProxyIp

-- 日志查询
INDEX (campaignId, triggeredAt) ON MonitoringLog
```

### 定时清理任务
- **UsedProxyIp**：每小时清理24小时前的记录
- **MonitoringLog**：每月归档3个月前的日志

## 🐛 常见问题

### Q: TypeScript报错找不到模块
```
找不到模块"@prisma/client"
```
**解决方案**：
```bash
npm install
npm run db:generate
```

### Q: 软删除后无法重复添加
**检查**：确保唯一约束包含 `deletedAt` 字段

## 🗓️ 开发里程碑

- [x] **M1**：数据库设计与Prisma配置 ✅
- [ ] **M2**：用户鉴权与MCC账号管理
- [ ] **M3**：监控Cron核心逻辑
- [ ] **M4**：仪表盘与日志查询UI
- [ ] **M5**：代理多供应商与告警

## 📚 相关文档

- [产品需求文档 (PRD)](./PRD.md)
- [数据库设计文档](./database/README.md)
- [SQL DDL文件](./database/schema.sql)
- [Prisma Schema](./prisma/schema.prisma)

## 👥 测试账号（开发环境）

执行 `npm run db:seed` 后会创建以下测试账号：

| 角色 | 邮箱 | 密码 |
|------|------|------|
| 管理员 | admin@example.com | admin123456 |
| 普通用户 | user@example.com | user123456 |

⚠️ **生产环境请务必修改密码！**

## 📄 许可证

本项目仅供内部使用。

---

**创建日期**：2024年12月8日  
**当前状态**：数据库设计已完成 ✅  
**下一步**：开始前端页面和API开发
