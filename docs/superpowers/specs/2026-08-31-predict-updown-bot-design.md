# Predict.fun BTC 5 分钟涨跌预测市场交易系统设计文档

> 日期: 2026-08-31
> 状态: 设计完成（待实现计划）

## 概述

针对 Predict.fun 的 Chainlink 价格市场（`btc-updown-5m-{unix}`，每 5 分钟开盘结算）构建一套量化交易系统。核心思路：**先攒数据、再练校准概率、最后才放真钱**。系统不追求"预测方向"，而是输出校准后的上涨概率 `p_up`，经过含费用的期望值（EV）闸门过滤后，只在正边出现时下限价单。

100U 本金只用于**验证**，不用于**炼丹**——实盘不充当训练集。

## 目标与约束

| 项目 | 规格 |
|------|------|
| 市场 | Predict.fun Chainlink 价格市场，BTC 5 分钟涨跌（Up/Down/Flat） |
| 本金 | 100U（交易本金） |
| 部署 | 本地 Windows 11 机器（无 VPS），采集 24/7 跑 |
| 语言 | Python（采集/特征/模型/闸门/回测）+ TypeScript（执行层薄服务，w4） |
| 数据源 | Predict 官方 WS（盘口 + 价格）、REST 快照；币安现货 WS 做交叉校验 |
| 下单 | 官方 SDK `@predictdotfun/sdk`，仅 LIMIT |
| 模型 | GLM（带样条）→ LightGBM → NN（校准器），损失 logloss |
| 验证 | walk-forward 按日历切分，禁随机 shuffle |

## 架构

### 五单元进程切分

采集器独立守护进程写盘，模型/回测/闸门离线+在线独立进程读同一份存储。采集与训练彻底解耦。

```
[采集器 daemon] ──append──▶ SQLite（tick / market / settlement / trades）
                                  │ 按天导出
                                  ▼
[特征+标签] ──▶ [训练] ──▶ model 产物（p_up 校准器 + 特征版本 + 校准曲线）
                                  │
[闸门 EV] ◀── model + 实时盘口 ──▶ [纸上交易](w2-3) / [TS 执行层](w4)
```

- 采集器坏了/重跑不碰模型；模型/回测反复重放不碰采集。
- 闸门做成**纯函数/无状态**：`(p_hat, orderbook snapshot) → 决策`，便于单独测试与回测复用。

### 数据流

1. 采集器连 WS，订阅 `predictOrderbook/{marketId}` + `assetPriceUpdate/{feedId}`，盘口/价格变动即写一行 tick。
2. 结算 reaper 循环：窗口收盘后查官方结算结果，回填 `resolved`(1/0/-1) 与 `end_price`。
3. 特征构建器读 Parquet，按 `feature_version` 版本化，在决策点采样生成特征向量 + 标签。
4. 训练器做 walk-forward，产出校准后的 `p_up` 模型。
5. 闸门（纸上或实盘）读模型输出 + 实时盘口，算 EV，超门槛才下单/记一笔。
6. w4 起，TS 执行层用官方 SDK 下限价单，写交易 journal。

## 项目结构

```
predict-updown-bot/
├── collector/
│   ├── __init__.py
│   ├── ws_client.py          # WS 连接、订阅、重连、REST 快照 resync
│   ├── market_tracker.py     # 当前市场状态、窗口翻转订阅
│   ├── writer.py             # tick append（SQLite WAL）
│   └── settlement_reaper.py  # 收盘后回填 resolved/end_price（官方结果）
├── storage/
│   ├── schema.sql            # tick/market/settlement/trades 表结构
│   ├── db.py                 # SQLite 连接、初始化、WAL
│   └── export.py             # SQLite → Parquet（按天分区）
├── features/
│   ├── labels.py             # y = 1{end>start}，Flat 单列
│   ├── build.py              # 特征计算 + 决策点采样
│   └── versioning.py         # feature_version 管理
├── model/
│   ├── glm.py                # 带样条 GLM（逻辑回归）
│   ├── gbm.py                # LightGBM（小树、强正则）
│   ├── calibrate.py          # isotonic/Platt 校准
│   └── artifacts.py          # 模型 + 特征版本 + 校准曲线 序列化
├── gate/
│   ├── ev.py                 # EV 公式 + fee 计算
│   └── gate.py               # 纯函数决策 + 交易节奏（20s/45s/10-15s/2-3拍）
├── backtest/
│   ├── walk_forward.py       # 14d 训 / 7d 验，滚动
│   ├── fill_model.py         # 限价成交模型（当时 ask+深度，≤前1-2档，未成=0）
│   └── metrics.py            # OOS EV、回撤、交易数、校准曲线
├── paper/
│   └── paper_trader.py       # 在线版回测：同一闸门吃实时数据，写 trades，日报
├── executor/                 # w4 才动，TypeScript
│   ├── package.json
│   └── src/index.ts          # @predictdotfun/sdk LIMIT 下单、撤单、护栏、journal
├── config.yaml               # 参数：本金/单笔/阈值/护栏/时间节奏
└── requirements.txt
```

