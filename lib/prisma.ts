/**
 * Prisma Client 实例配置
 * 包含软删除中间件
 */

import { PrismaClient } from '@prisma/client';

// 防止开发环境热重载时创建多个Prisma实例
const globalForPrisma = global as unknown as { prisma: PrismaClient };

// 创建Prisma Client实例
export const prisma = globalForPrisma.prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// ============================================
// 软删除中间件
// ============================================
prisma.$use(async (params, next) => {
  // 定义支持软删除的模型
  const softDeleteModels = ['MccAccount', 'CidAccount', 'Campaign', 'AffiliateConfig'];

  if (softDeleteModels.includes(params.model || '')) {
    // 拦截 delete 操作，转换为 update（设置 deletedAt）
    if (params.action === 'delete') {
      params.action = 'update';
      params.args['data'] = { deletedAt: new Date() };
    }

    // 拦截 deleteMany 操作，转换为 updateMany
    if (params.action === 'deleteMany') {
      params.action = 'updateMany';
      if (params.args.data !== undefined) {
        params.args.data['deletedAt'] = new Date();
      } else {
        params.args['data'] = { deletedAt: new Date() };
      }
    }

    // 拦截查询操作，自动过滤已软删除的记录
    if (params.action === 'findUnique' || params.action === 'findFirst') {
      params.action = 'findFirst';
      params.args.where = {
        ...params.args.where,
        deletedAt: null,
      };
    }

    if (params.action === 'findMany') {
      // 如果查询条件中没有明确指定 deletedAt，则默认过滤
      if (!params.args) {
        params.args = {};
      }
      if (!params.args.where) {
        params.args.where = {};
      }
      if (params.args.where.deletedAt === undefined) {
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }
    }

    // 拦截 count 操作
    if (params.action === 'count') {
      if (!params.args) {
        params.args = {};
      }
      if (!params.args.where) {
        params.args.where = {};
      }
      if (params.args.where.deletedAt === undefined) {
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }
    }

    // 拦截 update 和 updateMany 操作，确保不更新已删除的记录
    if (params.action === 'update' || params.action === 'updateMany') {
      if (!params.args.where) {
        params.args.where = {};
      }
      if (params.args.where.deletedAt === undefined) {
        params.args.where = {
          ...params.args.where,
          deletedAt: null,
        };
      }
    }
  }

  return next(params);
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
