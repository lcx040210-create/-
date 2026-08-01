# SmartMoney Lens 设计规格

## 概述

SmartMoney Lens 是一个链上聪明钱追踪与交易信号生成系统，在 Robinhood Chain（Arbitrum Orbit L2，Chain ID 4663）上监听标记钱包的链上行为，生成结构化交易信号，通过本地 Claude Code skill 和 OKX.AI ASP 服务双出口分发。

### 核心能力

- 手动 + 自动发现聪明钱钱包地址并持续跟踪
- 实时监听链上交易，识别 swap/mint/transfer 等行为
- 基于多维指标生成钱包画像（胜率、ROI、交易风格）
- 7 种信号模式匹配：首次买入、连续加仓、减仓预警、清仓离场、快速止盈、巨鲸异动、多人同向
- 加权置信度评分
- 双出口：Claude Code slash command（本地）+ OKX.AI A2MCP API（市场）

---

## 架构

```
                     Robinhood Chain (Chain ID 4663)
                            │
               ┌────────────┼────────────┐
               ▼            ▼            ▼
          RPC (WS)   Blockscout API  Price Feeds
               │            │         (CoinGecko / Dex)
               └──────┬─────┘            │
                      ▼                  │
                ┌──────────┐             │
                │ Scanner  │             │
                │ 区块监听  │             │
                │ 交易过滤  │             │
                └────┬─────┘             │
                     │                   │
                     ▼                   ▼
                ┌────────────────────────────┐
                │       Data Pipeline        │
                │  详情 → 方法识别 → 代币     │
                │  → 价格聚合 → 持久化        │
                └────────────┬───────────────┘
                             │
                             ▼
                ┌────────────────────────────┐
                │      Analysis Engine       │
                │  钱包画像 + 模式匹配         │
                │  + 置信度计算 + 信号生成     │
                └────────┬──────────┬────────┘
                         │          │
                         ▼          ▼
                  ┌─────────┐  ┌──────────────┐
                  │本地 Skill│  │ ASP Service  │
                  │FastAPI   │  │ A2A Gateway  │
                  │6 个命令  │  │ 4 个 API     │
                  └─────────┘  └──────────────┘
```

---

## 组件设计

### 1. Scanner（区块监听器）

#### 工作模式

| 模式 | 用途 | 触发 |
|------|------|------|
| 历史回扫 | 首次启动扫描过去区块，建立钱包数据库 | 一次性 / 按需 |
| 实时监听 | WebSocket 订阅 `newHeads`，拉交易列表匹配目标钱包 | 每区块持续 |

#### 钱包地址来源

1. **手动标记** — 用户直接添加的已知聪明钱 / 名人 / 机构地址
2. **自动发现** — 高活跃地址（高频、大额 swap、合约部署者），标记候选供用户确认
3. **外部导入** — Arkham / Nansen / Dune 标签数据作为种子钱包

#### 交易过滤规则

```
每笔交易：
  from 或 to 在跟踪集合中？
    ├─ 是 → 检查 method
    │       ├─ swap / mint / burn → 高价值 → 进入 Pipeline
    │       ├─ transfer（ERC20 / ETH）→ 中等 → 进入 Pipeline
    │       └─ approve / 其他 → 记录但不产生信号
    │
    └─ 否 → value > 5 ETH（可配）？
            ├─ 是 → 标记"大额未知交易"，评估是否加为新钱包
            └─ 否 → 丢弃
```

#### 可调参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 历史回扫深度 | 100,000 区块 | 约 7 天 |
| 最小交易金额 | 0.01 ETH | 过滤粉尘 |
| 大额警报阈值 | 5 ETH | 未标记地址大额交易 |
| 自动发现候选阈值 | 日均 ≥ 3 笔 | 触发候选建议 |

---

### 2. Data Pipeline

#### 处理流水线