## 组件设计

### 1. 采集器（Collector）

**唯一交付物优先级（w1 只做这个）。**

- **单条 WS 连接共连两 topic**：`predictOrderbook/{marketId}` + `assetPriceUpdate/{feedId}`（feed 1 = BTC）。两条流走同一连接 → 到达时间共享同一本地时钟，天然消除"现货/盘口差 2 秒"的假滞后。**待调研**：若 API 强制分两条连接，降级为每行记两流各自到达时刻 + 周期性对表校准，偏移 >2s 标记该段数据可疑。
- **事件驱动写行**：盘口变或价格变即写（约 200–500ms 节流）。
- **市场翻转**：每 5 分钟滚一次。维护"当前市场"状态，翻转时自动订阅新市场盘口。`window_start` 从 slug `btc-updown-5m-{unix}` 解析，`window_end = window_start + 300s`，`price_to_beat` 从 REST 市场元数据取。
- **结算回填（reaper 循环）**：对已收盘窗口查官方结算结果，回填 `resolved`(1=Up,0=Down,-1=Flat) 与 `end_price`。**严禁用币安 K 线自己判涨跌**。官方结果拿不到 → 置 `resolved=NULL` 并重试，不伪造标签。
- **时钟**：UTC 毫秒，`ts_ms` = WS 到达时刻。Windows 上 `w32tm /resync` 定期校时；用 WS `assetPrice` 时间戳做交叉基准，记录本地墙钟偏移。
- **断线重连**：指数退避；重连后先拉 REST 快照 `GET /markets/{id}/orderbook` 重新对齐再续订。
- **可靠性**：SQLite WAL append-only；断电/重启后按 `ts_ms` 去重续写。

### 2. 存储 Schema

- `ticks`：一行一个采样点，索引 `(market_id, ts_ms)`。
  - `ts_ms, market_id, slug, window_start, window_end, price_to_beat, spot, up_bid, up_ask, up_bid_sz, up_ask_sz, spread, t_left_sec, resolved, end_price`
- `markets`：slug、window_start/end、price_to_beat、feed_id、最终 resolved、end_price、结算来源。
- `trades`：纸上与实盘每笔日志 `p_hat, ask, EV, filled?, settlement, fee`。
- Parquet 按天分区导出喂 pandas/LightGBM；特征构建器读 Parquet，`feature_version` 保证回测可复现。

### 3. 特征与标签

- 标签 `y = 1{end > start}`，只来自官方结算；`Flat`(resolved=-1) 单独一类，训练时可丢或标"不交易"。
- 特征（按重要性）：`d=(spot-strike)/strike`、`d/σ_5m`（近 1 小时 5 秒收益波动标准化）、`t_left` 与 `sqrt(t_left)`、Up ask、Down 价(1−Up bid，注意精度)、价差、前 3 档深度、开盘后已实现方向 / 最高最低相对 strike；`polymarketChance` 可选。
- **采样**：只在决策点（每 10–15s 一个）采样进训练/评估，不拿 200–500ms 每一行去训。

### 4. 模型

