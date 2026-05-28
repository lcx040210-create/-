# 刷量引擎设计文档

> 日期: 2026-05-28
> 状态: 设计完成

## 概述

用于加密货币交易所的刷交易量引擎。支持单交易所自成交和跨交易所对倒两种模式，覆盖现货和永续合约。优先 Maker 挂单以最小化手续费损耗，不以盈利为目的。

## 目标与约束

| 项目 | 规格 |
|------|------|
| 交易所 | 币安 Alpha（币安主站 API）+ Bittap CEX，架构预留扩展 |
| 市场 | 现货 + 永续合约 |
| 交易对 | 高流动性 USDT 对（BTC/USDT、ETH/USDT） |
| 每账户数 | 每交易所单账户 |
| 损耗目标 | ≤ $2 / $10K 交易量 |
| 日交易量 | $10万 - $50万 |
| 语言 | Python |
| Web 面板 | 需要（状态查看 + 配置 + 日志） |

## 架构

### 五层架构

```
Web 层      FastAPI + Jinja2 + WebSocket
  ↕
引擎层      VolumeEngine（策略调度、模式切换、状态管理、并发控制）
  ↕
执行层      OrderExecutor（Maker 挂单、吃单、持仓对冲、盈亏计算）
  ↕
适配层      ExchangeAdapter（抽象基类）→ BinanceAdapter / BittapAdapter
  ↕
数据层      SQLite（订单、成交量、盈亏、配置）
```

### 核心数据流

1. Web 面板 → 启动/停止/配置 → VolumeEngine
2. VolumeEngine → 按模式选择策略 → 创建并发任务
3. 每个任务 → OrderExecutor → ExchangeAdapter
4. ExchangeAdapter → ccxt.pro / 自定义 WS → 交易所
5. 成交回报 → OrderExecutor → 更新盈亏 → 写 SQLite
6. WebSocket → 推送实时状态 → Web 面板刷新

## 项目结构

```
volume-engine/
├── main.py                 # 入口：FastAPI + 引擎启动
├── config.py               # 配置加载（YAML/环境变量）
├── engine/
│   ├── __init__.py
│   ├── volume_engine.py    # 核心引擎：调度、并发控制
│   ├── order_executor.py   # 订单执行：挂单、平仓、状态机
│   └── risk_manager.py     # 风控：硬限制、软告警、预算检查
├── exchange/
│   ├── __init__.py
│   ├── base.py             # ExchangeAdapter 抽象基类
│   ├── binance_adapter.py  # 币安适配器（ccxt.pro）
│   └── bittap_adapter.py   # Bittap 适配器（自定义 REST + WS）
├── web/
│   ├── __init__.py
│   ├── routes.py           # FastAPI 路由
│   ├── ws.py               # WebSocket 推送
│   ├── auth.py             # 登录认证
│   └── templates/          # Jinja2 模板
│       ├── dashboard.html
│       ├── login.html
│       ├── trades.html
│       └── settings.html
├── models/
│   ├── __init__.py
│   ├── database.py         # SQLite 连接与初始化
│   └── schema.py           # 表结构定义
├── static/                 # JS / CSS
├── config.yaml             # 默认配置
└── requirements.txt
```

## 刷量策略

### 模式 1：单交易所自成交（现货）

1. 获取 OrderBook（bid / ask）
2. 在 bid 挂买单（Maker），在 ask 挂卖单（Maker）
3. 双边均未成交 + 盘口变动 → 撤单重挂
4. 单边成交 → 反向 Taker 市价平仓
5. 平仓后进入下一轮

**永续合约变体：** 同时开多开空（Maker），形成对冲仓位。多空抵消，不需要平仓。注意资金费率双向平衡。

### 模式 2：跨交易所对倒

1. 同时获取币安和 Bittap OrderBook
2. 币安挂买单 @ bid，Bittap 挂卖单 @ ask（确保 bid < ask 避免套利者吃单）
3. 双边成交 → 各自反向平仓
4. 单边成交 → 超时 3-5 秒撤单 → 市价平仓