```
Scanner 输出（tx hash + 触发钱包）
        │
        ▼
1. 交易详情拉取
   getTransactionReceipt + decode input data
        │
        ▼
2. 方法识别（4-byte selector → swap / mint / transfer / addLiq / removeLiq / bridge ...）
   → 未知 selector 标记 unknown 留后续补充
        │
        ▼
3. 代币信息解析
   tokenIn / tokenOut 地址 + 数量 + decimals
   → 代币地址映射缓存
        │
        ▼
4. 价格聚合（优先级）
   ① 同链 DEX 池子现货价（on-chain 报价，最准）
   ② CoinGecko API 兜底
   ③ 标记 price_unknown（不阻塞流水线）
        │
        ▼
5. 去重 + 写入 SQLite
   主键 = tx_hash + wallet_address
```

#### 方法识别

EVM 兼容链的 4-byte selector 匹配。维护 selector → 方法名映射表，覆盖 swap / transfer / mint / burn / addLiquidity / removeLiquidity / bridge / stake / unstake 等。DEX 路由合约通过 `to` 地址识别，用于定位对应交易池拉价格。

---

### 3. Analysis Engine

#### 钱包画像维度

```
基础信息
├── 地址 + 标签
├── 首次跟踪时间
└── 地址年龄（链上首笔交易至今）

战绩指标（滚动 30 天）
├── 胜率 = 盈利交易数 / 总交易数
├── 平均 ROI（买入 → 卖出价格变化百分比）
├── 夏普近似值 = 平均 ROI / ROI 标准差
├── 最大回撤
└── 平均持仓时间

交易风格标签
├── 频率：高频（日均 > 5） / 中频 / 低频（日均 < 1）
├── 偏好：Meme / DeFi / 稳定币 / 混合
├── 持仓周期：短线（< 1h） / 中线（1h-24h） / 长线（> 24h）
└── 规模：巨鲸 / 中大 / 小散

近期活跃度
├── 近 7 天交易数
├── 近 7 天总交易额（USD）
└── 当前持仓代币数
```

#### 信号类型

| 信号 | 触发条件 | 方向 |
|------|----------|------|
| `ENTRY` | 钱包首次买入某代币 | BUY |
| `BUYING` | 同一代币 24h 内 ≥ 2 次买入 | BUY |
| `WARNING` | 卖出部分持仓（非全部） | SELL |
| `EXIT` | 卖出全部持仓 | SELL |
| `FLIP` | 买入后 < 30min 卖出 | SELL |
| `WHALE_ALERT` | 未标记钱包单笔 > 20 ETH | BUY/SELL |
| `CONFLUENCE` | ≥ 3 个跟踪钱包同时买同一代币 | BUY |

#### 置信度计算

```
confidence = (
  wallet_win_rate  × 0.35 +
  position_size    × 0.25 +
  holding_time     × 0.15 +
  confluence       × 0.25
)
```

| 阈值 | 处理 |
|------|------|
| > 0.6 | 主推送 |
| 0.4 - 0.6 | 观察列表 |
| < 0.4 | 丢弃 |

#### 信号输出格式

```json
{
  "signal_id": "sig_xxx",
  "type": "ENTRY",
  "wallet_address": "0x...",
  "wallet_label": "SmartWhale_01",
  "token_address": "0x...",
  "token_symbol": "TOKEN",
  "direction": "BUY",
  "confidence": 0.78,
  "confidence_factors": {
    "wallet_win_rate": 0.72,
    "position_size_pct": 0.15,
    "confluence_count": 2
  },
  "tx_hash": "0x...",
  "block_number": 123456,
  "timestamp": 1718208000,
  "summary": "SmartWhale_01 首次买入 2.5 ETH TOKEN（占钱包 15%）"
}
```

---

### 4. 数据存储

使用 SQLite，三张核心表：

