# 北岭闸口 · Demo 设计文档（Northridge Gate）

> 状态：评审通过，待实现计划（writing-plans）
> 日期：2026-09-24
> 类型：第一人称辨认恐怖 / 窗口审判 · 单场景 · 约 12 分钟 · 4 名来访者
> 核心句：你不是在打怪，你是在盖章；盖错的章要到天亮才流血。

---

## 1. 概述

夜班安保透过观察窗判断来者是人、伪人还是感染者。放行、处决、收容三项**只改结局**；用错工具、不通风、闭眼休息留下当下的脏反馈，但**不当场死亡**。

- **平台**：轻量 3D Web —— Vite + TypeScript + Three.js（房间 + 4 机位）+ React（窗框 UI）
- **核心架构原则**：**内容 = 数据，引擎 = 薄运行时**。所有对话、访客、结局、San 效果、处决时间轴都是 typed 数据文件；引擎是通用状态机，不硬编码一句文案。
- **模型分工**：DeepSeek 出草稿 → Opus 5.5 精修（$20 封顶）→ Perchance 出图 → 组装进数据文件。

---

## 2. 目标 / 非目标

### 做
- 门卫室单场景（四个热点，不做全屋物理碰撞）
- 窗框 2D 对话 + 伪人定格（3–5 帧）
- 4 名来访者、3 种判定
- 一条通用处决时间轴 + 两套成功演出（刃 / 枪或火，至少实做一套）
- San、一次幻觉、沙发赌博
- 天亮翻牌结局

### 不做
- 实验室、综合楼、收容所、武器区
- 步枪、霰弹、锤子、匕首、毒药的独立流程
- 真实弹道、碎尸物理、对讲机剧情树
- 当场 Game Over

完整版预告：武器柜灰格标注「白班权限」。

---

## 3. 技术栈与架构

```
Vite + TypeScript + Three.js   ← 3D 房间 + 4 机位（越薄越好）
React                          ← 2D 窗框 UI（游戏本体）
纯 TS 状态机                    ← 判定 / San / 处决 / 翻牌
```

四层分离，单向依赖：

```
data/  ──▶  engine/  ──▶  ui/  ──▶  scene/
(内容)      (逻辑)       (窗框)     (3D 房间)
```