### 挂单策略

- **盘口跟随：** 始终在买一/卖一挂单，成交概率高但撤单频繁
- **深度插入：** 在 bid × 0.999 / ask × 1.001 挂单，更隐蔽，API 压力小

## 风控

### 硬限制（触发即停）

- 单轮最大亏损：$5
- 单日最大亏损：$50
- 最小余额：$100 USDT
- 最大持仓时间：30 秒
- Spread 上限：> 0.05% 暂停

### 软限制（告警不停）

- 撤单率 > 80%
- 连续 10 轮无成交
- 单小时交易量 < 目标的 50%
- API 错误率 > 5%
- 资金费率 > 0.1%

### Maker 三级降级

1. 纯 Maker：双边限价单等被动成交
2. Maker + 超时 Taker：N 秒未成交 → 撤单重挂（最多 3 次）→ 仍不成 → Taker
3. 放弃本轮：连续 3 轮使用 Taker → 暂停该对 5 分钟

## 周期状态机

```
IDLE → PLACING_ORDERS → WAITING_FILL → FILLED_BUY/FILLED_SELL → CLOSING → IDLE
                                        → TIMEOUT → CANCELING → RETRY → IDLE
                                        → PARTIAL_FILL → CLOSING → IDLE
```

## 交易所适配层

### 抽象接口（ExchangeAdapter, ABC）

```
fetch_ticker(symbol) -> Ticker
fetch_order_book(symbol, limit) -> OrderBook
create_limit_order(symbol, side, amount, price) -> Order
create_market_order(symbol, side, amount) -> Order
cancel_order(order_id, symbol) -> bool
fetch_balance() -> Balance
fetch_open_orders(symbol) -> list[Order]
fetch_positions() -> list[Position]        # 永续合约
set_leverage(symbol, leverage) -> bool
watch_order_book(symbol) -> AsyncIterator  # WebSocket 流
watch_orders(symbol) -> AsyncIterator
watch_balance() -> AsyncIterator
```

### BinanceAdapter

基于 ccxt.pro，开箱即用。支持现货 + 永续合约（UM）。注意速率限制（1200 req/min，权重制）和 BNB 抵扣。

### BittapAdapter

自定义实现。Bittap 使用独立 API 格式（非币安兼容）。

- REST: `https://openapi.bittap.com`
- WebSocket: 待调研具体端点
- 认证: 待确认具体签名算法
- 速率限制: 600 req/min, 10 req/s
- 响应格式: `{"code":"0","data":{},"msg":"成功","success":true}`
- 支持: 现货 + 永续合约 + WebSocket

## Web 面板

### 仪表盘
- 今日总交易量（USDT）
- 今日成交笔数
- 今日盈亏/损耗
- 运行状态（运行中/暂停/停止）
- 各交易对量分布（Chart.js 饼图）
- 24 小时成交量（Chart.js 折线图）
- WebSocket 实时推送

### 策略控制
- 启动/暂停/停止
- 模式切换（单交易所/跨交易所）
- 市场切换（现货/合约）
- 参数配置：交易对、每笔金额、超时、重试、日量上限、风控阈值

### 交易日志
- 按时间排序表格，筛选：日期、交易对、模式
- 每笔：时间、交易对、方向、数量、价格、手续费、净盈亏
- 导出 CSV，分页加载

### 交易所配置
- API Key/Secret 配置（加密存储）
- 交易所开关、连接状态、余额显示、手续费率
- 测试连接按钮

### 技术方案
- FastAPI 单进程，引擎和 Web 共享事件循环
- Jinja2 服务端渲染 + 原生 JS + Chart.js + WebSocket
- bcrypt + session cookie 登录认证

## Bittap API 待调研项

以下信息需要实现前确认：
- [ ] WebSocket 端点 URL 和协议格式
- [ ] 签名算法（HMAC-SHA256? 其他?）
- [ ] 永续合约的具体端点
- [ ] 手续费率结构（Maker/Taker）
- [ ] 是否支持 Bittap 平台币抵扣手续费
