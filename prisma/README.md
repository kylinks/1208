# Prisma 配置说明

## ✅ 已完成的配置

### 1. 数据库连接
- **主数据库**：`kysql01` (localhost:3306)
- **影子数据库**：`kysql01_shadow` (localhost:3306)
- 用户名：kysql01

### 2. 关系模式
- **模式**：`relationMode = "prisma"`
- **特点**：仅ORM层关系映射，无数据库层外键约束

### 3. 索引优化
为所有外键字段添加了索引：
- ✅ `UsedProxyIp.providerId`
- ✅ `MonitoringLog.providerId`
- ✅ `SystemConfig.updatedBy`

## 🚀 初始化步骤

### 1️⃣ 创建数据库
```bash
# 登录MySQL
mysql -u kysql01 -p

# 创建数据库
CREATE DATABASE kysql01 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE kysql01_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 退出
exit
```

### 2️⃣ 生成Prisma Client
```bash
# 生成Prisma客户端代码
npx prisma generate
```

### 3️⃣ 执行数据库迁移
```bash
# 方式1：使用迁移（推荐生产环境）
npx prisma migrate dev --name init

# 方式2：直接推送schema（开发环境快速测试）
npx prisma db push
```

### 4️⃣ （可选）初始化种子数据
```bash
# 导入测试数据
npx prisma db seed
```

### 5️⃣ （可选）打开可视化管理界面
```bash
# 启动Prisma Studio
npx prisma studio
```

## 📁 文件结构

```
prisma/
├── schema.prisma           # Prisma模型定义（主配置文件）
├── seed.ts                 # 种子数据脚本
├── README.md              # 本文件
└── RELATION_MODE_GUIDE.md # 关系模式使用指南
```

## 🔧 常用命令

### 开发阶段
```bash
# 生成Prisma Client
npx prisma generate

# 创建新的迁移
npx prisma migrate dev --name <migration_name>

# 推送schema变更到数据库（跳过迁移）
npx prisma db push

# 重置数据库（危险操作！）
npx prisma migrate reset

# 查看数据库
npx prisma studio

# 格式化schema文件
npx prisma format
```

### 生产环境
```bash
# 部署迁移（不创建新迁移）
npx prisma migrate deploy

# 生成Prisma Client
npx prisma generate
```

## 📊 数据库信息

### 表结构总览
1. **User** - 用户表
2. **MccAccount** - Google Ads MCC账号表
3. **CidAccount** - Google Ads CID账号表
4. **Campaign** - 广告系列表（核心）
5. **AffiliateConfig** - 联盟链接配置表
6. **ProxyProvider** - 代理供应商表
7. **UsedProxyIp** - 已使用代理IP表
8. **MonitoringLog** - 监控日志表
9. **SystemConfig** - 系统配置表

### 关系层级
```
User
 └─ MccAccount
     └─ CidAccount
         └─ Campaign
             ├─ AffiliateConfig
             ├─ UsedProxyIp
             └─ MonitoringLog
```

## 💡 关系模式特性

### ✅ 保留功能
- 完整的ORM关系查询（`include`、`select`）
- 关系过滤（`where`）
- 嵌套创建/更新
- 类型安全
- 自动补全

### ❌ 移除功能
- 数据库层外键约束
- 数据库层级联删除（改为应用层处理）
- 外键锁定

### 📖 使用指南
详细使用方法请查看：[RELATION_MODE_GUIDE.md](./RELATION_MODE_GUIDE.md)

## ⚠️ 重要提示

### 1. 参照完整性
- 始终通过Prisma进行数据操作
- 避免直接修改数据库，可能导致孤儿记录

### 2. 软删除
项目使用软删除策略，支持的表：
- MccAccount
- CidAccount
- Campaign
- AffiliateConfig

查询时自动过滤已删除记录（由Prisma中间件处理）。

### 3. 数据一致性
使用事务确保多表操作的原子性：
```typescript
await prisma.$transaction([
  // ... 多个操作
]);
```

## 🔒 安全建议

1. **环境变量**
   - `.env` 文件已添加到 `.gitignore`
   - 生产环境使用强密码
   - 定期更新敏感密钥

2. **访问控制**
   - 数据库用户权限最小化
   - 生产环境禁用影子数据库
   - 启用SSL连接（生产环境）

3. **备份策略**
   ```bash
   # 备份数据库
   mysqldump -u kysql01 -p kysql01 > backup.sql
   
   # 恢复数据库
   mysql -u kysql01 -p kysql01 < backup.sql
   ```

## 📚 相关文档

- [Prisma官方文档](https://www.prisma.io/docs)
- [关系模式文档](https://www.prisma.io/docs/concepts/components/prisma-schema/relations/relation-mode)
- [数据库设计文档](../database/README.md)
- [项目PRD](../PRD.md)

## 🆘 常见问题

### Q: 为什么使用 relationMode = "prisma"？
A: 提升性能，避免外键锁定，增加灵活性，适合云数据库服务。

### Q: ORM关系查询还能用吗？
A: 完全可以！所有Prisma关系功能正常使用，查看 [RELATION_MODE_GUIDE.md](./RELATION_MODE_GUIDE.md)。

### Q: 如何保证数据一致性？
A: 通过Prisma进行所有操作，Prisma会在应用层处理级联删除等逻辑。

### Q: 迁移时报错怎么办？
```bash
# 1. 检查数据库连接
npx prisma db pull

# 2. 重置迁移历史
npx prisma migrate reset

# 3. 重新生成
npx prisma generate
npx prisma migrate dev
```

---

**最后更新**：2024年12月9日  
**维护者**：开发团队
