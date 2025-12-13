# 快速启动指南

## 🚀 5分钟启动项目

### 1. 安装依赖

```bash
npm install
```

### 2. 配置数据库

编辑 `.env` 文件,设置数据库连接:

```env
DATABASE_URL="mysql://root:password@localhost:3306/google_ads_system"
SHADOW_DATABASE_URL="mysql://root:password@localhost:3306/google_ads_system_shadow"
```

### 3. 初始化数据库

```bash
# 生成Prisma Client
npm run db:generate

# 推送数据库结构
npm run db:push
```

### 4. 启动开发服务器

```bash
npm run dev
```

### 5. 访问控制台

打开浏览器访问: http://localhost:10111/console

## 📱 控制台模块导航

- **控制台首页**: http://localhost:10111/console
- **链接管理**: http://localhost:10111/console/links
- **MCC管理**: http://localhost:10111/console/mcc
- **代理管理**: http://localhost:10111/console/proxy
- **系统设置**: http://localhost:10111/console/settings
- **日志查看**: http://localhost:10111/console/logs

## 🎯 当前功能状态

### ✅ 已完成(可立即使用)
- 所有控制台界面和交互
- 完整的数据库模型
- API路由结构
- 表单验证

### 🚧 待实现(需要开发)
- 用户登录认证
- Google Ads API集成
- 监控定时任务
- 代理IP获取逻辑
- 邮件/Webhook告警

## 💡 测试建议

1. **浏览所有页面** - 查看每个模块的界面设计
2. **测试表单** - 尝试添加/编辑功能(目前使用模拟数据)
3. **查看响应式** - 调整浏览器窗口测试移动端适配
4. **检查交互** - 测试按钮、开关、筛选等交互功能

## 📦 可选:使用Prisma Studio

查看和管理数据库:

```bash
npm run db:studio
```

访问 http://localhost:5555

## 🔧 常见问题

### 端口被占用
修改 `package.json` 中的端口号:
```json
"dev": "next dev -p 你的端口"
```

### 数据库连接失败
1. 确保MySQL服务已启动
2. 检查用户名和密码
3. 确认数据库已创建

### 依赖安装失败
尝试清除缓存后重新安装:
```bash
rm -rf node_modules package-lock.json
npm install
```

## 📚 更多文档

- **INSTALL.md** - 详细安装说明
- **CONSOLE_GUIDE.md** - 控制台使用指南
- **PROJECT_STATUS.md** - 项目完成状态
- **PRD.md** - 产品需求文档

## 🎉 开始探索

现在您可以开始浏览控制台界面了!

所有模块都已实现完整的UI交互,虽然目前使用的是模拟数据,但您可以:
- 查看各个模块的设计和布局
- 测试表单和交互功能
- 了解系统的整体架构
- 为后续开发做准备

祝您使用愉快! 🚀
