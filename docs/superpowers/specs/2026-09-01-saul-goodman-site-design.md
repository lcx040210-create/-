# Saul Goodman 恶搞律师官网 · 设计文档

> 2026-09-01 · 参考站 save-walt.onrender.com（《绝命毒师》savewalterwhite.com 忠实还原）

## 1. 目标与定位

做一个《风骚律师》(Better Call Saul) 里 Saul Goodman 的浮夸律师广告官网恶搞站。全英文文案，还原剧里那种深夜电视廉价律师广告的调性，带一个可交互小游戏 + 全玩家排行榜。

**核心体验：** 进站 → 填用户名(必填) + 邮箱(可选) → 玩「律师电话快答」小游戏 → 结算出胜诉指数和等级 → 进排行榜看所有玩家排名。

## 2. 视觉风格

- 亮黄色满屏底，深蓝 + 正红撞色（蓝西装红领带）。
- 超大号粗体大字报标题，像贴电线杆的传单。
- 复古 2000s 廉价律师广告质感：虚线边框、爆炸星形、加粗下划线、"AS SEEN ON TV" 徽章。
- 常驻交互元素：`CALL NOW` 按钮闪烁、`FREE CONSULTATION` 滚动条。

## 3. 页面结构（单页，锚点滚动，全英文）

1. **Hero** — `DID YOU KNOW YOU HAVE RIGHTS?` / `THE CONSTITUTION SAYS YOU DO!` + 主角大图 + 巨型 `BETTER CALL SAUL!` 按钮。
2. **About Saul** — `SAUL GOODMAN, ATTORNEY AT LAW` + 一排四张照 + 业务清单（车祸 / 工伤 / 刑事 / 被坑 / 离婚 / 白领犯罪，每项一行浮夸话术）。
3. **客户好评** — 几条假得离谱的五星好评，轮播。
4. **小游戏** — 律师电话快答（见 §5）+ 排行榜（见 §6）。
5. **Call Now** — 巨型电话按钮 + 免费咨询 + 底部恶搞免责声明（"结果不保证，但收费我保证"）。

## 4. 用户流程与数据

1. 进入页面弹注册框：`username`（必填，1–40 字符）+ `email`（可选，100 字符内）。提交调 `POST /api/players`，后端返回 `player_id`，前端存 `localStorage`。
2. 用户玩小游戏，结算后提交分数 `POST /api/scores`。
3. 排行榜 `GET /api/leaderboard` 展示所有玩家（用户名 + 胜诉指数 + 排名），不展示邮箱。

## 5. 小游戏：律师电话快答（v2）

**流程：** 电话铃响 → 客户情景（英文）→ 作答 → Saul 吐槽/夸一句 → 下一题 → 结算。

- **3 轮，每轮 5 题**，难度递增（第 3 轮最刁钻）。
- **题型两类：**
  - 单选：4 个选项里挑最 Saul 的诡辩回答（主题型）。
  - 判断：给客户诉求，判断 Saul 会不会接这个案子（对/错）。
- 题库 20 题，每轮随机抽 5 题（不重复）；每题限时 10 秒，超时按答错计。
- 全英文文案，原创恶搞，不照搬剧集剧本。

## 6. 评分标准（综合制）

```
单题得分 = 基础分 + 速度 bonus + 连击 combo
  基础分  = 答对 100 / 答错 0
  速度    = 剩余秒数 × 10        （上限 100）
  连击    = 20 × (连续答对题数 - 1)   （从第 2 题起算）
总分 = Σ 单题得分
满分 = 15 × (100 + 100) + 20 × (1+2+...+14) = 5100
胜诉指数 = min(100, round(总分 / 5100 × 100))
```

**等级映射：**

| 胜诉指数 | 等级 |
|---|---|
| ≥ 90 | Saul 认证顶级讼棍 (Saul-certified: Supreme Chicanery) |
| 70–89 | 够格接 Saul 电话 (Worthy of answering Saul's phones) |
| 50–69 | 先咨询你的律师 (Consult a lawyer... about consulting) |
| < 50 | 自首吧 (Turn yourself in) |

结算页展示：基础分、速度分、连击分、总分、胜诉指数、等级，逐项列明。

## 7. 后端 API（FastAPI + SQLite）

**表结构：**

```
players(id INTEGER PK, username TEXT NOT NULL, email TEXT, created_at INTEGER)
scores(id INTEGER PK, player_id INTEGER FK, win_index INTEGER, score INTEGER, created_at INTEGER)
```

**端点：**

- `POST /api/players` — 入参 `{username, email?}`，校验用户名非空、去重，返回 `{player_id}`。
- `POST /api/scores` — 入参 `{player_id, win_index, score}`，返回 `{rank, total_players}`。
- `GET /api/leaderboard` — 返回 top N（默认 50）`[{rank, username, win_index}]`，按 win_index 降序。
- `GET /api/health` — 健康检查。

**持久化说明（如实标注）：** 本地开发用 SQLite 文件；render 免费 web service 磁盘是 ephemeral（重启/部署会丢数据），若要排行榜持久需升级到 render Postgres 或 persistent disk。代码里 DB 路径与连接串从环境变量读，方便切换。

## 8. 文件结构

```
saul-goodman/
  backend/
    main.py          # FastAPI app + StaticFiles 托管前端
    db.py            # SQLite 连接 + 建表
    models.py        # Pydantic 请求/响应模型
    scoring.py       # 评分公式纯函数（可单测）
    requirements.txt
    tests/test_scoring.py
    tests/test_api.py
  frontend/
    index.html
    styles/main.css
    scripts/main.js   # 注册框/闪烁/轮播/锚点/电话动画
    scripts/game.js   # 题库存量 + 游戏状态机 + 提交分数
    images/
      saul-hero.jpg   # 主角大图  1200×900
      saul-1..4.jpg   # 四张小图  600×400
  README.md           # 本地运行 + render 部署 + 图片替换规格
```

## 9. 图片规格（占位图，用户本地替换）

我用风格化 SVG 占位图（黄底 + 标注文件名和尺寸）放到 `images/`，真实剧照由用户按同名同尺寸替换。**不抓取受版权保护的剧照。**

- `saul-hero.jpg` — 1200×900
- `saul-1.jpg` … `saul-4.jpg` — 600×400

## 10. 部署

- 单个 render web service：FastAPI 同时 serve 静态前端 + API。
- 环境变量：`DATABASE_URL`（默认本地 SQLite 文件路径）、`PORT`。
- 启动命令 `uvicorn main:app`。

## 11. 测试

- 后端：pytest 测 `scoring.py` 评分公式（边界：全对/全错/超时/连击）与 API（注册去重、提交分数、排行榜排序）。
- 前端：`game.js` 的状态机与计分抽成纯函数，用 Node 内置 `node --test` 跑。

## 12. 版权说明

- 招牌短句（`DID YOU KNOW YOU HAVE RIGHTS?`、`Better Call Saul!`）为功能性短句，可引用。
- 其余文案全部原创恶搞，不复制剧集台词剧本。
- 剧照不自动抓取，由用户本地替换。
