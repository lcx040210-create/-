# API Relay — API 中转站设计规格

**日期：** 2026-05-24
**版本：** v1.0
**状态：** 待实施

---

## 1. 项目概述

构建一个 OpenAI/Anthropic 兼容格式的 API 转发平台。上游对接国产大模型 API（DeepSeek、通义千问、智谱等），下游以 GPT/Claude 别名模型名向用户暴露，赚取 token 差价。

**核心商业模式：** 低价采购国产模型 token → 映射为高价 GPT/Claude 品牌 → 卖给无法直接访问 OpenAI/Anthropic 的国内用户。

## 2. 目标用户

- **C 端：** 无法直接访问 OpenAI/Claude API 的国内开发者、学生
- **B 端：** 套壳站、AI 应用开发者，需要兼容 GPT/Claude 格式的 API 后端

## 3. 功能范围

### MVP 包含
- 用户注册/登录（Web 面板）
- API Key 管理（创建/删除）
- OpenAI 兼容代理端点（/v1/chat/completions, /v1/models, /v1/embeddings）
- Anthropic 兼容代理端点（/v1/messages, /v1/messages/stream）
- Anthropic ↔ OpenAI 双向格式转换
- 预付费余额系统（手动充值）
- 模型别名路由（gpt-4o → deepseek-chat, gpt-5.5 → deepseek-v4-pro, claude-opus-4-7 → deepseek-v4-pro, claude-sonnet-4-6 → deepseek-chat/glm-4）
- 代理清洗层（请求/响应/错误/SSE 清理，防上游泄露）
- 调用日志 + 用量统计
- 管理后台（用户管理、手动充值、路由/价格配置）

### MVP 不包含
- 在线支付（微信/支付宝）
- 邮件验证、手机验证
- 多语言
- 邀请返利
- 子账号/RBAC

## 4. 技术栈

| 层 | 选型 |
|----|------|
| 后端框架 | Python FastAPI |
| 数据库 | SQLite（SQLAlchemy ORM + aiosqlite 异步驱动） |
| HTTP 客户端 | httpx（异步，SSE 流式） |
| 认证 | JWT (python-jose) + bcrypt 密码哈希 |
| 前端 | 原生 HTML + 少量 JS，Jinja2 模板渲染 |
| 部署 | Docker Compose，单机 1核2G 轻量云 |

**为什么 SQLite：** MVP 阶段日活 < 200，SQLite 完全够用。后续升级 PostgreSQL 只需换连接串。

## 5. 架构设计

### 5.1 整体架构：分层单体

```
用户请求（Web面板 或 API调用）
        │
        ▼
┌─── Nginx（可选，生产环境）───┐
│    限流 / SSL / 静态文件      │
└──────────────┬───────────────┘
               │
               ▼
┌──────── FastAPI 应用 ─────────┐
│                                │
│  ┌ 用户面板 ┐ ┌ API网关 ┐ ┌ 管理后台 ┐
│  │/dashboard│ │ /v1/*  │ │ /admin  │
│  └────┬─────┘ └───┬────┘ └───┬─────┘
│       └───────────┼───────────┘
│                   ▼
│  ┌────────── Service 层 ──────────┐
│  │ 鉴权 → 查余额 → 路由 → 代理 → 计费 │
│  │  + ProxyCleaner 清洗层         │
│  │  + Anthropic↔OpenAI 格式转换   │
│  └──────────────┬────────────────┘
│                 ▼
│  ┌──────── Repository 层 ────────┐
│  │  用户 / API Key / 订单 / 日志  │
│  └──────────────┬────────────────┘
│                 ▼
└─────────────────┼────────────────
                  ▼
   ┌──────────┐      ┌──────────────┐
   │  SQLite  │      │ 上游 AI API   │
   │  数据库  │      │ DeepSeek/Qwen │
   └──────────┘      └──────────────┘
```

### 5.2 请求处理链（核心流程）

