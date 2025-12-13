/**
 * Prisma 数据库种子文件
 * 用于初始化系统配置和测试数据
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 开始初始化数据库...');

  // ============================================
  // 1. 创建系统配置
  // ============================================
  console.log('📝 创建系统配置...');
  
  const systemConfigs = [
    {
      key: 'cron_interval',
      value: '5',
      description: '监控任务执行间隔（分钟）',
      category: 'monitoring',
      isPublic: true,
    },
    {
      key: 'max_redirects',
      value: '10',
      description: '默认最大跳转次数',
      category: 'monitoring',
      isPublic: true,
    },
    {
      key: 'proxy_reuse_hours',
      value: '24',
      description: '代理IP去重时间窗口（小时）',
      category: 'proxy',
      isPublic: true,
    },
    {
      key: 'daily_replacement_limit',
      value: '100',
      description: '单个广告系列每日最大换链次数',
      category: 'monitoring',
      isPublic: true,
    },
    {
      key: 'request_timeout',
      value: '30000',
      description: 'HTTP请求超时时间（毫秒）',
      category: 'monitoring',
      isPublic: true,
    },
  ];

  for (const config of systemConfigs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: config,
      create: config,
    });
  }

  console.log('✅ 系统配置创建完成');

  // ============================================
  // 2. 创建测试管理员账号（仅开发环境）
  // ============================================
  if (process.env.NODE_ENV !== 'production') {
    console.log('👤 创建测试管理员账号...');

    const hashedPassword = await bcrypt.hash('admin123456', 10);

    const adminUser = await prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        email: 'admin@example.com',
        password: hashedPassword,
        name: '系统管理员',
        role: 'admin',
        tenantId: 'default-tenant',
      },
    });

    console.log('✅ 管理员账号创建完成:', adminUser.email);

    // ============================================
    // 3. 创建测试普通用户账号
    // ============================================
    console.log('👤 创建测试普通用户账号...');

    const employeePassword = await bcrypt.hash('user123456', 10);

    const employeeUser = await prisma.user.upsert({
      where: { email: 'user@example.com' },
      update: {},
      create: {
        email: 'user@example.com',
        password: employeePassword,
        name: '张三',
        role: 'employee',
        tenantId: 'tenant-001',
      },
    });

    console.log('✅ 普通用户账号创建完成:', employeeUser.email);

    // ============================================
    // 4. 创建示例代理供应商
    // ============================================
    console.log('🌐 创建示例代理供应商...');

    const proxyProvider = await prisma.proxyProvider.create({
      data: {
        name: '示例代理供应商',
        priority: 1,
        enabled: true,
        proxyHost: 'proxy-provider.example.com',
        proxyPort: 8080,
        username: 'demo-{country}-session-{session:8}',
        password: 'pass-{session:8}',
      },
    });

    console.log('✅ 代理供应商创建完成:', proxyProvider.name);

    // ============================================
    // 5. 创建示例MCC账号
    // ============================================
    console.log('📊 创建示例MCC账号...');

    const mccAccount = await prisma.mccAccount.create({
      data: {
        userId: employeeUser.id,
        mccId: '123-456-7890',
        name: '张三的Google Ads账号',
        authStatus: 'pending',
      },
    });

    console.log('✅ MCC账号创建完成:', mccAccount.name);

    // ============================================
    // 6. 创建示例CID账号
    // ============================================
    console.log('💳 创建示例CID账号...');

    const cidAccount = await prisma.cidAccount.create({
      data: {
        userId: employeeUser.id,
        mccAccountId: mccAccount.id,
        cid: '987-654-3210',
        name: '张三的减肥产品账号',
        currency: 'USD',
        timezone: 'America/New_York',
        status: 'active',
      },
    });

    console.log('✅ CID账号创建完成:', cidAccount.name);

    // ============================================
    // 7. 创建示例广告系列
    // ============================================
    console.log('🎯 创建示例广告系列...');

    const campaign = await prisma.campaign.create({
      data: {
        userId: employeeUser.id,
        cidAccountId: cidAccount.id,
        campaignId: 'campaign-001',
        name: 'US-WeightLoss-2024',
        countryCode: 'US',
        lastClicks: 50,
        todayClicks: 50,
        enabled: true,
      },
    });

    console.log('✅ 广告系列创建完成:', campaign.name);

    // ============================================
    // 8. 创建示例联盟配置
    // ============================================
    console.log('🔗 创建示例联盟配置...');

    const affiliateConfig = await prisma.affiliateConfig.create({
      data: {
        campaignId: campaign.id,
        affiliateLink: 'https://affiliate.example.com/offer?id=12345',
        targetDomain: 'landing-page.example.com',
        countryCode: 'US',
        maxRedirects: 10,
        enabled: true,
        priority: 1,
      },
    });

    console.log('✅ 联盟配置创建完成');
  }

  console.log('🎉 数据库初始化完成！');
}

main()
  .catch((e) => {
    console.error('❌ 数据库初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
