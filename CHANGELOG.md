# 数据库设计变更日志

## [v1.3] - 2024-12-09

### ⚙️ 配置

- **数据库连接配置**：完成MySQL数据库连接配置
  - **主数据库**：`kysql01` (localhost:3306)
  - **影子数据库**：`kysql01_shadow` (localhost:3306)
  - 用户名：kysql01
  - 已更新 `.env` 文件
  - 已更新 `prisma/schema.prisma`，添加 `shadowDatabaseUrl` 配置

- **Prisma关系模式配置**：启用 `relationMode = "prisma"`
  - 关系仅在Prisma ORM层管理
  - 数据库层不创建物理外键约束
  - 提升性能和灵活性

### 📝 文件变更

- ✅ **创建 `.env`**：基于 `.env.example` 创建环境变量文件
  - 配置主数据库连接：`DATABASE_URL`
  - 配置影子数据库连接：`SHADOW_DATABASE_URL`
  
- ✅ **更新 `prisma/schema.prisma`**：
  - datasource db 块新增 `shadowDatabaseUrl = env("SHADOW_DATABASE_URL")`
  - 影子数据库用于开发环境的数据库迁移测试
  - 新增 `relationMode = "prisma"`，启用仅ORM层的关系管理
  - 为外键字段添加必需的索引：
    - `UsedProxyIp.providerId`
    - `MonitoringLog.providerId`
    - `SystemConfig.updatedBy`

### 💡 关系模式说明（relationMode = "prisma"）

**什么是 relationMode = "prisma"？**

这是Prisma 4.8+引入的特性，允许关系完全由Prisma层管理，而不在数据库层创建物理外键约束。

**工作原理**：
- ✅ **ORM层**：保留所有 `@relation` 定义，支持关系查询（如 `include`、`select`）
- ❌ **数据库层**：不创建 FOREIGN KEY 约束，表之间无物理关联

**优势**：
1. **性能提升**：避免外键带来的锁定和级联操作开销
2. **灵活性**：更容易进行数据迁移和表结构调整
3. **兼容性**：支持不提供外键的数据库服务（如PlanetScale、某些云数据库）
4. **简化部署**：减少迁移时的复杂依赖关系

**注意事项**：
- 所有外键字段必须有索引（已添加）
- 参照完整性由应用层（Prisma）保证，需谨慎操作
- 删除数据时需手动处理级联逻辑（或使用Prisma的 `onDelete` 行为）

### 💡 影子数据库说明

影子数据库（Shadow Database）是Prisma用于开发环境的数据库迁移测试：
- Prisma会先在影子数据库中测试迁移
- 确保迁移安全后再应用到主数据库
- 避免因迁移失败导致主数据库损坏
- 仅在开发环境使用，生产环境不需要

### 📋 下一步操作

1. **初始化数据库**：
   ```bash
   # 执行数据库迁移
   npx prisma migrate dev --name init
   
   # 生成Prisma Client
   npx prisma generate
   
   # （可选）初始化种子数据
   npx prisma db seed
   ```

2. **查看数据库**：
   ```bash
   # 打开Prisma Studio可视化工具
   npx prisma studio
   ```

---

## [v1.2] - 2024-12-08

### 🔄 修改

- **移除 BigInt 类型**：实际数据量有限，无需使用BigInt
  - **Campaign 表**：
    - `lastClicks`: BIGINT → INT
    - `todayClicks`: BIGINT → INT
  - **MonitoringLog 表**：
    - `todayClicks`: BIGINT → INT
    - `lastClicks`: BIGINT → INT
    - `newClicks`: BIGINT → INT

### ❌ 移除

- **lib/prisma.ts**：移除BigInt序列化处理代码
  ```typescript
  // 已移除
  (BigInt.prototype as any).toJSON = function () {
    return this.toString();
  };
  ```

- **prisma/seed.ts**：移除BigInt()包装
  - 从 `BigInt(50)` 改为 `50`

### 📝 文档更新

- **database/README.md**：
  - 移除"BigInt处理"章节
  - 更新Campaign表字段说明（BigInt → INT）
  
- **README.md**：
  - 移除"BigInt处理"设计决策
  - 移除"BigInt序列化错误"常见问题

### 🎯 设计理由

**为什么移除BigInt？**

1. **数据量评估**：
   - INT类型范围：-2,147,483,648 到 2,147,483,647
   - 单个广告系列日点击数通常不会超过INT上限
   - 即使高流量场景，单日点击数也在INT范围内

2. **简化开发**：
   - 无需处理BigInt序列化问题
   - JavaScript原生支持Number类型
   - 避免前后端数据类型转换复杂度

3. **性能优化**：
   - INT占用4字节，BIGINT占用8字节
   - 节省存储空间和索引大小
   - 提升查询性能

### ⚠️ 迁移注意事项

如果已有数据库实例：

```sql
-- 修改Campaign表
ALTER TABLE `Campaign` 
  MODIFY COLUMN `lastClicks` INT NOT NULL DEFAULT 0,
  MODIFY COLUMN `todayClicks` INT NOT NULL DEFAULT 0;

-- 修改MonitoringLog表
ALTER TABLE `MonitoringLog` 
  MODIFY COLUMN `todayClicks` INT NOT NULL,
  MODIFY COLUMN `lastClicks` INT NOT NULL,
  MODIFY COLUMN `newClicks` INT NOT NULL;
```

