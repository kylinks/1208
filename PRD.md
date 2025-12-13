# Google Ads 联盟链接自动更换系统 PRD（v2.0 摘要版）

## 1. 背景与目标
- 目标：在发现广告系列出现新增点击时，自动用对应国家代理访问联盟链接，抓取最终落地页，并通过 Google Ads API 更新广告配置，降低链接失效/点击损耗风险。
- 价值：保障投放落地页始终有效，提高转化，减少人工排查与手动改链成本。

## 2. 使用场景示例
- 张三投放 US 减肥产品，广告系列 US-WeightLoss-2024。
- 今日点击从 50→52（新增），系统用 US 代理访问联盟链接，跟随跳转，根域名匹配后更新 Final URL，并记录日志。

## 3. 角色与权限
- 员工（租户内用户）：仅查看/操作自己绑定的 MCC、广告系列与配置。
- 管理员：可查看全部租户数据、配置代理供应商、查看全局监控日志。

## 4. 核心业务流程（循环）
1) 定时监控：每 N 分钟（默认 5）获取广告系列 todayClicks。
2) 触发判定：todayClicks > lastClicks → 触发换链。
3) 代理获取：按国家取代理 IP，校验 24h 未用。
4) 链路追踪：用代理访问 affiliateLink，跟随 3xx（maxRedirects=10）。
5) 验证：取最终 URL 根域名，与 targetDomain 比对。
6) 更新：调用 Google Ads API 更新 Final URL。
7) 记录：写入 lastClicks、lastNewUrl、监控日志，replacementCountToday+1。

## 5. 功能需求
### 5.1 配置管理
- 绑定/解绑 MCC 账号（含授权状态）。
- 广告系列列表：筛选、分页、软删除。
- 联盟链接配置：affiliateLink、targetDomain、countryCode、启用/禁用。
- 代理供应商管理：多供应商优先级与故障转移。

### 5.2 监控与执行
- Cron 周期可配（默认 5 分钟）。
- 新增点击判定：todayClicks > lastClicks 才执行。
- 代理去重：UsedProxyIp 记录 24h 内使用；失败切换下一供应商。
- 重定向追踪：最多 10 跳，超限标记失败。
- Final URL 更新：成功后写 lastClicks、lastNewUrl；失败写错误原因。

### 5.3 仪表盘
- 展示今日点击与上次点击对比，新增点击用绿色上升标记。
- 展示当日换链次数、最新 Final URL、最后更新时间。
- 链接更换状态标记（成功/失败）；失败显示原因。

### 5.4 日志与审计
- 监控日志：时间、广告系列、todayClicks/lastClicks、代理 IP、最终 URL、结果/错误。
- 变更审计：记录配置变更、MCC 授权变更。

### 5.5 清理与维护
- UsedProxyIp 定期清理（仅保留最近 24h）。
- 软删除：核心表含 deletedAt；查询默认过滤 deletedAt=null。
- 唯一键处理：允许软删除后重复添加（需唯一约束策略）。

## 6. 非功能需求
- 性能：单次循环支持批量广告系列遍历；代理获取与跳转请求需超时控制。
- 可用性：代理供应商故障自动切换；跳转过多/超时可限次重试。
- 安全：多租户隔离；所有 API 校验资源归属；敏感凭据加密存储。
- 兼容：Next.js 14+ App Router，TypeScript 5.x，Node 18+。

## 7. 技术栈与规范
- 前端/全栈：Next.js 14+ (App Router) + TypeScript。
- UI：Ant Design 5.x 主组件 + Tailwind CSS 3.x 布局微调。
- 后端：Next.js Route Handlers；node-cron 定时任务。
- ORM/DB：Prisma 5.x + MySQL 8.0+；Prisma Middleware 处理软删过滤。
- 鉴权：NextAuth.js / JWT。
- 注意：Route Handler 解析需 await request.json()；Prisma BigInt 返回前转 string。

## 8. 数据模型要点（摘要）
- User/Account：多租户用户。
- MccAccount：绑定的 Google Ads MCC，含授权状态，软删。
- Campaign：广告系列，关联用户与 MCC，存 lastClicks、lastNewUrl、replacementCountToday、deletedAt。
- AffiliateConfig：联盟链接配置（affiliateLink、targetDomain、countryCode、enabled、deletedAt）。
- UsedProxyIp：记录代理 IP、country、usedAt，供 24h 去重与清理。
- MonitoringLog：记录触发时间、点击对比、代理、最终 URL、结果/错误。

## 9. API/服务（概略）
- MCC 管理：创建/授权、刷新、软删、列表。
- 广告系列：列表/筛选、启用/禁用、软删。
- 联盟配置：CRUD、启用/禁用。
- 监控服务：Cron 触发 → 获取 clicks → 判定 → 代理 → 跳转 → 验证 → 更新 Final URL → 写日志。
- 日志查询：监控日志分页、按广告系列/日期筛选。

## 10. 监控与告警
- 指标：换链成功率、失败次数、代理获取失败率、平均跳转时延。
- 告警：连续失败 N 次、代理供应商全失败、跳转超限、Final URL 域名不匹配。

## 11. 测试要点
- 判定：todayClicks > lastClicks 时才换链；相等不触发。
- 代理去重：同一 IP 24h 内不得复用。
- 跳转链：超过 maxRedirects 需失败并记录。
- 域名校验：根域名不匹配应拒绝更新。
- 软删除：删除后可重复添加同唯一键。
- BigInt 序列化：接口返回不抛错。
- 多租户隔离：跨用户访问被拒绝。

## 12. 里程碑（建议）
- M1：数据模型与 Prisma 中间件（软删、唯一约束处理）。
- M2：MCC 绑定与广告系列读取（API + 前端列表）。
- M3：监控 Cron 闭环（点击拉取→代理→跳转→更新→日志）。
- M4：仪表盘与日志查询、告警基础。
- M5：清理任务与代理多供应商容错。