- 顺序：带样条 GLM（逻辑回归）→ LightGBM（小树、强正则）→ NN（最后，只当校准器）。
- 损失 logloss，看**校准**不看准确率；验证集上做 isotonic/Platt 校准，输出真正的 `p_up`。
- 产物 = 序列化模型 + 特征版本 + 校准曲线。
- 门槛：录满 2000+ 互不重叠窗口前，不上 GBM；两周约一千出头窗口，只够线性模型。

### 5. EV 闸门

- `EV_up = p̂·(1-a) − (1-p̂)·a − fee(a)`，`fee ≈ 2% × min(a, 1-a)`（50¢ 附近，按官方公式）。
- 仅 `EV > +2~3¢`（含费后）允许；Down 同样算（`a_down = 1 − up_bid`）；两边没边就空过。
- 节奏：开盘后 20s 不做、最后 30–45s 不做、每 10–15s 评估一次、信号持续 2–3 拍才下。

### 6. 回测 / 纸上交易

- walk-forward：前 14 天训、后 7 天验、滚动前移；**禁随机切分**（时间高度相关，随机 = 泄露未来）。
- 同一窗口只抽 1 个决策点进评估，避免重复计算同一根 K。
- 成交模型：用**当时 ask + 当时深度**，成交量 ≤ 前 1–2 档；计入 taker 费；限价未成记 0，不假设全成。
- 指标：样本外 EV、最大回撤、交易次数、校准曲线（10 桶：p̂=0.60 的桶实际胜率是否真 60%）。
- **样本外 EV ≤ 0 → 模型作废，不上实盘。**
- 纸上交易 = 回测在线版，同一闸门吃实时数据写 `trades`，每日输出信号数 / 假想 PnL / 校准图。

### 7. 执行层（TS，w4 才动）

- 薄 Node 服务用 `@predictdotfun/sdk`，**LIMIT only**，超 3–5s 未成撤。不市价扫薄盘。
- 硬护栏写进代码：单笔 2–3U、同时 1 笔、日亏 −15U 停、权益 <80U 停 24h。
- 每笔 journal：`p_hat、ask、EV、是否成交、结算、费`。
- API Key + 私钥只放本机环境变量，不进任何"一键训练"黑盒 exe。

## 错误处理

- WS 断连 → 指数退避 + REST 快照 resync。
- 时钟漂移 → 告警；spot/orderbook 偏移 >2s 标记数据可疑。
- 官方结算缺失 → `resolved=NULL` 重试，不伪造标签。
- 模型/闸门崩溃 → 采集器独立进程不受影响。

## 测试

- 采集器：回放捕获的 WS 帧（fixture），断言 schema 与对齐。
- 特征构建器：合成行单测。
- 标签：用官方结算 fixture 单测 reaper 回填。
- 闸门：EV 公式单测（50¢ 附近的 fee 边界、Flat 情形）。
- 回测：walk-forward harness 单测——断言无未来数据泄露、校准曲线 sanity。
- 执行层（w4）：SDK 有沙箱则 dry-run，否则纸上。

## 四周排期

| 周 | 内容 | 出口条件 |
|----|------|---------|
| w1 | 只录数据；核对 WS `assetPrice` 收盘 vs 盘面 Final Price / Price to Beat 链条 | 对齐无误，采集稳定 |
| w2–3 | 逻辑回归 + EV 闸门，仅纸上交易 | 每日：信号数、假想 PnL、校准图 |
| w4 | 纸上 EV 稳定为正，才拿 2U 真打，一天最多 5 笔 | 样本外 EV > 0 |

## 待调研项

实现前需确认：
- [ ] WS 订盘口/价格是否需要鉴权（文档提示部分实现无需 key，以实测为准）
- [ ] 单条 WS 连接能否同时订 `predictOrderbook` 与 `assetPriceUpdate` 两 topic
- [ ] 官方结算结果的获取方式（REST 端点 / 链上 Final Price）
- [ ] `price_to_beat`（开盘锚定）从哪个 REST 字段取
- [ ] fee 精确公式（官方费率，50¢ 附近约 2% 的精确系数）
- [ ] 币安现货 WS 交叉校验用哪个端点（公开现货 ticker 流）
- [ ] Chainlink Data Streams 是否需要订阅（交叉校验备用，可先不用）