```sql
-- 钱包表
CREATE TABLE wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT UNIQUE NOT NULL,
    label TEXT,
    source TEXT DEFAULT 'manual',  -- manual / auto_discovered / imported
    status TEXT DEFAULT 'active',  -- active / candidate / archived
    added_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 交易表
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tx_hash TEXT NOT NULL,
    block_number INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    wallet_address TEXT NOT NULL,
    direction TEXT NOT NULL,          -- from / to
    method TEXT NOT NULL,             -- swap / transfer / mint / burn ...
    token_in_address TEXT,
    token_in_symbol TEXT,
    token_in_amount REAL,
    token_out_address TEXT,
    token_out_symbol TEXT,
    token_out_amount REAL,
    value_eth REAL,
    value_usd REAL,
    dex_router TEXT,
    gas_used INTEGER,
    gas_price_gwei REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tx_hash, wallet_address)
);

-- 信号表
CREATE TABLE signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,               -- ENTRY / BUYING / WARNING / EXIT / FLIP / WHALE_ALERT / CONFLUENCE
    wallet_address TEXT NOT NULL,
    token_address TEXT,
    direction TEXT NOT NULL,          -- BUY / SELL
    confidence REAL NOT NULL,
    confidence_factors TEXT,          -- JSON
    trigger_tx_hash TEXT NOT NULL,
    summary TEXT NOT NULL,
    dispatched INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

### 5. 双出口

#### 本地 Skill（Claude Code slash commands）

```
Claude Code ←→ FastAPI Server (localhost:8765)
                 ├── GET  /api/signals/recent
                 ├── GET  /api/wallets
                 ├── GET  /api/wallets/{address}/profile
                 ├── POST /api/wallets/add
                 ├── GET  /api/signals/confluence
                 └── GET  /api/health
```

| 命令 | API | 功能 |
|------|-----|------|
| `/smartmoney check` | `GET /signals/recent` | 最近信号汇总 |
| `/smartmoney wallet <addr>` | `GET /wallets/{addr}/profile` | 钱包完整画像 |
| `/smartmoney add <addr> <label>` | `POST /wallets/add` | 添加跟踪钱包 |
| `/smartmoney confluence` | `GET /signals/confluence` | 多人同向信号 |
| `/smartmoney start` | — | 启动 Scanner + Pipeline |
| `/smartmoney stop` | — | 停止监控 |

Skill 文件薄层（~15 行），只做读取配置 → 调 API → 展示结果，不含分析逻辑。

#### ASP Service（OKX.AI 市场）

| 字段 | 内容 |
|------|------|
| 名称 | SmartMoney Lens |
| 服务类型 | A2MCP（API 服务，按次付费） |
| 端点 | `https://<server>/a2a/signals` |

对外开放 4 个 API：signal-feed / wallet-profile / top-wallets / token-activity。

两个出口共用同一个 Analysis Engine 核心模块，仅暴露方式不同。

---

### 6. 部署

| 阶段 | 环境 | 说明 |
|------|------|------|
| 开发验证 | 本机 | Python 3.11+，web3.py + FastAPI + aiosqlite |
| 生产 | 云服务器 | 本机验证通过后迁移 |

---

## Robinhood Chain 参数

| 参数 | 值 |
|------|-----|
| 链名 | Robinhood Chain |
| Chain ID | 4663 |
| RPC | `rpc.mainnet.chain.robinhood.com` |
| Gas 代币 | ETH |
| 区块浏览器 | `robinhoodchain.blockscout.com` |
| 技术栈 | Arbitrum Orbit（乐观 Rollup），EVM 完全兼容 |
| 官方文档 | https://docs.robinhood.com/chain |

---

## 技术栈

| 组件 | 技术 |
|------|------|
| 语言 | Python 3.11+ |
| 链交互 | web3.py |
| API 框架 | FastAPI |
| 数据库 | aiosqlite（本地），后续可切 PostgreSQL |
| HTTP 客户端 | aiohttp |
| 价格源 | DEX 池子 on-chain + CoinGecko API |

---

## 后续扩展

- Solana / Ethereum / BSC 链支持（Scanner 插件化，每条链一个 adapter）
- 自动交易执行模块（信号 → 链上跟单）
- AI 钱包筛选（基于历史行为自动打分，替代纯规则匹配）
