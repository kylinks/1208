-- ============================================
-- Google Ads 联盟链接自动更换系统 - 数据库设计
-- 框架: Next.js 14+ with Prisma ORM
-- 数据库: MySQL 8.0+
-- 特性: 多租户隔离、软删除
-- ============================================

-- 1. 用户表 (多租户基础)
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL COMMENT '用户唯一标识',
    `email` VARCHAR(191) NOT NULL COMMENT '用户邮箱，用于登录',
    `password` VARCHAR(255) NOT NULL COMMENT '加密后的密码',
    `name` VARCHAR(100) NOT NULL COMMENT '用户姓名',
    `role` ENUM('employee', 'admin') NOT NULL DEFAULT 'employee' COMMENT '角色：employee=员工，admin=管理员',
    `tenantId` VARCHAR(191) NOT NULL COMMENT '租户ID，用于多租户数据隔离',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '最后更新时间',
    
    PRIMARY KEY (`id`),
    UNIQUE KEY `User_email_key` (`email`),
    INDEX `User_tenantId_idx` (`tenantId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表：存储系统用户信息，支持多租户';

-- 2. MCC账号表 (Google Ads MCC账号管理)
CREATE TABLE `MccAccount` (
    `id` VARCHAR(191) NOT NULL COMMENT 'MCC账号记录唯一标识',
    `userId` VARCHAR(191) NOT NULL COMMENT '关联的用户ID',
    `mccId` VARCHAR(100) NOT NULL COMMENT 'Google Ads MCC账号ID',
    `name` VARCHAR(200) NOT NULL COMMENT 'MCC账号显示名称',
    `authStatus` ENUM('pending', 'authorized', 'expired', 'failed') NOT NULL DEFAULT 'pending' 
        COMMENT '授权状态：pending=待授权，authorized=已授权，expired=已过期，failed=授权失败',
    `refreshToken` TEXT NULL COMMENT 'Google OAuth刷新令牌（加密存储）',
    `accessToken` TEXT NULL COMMENT 'Google OAuth访问令牌（临时）',
    `tokenExpiresAt` DATETIME(3) NULL COMMENT '访问令牌过期时间',
    `lastSyncAt` DATETIME(3) NULL COMMENT '最后同步广告系列数据的时间',
    `deletedAt` DATETIME(3) NULL COMMENT '软删除时间戳，NULL表示未删除',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '最后更新时间',
    
    PRIMARY KEY (`id`),
    UNIQUE KEY `MccAccount_mccId_userId_deletedAt_key` (`mccId`, `userId`, `deletedAt`) 
        COMMENT '唯一约束：同一用户的同一MCC账号（软删除后可重复添加）',
    INDEX `MccAccount_userId_idx` (`userId`),
    INDEX `MccAccount_authStatus_idx` (`authStatus`),
    
    CONSTRAINT `MccAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='MCC账号表：存储Google Ads MCC账号及授权信息';

-- 3. CID账号表 (Google Ads客户账号)
CREATE TABLE `CidAccount` (
    `id` VARCHAR(191) NOT NULL COMMENT 'CID账号记录唯一标识',
    `userId` VARCHAR(191) NOT NULL COMMENT '关联的用户ID',
    `mccAccountId` VARCHAR(191) NOT NULL COMMENT '关联的MCC账号ID',
    `cid` VARCHAR(100) NOT NULL COMMENT 'Google Ads客户账号ID（Customer ID）',
    `name` VARCHAR(200) NOT NULL COMMENT 'CID账号显示名称',
    `currency` VARCHAR(10) NULL COMMENT '账号货币代码（如USD、CNY）',
    `timezone` VARCHAR(50) NULL COMMENT '账号时区',
    `status` ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active' 
        COMMENT '账号状态：active=活跃，inactive=未激活，suspended=已暂停',
    `lastSyncAt` DATETIME(3) NULL COMMENT '最后同步广告系列数据的时间',
    `deletedAt` DATETIME(3) NULL COMMENT '软删除时间戳，NULL表示未删除',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '最后更新时间',
    
    PRIMARY KEY (`id`),
    UNIQUE KEY `CidAccount_cid_mccAccountId_deletedAt_key` (`cid`, `mccAccountId`, `deletedAt`) 
        COMMENT '唯一约束：同一MCC下的同一CID账号（软删除后可重复添加）',
    INDEX `CidAccount_userId_idx` (`userId`),
    INDEX `CidAccount_mccAccountId_idx` (`mccAccountId`),
    INDEX `CidAccount_status_idx` (`status`),
    
    CONSTRAINT `CidAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `CidAccount_mccAccountId_fkey` FOREIGN KEY (`mccAccountId`) REFERENCES `MccAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CID账号表：存储Google Ads客户账号信息，一个MCC可管理多个CID';

-- 4. 广告系列表 (核心业务表)
CREATE TABLE `Campaign` (
    `id` VARCHAR(191) NOT NULL COMMENT '广告系列记录唯一标识',
    `userId` VARCHAR(191) NOT NULL COMMENT '关联的用户ID',
    `cidAccountId` VARCHAR(191) NOT NULL COMMENT '关联的CID账号ID',
    `campaignId` VARCHAR(100) NOT NULL COMMENT 'Google Ads广告系列ID',
    `name` VARCHAR(255) NOT NULL COMMENT '广告系列名称',
    `countryCode` VARCHAR(10) NOT NULL COMMENT '投放国家代码（如US、UK、CN）',
    `lastClicks` INT NOT NULL DEFAULT 0 COMMENT '上次记录的点击数（用于判断是否有新增点击）',
    `todayClicks` INT NOT NULL DEFAULT 0 COMMENT '今日点击数（从Google Ads API实时获取）',
    `lastNewUrl` TEXT NULL COMMENT '最后更新的Final URL（落地页链接）',
    `replacementCountToday` INT NOT NULL DEFAULT 0 COMMENT '当日已执行的换链次数',
    `lastReplacementAt` DATETIME(3) NULL COMMENT '最后一次换链时间',
    `enabled` BOOLEAN NOT NULL DEFAULT true COMMENT '是否启用自动监控换链',
    `deletedAt` DATETIME(3) NULL COMMENT '软删除时间戳，NULL表示未删除',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '最后更新时间',
    
    PRIMARY KEY (`id`),
    UNIQUE KEY `Campaign_campaignId_cidAccountId_deletedAt_key` (`campaignId`, `cidAccountId`, `deletedAt`) 
        COMMENT '唯一约束：同一CID账号下的同一广告系列（软删除后可重复添加）',
    INDEX `Campaign_userId_idx` (`userId`),
    INDEX `Campaign_cidAccountId_idx` (`cidAccountId`),
    INDEX `Campaign_enabled_deletedAt_idx` (`enabled`, `deletedAt`) COMMENT '用于定时任务筛选启用的未删除广告系列',
    
    CONSTRAINT `Campaign_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `Campaign_cidAccountId_fkey` FOREIGN KEY (`cidAccountId`) REFERENCES `CidAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='广告系列表：存储需要监控的Google Ads广告系列信息';

-- 5. 联盟链接配置表 (一对多：一个广告系列可配置多个联盟链接)
CREATE TABLE `AffiliateConfig` (
    `id` VARCHAR(191) NOT NULL COMMENT '联盟配置记录唯一标识',
    `campaignId` VARCHAR(191) NOT NULL COMMENT '关联的广告系列ID',
    `affiliateLink` TEXT NOT NULL COMMENT '联盟链接URL（起始链接，需通过代理访问）',
    `targetDomain` VARCHAR(255) NOT NULL COMMENT '目标根域名（如example.com，用于验证最终落地页）',
    `countryCode` VARCHAR(10) NOT NULL COMMENT '国家代码，用于选择对应国家的代理IP',
    `maxRedirects` INT NOT NULL DEFAULT 10 COMMENT '最大允许跳转次数（302/301重定向）',
    `enabled` BOOLEAN NOT NULL DEFAULT true COMMENT '是否启用此联盟配置',
    `priority` INT NOT NULL DEFAULT 0 COMMENT '优先级（数字越小优先级越高，用于多配置场景）',
    `deletedAt` DATETIME(3) NULL COMMENT '软删除时间戳，NULL表示未删除',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '最后更新时间',
    
    PRIMARY KEY (`id`),
    INDEX `AffiliateConfig_campaignId_idx` (`campaignId`),
    INDEX `AffiliateConfig_enabled_priority_idx` (`enabled`, `priority`) COMMENT '用于查询启用的配置并按优先级排序',
    
    CONSTRAINT `AffiliateConfig_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='联盟链接配置表：存储广告系列的联盟链接配置信息';

-- 6. 代理供应商表 (多供应商管理)
CREATE TABLE `ProxyProvider` (
    `id` VARCHAR(191) NOT NULL COMMENT '代理供应商唯一标识',
    `name` VARCHAR(100) NOT NULL COMMENT '供应商名称',
    `apiEndpoint` VARCHAR(500) NOT NULL COMMENT 'API接口地址',
    `apiKey` TEXT NULL COMMENT 'API密钥（加密存储）',
    `apiSecret` TEXT NULL COMMENT 'API密钥Secret（加密存储，某些供应商需要）',
    `priority` INT NOT NULL DEFAULT 0 COMMENT '优先级（数字越小优先级越高，用于故障转移）',
    `enabled` BOOLEAN NOT NULL DEFAULT true COMMENT '是否启用',
    `maxRequestsPerMinute` INT NULL COMMENT '每分钟最大请求次数限制',
    `successRate` DECIMAL(5,2) NULL DEFAULT 100.00 COMMENT '成功率（百分比，用于监控）',
    `lastFailedAt` DATETIME(3) NULL COMMENT '最后一次失败时间',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '最后更新时间',
    
    PRIMARY KEY (`id`),
    INDEX `ProxyProvider_enabled_priority_idx` (`enabled`, `priority`) COMMENT '用于按优先级选择启用的供应商'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理供应商表：管理多个代理IP供应商';

-- 7. 已使用代理IP表 (24小时去重 - 按广告系列)
CREATE TABLE `UsedProxyIp` (
    `id` VARCHAR(191) NOT NULL COMMENT '使用记录唯一标识',
    `ip` VARCHAR(50) NOT NULL COMMENT '代理IP地址',
    `port` INT NOT NULL COMMENT '代理端口',
    `countryCode` VARCHAR(10) NOT NULL COMMENT '代理IP所属国家代码',
    `providerId` VARCHAR(191) NOT NULL COMMENT '关联的代理供应商ID',
    `campaignId` VARCHAR(191) NOT NULL COMMENT '关联的广告系列ID（按广告系列去重）',
    `usedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '使用时间（用于24小时清理）',
    
    PRIMARY KEY (`id`),
    INDEX `UsedProxyIp_ip_campaignId_usedAt_idx` (`ip`, `campaignId`, `usedAt`) 
        COMMENT '用于快速查询某IP在某广告系列24h内是否使用过',
    INDEX `UsedProxyIp_usedAt_idx` (`usedAt`) COMMENT '用于定时清理24小时前的记录',
    INDEX `UsedProxyIp_campaignId_idx` (`campaignId`),
    
    CONSTRAINT `UsedProxyIp_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `ProxyProvider`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `UsedProxyIp_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='已使用代理IP表：记录24小时内各广告系列使用的代理IP，防止重复使用';

-- 8. 监控日志表 (记录每次换链操作)
CREATE TABLE `MonitoringLog` (
    `id` VARCHAR(191) NOT NULL COMMENT '监控日志唯一标识',
    `campaignId` VARCHAR(191) NOT NULL COMMENT '关联的广告系列ID',
    `triggeredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '触发监控的时间',
    `todayClicks` INT NOT NULL COMMENT '触发时的今日点击数',
    `lastClicks` INT NOT NULL COMMENT '触发时的上次记录点击数',
    `newClicks` INT NOT NULL COMMENT '新增点击数（todayClicks - lastClicks）',
    `proxyIp` VARCHAR(50) NULL COMMENT '使用的代理IP地址',
    `proxyPort` INT NULL COMMENT '使用的代理端口',
    `providerId` VARCHAR(191) NULL COMMENT '使用的代理供应商ID',
    `affiliateLink` TEXT NULL COMMENT '访问的联盟链接',
    `finalUrl` TEXT NULL COMMENT '最终落地页URL',
    `redirectCount` INT NULL COMMENT '实际跳转次数',
    `status` ENUM('success', 'failed', 'skipped') NOT NULL COMMENT '执行状态：success=成功，failed=失败，skipped=跳过',
    `errorMessage` TEXT NULL COMMENT '失败原因或错误信息',
    `executionTime` INT NULL COMMENT '执行耗时（毫秒）',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '日志创建时间',
    
    PRIMARY KEY (`id`),
    INDEX `MonitoringLog_campaignId_triggeredAt_idx` (`campaignId`, `triggeredAt`) 
        COMMENT '用于查询某广告系列的历史监控记录',
    INDEX `MonitoringLog_status_idx` (`status`) COMMENT '用于统计成功率',
    INDEX `MonitoringLog_triggeredAt_idx` (`triggeredAt`) COMMENT '用于按时间范围查询',
    
    CONSTRAINT `MonitoringLog_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `MonitoringLog_providerId_fkey` FOREIGN KEY (`providerId`) REFERENCES `ProxyProvider`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='监控日志表：记录每次自动换链操作的详细日志';

-- 9. 系统配置表 (存储全局配置)
CREATE TABLE `SystemConfig` (
    `id` VARCHAR(191) NOT NULL COMMENT '配置项唯一标识',
    `key` VARCHAR(100) NOT NULL COMMENT '配置键名（如cron_interval）',
    `value` TEXT NOT NULL COMMENT '配置值（JSON或字符串）',
    `description` VARCHAR(500) NULL COMMENT '配置说明',
    `category` VARCHAR(50) NOT NULL DEFAULT 'general' COMMENT '配置分类（如general、monitoring、proxy）',
    `isPublic` BOOLEAN NOT NULL DEFAULT false COMMENT '是否对普通用户可见',
    `updatedBy` VARCHAR(191) NULL COMMENT '最后更新者用户ID',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
    `updatedAt` DATETIME(3) NOT NULL COMMENT '最后更新时间',
    
    PRIMARY KEY (`id`),
    UNIQUE KEY `SystemConfig_key_key` (`key`),
    INDEX `SystemConfig_category_idx` (`category`),
    
    CONSTRAINT `SystemConfig_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统配置表：存储全局系统配置项';

-- ============================================
-- 初始化默认系统配置
-- ============================================
INSERT INTO `SystemConfig` (`id`, `key`, `value`, `description`, `category`, `isPublic`) VALUES
(UUID(), 'cron_interval', '5', '监控任务执行间隔（分钟）', 'monitoring', true),
(UUID(), 'max_redirects', '10', '默认最大跳转次数', 'monitoring', true),
(UUID(), 'proxy_reuse_hours', '24', '代理IP去重时间窗口（小时）', 'proxy', true),
(UUID(), 'daily_replacement_limit', '100', '单个广告系列每日最大换链次数', 'monitoring', true),
(UUID(), 'request_timeout', '30000', 'HTTP请求超时时间（毫秒）', 'monitoring', true);