1. **AuthMiddleware** — 提取 Bearer Token → SHA256 → 查 api_keys 表 → 关联 user
2. **BalanceCheck** — 查余额，不足直接返回 402
3. **RouteLookup** — 查 model_routes 表，找到 alias → upstream_model + api_format
4. **FormatConvert**（仅 Anthropic） — 请求：Anthropic → OpenAI；响应：OpenAI → Anthropic
5. **ProxyCleaner.clean_request** — 替换 model 字段为上游名，移除不支持参数
6. **ProxyForward** — httpx 异步转发，SSE 流式逐块 yield
7. **ProxyCleaner.clean_response** — 替换 model 回别名，过滤 headers，重写错误
8. **Billing** — 收集 usage → 查 pricing → 扣费 → 写 usage_logs
   - 流式请求：在 SSE 流全部传输完成后扣费，不阻塞首字节
   - 非流式请求：响应完成后扣费
   - 扣费失败（并发导致余额不足）：记录 error，不回滚已发送的流式内容

### 5.3 格式转换要点（Anthropic ↔ OpenAI）

| 差异点 | Anthropic | OpenAI |
|--------|-----------|--------|
| 端点 | /v1/messages | /v1/chat/completions |
| system prompt | 顶层 system 字段 | messages 中 role=system |
| content 格式 | [{"type":"text","text":"..."}] | "string" |
| 结束原因 | stop_reason: "end_turn" | finish_reason: "stop" |
| token 统计 | input_tokens + output_tokens | prompt_tokens + completion_tokens |
| 流式事件 | content_block_delta 等 | SSE delta 结构 |

## 6. 数据库设计

### 6.1 users
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | 自增 |
| email | VARCHAR(255) UNIQUE | 登录邮箱 |
| password_hash | VARCHAR(255) | bcrypt |
| balance | DECIMAL(12,4) | 账户余额（元） |
| is_active | BOOLEAN | 封禁开关 |
| created_at | DATETIME | |

### 6.2 api_keys
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| user_id | INT FK | |
| key_hash | VARCHAR(255) | SHA256(完整key) |
| key_prefix | VARCHAR(12) | sk-abc123... 展示用 |
| name | VARCHAR(100) | 用户给 key 的标签 |
| is_active | BOOLEAN | |
| created_at | DATETIME | |

### 6.3 model_routes（核心）
| 字段 | 类型 | 说明 |
|------|------|------|
| alias_model | VARCHAR(50) PK | 用户看到的模型名，如 gpt-5.5 |
| upstream_provider | VARCHAR(50) | 上游厂商，如 deepseek |
| upstream_model | VARCHAR(50) | 上游真名，如 deepseek-v4-pro |
| api_format | VARCHAR(20) | "openai" 或 "anthropic" |
| is_active | BOOLEAN | 可随时下架 |

### 6.4 pricing
| 字段 | 类型 | 说明 |
|------|------|------|
| alias_model | VARCHAR(50) PK | |
| price_per_1k_input | DECIMAL(10,6) | 每千输入 token 价格 |
| price_per_1k_output | DECIMAL(10,6) | 每千输出 token 价格 |
| updated_at | DATETIME | |

### 6.5 transactions
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| user_id | INT FK | |
| amount | DECIMAL(12,4) | 正=充值，负=消费 |
| type | VARCHAR(20) | "topup" / "consumption" |
| balance_after | DECIMAL(12,4) | |
| note | TEXT | |
| created_at | DATETIME | |

### 6.6 usage_logs
| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT PK | |
| user_id | INT FK | |
| api_key_id | INT FK | |
| alias_model | VARCHAR(50) | 用户请求的模型名 |
| upstream_model | VARCHAR(50) | 实际调用的模型 |
| tokens_in | INT | |
| tokens_out | INT | |
| cost | DECIMAL(12,6) | |
| duration_ms | INT | |
| status | VARCHAR(20) | success / error / insufficient_balance |
| error_msg | TEXT | |
| created_at | DATETIME | |

## 7. API 设计

### 7.1 代理端点（Bearer API Key 鉴权）

**OpenAI 格式：**
- `POST /v1/chat/completions` — 聊天补全，支持 SSE 流式
- `POST /v1/embeddings` — 文本嵌入（可选）
- `GET /v1/models` — 返回静态别名列表

