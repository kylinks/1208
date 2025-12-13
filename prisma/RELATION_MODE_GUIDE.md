# Prisma 关系模式使用指南

## 📌 配置说明

本项目使用 `relationMode = "prisma"`，这意味着：
- ✅ **ORM层**：完整的关系查询功能
- ❌ **数据库层**：无物理外键约束

## 🔍 ORM层关系查询（完全支持）

### 1. Include 关联查询

```typescript
// 查询广告系列及其关联的联盟配置
const campaign = await prisma.campaign.findUnique({
  where: { id: campaignId },
  include: {
    affiliateConfigs: true,  // 包含所有联盟配置
    cidAccount: {            // 包含CID账号
      include: {
        mccAccount: true     // 嵌套包含MCC账号
      }
    },
    user: true               // 包含用户信息
  }
});

// 结果包含完整的关系数据
console.log(campaign.affiliateConfigs); // AffiliateConfig[]
console.log(campaign.cidAccount.mccAccount); // MccAccount
```

### 2. Select 选择字段

```typescript
// 只查询需要的字段和关系
const campaigns = await prisma.campaign.findMany({
  select: {
    id: true,
    name: true,
    lastClicks: true,
    cidAccount: {
      select: {
        name: true,
        cid: true
      }
    }
  }
});
```

### 3. Where 关系过滤

```typescript
// 查询特定MCC账号下的所有广告系列
const campaigns = await prisma.campaign.findMany({
  where: {
    cidAccount: {
      mccAccount: {
        mccId: "123-456-7890"
      }
    }
  }
});

// 查询有失败监控日志的广告系列
const campaignsWithErrors = await prisma.campaign.findMany({
  where: {
    monitoringLogs: {
      some: {
        status: "failed"
      }
    }
  }
});
```

### 4. Create 创建关联数据

```typescript
// 创建广告系列并关联到现有CID账号
const campaign = await prisma.campaign.create({
  data: {
    campaignId: "98765",
    name: "Summer Sale Campaign",
    countryCode: "US",
    userId: user.id,
    cidAccountId: cidAccount.id,  // 直接关联
    // 或使用嵌套创建
    affiliateConfigs: {
      create: [
        {
          affiliateLink: "https://affiliate.com/link1",
          targetDomain: "example.com",
          countryCode: "US",
          priority: 1
        }
      ]
    }
  }
});
```

### 5. Update 更新关联

```typescript
// 更新广告系列的CID关联
await prisma.campaign.update({
  where: { id: campaignId },
  data: {
    cidAccountId: newCidAccountId  // 直接更新关联ID
  }
});

// 添加新的联盟配置
await prisma.campaign.update({
  where: { id: campaignId },
  data: {
    affiliateConfigs: {
      create: {
        affiliateLink: "https://affiliate.com/link2",
        targetDomain: "example2.com",
        countryCode: "UK",
        priority: 2
      }
    }
  }
});
```

### 6. Delete 删除操作

```typescript
// onDelete: Cascade 在 relationMode = "prisma" 下的行为
// Prisma会自动处理级联删除（在应用层）

// 删除CID账号会自动删除其下所有广告系列
await prisma.cidAccount.delete({
  where: { id: cidAccountId }
});
// ✅ 相关的 Campaign 记录会被自动删除（Prisma处理）

// onDelete: SetNull 的行为
// 删除供应商时，相关日志的 providerId 会被设置为 null
await prisma.proxyProvider.delete({
  where: { id: providerId }
});
// ✅ MonitoringLog.providerId 会变为 null
```

## ⚠️ 注意事项

### 1. 参照完整性由应用层保证

```typescript
// ❌ 错误：直接在数据库中删除记录会破坏参照完整性
// 如果绕过Prisma直接操作数据库，可能导致孤儿记录

// ✅ 正确：始终通过Prisma进行删除操作
await prisma.campaign.delete({
  where: { id: campaignId }
});
```

### 2. 手动处理批量删除

```typescript
// 如果需要批量删除关联数据，需要手动处理
const cidAccountId = "xxx";

// 先删除子记录
await prisma.campaign.deleteMany({
  where: { cidAccountId }
});

// 再删除父记录
await prisma.cidAccount.delete({
  where: { id: cidAccountId }
});

// 或使用事务
await prisma.$transaction([
  prisma.campaign.deleteMany({
    where: { cidAccountId }
  }),
  prisma.cidAccount.delete({
    where: { id: cidAccountId }
  })
]);
```

### 3. 性能优化建议

```typescript
// ✅ 推荐：使用索引字段进行关联查询
const campaigns = await prisma.campaign.findMany({
  where: {
    cidAccountId: cidId  // cidAccountId 有索引
  }
});

// ⚠️ 注意：深层嵌套查询可能影响性能
const data = await prisma.user.findMany({
  include: {
    cidAccounts: {
      include: {
        campaigns: {
          include: {
            affiliateConfigs: true,
            monitoringLogs: true
          }
        }
      }
    }
  }
});
// 考虑分步查询或使用原始SQL
```

## 🎯 最佳实践

### 1. 使用软删除而非硬删除

```typescript
// ✅ 软删除：保留历史数据，避免破坏关系
await prisma.campaign.update({
  where: { id: campaignId },
  data: { deletedAt: new Date() }
});

// 软删除中间件会自动过滤 deletedAt 不为 null 的记录
const activeCampaigns = await prisma.campaign.findMany();
// 只返回 deletedAt = null 的记录
```

### 2. 验证关联存在性

```typescript
// 创建关联数据前验证父记录存在
const cidAccount = await prisma.cidAccount.findUnique({
  where: { id: cidAccountId }
});

if (!cidAccount) {
  throw new Error("CID账号不存在");
}

const campaign = await prisma.campaign.create({
  data: {
    cidAccountId,
    // ... 其他字段
  }
});
```

### 3. 使用事务保证一致性

```typescript
// 使用事务确保多个操作的原子性
const result = await prisma.$transaction(async (tx) => {
  // 创建MCC账号
  const mccAccount = await tx.mccAccount.create({
    data: { /* ... */ }
  });
  
  // 创建CID账号
  const cidAccount = await tx.cidAccount.create({
    data: {
      mccAccountId: mccAccount.id,
      /* ... */
    }
  });
  
  // 创建广告系列
  const campaign = await tx.campaign.create({
    data: {
      cidAccountId: cidAccount.id,
      /* ... */
    }
  });
  
  return { mccAccount, cidAccount, campaign };
});
```

## 📚 对比：数据库层外键 vs ORM层关系

| 特性 | 数据库层外键 | relationMode = "prisma" |
|------|-------------|-------------------------|
| **关系查询** | ✅ 支持 | ✅ 支持（完全相同） |
| **参照完整性** | 数据库保证 | 应用层保证 |
| **级联删除** | 数据库执行 | Prisma执行 |
| **性能** | 有锁定开销 | 更快（无外键锁） |
| **灵活性** | 受限 | 更灵活 |
| **迁移复杂度** | 较高 | 较低 |
| **适用场景** | 严格数据一致性 | 高性能、云数据库 |

## ✨ 总结

使用 `relationMode = "prisma"` 后：
- ✅ 所有Prisma ORM功能正常使用
- ✅ 关系查询、过滤、嵌套操作完全支持
- ✅ 更好的性能和灵活性
- ⚠️ 需要通过Prisma操作数据，避免直接修改数据库
- ⚠️ 在应用层确保数据一致性

---

**最后更新**：2024年12月9日  
**Prisma版本**：5.x+
