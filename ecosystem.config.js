/**
 * PM2 生态系统配置文件
 *
 * 用法：
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --only web
 *   pm2 start ecosystem.config.js --only worker
 *
 * 查看状态：
 *   pm2 status
 *   pm2 logs
 *   pm2 monit
 *
 * 重启：
 *   pm2 restart all
 *   pm2 restart web
 *   pm2 restart worker
 */

module.exports = {
  apps: [
    // ============ Web 应用（Next.js） ============
    {
      name: 'web',
      script: 'node_modules/.bin/next',
      args: 'start -p 10111',
      cwd: __dirname,
      instances: 1, // 单实例（Next.js 内部已有 worker pool）
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 10111,
      },
      // 日志配置
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ============ Worker（监控任务消费者） ============
    {
      name: 'worker',
      script: 'npx',
      args: 'tsx scripts/monitor-worker.ts',
      cwd: __dirname,
      instances: 1, // 可根据负载增加（建议 1~4）
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      // 自动重启配置
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        WORKER_CONCURRENCY: 2, // 单进程并发数
      },
      // 日志配置
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },

    // ============ 可选：多 Worker 实例（高负载场景） ============
    // 如果 50 用户 × 4 分钟/用户仍然不够，可以启用更多 worker
    // {
    //   name: 'worker-2',
    //   script: 'npx',
    //   args: 'tsx scripts/monitor-worker.ts',
    //   cwd: __dirname,
    //   instances: 1,
    //   exec_mode: 'fork',
    //   env: {
    //     NODE_ENV: 'production',
    //     WORKER_CONCURRENCY: 2,
    //   },
    //   error_file: './logs/worker-2-error.log',
    //   out_file: './logs/worker-2-out.log',
    // },
  ],
}

