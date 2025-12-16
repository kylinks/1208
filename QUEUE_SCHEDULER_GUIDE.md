# 队列版调度系统部署指南

本文档说明如何部署"每用户不同监控间隔"的队列版调度系统。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                          系统架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────┐     ┌─────────────┐     ┌─────────┐                │
│  │  Cron   │────▶│  Dispatcher │────▶│  Redis  │                │
│  │(每分钟) │     │  (API)      │     │ (队列)  │                │
│  └─────────┘     └─────────────┘     └────┬────┘                │
│                         │                  │                     │
│                         ▼                  ▼                     │
│                  ┌─────────────┐    ┌─────────────┐             │
│                  │   MySQL     │    │   Worker    │             │
│                  │(调度状态)   │    │ (执行任务)  │             │
│                  └─────────────┘    └─────────────┘             │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 组件说明

1. **Cron**：系统 crontab，每分钟触发一次 Dispatcher
2. **Dispatcher**：`/api/cron/one-click-start`，从 DB 找到期用户并入队
3. **Redis**：BullMQ 队列存储
4. **Worker**：`scripts/monitor-worker.ts`，消费队列并执行监控任务
5. **MySQL**：存储用户调度配置（`UserMonitorSchedule` 表）

## 部署步骤

### 1. 安装 Redis

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server

# 验证
redis-cli ping  # 应返回 PONG
```

### 2. 配置环境变量

在 `.env.production` 中添加：

```bash
# Redis 连接
REDIS_URL="redis://127.0.0.1:6379"

# 调度配置
DISPATCH_BATCH_SIZE=20          # 每次调度最多多少用户
DISPATCH_LOCK_TTL=900000        # 锁 TTL（15 分钟）
DEFAULT_INTERVAL_MINUTES=5      # 新用户默认间隔

# Worker 配置
WORKER_CONCURRENCY=2            # 单 Worker 并发数
```

### 3. 执行数据库迁移

```bash
# 方式 1：使用 Prisma migrate
npx prisma migrate dev --name add_user_monitor_schedule

# 方式 2：手动执行 SQL
mysql -u root -p your_database < prisma/migrations/20251216_add_user_monitor_schedule/migration.sql

# 生成 Prisma Client
npx prisma generate
```

### 4. 构建项目

```bash
npm run build
```

### 5. 使用 PM2 启动

```bash
# 创建日志目录
mkdir -p logs

# 启动所有服务
pm2 start ecosystem.config.js

# 或分别启动
pm2 start ecosystem.config.js --only web
pm2 start ecosystem.config.js --only worker

# 查看状态
pm2 status
pm2 logs
```

### 6. 配置 Cron（每分钟触发 Dispatcher）

```bash
crontab -e
```

添加：

```cron
* * * * * cd /path/to/project && node scripts/cron-one-click-start.mjs >> logs/cron.log 2>&1
```

## 使用说明

### 用户设置监控间隔

用户在"系统设置"页面可以：
- 启用/禁用自动监控
- 设置个人监控间隔（1-1440 分钟）
- 查看下次执行时间、上次执行状态
- 手动触发立即执行

### Dispatcher API

**调度模式**（默认）：
```bash
curl -X POST http://localhost:10111/api/cron/one-click-start \
  -H "x-cron-secret: your-secret"
```

**直接执行模式**（调试用）：
```bash
curl -X POST http://localhost:10111/api/cron/one-click-start \
  -H "x-cron-secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"userId": "xxx"}'
```

**同步执行模式**（无 Redis 环境）：
```bash
curl -X POST http://localhost:10111/api/cron/one-click-start \
  -H "x-cron-secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sync"}'
```

## 监控与运维

### 查看队列状态

```bash
# 通过 Redis CLI
redis-cli
> KEYS bull:monitor-user-tasks:*
> LLEN bull:monitor-user-tasks:wait
> LLEN bull:monitor-user-tasks:active
```

### PM2 常用命令

| 命令 | 说明 |
|------|------|
| `pm2 status` | 查看进程状态 |
| `pm2 logs` | 查看日志 |
| `pm2 logs worker` | 查看 Worker 日志 |
| `pm2 restart all` | 重启所有进程 |
| `pm2 restart worker` | 重启 Worker |
| `pm2 scale worker 2` | 扩展到 2 个 Worker |
| `pm2 monit` | 实时监控 |

### 扩容指南

如果 50 用户 × 4 分钟/用户仍然不够：

1. **增加 Worker 并发**：
   ```bash
   WORKER_CONCURRENCY=4 npm run worker
   ```

2. **增加 Worker 实例**：
   ```bash
   pm2 scale worker 2
   # 或在 ecosystem.config.js 中取消注释 worker-2
   ```

3. **调整 Dispatcher 批次大小**：
   ```bash
   DISPATCH_BATCH_SIZE=30
   ```

## 故障排查

### Worker 不消费任务

1. 检查 Redis 连接：
   ```bash
   redis-cli ping
   ```

2. 检查 Worker 日志：
   ```bash
   pm2 logs worker
   ```

3. 检查队列是否有任务：
   ```bash
   redis-cli LLEN bull:monitor-user-tasks:wait
   ```

### 任务重复执行

1. 检查是否有多个 Dispatcher 同时运行
2. 检查 `lockedUntil` 是否正常更新
3. 确保 `DISPATCH_LOCK_TTL` 大于任务执行时间

### 任务卡住

1. 检查 `lockedUntil` 是否过期
2. 手动清除锁：
   ```sql
   UPDATE UserMonitorSchedule 
   SET lockedUntil = NULL, lockedBy = NULL 
   WHERE lockedUntil < NOW();
   ```

## 回退方案

如果队列版有问题，可以临时回退到同步执行模式：

```bash
# 修改 cron 脚本，添加 mode=sync
curl -X POST http://localhost:10111/api/cron/one-click-start \
  -H "x-cron-secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"mode": "sync"}'
```

这会跳过队列，直接在 API 进程中串行执行所有到期用户。

