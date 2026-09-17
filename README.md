# student-lifecycle

教育机构学生生命周期管理系统 — 从咨询试听到排课、上课、续费的一条业务流水线。

> ⚠️ **首次访问部署链接需等约 1 分钟**：后端跑在 Render 免费档，15 分钟无流量会休眠；数据库是 Neon 免费档，compute 也会休眠。第一个请求在唤醒服务，之后恢复正常速度。

<!-- TODO(阶段7): 部署链接 + 测试账号 -->

## 设计文档

设计思路、数据模型、业务规则与页面草图见 **[DESIGN.md](./DESIGN.md)**。

## 技术栈

| 层 | 选择 |
|---|---|
| 前端 | Vite + React + TypeScript + TanStack Router + TanStack Query |
| UI | Tailwind CSS + shadcn/ui |
| 后端 | NestJS（唯一服务端：`/api/*` 提供 API，`/*` 托管 SPA 产物） |
| ORM / DB | Prisma + Neon Postgres |
| 部署 | Render 单服务 |

业务时间统一按 `Australia/Melbourne` 处理与展示。

## 本地运行

```bash
pnpm i

cp .env.example .env
# 填入 Neon 的两个连接串（带 -pooler 的给 DATABASE_URL，不带的给 DATABASE_URL_UNPOOLED）
# JWT_SECRET 可用 openssl rand -base64 32 生成
# LLM_API_KEY 留空也能跑，简报功能会自动降级

pnpm db:migrate
pnpm db:seed

pnpm dev
```

- API — http://localhost:3000
- Web — http://localhost:5173（dev server 把 `/api` 代理到 :3000，与生产同域）

## 验证业务规则在服务端

```bash
pnpm break-test
```

这个脚本绕过界面直接调 API，尝试违反各条业务规则，每条都应被拒绝。

<!-- TODO(阶段4): 补齐脚本与各条规则的预期状态码 -->

## AI 工具的使用

<!-- TODO(阶段8): 用在哪些环节、哪些 AI 建议未采纳及原因 -->

## 已知限制

<!-- TODO(阶段8): 与 DESIGN.md 的"第一版不做"清单呼应 -->