- **scene/**：Three.js 只干三件事——渲染小房间、4 机位切换、站窗前推近镜头。房间用 primitives + 贴图，不上 GLB、不做物理。
- **ui/**：React 承载窗框、立绘定格、三槽检视、三判定、处决时间轴、San 条、天亮翻牌。
- **engine/**：纯逻辑，不 import 一句文案，全部从 `data/` 读。
- **data/**：内容 = 数据，是 DeepSeek/Opus 分工的落点。

---

## 4. 仓库结构

```
northridge-gate/
  index.html
  package.json
  vite.config.ts
  tsconfig.json
  src/
    engine/          # 纯逻辑，不碰文案
      state.ts       # 全局状态机（来访序列、沙发闭眼、通风状态）
      judge.ts       # 三判定结算（只改结局，不即时结算）
      san.ts         # San 计算 + 四区间效果
      execution.ts   # 处决时间轴（成/败共用一条）
      endings.ts     # 天亮翻牌 → 结局映射
    scene/           # Three.js：房间 + 4 机位 + 热点
      room.ts
      cameras.ts
      hotspots.ts
    ui/              # React：窗框 / 立绘 / 检视 / 判定 / HUD
      Window.tsx
      Portrait.tsx
      Inspect.tsx
      Verdict.tsx
      ExecutionOverlay.tsx
      HUD.tsx
      Dawn.tsx
    data/            # ★ 内容 = 数据
      schema.ts      # 所有类型定义 + 字段注释（DeepSeek 的"合同"）
      visitors/
        v1-human.ts
        v2-skinfit.ts
        v3-suspicious-human.ts
        v4-coretick.ts
      world.ts       # 手册缺页 / 抽屉便利贴 / 对讲机碎片 / 灯箱
      items.ts       # 咖啡 / 镇静叶 / 斧 / 枪 / 焚化罐
      endings.ts     # 结局条件 + 两句文案
      san.ts         # San 区间文案
  public/
    assets/          # Perchance 产出（见 §8 命名规范）
```

---

## 5. 数据模型（schema.ts —— DeepSeek 的合同）

所有字段必须有注释。DeepSeek 照此批量填，字段缺一即报错。

```ts
// ===== 基础枚举 =====
type Verdict = 'admit' | 'execute' | 'contain'   // 三判定，只进结局
type Tool = 'axe' | 'gun' | 'fire'               // 处决工具
type Role = 'human' | 'skinfit' | 'coretick' | 'wetnest'  // Demo 启用：skinfit +（coretick 或 wetnest 二选一）+ 感染者状态
type VisitorState = 'clean' | 'infected'         // 感染者是状态，不是第 4 图鉴

// ===== 访客 =====
interface Visitor {
  id: string
  claimedName: string            // 自称姓名 / 工号
  role: Role
  state: VisitorState
  portrait: string               // 立绘路径
  freezeFrames: string[]         // 伪人 3–5 帧定格；人类只 1 帧
  glitchLine?: string            // 伪人卡帧句（错字/重复标点）；干净人类为空
  tells: {
    eye?: string                 // 眼检视结果（扣反应）
    id?: string                  // 证件检视结果（免费）
    questions: { q: string; a: string }[]  // 问一句，最多 2 问，扣反应
  }
  correctVerdict: Verdict
  correctTool?: Tool             // 处决时正确工具；收容/放行为空
  outcomes: Partial<Record<Verdict, Outcome>>
}

interface Outcome {
  text: string                   // 演出文案
  san?: number                   // San 变动（正负）
  flags: OutcomeFlag[]           // 记进隐藏分
}

type OutcomeFlag =
  | 'correct_admit' | 'correct_execute' | 'correct_contain'
  | 'killed_human' | 'released_pseudo' | 'contamination'
  | 'auto_released' | 'escaped'   // 逃逸 +1

// ===== 道具 =====
interface Item {
  id: string
  name: string
  desc: string                   // 首次拾取出一行说明
  effect: { san?: number; reaction?: number; constraint?: string }
}

// ===== 环境叙事 =====
interface WorldText {
  id: string
  surface: 'manual' | 'sticky' | 'radio' | 'lightbox' | 'drawer' | 'label'
  text: string
}

// ===== 结局 =====
interface Ending {
  id: 'passed' | 'contaminated' | 'unclean'
  condition: string              // 结算条件（伪代码/描述）
  lines: string[]                // 天亮翻牌两句文案
}

// ===== San 区间 =====
interface SanBand {
  min: number; max: number       // 0–100，开局 75
  effect: string
}

// ===== 处决时间轴 =====
interface Execution {
  tool: Tool
  frames: string[]               // 遮黑 + 定格 4 帧
  residue: string                // 玻璃残渣路径
  onSuccess: { san?: number; radioDistort?: boolean }
  onFailure: { san?: number; escaped: true }
}
```

---

## 6. 运行时规则（引擎要实现的确定性逻辑）

### 判定（只进结局）
放行 / 处决 / 收容，对错**不立刻结算**，记进每人一条隐藏分。

### 手续（当下脏反馈，仍不死）
- 用错处决工具 → 失败演出，对方逃走，结局「逃逸 +1」，掉 San 不掉关
- 化学/火后未开通风 → 封窗至开通风
- 沙发闭眼 → 见下

### 伪人破绽与正确处决
| 类型 | 破绽 | 正确处决 | 用错工具 |
|---|---|---|---|
| 贴皮 Skin-fit | 耳后接缝、眨眼不同步、证件牙齿数不对 | 斧（冷兵器） | 枪/火：逃走，逃逸+1 |
| 核响 Core-tick | 锁骨下金属嘀嗒；问天气答「和昨天一样」（窗外下雨） | 手枪（打头核） | 斧：反震，San-10，逃走 |
| 湿巢 Wet-nest（备选） | 指缝反光、呼气下沉、拒绝喝水 | 焚化罐 | 斧/枪：溅窗，封窗至通风 |
| 感染者（状态） | 喉结滑动反了 / 突然求快开门 | 收容 | 杀=误杀感染者；放=污染扩散 |

Demo 只启用核响 **或** 湿巢其一。

### 来访序列（4 人）
| 序 | 身份 | 目的 |
|---|---|---|
| 1 | 人类 | 教三按钮与检视 |
| 2 | 贴皮 | 斧处决演出 |
| 3 | 很像伪人的人类 | 高压误判 |
| 4 | 核响 或 湿巢 / 感染者 | 枪或火 / 收容 |

第 4 人若自称替班，对应抽屉留言「不要相信说自己是替班的人」。

### 检视三槽
眼（扣反应）/ 证（免费）/ 问一句（最多 2 问，扣反应）。反应条空了只能拍板。伪人有且仅有一句卡帧（错字或重复标点）。

### 处决时间轴（成/败共用一条）
1. 选「处决」 → 2. 选工具（非法工具可点，走失败分支） → 3. 2 秒遮黑 + 定格 4 帧 → 4. 玻璃残留不同 → 5. 回到空窗。
- 成功残渣：斧=窗沿暗痕+对讲机失真；枪=裂纹+耳鸣+San-5；火=窗框起雾，必须开通风
- 失败：同一时间轴，最后一帧「东西还站着」，然后走廊脚步远去

### San（0–100，开局 75）
| 区间 | 效果 |
|---|---|
| 70–100 | 正常 |
| 40–69 | 耳鸣、脸延迟一帧 |
| 15–39 | 手册「放行/处决」图标对调 0.4 秒 |
| 0–14 | 破绽可能反转显示 |

幻觉全 Demo 只触发一次：第 3 人到来前，走廊多一双鞋。

### 回复道具
| 道具 | 效果 | 限制 |
|---|---|---|
| 咖啡 | San+8，反应+ | 手抖 20 秒；机只出两杯，再按凉水 |
| 镇静叶 | San 下降变慢 | 反应上限 -30%；一次性 |
| 沙发 | 闭眼约 40 秒，San+20 | 全关一次 |

### 沙发
- 闭眼期间门外若有排队者：**必定自动放行 1 人**（门锁一声咔）
- 15%：爪痕，取消回血且 San-10
- 被放行者身份天亮翻牌

### 开局（可中断，≤40 秒）
1. 窗外剪影已等待 → 2. 强制开武器柜，高亮本班斧 + 手枪（或焚化罐）→ 3. 窗框贴纸亮三类对照 → 4. 咖啡/镇静叶首次拾取出一行说明 → 5. 手册可随时翻，缺页不补。

### 结局（天亮只出一张表 + 两句文案）
| 结局 | 条件 |
|---|---|
| 班次合格 | 误判 ≤1，且无放走须火/须枪之体 |
| 设施污染 | 任一伪人进门，或翻牌为伪人 |
| 隐藏：你也不干净 | 曾 San<15 且误杀 ≥1 → 镜中眨眼不同步 |

---

## 7. 内容生产流水线（成本优化 —— $20 Opus 5.5 封顶）

**原则：DeepSeek 出草稿 → Opus 5.5 只做「改」不做「写」 → Perchance 出图 → 组装。** 精修是「读 40K + 写 8K」，比从零写输出量小一个数量级，而昂贵的恰是输出。

| 环节 | 谁做 | 成本 |
|---|---|---|
| 代码骨架 + 引擎逻辑 + `schema.ts` | 本会话（DeepSeek API） | 白菜价 |
| 全部文案草稿（4 访客、环境叙事、结局、道具、UI） | DeepSeek | 白菜价 |
| 最终精修 pass（只改不写） | Opus 5.5 | ≈ $1–2 总量 |
| 立绘 + 定格 + 处决帧 + 剪影（SVG 矢量，Opus 直接写） | Opus 5.5 | ≈ $1–2 总量 |
| 融合进数据文件 + 跑通 | 本会话 | 白菜价 |

**Opus 5.5 只碰这六处高杠杆点（其余一律 DeepSeek）：**
1. 4 句卡帧（伪人那句错字/重复标点）——全游戏最见功力
2. 访客 #3「像伪人的人类」整段——高压误判的微妙
3. 结局两句文案 ×3——情绪落点
4. 环境叙事 3–4 段（手册缺页、抽屉便利贴、对讲机碎片）
5. 一段 voice bible（约 1500 字）——DeepSeek 与精修都照它定调
6. 视觉 bible + 全部 SVG 画面（立绘/定格帧/处决帧/UI）——文字破绽与画面破绽必须咬合

**预算账**（Opus 级 API 输出 $60–75/M 量级估算）：一次精修 ≈ 读 40K（≈$0.6）+ 写 8K（≈$0.6）≈ $1.2。返工 5–8 轮也仅 $10 上下，**$20 有充足余量**。DeepSeek 写几百 K 草稿成本忽略不计。

**落地顺序：**
1. 本会话产出 `schema.ts` + 引擎 + 代码骨架 + voice bible 草稿
2. DeepSeek 照 schema 批量出全部文案草稿
3. Opus 5.5 精修五处高杠杆点
4. Opus 5.5 写 SVG 画面（见 §8）
5. 本会话组装进数据文件、跑通

---

## 8. 资产清单与命名规范（Opus 5.5 写 SVG 矢量）

画面全部由 Opus 5.5 直接写 SVG（SVG 是文本，Opus 能出，无需位图管线）。3D 房间保留 Three.js primitives，不在此清单内。颗粒/血浆质感用 SVG filter（`feTurbulence` 噪点、`feColorMatrix` 调色）；伪人定格帧 = 同一张立绘的 SVG 变体，只差在破绽上。本 Demo 要的是「定格 4 帧」而非动画，正好对得上。

```
public/assets/
  portraits/
    v1_human.svg
    v2_skinfit_frame1..5.svg       # 伪人定格，第 3 帧必须露出破绽
    v3_suspicious_frame1..5.svg
    v4_coretick_frame1..5.svg
  exec/
    exec_axe_1..4.svg              # 处决成功 4 帧
    exec_gun_1..4.svg
    exec_fire_1..4.svg
    exec_fail_1..4.svg             # 「东西还站着」失败分支
  env/
    corridor_silhouette.svg        # 开场剪影
    shoes_hallucination.svg        # 幻觉多一双鞋
    window_residue_axe.svg         # 三种玻璃残渣
    window_residue_gun.svg
    window_residue_fire.svg
```

对应 schema 字段：`portrait`、`freezeFrames[]`、`Execution.frames[]`、`residue`。Opus 写 SVG，本会话填入路径。

---

## 9. 构建优先级

1. `schema.ts` + 引擎骨架（state/judge/san/execution/endings）
2. 四点场景 + 窗框 UI（scene + ui shell）
3. 4 个访客数据表 + 占位文案跑通
4. 处决时间轴（成/败）
5. San + 沙发 + 翻牌
6. 贴纸手册 + 两句结局 + 环境叙事

文案与定格优先于房间模型。

---

## 附：完整版只定接口

| 区域 | 接口 |
|---|---|
| 门卫室 | 入口审判（Demo） |
| 实验室 | 紫外 / 录音比对 |
| 综合楼 | 双窗口排队 |
| 收容所 | 处理你收押的人 |
| 武器区 | 步枪、霰弹、化学柜权限 |

Demo 分数作为存档带入。