**Anthropic 格式：**
- `POST /v1/messages` — Claude Messages API
- `POST /v1/messages/stream` — Claude 流式

### 7.2 用户面板（Session Cookie 鉴权）

- `POST /api/auth/register` — 注册
- `POST /api/auth/login` — 登录
- `GET /api/me` — 用户信息 + 余额
- `GET /api/keys` — API Key 列表
- `POST /api/keys` — 创建 Key（返回完整 Key 仅此一次）
- `DELETE /api/keys/{id}` — 删除 Key
- `GET /api/usage?days=7` — 用量统计
- `GET /api/logs?page=1&model=gpt-5.5` — 调用历史
- `GET /api/pricing` — 价格表

### 7.3 管理后台（Admin Session 鉴权）

- `GET /admin/users` — 用户列表
- `POST /admin/users/{id}/topup` — 手动充值
- `POST /admin/users/{id}/ban` — 封禁
- `GET /admin/routes` — 查看路由
- `PUT /admin/routes/{model}` — 更新路由
- `PUT /admin/pricing/{model}` — 调整价格
- `GET /admin/stats` — 平台统计

## 8. 防上游泄露方案

### 8.1 高风险（必须处理）
1. 响应 body 中 model 字段替换为别名
2. 非 2xx 响应重写为标准错误格式
3. 响应头白名单过滤（只留 content-type, date, x-request-id）
4. /v1/models 返回静态别名列表，不透传上游

### 8.2 中风险（需要关注）
5. Token 计数不一致 → 使用上游 usage 数据，不本地计算
6. SSE 流式中的 model 字段 → 逐行扫描替换
7. 不支持功能的差异 → 路由层声明能力，不支持的请求在网关拒绝

### 8.3 ProxyCleaner 中间件
每个请求-响应必须经过统一的清洗层：clean_request → clean_response → clean_error → clean_sse_chunk，确保无遗漏。

## 9. 项目结构

```
api-relay/
├── app/
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 配置管理
│   ├── db.py                # SQLAlchemy 引擎
│   ├── dependencies.py      # FastAPI Depends
│   ├── api/
│   │   ├── proxy.py         # /v1/* 代理端点
│   │   ├── dashboard.py     # /api/* 用户面板
│   │   └── admin.py         # /admin/* 管理后台
│   ├── core/
│   │   ├── auth.py          # API Key + Session
│   │   ├── proxy.py         # HTTP 转发 + SSE
│   │   ├── cleaner.py       # ProxyCleaner
│   │   ├── converter.py     # Anthropic ↔ OpenAI
│   │   ├── router.py        # 模型路由
│   │   └── billing.py       # 计费扣费
│   ├── models/              # SQLAlchemy 模型
│   └── static/              # 前端静态文件
├── tests/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── .env.example
```

## 10. 部署

- **环境：** 阿里云/腾讯云 1核2G 轻量云
- **方式：** Docker Compose 一键启动
- **月成本：** ~50 元
- **数据库：** SQLite 文件挂载宿主机，定期备份

## 11. 定价策略（参考）

| 别名模型 | 上游 | 建议售价（每百万 token） | 上游成本 | 利润率 |
|----------|------|------------------------|---------|--------|
| gpt-4o | deepseek-chat | ¥15 | ~¥1.5 | ~10x |
| gpt-5.5 | deepseek-v4-pro | ¥45 | ~¥3 | ~15x |
| gpt-4-turbo | qwen-turbo | ¥25 | ~¥1 | ~25x |
| claude-sonnet-4-6 | deepseek-chat | ¥20 | ~¥1.5 | ~13x |
| claude-opus-4-7 | deepseek-v4-pro | ¥60 | ~¥3 | ~20x |

注：最终定价以实际运营为准。

## 12. 路线图

- **Phase 1（MVP，2-3周）：** 上述全部内容
- **Phase 2：** 在线支付、邮件通知、Redis 缓存 + 限流
- **Phase 3：** 智能路由（多上游自动切换）、PostgreSQL 迁移
- **Phase 4：** B端专属面板、API 文档站