### 📊 影响范围

**数据库层面**：
- 修改2个表：`Campaign`、`MonitoringLog`（字段类型变更）

**代码层面**：
- ✅ `database/schema.sql` - 字段类型更新
- ✅ `prisma/schema.prisma` - 模型类型更新
- ✅ `lib/prisma.ts` - 移除BigInt序列化
- ✅ `prisma/seed.ts` - 移除BigInt()调用
- ✅ 文档更新（README.md、database/README.md）

---

## [v1.1] - 2024-12-08

### ✨ 新增

- **新增 CidAccount 表**：Google Ads CID客户账号表
  - 字段：`id`, `userId`, `mccAccountId`, `cid`, `name`, `currency`, `timezone`, `status`, `lastSyncAt`, `deletedAt`, `createdAt`, `updatedAt`
  - 支持软删除功能
  - 唯一约束：`(cid, mccAccountId, deletedAt)`
  - 状态枚举：`active`, `inactive`, `suspended`

### 🔄 修改

- **Campaign 表**：调整关联关系
  - ❌ 移除：`mccAccountId` 字段
  - ✅ 新增：`cidAccountId` 字段
  - 修改唯一约束：从 `(campaignId, mccAccountId, deletedAt)` 改为 `(campaignId, cidAccountId, deletedAt)`
  - 修改外键约束：从关联 `MccAccount` 改为关联 `CidAccount`

- **MccAccount 表**：调整关系
  - 从 `1:N → Campaign` 改为 `1:N → CidAccount`

  -（审计日志模块已移除，不再维护 AuditLog 表相关变更）

### 📝 文档更新

- **database/schema.sql**：
  - 新增第3节：CidAccount表DDL
  - 修改第4节：Campaign表DDL
  - 更新所有后续表的序号（4→5, 5→6, ..., 9→10）

- **prisma/schema.prisma**：
  - 新增 `CidAccount` 模型
  - 新增 `CidStatus` 枚举
  - 修改 `Campaign` 模型关联
  - 修改 `MccAccount` 模型关联
  - 修改 `EntityType` 枚举

- **prisma/seed.ts**：
  - 第6步：新增CidAccount示例数据创建
  - 修改Campaign创建逻辑，使用 `cidAccountId`

- **lib/prisma.ts**：
  - 软删除中间件支持列表新增 `CidAccount`

- **database/README.md**：
  - 表结构总览新增CidAccount（共10个表）
  - 核心设计决策新增"Google Ads层级结构"说明
  - 详细表结构新增CidAccount说明
  - 更新Campaign表的关联关系说明
  - 软删除支持列表新增CidAccount

- **README.md**：
  - 核心表结构新增CidAccount（共10个表）
  - 新增"Google Ads账号层级关系"可视化图示
  - 关键设计决策新增层级结构说明

### 🎯 设计理由

**为什么需要CidAccount表？**

1. **符合Google Ads实际架构**：
   - Google Ads的真实层级是：MCC（管理中心账号）→ CID（客户账号）→ Campaign（广告系列）
   - 一个MCC可以管理多个CID账号
   - 广告系列（Campaign）实际是属于CID账号，而非直接属于MCC

2. **业务场景需求**：
   - 不同CID账号可能有不同的货币、时区配置
   - 同一MCC下不同CID的广告系列需要独立管理
   - CID账号可能有不同的状态（活跃、暂停等）

3. **数据隔离与权限控制**：
   - 更细粒度的权限控制（可以按CID分配权限）
   - 更清晰的数据归属关系
   - 便于多客户/多账号管理

### ⚠️ 迁移注意事项

如果已有旧数据，需要执行以下迁移步骤：

1. **创建CidAccount表**
2. **为每个现有的MccAccount创建对应的CidAccount**（1:1映射）
3. **更新Campaign表的外键关联**
4. **删除Campaign表的旧外键约束**
5. **验证数据完整性**

### 📊 影响范围

**数据库层面**：
- 新增1个表：`CidAccount`
- 修改1个表：`Campaign`（外键关联变更）
- 新增1个枚举：`CidStatus`
- 修改1个枚举：`EntityType`（新增cid类型）

**代码层面**（需要后续更新）：
- [ ] API路由：新增CID账号管理相关接口
- [ ] 前端页面：新增CID账号列表和详情页
- [ ] Google Ads API：从MCC同步CID账号列表
- [ ] 监控Cron：调整广告系列查询逻辑（通过CID访问）

### 🔗 相关文件

- `database/schema.sql` - SQL DDL文件
- `prisma/schema.prisma` - Prisma Schema定义
- `prisma/seed.ts` - 种子数据文件
- `lib/prisma.ts` - Prisma Client配置
- `database/README.md` - 数据库设计文档
- `README.md` - 项目主文档

---

## [v1.0] - 2024-12-08（初始版本）

### ✨ 初始功能

- 完成基础数据库设计
- 9个核心表：User, MccAccount, Campaign, AffiliateConfig, ProxyProvider, UsedProxyIp, MonitoringLog, SystemConfig
- 支持多租户隔离
- 支持软删除（MccAccount, Campaign, AffiliateConfig）
- BigInt字段序列化处理
- Prisma软删除中间件

---

**维护者**：开发团队  
**最后更新**：2024年12月8日
