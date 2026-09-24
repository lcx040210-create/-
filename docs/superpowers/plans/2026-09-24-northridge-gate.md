# 北岭闸口 Demo 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Vite + TypeScript + Three.js + React 搭出一个能跑的「北岭闸口」Demo——数据驱动的窗口审判游戏，含引擎逻辑、4 机位场景、窗框 UI、处决时间轴、San 系统与天亮翻牌。

**Architecture:** 四层单向依赖 `data → engine → ui → scene`。内容 = 数据（`src/data/*`），引擎 = 纯函数状态机（`src/engine/*`），UI = React 窗框，scene = Three.js 房间 + 4 机位。引擎不 import 一句文案。

**Tech Stack:** Vite、TypeScript、React 18、Three.js、Vitest + @testing-library/react（jsdom）。

## Global Constraints

- **版本下限**：Node ≥ 18；React 18；TypeScript 5；Three.js ≥ 0.160；Vite 5；Vitest 1。
- **目录**：项目根目录新建 `northridge-gate/`（不在现有 english-platform 等目录内）。
- **引擎纯度**：`src/engine/*` 与 `src/data/*` 不得 import React、Three.js 或任何 DOM/浏览器 API，必须可在 jsdom 下测试。
- **内容 = 数据**：所有文案、访客、结局、San 区间、处决帧路径都在 `src/data/*`，引擎只读数据、不硬编码字符串。
- **文案先占位后填充**：本计划产出的 `data/visitors/*`、`world.ts`、`endings.ts` 内文本是「草稿级」占位，后续由 DeepSeek→Opus 5.5 内容流水线覆盖（不在本代码计划内）。Opus 5.5 API key 不写入任何文件。
- **命名规则**：类型名 PascalCase；函数名 camelCase；数据常量 UPPER_SNAKE（如 `VISITORS`、`SAN_BANDS`）。
- **TDD**：引擎任务先写失败测试再实现；UI 任务写渲染冒烟测试 + `npm run dev` 手动核对。
- **处决成功演出**：实做斧 + 枪两套，火不启用（spec §2「至少实做一套」，取枪）。「火后未开通风→封窗」手续因此不触发；通风开关保留为环境交互占位（`EXECUTIONS.fire` 数据保留但引擎不启用）。
- **手抖 20 秒**：仅作咖啡描述文字（`Item.effect.constraint`），不做计时/抖动逻辑（YAGNI，Demo 无该交互依赖）。

---

### Task 1: 项目脚手架

**Files:**
- Create: `northridge-gate/package.json`
- Create: `northridge-gate/tsconfig.json`
- Create: `northridge-gate/vite.config.ts`
- Create: `northridge-gate/index.html`
- Create: `northridge-gate/src/main.tsx`
- Create: `northridge-gate/src/App.tsx`
- Create: `northridge-gate/src/index.css`
- Test: `northridge-gate/src/App.test.tsx`

**Interfaces:**
- Produces: 可 `npm run dev` 启动、`npm test` 跑通的最小 Vite React 应用。

- [ ] **Step 1: 写 package.json 与依赖**

```json
{
  "name": "northridge-gate",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "three": "^0.160.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^15.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/three": "^0.160.0",
    "@vitejs/plugin-react": "^4.2.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: 写 vite.config.ts**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

- [ ] **Step 4: 写 test-setup 与 index.html、入口**

`src/test-setup.ts`：
```ts
import '@testing-library/jest-dom'
```

`index.html`：
```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>北岭闸口</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx`：
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

`src/index.css`：
```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #root { height: 100%; }
body { background: #0a0a0c; color: #d8d8d0; font-family: system-ui, sans-serif; }
```

- [ ] **Step 5: 写最小 App + 冒烟测试**

`src/App.tsx`：
```tsx
export default function App() {
  return <div data-testid="app">北岭闸口</div>
}
```

`src/App.test.tsx`：
```tsx
import { render, screen } from '@testing-library/react'
import App from './App'

it('renders the title', () => {
  render(<App />)
  expect(screen.getByTestId('app')).toHaveTextContent('北岭闸口')
})
```

- [ ] **Step 6: 安装依赖并跑通**

Run: `cd northridge-gate && npm install`
Run: `npm test` — Expected: 1 passing
Run: `npm run dev` — Expected: 浏览器打开 localhost:5173 显示「北岭闸口」

- [ ] **Step 7: Commit**

```bash
cd northridge-gate && git init && git add -A && git commit -m "chore: 脚手架（Vite+React+TS+Three.js+Vitest）"
```

---

### Task 2: 数据 schema（DeepSeek 的合同）

**Files:**
- Create: `northridge-gate/src/data/schema.ts`

**Interfaces:**
- Produces: 类型 `Verdict`、`Tool`、`Role`、`VisitorState`、`Surface`、`Outcome`、`Visitor`、`Item`、`WorldText`、`Ending`、`SanBand`、`Execution`。后续所有引擎与数据文件 import 这些类型。

- [ ] **Step 1: 写 schema.ts**

```ts
// 基础枚举
export type Verdict = 'admit' | 'execute' | 'contain'   // 三判定，只进结局
export type Tool = 'axe' | 'gun' | 'fire'               // 处决工具
export type Role = 'human' | 'skinfit' | 'coretick' | 'wetnest'
export type VisitorState = 'clean' | 'infected'         // 感染者是状态，不是第 4 图鉴
export type Surface = 'manual' | 'sticky' | 'radio' | 'lightbox' | 'drawer' | 'label'

// 判定结果（文案 + San 变动；对错由引擎推导，不写在数据里）
export interface Outcome {
  text: string
  san?: number
}

export interface Visitor {
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

export interface Item {
  id: string
  name: string
  desc: string                   // 首次拾取出一行说明
  effect: { san?: number; reaction?: number; constraint?: string }
}

export interface WorldText {
  id: string
  surface: Surface
  text: string
}

export interface Ending {
  id: 'passed' | 'contaminated' | 'unclean'
  condition: string              // 结算条件（供显示）
  lines: string[]                // 天亮翻牌两句文案
}

export interface SanBand {
  min: number
  max: number                    // 0–100，开局 75
  effect: string
}

export interface Execution {
  tool: Tool
  frames: string[]               // 遮黑 + 定格 4 帧
  residue: string                // 玻璃残渣路径
  onSuccess: { san?: number; radioDistort?: boolean }
  onFailure: { san?: number; escaped: true }
}
```

> 注：相比 spec §5，去掉了数据里的 `OutcomeFlag` 枚举——对错、逃逸、误杀都由引擎根据 `correctVerdict`/`correctTool`/`role` 推导，DeepSeek 填数据时无需手写 flag，减少出错面。

- [ ] **Step 2: 类型检查通过**

Run: `cd northridge-gate && npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: 数据 schema 类型定义"
```

---

### Task 3: 引擎 types + judge（判定结算）

**Files:**
- Create: `northridge-gate/src/engine/types.ts`
- Create: `northridge-gate/src/engine/judge.ts`
- Test: `northridge-gate/src/engine/judge.test.ts`

**Interfaces:**
- Consumes: `Visitor`、`Verdict`、`Tool`、`Outcome`（schema.ts）
- Produces: `Judgment`、`resolveVerdict(visitor, verdict, tool?)`；`VisitorRecord`、`Phase`、`GameState`（types.ts，供后续任务）

- [ ] **Step 1: 写 engine/types.ts**

```ts
import type { Visitor, Verdict, Tool, Outcome } from '../data/schema'

export interface Judgment {
  verdict: Verdict
  tool?: Tool
  correct: boolean       // 判定是否正确（含工具）
  escaped: boolean       // 用错工具导致逃走
  outcome: Outcome
}

export interface VisitorRecord {
  visitorId: string
  role: Visitor['role']
  state: Visitor['state']
  correctTool?: Tool
  verdict: Verdict
  tool?: Tool
  correct: boolean
  escaped: boolean
  sanAtJudge: number
}

export type Phase = 'opening' | 'visitor' | 'dawn'

export interface GameState {
  phase: Phase
  san: number
  reaction: number
  reactionMax: number
  ventilationOn: boolean
  sofaUsed: boolean
  coffeeUsed: number
  sedativeUsed: boolean
  hallucinationTriggered: boolean
  visitorIndex: number
  records: VisitorRecord[]
  autoReleased: Visitor | null
  sanTouchedBelow15: boolean
}
```

- [ ] **Step 2: 写失败测试 judge.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { resolveVerdict } from './judge'
import { v1Human } from '../data/visitors/v1-human'
import { v2Skinfit } from '../data/visitors/v2-skinfit'

describe('resolveVerdict', () => {
  it('admitting a clean human is correct', () => {
    const j = resolveVerdict(v1Human, 'admit')
    expect(j.correct).toBe(true)
    expect(j.escaped).toBe(false)
  })

  it('executing a skinfit with an axe is correct', () => {
    const j = resolveVerdict(v2Skinfit, 'execute', 'axe')
    expect(j.correct).toBe(true)
    expect(j.escaped).toBe(false)
  })

  it('executing a skinfit with a gun causes escape', () => {
    const j = resolveVerdict(v2Skinfit, 'execute', 'gun')
    expect(j.correct).toBe(false)
    expect(j.escaped).toBe(true)
  })

  it('executing a human is wrong but not an escape', () => {
    const j = resolveVerdict(v1Human, 'execute', 'axe')
    expect(j.correct).toBe(false)
    expect(j.escaped).toBe(false)
  })
})
```

- [ ] **Step 3: 运行测试确认失败（缺 data/visitors 与 judge）**

Run: `cd northridge-gate && npx vitest run src/engine/judge.test.ts`
Expected: FAIL —— 找不到 `./judge` 与 `../data/visitors/v1-human`

- [ ] **Step 4: 写 judge.ts（先实现引擎，占位数据下一步补）**

```ts
import type { Visitor, Verdict, Tool } from '../data/schema'
import type { Judgment } from './types'

export function resolveVerdict(visitor: Visitor, verdict: Verdict, tool?: Tool): Judgment {
  const correctVerdict = verdict === visitor.correctVerdict
  let toolCorrect = true
  let escaped = false
  // 只有「该处决的伪人」用错工具才算逃逸；杀错目标不算逃逸
  if (verdict === 'execute' && visitor.correctVerdict === 'execute' && visitor.correctTool) {
    toolCorrect = tool === visitor.correctTool
    escaped = !toolCorrect
  }
  const correct = correctVerdict && toolCorrect
  const outcome = visitor.outcomes[verdict] ?? { text: '', san: 0 }
  return { verdict, tool, correct, escaped, outcome }
}
```

- [ ] **Step 5: 补占位访客数据让测试通过**

Create `src/data/visitors/v1-human.ts` 与 `v2-skinfit.ts`（完整内容见 Task 8；此处先建最小可测版）：

```ts
// src/data/visitors/v1-human.ts
import type { Visitor } from '../schema'

export const v1Human: Visitor = {
  id: 'v1-human', claimedName: '调度 · 林远', role: 'human', state: 'clean',
  portrait: '/assets/portraits/v1_human.png',
  freezeFrames: ['/assets/portraits/v1_human.png'],
  tells: { eye: '眼神正常。', id: '证件一致。', questions: [] },
  correctVerdict: 'admit',
  outcomes: { admit: { text: '放行。', san: 0 }, execute: { text: '误杀。', san: -15 }, contain: { text: '误收容。', san: -8 } },
}
```

```ts
// src/data/visitors/v2-skinfit.ts
import type { Visitor } from '../schema'

export const v2Skinfit: Visitor = {
  id: 'v2-skinfit', claimedName: '维修 · 陈默', role: 'skinfit', state: 'clean',
  portrait: '/assets/portraits/v2_skinfit_frame1.png',
  freezeFrames: ['/assets/portraits/v2_skinfit_frame1.png', '/assets/portraits/v2_skinfit_frame2.png', '/assets/portraits/v2_skinfit_frame3.png'],
  glitchLine: '我是来修灯的。。灯的线路出了问题',
  tells: { eye: '他眨眼，两只眼睛节奏不一样。', id: '证件牙齿数对不上。', questions: [] },
  correctVerdict: 'execute', correctTool: 'axe',
  outcomes: { admit: { text: '放走伪人。', san: -10 }, execute: { text: '斧落。', san: 0 }, contain: { text: '收容。', san: -8 } },
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd northridge-gate && npx vitest run src/engine/judge.test.ts`
Expected: 4 passing

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: 引擎 types + judge 判定结算"
```

---

### Task 4: san 引擎

**Files:**
- Create: `northridge-gate/src/engine/san.ts`
- Create: `northridge-gate/src/data/san.ts`
- Test: `northridge-gate/src/engine/san.test.ts`

**Interfaces:**
- Consumes: `SanBand`（schema.ts）
- Produces: `applySanDelta(current, delta): number`（clamp 0–100）、`getSanBand(san, bands): SanBand`；数据 `SAN_BANDS`

- [ ] **Step 1: 写失败测试 san.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { applySanDelta, getSanBand } from './san'
import { SAN_BANDS } from '../data/san'

describe('applySanDelta', () => {
  it('clamps to 0..100', () => {
    expect(applySanDelta(50, 100)).toBe(100)
    expect(applySanDelta(50, -100)).toBe(0)
  })
  it('leaves mid values unchanged', () => {
    expect(applySanDelta(75, -10)).toBe(65)
  })
})

describe('getSanBand', () => {
  it('maps san to the correct band effect', () => {
    expect(getSanBand(75, SAN_BANDS).effect).toBe('正常')
    expect(getSanBand(50, SAN_BANDS).effect).toContain('耳鸣')
    expect(getSanBand(10, SAN_BANDS).effect).toContain('反转')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd northridge-gate && npx vitest run src/engine/san.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 data/san.ts**

```ts
import type { SanBand } from './schema'

export const SAN_BANDS: SanBand[] = [
  { min: 70, max: 100, effect: '正常' },
  { min: 40, max: 69, effect: '耳鸣、脸延迟一帧' },
  { min: 15, max: 39, effect: '手册「放行/处决」图标对调 0.4 秒' },
  { min: 0, max: 14, effect: '破绽可能反转显示' },
]
```

- [ ] **Step 4: 写 engine/san.ts**

```ts
import type { SanBand } from '../data/schema'

export function applySanDelta(current: number, delta: number): number {
  return Math.max(0, Math.min(100, current + delta))
}

export function getSanBand(san: number, bands: SanBand[]): SanBand {
  return bands.find((b) => san >= b.min && san <= b.max) ?? bands[bands.length - 1]
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/engine/san.test.ts`
Expected: 3 passing

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: san 计算 + 区间映射"
```

---

### Task 5: execution 引擎（处决时间轴）

**Files:**
- Create: `northridge-gate/src/engine/execution.ts`
- Create: `northridge-gate/src/data/executions.ts`
- Test: `northridge-gate/src/engine/execution.test.ts`

**Interfaces:**
- Consumes: `Visitor`、`Tool`、`Execution`（schema.ts）
- Produces: `ExecutionResult`、`resolveExecution(visitor, tool)`；数据 `EXECUTIONS: Record<Tool, Execution>`

- [ ] **Step 1: 写失败测试 execution.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { resolveExecution } from './execution'
import { v2Skinfit } from '../data/visitors/v2-skinfit'
import { v4Coretick } from '../data/visitors/v4-coretick'

describe('resolveExecution', () => {
  it('axe succeeds against skinfit', () => {
    const r = resolveExecution(v2Skinfit, 'axe')
    expect(r.success).toBe(true)
    expect(r.escaped).toBe(false)
  })
  it('gun escapes against skinfit', () => {
    const r = resolveExecution(v2Skinfit, 'gun')
    expect(r.success).toBe(false)
    expect(r.escaped).toBe(true)
  })
  it('gun succeeds against coretick', () => {
    const r = resolveExecution(v4Coretick, 'gun')
    expect(r.success).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd northridge-gate && npx vitest run src/engine/execution.test.ts`
Expected: FAIL（缺 v4-coretick、execution）

- [ ] **Step 3: 写 data/executions.ts**

```ts
import type { Execution, Tool } from './schema'

export const EXECUTIONS: Record<Tool, Execution> = {
  axe: {
    tool: 'axe',
    frames: ['/assets/exec/exec_axe_1.png', '/assets/exec/exec_axe_2.png', '/assets/exec/exec_axe_3.png', '/assets/exec/exec_axe_4.png'],
    residue: '/assets/env/window_residue_axe.png',
    onSuccess: { san: 0, radioDistort: true },
    onFailure: { san: -10, escaped: true },
  },
  gun: {
    tool: 'gun',
    frames: ['/assets/exec/exec_gun_1.png', '/assets/exec/exec_gun_2.png', '/assets/exec/exec_gun_3.png', '/assets/exec/exec_gun_4.png'],
    residue: '/assets/env/window_residue_gun.png',
    onSuccess: { san: -5, radioDistort: false },
    onFailure: { san: -5, escaped: true },
  },
  fire: {
    tool: 'fire',
    frames: ['/assets/exec/exec_fire_1.png', '/assets/exec/exec_fire_2.png', '/assets/exec/exec_fire_3.png', '/assets/exec/exec_fire_4.png'],
    residue: '/assets/env/window_residue_fire.png',
    onSuccess: { san: 0, radioDistort: false },
    onFailure: { san: -5, escaped: true },
  },
}
```

- [ ] **Step 4: 写 engine/execution.ts**

```ts
import type { Visitor, Tool } from '../data/schema'
import { EXECUTIONS } from '../data/executions'

export interface ExecutionResult {
  success: boolean
  frames: string[]
  residue: string
  sanDelta: number
  radioDistort: boolean
  escaped: boolean
}

export function resolveExecution(visitor: Visitor, tool: Tool): ExecutionResult {
  const exec = EXECUTIONS[tool]
  const success = visitor.correctTool === tool
  if (success) {
    return {
      success: true,
      frames: exec.frames,
      residue: exec.residue,
      sanDelta: exec.onSuccess.san ?? 0,
      radioDistort: exec.onSuccess.radioDistort ?? false,
      escaped: false,
    }
  }
  return {
    success: false,
    frames: exec.frames,
    residue: exec.residue,
    sanDelta: exec.onFailure.san ?? -10,
    radioDistort: false,
    escaped: true,
  }
}
```

- [ ] **Step 5: 补 v4-coretick 占位数据（最小可测版）**

```ts
// src/data/visitors/v4-coretick.ts
import type { Visitor } from '../schema'

export const v4Coretick: Visitor = {
  id: 'v4-coretick', claimedName: '替班 · 周齐', role: 'coretick', state: 'clean',
  portrait: '/assets/portraits/v4_coretick_frame1.png',
  freezeFrames: ['/assets/portraits/v4_coretick_frame1.png', '/assets/portraits/v4_coretick_frame2.png', '/assets/portraits/v4_coretick_frame3.png'],
  glitchLine: '我来替班，你们，快开门',
  tells: { eye: '锁骨下有金属嘀嗒声。', id: '证件崭新得不像话。', questions: [] },
  correctVerdict: 'execute', correctTool: 'gun',
  outcomes: { admit: { text: '放走。', san: -12 }, execute: { text: '命中核。', san: -5 }, contain: { text: '收容。', san: -8 } },
}
```

- [ ] **Step 6: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/engine/execution.test.ts`
Expected: 3 passing

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: 处决时间轴判定（成/败）"
```

---

### Task 6: endings 引擎（天亮翻牌）

**Files:**
- Create: `northridge-gate/src/engine/endings.ts`
- Test: `northridge-gate/src/engine/endings.test.ts`

**Interfaces:**
- Consumes: `Visitor`（schema.ts）、`VisitorRecord`（engine/types.ts）
- Produces: `computeEnding(input): 'passed' | 'contaminated' | 'unclean'`

- [ ] **Step 1: 写失败测试 endings.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { computeEnding } from './endings'
import type { VisitorRecord } from './types'

function rec(p: Partial<VisitorRecord>): VisitorRecord {
  return { visitorId: 'x', role: 'human', state: 'clean', verdict: 'admit', correct: true, escaped: false, sanAtJudge: 70, ...p }
}

describe('computeEnding', () => {
  it('passes when all four are correct', () => {
    const r = computeEnding({ records: [rec({}), rec({}), rec({}), rec({})], sanTouchedBelow15: false, autoReleased: null })
    expect(r).toBe('passed')
  })
  it('contaminates when a pseudo is admitted', () => {
    const r = computeEnding({ records: [rec({ role: 'skinfit', verdict: 'admit', correct: false })], sanTouchedBelow15: false, autoReleased: null })
    expect(r).toBe('contaminated')
  })
  it('contaminates when sofa auto-released a pseudo', () => {
    const r = computeEnding({ records: [], sanTouchedBelow15: false, autoReleased: { role: 'coretick' } as never })
    expect(r).toBe('contaminated')
  })
  it('unclean when san touched <15 and killed a human', () => {
    const r = computeEnding({ records: [rec({ role: 'human', verdict: 'execute', correct: false })], sanTouchedBelow15: true, autoReleased: null })
    expect(r).toBe('unclean')
  })
  it('fails (contaminated fallback) on 2+ misjudges with no release', () => {
    const r = computeEnding({ records: [rec({ correct: false }), rec({ correct: false })], sanTouchedBelow15: false, autoReleased: null })
    expect(r).toBe('contaminated')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd northridge-gate && npx vitest run src/engine/endings.test.ts`
Expected: FAIL

- [ ] **Step 3: 写 engine/endings.ts**

```ts
import type { Visitor } from '../data/schema'
import type { VisitorRecord } from './types'

export interface EndingInput {
  records: VisitorRecord[]
  sanTouchedBelow15: boolean
  autoReleased: Visitor | null
}

export function computeEnding(input: EndingInput): 'passed' | 'contaminated' | 'unclean' {
  const misjudges = input.records.filter((r) => !r.correct).length
  const releasedPseudo = input.records.some((r) => r.verdict === 'admit' && r.role !== 'human')
  const killedHuman = input.records.some((r) => r.verdict === 'execute' && r.role === 'human')
  const pseudoEntered = releasedPseudo || (input.autoReleased !== null && input.autoReleased.role !== 'human')

  if (input.sanTouchedBelow15 && killedHuman) return 'unclean'
  if (pseudoEntered) return 'contaminated'
  if (misjudges <= 1) return 'passed'
  return 'contaminated' // 误判 ≥2 但无伪人进门：归入污染（spec 未列第 4 结局，此为实现裁定）
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/engine/endings.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 天亮翻牌结局结算"
```

---

### Task 7: state 状态机（reducer）

**Files:**
- Create: `northridge-gate/src/engine/state.ts`
- Create: `northridge-gate/src/data/visitors/index.ts`
- Test: `northridge-gate/src/engine/state.test.ts`

**Interfaces:**
- Consumes: `resolveVerdict`（judge.ts）、`applySanDelta`（san.ts）、`GameState`（types.ts）、`VISITORS`
- Produces: `INITIAL_STATE`、`Action`、`reducer(state, action): GameState`、`currentVisitor(state): Visitor | null`

- [ ] **Step 1: 写 data/visitors/index.ts（先占位，Task 8 补全）**

```ts
import type { Visitor } from '../schema'
import { v1Human } from './v1-human'
import { v2Skinfit } from './v2-skinfit'
import { v4Coretick } from './v4-coretick'

// v3 暂缺，Task 8 补上；先以占位空数组维护顺序
export const VISITORS: Visitor[] = [v1Human, v2Skinfit, v4Coretick]
```

- [ ] **Step 2: 写失败测试 state.test.ts**

```ts
import { describe, it, expect } from 'vitest'
import { reducer, INITIAL_STATE } from './state'

describe('reducer', () => {
  it('START moves to visitor phase', () => {
    expect(reducer(INITIAL_STATE, { type: 'START' }).phase).toBe('visitor')
  })

  it('JUDGE appends a record and advances', () => {
    const s = reducer(reducer(INITIAL_STATE, { type: 'START' }), { type: 'JUDGE', verdict: 'admit' })
    expect(s.records).toHaveLength(1)
    expect(s.visitorIndex).toBe(1)
  })

  it('after all visitors, phase becomes dawn', () => {
    let s = reducer(INITIAL_STATE, { type: 'START' })
    for (let i = 0; i < 3; i++) s = reducer(s, { type: 'JUDGE', verdict: 'admit' })
    expect(s.phase).toBe('dawn')
  })

  it('INSPECT eye costs reaction, id is free', () => {
    const s0 = reducer(INITIAL_STATE, { type: 'START' })
    const s1 = reducer(s0, { type: 'INSPECT', slot: 'eye' })
    expect(s1.reaction).toBe(80)
    const s2 = reducer(s1, { type: 'INSPECT', slot: 'id' })
    expect(s2.reaction).toBe(80)
  })

  it('DRINK_COFFEE heals san and is limited to two cups', () => {
    let s = reducer(INITIAL_STATE, { type: 'START' })
    s = reducer(s, { type: 'DRINK_COFFEE' })
    expect(s.san).toBe(83)
    s = reducer(s, { type: 'DRINK_COFFEE' })
    s = reducer(s, { type: 'DRINK_COFFEE' })
    expect(s.san).toBe(91) // 第三杯凉水，无效果
    expect(s.coffeeUsed).toBe(2)
  })

  it('USE_SOFA heals, auto-releases current visitor, marks sofaUsed', () => {
    const s0 = reducer(INITIAL_STATE, { type: 'START' })
    const s1 = reducer(s0, { type: 'USE_SOFA', claw: false })
    expect(s1.san).toBe(95)
    expect(s1.sofaUsed).toBe(true)
    expect(s1.autoReleased?.id).toBe('v1-human')
    expect(s1.visitorIndex).toBe(1)
  })

  it('sedative halves negative san deltas', () => {
    let s = reducer(INITIAL_STATE, { type: 'START' })
    s = reducer(s, { type: 'USE_SEDATIVE' })
    // v1-human 是干净人类，处决 → outcome san -15，镇静叶减半 → -7（Math.round(-7.5) = -7）
    s = reducer(s, { type: 'JUDGE', verdict: 'execute', tool: 'axe' })
    expect(s.san).toBe(68)
  })
})
```

- [ ] **Step 3: 运行确认失败**

Run: `cd northridge-gate && npx vitest run src/engine/state.test.ts`
Expected: FAIL

- [ ] **Step 4: 写 engine/state.ts**

```ts
import type { Visitor, Verdict, Tool } from '../data/schema'
import { VISITORS } from '../data/visitors'
import { resolveVerdict } from './judge'
import { applySanDelta } from './san'
import type { GameState, VisitorRecord } from './types'

export const INITIAL_STATE: GameState = {
  phase: 'opening',
  san: 75,
  reaction: 100,
  reactionMax: 100,
  ventilationOn: false,
  sofaUsed: false,
  coffeeUsed: 0,
  sedativeUsed: false,
  hallucinationTriggered: false,
  visitorIndex: 0,
  records: [],
  autoReleased: null,
  sanTouchedBelow15: false,
}

export type Action =
  | { type: 'START' }
  | { type: 'JUDGE'; verdict: Verdict; tool?: Tool }
  | { type: 'INSPECT'; slot: 'eye' | 'id' | 'question' }
  | { type: 'DRINK_COFFEE' }
  | { type: 'USE_SEDATIVE' }
  | { type: 'USE_SOFA'; claw: boolean }
  | { type: 'TOGGLE_VENTILATION' }

export function currentVisitor(state: GameState): Visitor | null {
  return state.phase === 'visitor' ? VISITORS[state.visitorIndex] ?? null : null
}

export function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'START':
      return { ...INITIAL_STATE, phase: 'visitor' }

    case 'JUDGE': {
      const visitor = currentVisitor(state)
      if (!visitor) return state
      const j = resolveVerdict(visitor, action.verdict, action.tool)
      const record: VisitorRecord = {
        visitorId: visitor.id,
        role: visitor.role,
        state: visitor.state,
        correctTool: visitor.correctTool,
        verdict: j.verdict,
        tool: j.tool,
        correct: j.correct,
        escaped: j.escaped,
        sanAtJudge: state.san,
      }
      const rawDelta = j.outcome.san ?? 0
      const delta = state.sedativeUsed && rawDelta < 0 ? Math.round(rawDelta / 2) : rawDelta
      const san = applySanDelta(state.san, delta)
      const visitorIndex = state.visitorIndex + 1
      return {
        ...state,
        san,
        records: [...state.records, record],
        visitorIndex,
        phase: visitorIndex >= VISITORS.length ? 'dawn' : 'visitor',
        sanTouchedBelow15: state.sanTouchedBelow15 || san < 15,
      }
    }

    case 'INSPECT': {
      const cost = action.slot === 'id' ? 0 : 20
      return { ...state, reaction: Math.max(0, state.reaction - cost) }
    }

    case 'DRINK_COFFEE': {
      if (state.coffeeUsed >= 2) return state // 第三杯凉水
      return {
        ...state,
        coffeeUsed: state.coffeeUsed + 1,
        san: applySanDelta(state.san, 8),
        reaction: Math.min(state.reactionMax, state.reaction + 20),
      }
    }

    case 'USE_SEDATIVE': {
      if (state.sedativeUsed) return state
      const reactionMax = Math.round(state.reactionMax * 0.7)
      return { ...state, sedativeUsed: true, reactionMax, reaction: Math.min(state.reaction, reactionMax) }
    }

    case 'USE_SOFA': {
      const visitor = currentVisitor(state)
      if (state.sofaUsed || !visitor) return state
      const san = action.claw
        ? applySanDelta(state.san, -10)
        : applySanDelta(state.san, 20)
      const visitorIndex = state.visitorIndex + 1
      return {
        ...state,
        san,
        sofaUsed: true,
        autoReleased: visitor,
        visitorIndex,
        phase: visitorIndex >= VISITORS.length ? 'dawn' : 'visitor',
      }
    }

    case 'TOGGLE_VENTILATION':
      return { ...state, ventilationOn: !state.ventilationOn }

    default:
      return state
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/engine/state.test.ts`
Expected: 6 passing

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: 全局状态机 reducer"
```

---

### Task 8: 完整数据文件（4 访客 + 道具 + 环境 + 结局）

**Files:**
- Modify: `northridge-gate/src/data/visitors/v1-human.ts`（补全文案）
- Modify: `northridge-gate/src/data/visitors/v2-skinfit.ts`
- Create: `northridge-gate/src/data/visitors/v3-suspicious.ts`
- Modify: `northridge-gate/src/data/visitors/v4-coretick.ts`
- Modify: `northridge-gate/src/data/visitors/index.ts`（加入 v3，恢复 4 人顺序）
- Create: `northridge-gate/src/data/items.ts`
- Create: `northridge-gate/src/data/world.ts`
- Create: `northridge-gate/src/data/endings.ts`

**Interfaces:**
- Produces: `VISITORS`（4 人）、`ITEMS`、`WORLD_TEXT`、`ENDINGS`。文本为草稿级，后续由内容流水线覆盖。

- [ ] **Step 1: 补全 v1-human.ts（教程人类）**

```ts
import type { Visitor } from '../schema'

export const v1Human: Visitor = {
  id: 'v1-human',
  claimedName: '调度 · 林远',
  role: 'human',
  state: 'clean',
  portrait: '/assets/portraits/v1_human.png',
  freezeFrames: ['/assets/portraits/v1_human.png'],
  tells: {
    eye: '眼神正常，只是被雨淋得有点烦。',
    id: '证件照片和本人一致，牙齿数对得上。',
    questions: [
      { q: '今晚来做什么？', a: '换班的，白班说让我来顶后半夜。' },
      { q: '窗外在下雨吗？', a: '下大了，来的路上淋透了。' },
    ],
  },
  correctVerdict: 'admit',
  outcomes: {
    admit: { text: '门开了一条缝，他点头进去，影子消失在走廊。', san: 0 },
    execute: { text: '你按下处决。玻璃上溅开，那人倒下去，没有再动。', san: -15 },
    contain: { text: '他被拖进收容舱，隔着窗喊了整夜。', san: -8 },
  },
}
```

- [ ] **Step 2: 补全 v2-skinfit.ts（贴皮）**

```ts
import type { Visitor } from '../schema'

export const v2Skinfit: Visitor = {
  id: 'v2-skinfit',
  claimedName: '维修 · 陈默',
  role: 'skinfit',
  state: 'clean',
  portrait: '/assets/portraits/v2_skinfit_frame1.png',
  freezeFrames: [
    '/assets/portraits/v2_skinfit_frame1.png',
    '/assets/portraits/v2_skinfit_frame2.png',
    '/assets/portraits/v2_skinfit_frame3.png',
    '/assets/portraits/v2_skinfit_frame4.png',
    '/assets/portraits/v2_skinfit_frame5.png',
  ],
  glitchLine: '我是来修灯的。。灯的线路出了问题',
  tells: {
    eye: '他眨眼，但两只眼睛的节奏不一样。',
    id: '证件上的牙齿数，和本人对不上。',
    questions: [
      { q: '工号多少？', a: '工号……2207。' },
      { q: '今晚修哪盏灯？', a: '门卫室北边那盏，一直闪。' },
    ],
  },
  correctVerdict: 'execute',
  correctTool: 'axe',
  outcomes: {
    admit: { text: '你放他进了门。身后传来一阵不自然的关节响。', san: -10 },
    execute: { text: '斧落下，接缝裂开，那层皮从骨头上滑下来。', san: 0 },
    contain: { text: '收容舱的门合上，它在里面用你的声音说话。', san: -8 },
  },
}
```

- [ ] **Step 3: 写 v3-suspicious.ts（很像伪人的人类）**

```ts
import type { Visitor } from '../schema'

export const v3Suspicious: Visitor = {
  id: 'v3-suspicious',
  claimedName: '访客 · 何夕',
  role: 'human',
  state: 'clean',
  portrait: '/assets/portraits/v3_suspicious_frame1.png',
  freezeFrames: [
    '/assets/portraits/v3_suspicious_frame1.png',
    '/assets/portraits/v3_suspicious_frame2.png',
    '/assets/portraits/v3_suspicious_frame3.png',
    '/assets/portraits/v3_suspicious_frame4.png',
    '/assets/portraits/v3_suspicious_frame5.png',
  ],
  tells: {
    eye: '他眨眼节奏有点乱，但可能只是紧张。',
    id: '证件是真的，只是照片磨得很旧。',
    questions: [
      { q: '为什么半夜来？', a: '我也不想，接到通知说这里能避一避。' },
      { q: '认识里面的人吗？', a: '我妹妹在里面值班，叫……我记不清了。' },
    ],
  },
  correctVerdict: 'admit',
  outcomes: {
    admit: { text: '他进去后长舒一口气，瘫坐在长椅上。', san: 0 },
    execute: { text: '你杀了一个人。血是真的，温度也是真的。', san: -20 },
    contain: { text: '他被塞进收容舱，哭着说自己不是。', san: -15 },
  },
}
```

- [ ] **Step 4: 补全 v4-coretick.ts（核响，自称替班）**

```ts
import type { Visitor } from '../schema'

export const v4Coretick: Visitor = {
  id: 'v4-coretick',
  claimedName: '替班 · 周齐',
  role: 'coretick',
  state: 'clean',
  portrait: '/assets/portraits/v4_coretick_frame1.png',
  freezeFrames: [
    '/assets/portraits/v4_coretick_frame1.png',
    '/assets/portraits/v4_coretick_frame2.png',
    '/assets/portraits/v4_coretick_frame3.png',
    '/assets/portraits/v4_coretick_frame4.png',
    '/assets/portraits/v4_coretick_frame5.png',
  ],
  glitchLine: '我来替班，你们，快开门',
  tells: {
    eye: '锁骨下方，有极轻的金属嘀嗒声。',
    id: '证件崭新得不像话，连折痕都没有。',
    questions: [
      { q: '今晚天气怎么样？', a: '和昨天一样。' },
      { q: '你替谁的班？', a: '上一班的人请假了，我顶。' },
    ],
  },
  correctVerdict: 'execute',
  correctTool: 'gun',
  outcomes: {
    admit: { text: '它走进门，嘀嗒声在走廊里放大。', san: -12 },
    execute: { text: '一枪命中锁骨下的核，它像断电一样倒下。', san: -5 },
    contain: { text: '收容舱里，那嘀嗒声整夜没停。', san: -8 },
  },
}
```

- [ ] **Step 5: 更新 index.ts 恢复 4 人顺序**

```ts
import type { Visitor } from '../schema'
import { v1Human } from './v1-human'
import { v2Skinfit } from './v2-skinfit'
import { v3Suspicious } from './v3-suspicious'
import { v4Coretick } from './v4-coretick'

export const VISITORS: Visitor[] = [v1Human, v2Skinfit, v3Suspicious, v4Coretick]
```

- [ ] **Step 6: 写 items.ts、world.ts、endings.ts**

```ts
// src/data/items.ts
import type { Item } from './schema'

export const ITEMS: Item[] = [
  { id: 'coffee', name: '咖啡', desc: '温的。机子里的咖啡能让你清醒一点。', effect: { san: 8, reaction: 20, constraint: '手抖 20 秒；机只出两杯' } },
  { id: 'sedative', name: '镇静叶', desc: '嚼起来像干草。', effect: { san: 0, constraint: 'San 下降变慢；反应上限 -30%；一次性' } },
  { id: 'axe', name: '消防斧', desc: '本班配发的冷兵器。', effect: {} },
  { id: 'gun', name: '手枪', desc: '对付核响型，打头核。', effect: {} },
  { id: 'fire', name: '焚化罐', desc: '对付湿巢型。', effect: {} },
]
```

```ts
// src/data/world.ts
import type { WorldText } from './schema'

export const WORLD_TEXT: WorldText[] = [
  { id: 'manual-missing', surface: 'manual', text: '《识别手册 v0.4》——中间两页被撕掉了。' },
  { id: 'drawer-note', surface: 'drawer', text: '便利贴：「不要相信说自己是替班的人。」' },
  { id: 'radio-static', surface: 'radio', text: '对讲机偶尔冒出一段实验室的忙音。' },
  { id: 'lightbox', surface: 'lightbox', text: '灯箱：「日间禁止外出」。窗外永远是夜。' },
  { id: 'cabinet-label', surface: 'label', text: '武器柜：斧（可用）、手枪（可用）、其余灰格「白班权限」。' },
]
```

```ts
// src/data/endings.ts
import type { Ending } from './schema'

export const ENDINGS: Ending[] = [
  { id: 'passed', condition: '误判 ≤1，且无放走须火/须枪之体', lines: ['这一夜，你盖对了大多数章。', '天亮了。'] },
  { id: 'contaminated', condition: '任一伪人进门，或翻牌为伪人', lines: ['有什么东西，已经进去了。', '天亮了，但设施不再是干净的了。'] },
  { id: 'unclean', condition: '曾 San<15 且误杀 ≥1', lines: ['镜子里的你，眨了眨眼。', '另一只眼睛慢了一帧。'] },
]
```

- [ ] **Step 7: 全量测试 + 类型检查**

Run: `cd northridge-gate && npm test`
Expected: 全部通过（judge 4 + san 3 + execution 3 + endings 5 + state 7 = 22）

Run: `cd northridge-gate && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: 完整数据文件（4 访客 + 道具 + 环境 + 结局，草稿文案）"
```

---

### Task 9: Three.js 场景（房间 + 4 机位）

**Files:**
- Create: `northridge-gate/src/scene/cameras.ts`
- Create: `northridge-gate/src/scene/room.ts`
- Create: `northridge-gate/src/scene/RoomScene.tsx`
- Test: `northridge-gate/src/scene/cameras.test.ts`

**Interfaces:**
- Consumes: 无（纯 Three.js）
- Produces: `HOTSPOTS: Hotspot[]`（4 机位）、`buildRoom(scene)`、`<RoomScene hotspotId={string}>`。视觉需 `npm run dev` 手动核对（WebGL 无法在 jsdom 跑）。

- [ ] **Step 1: 写 cameras.ts 及其测试**

```ts
export interface Hotspot {
  id: string
  label: string
  position: [number, number, number]
  lookAt: [number, number, number]
}

export const HOTSPOTS: Hotspot[] = [
  { id: 'window', label: '观察窗', position: [0, 1.6, 2], lookAt: [0, 1.6, 0] },
  { id: 'manual', label: '手册柜', position: [-2, 1.4, 1.5], lookAt: [-2, 1.4, 0] },
  { id: 'weapons', label: '武器台', position: [2, 1.4, 1.5], lookAt: [2, 1.4, 0] },
  { id: 'sofa', label: '沙发', position: [0, 1.2, -1.5], lookAt: [0, 1.2, -3] },
]
```

```ts
// src/scene/cameras.test.ts
import { describe, it, expect } from 'vitest'
import { HOTSPOTS } from './cameras'

describe('HOTSPOTS', () => {
  it('has four hotspots with a window', () => {
    expect(HOTSPOTS).toHaveLength(4)
    expect(HOTSPOTS.map((h) => h.id)).toContain('window')
  })
})
```

- [ ] **Step 2: 写 room.ts（primitives 小房间）**

```ts
import * as THREE from 'three'

export function buildRoom(scene: THREE.Scene): void {
  scene.background = new THREE.Color(0x0a0a0c)
  scene.fog = new THREE.Fog(0x0a0a0c, 4, 12)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1e }),
  )
  floor.rotation.x = -Math.PI / 2
  scene.add(floor)

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 4),
    new THREE.MeshStandardMaterial({ color: 0x222226 }),
  )
  backWall.position.set(0, 2, -2)
  scene.add(backWall)

  // 观察窗开口（深色平面占位）
  const window = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x050507 }),
  )
  window.position.set(0, 1.7, -1.99)
  scene.add(window)

  // 桌台
  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.1, 1),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2e }),
  )
  desk.position.set(0, 0.9, 0.5)
  scene.add(desk)

  scene.add(new THREE.AmbientLight(0x404040, 1.2))
  const key = new THREE.PointLight(0x88aaff, 20, 12)
  key.position.set(0, 3, 1)
  scene.add(key)
}
```

- [ ] **Step 3: 写 RoomScene.tsx**

```tsx
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { HOTSPOTS } from './cameras'
import { buildRoom } from './room'

export default function RoomScene({ hotspotId }: { hotspotId: string }) {
  const mountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    buildRoom(scene)
    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 50)
    camera.position.set(0, 1.6, 2)

    const hotspot = HOTSPOTS.find((h) => h.id === hotspotId) ?? HOTSPOTS[0]
    camera.position.set(...hotspot.position)
    camera.lookAt(...hotspot.lookAt)

    renderer.render(scene, camera)
    return () => {
      mount.removeChild(renderer.domElement)
      renderer.dispose()
    }
  }, [hotspotId])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
}
```

- [ ] **Step 4: 运行测试 + 手动核对**

Run: `cd northridge-gate && npx vitest run src/scene/cameras.test.ts`
Expected: 1 passing

Run: `cd northridge-gate && npm run dev` —— 临时在 App.tsx 挂 `<RoomScene hotspotId="window" />` 看房间渲染，核对后退掉该临时改动。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Three.js 房间 + 4 机位"
```

---

### Task 10: 窗框 UI（Portrait + Window）

**Files:**
- Create: `northridge-gate/src/ui/Portrait.tsx`
- Create: `northridge-gate/src/ui/Window.tsx`
- Test: `northridge-gate/src/ui/Window.test.tsx`

**Interfaces:**
- Consumes: `Visitor`（schema.ts）
- Produces: `<Portrait visitor={Visitor} frame={number} />`、`<Window visitor={Visitor} />`

- [ ] **Step 1: 写 Portrait.tsx（立绘 + 定格循环）**

```tsx
import { useState } from 'react'
import type { Visitor } from '../data/schema'

export default function Portrait({ visitor, frame = 0 }: { visitor: Visitor; frame?: number }) {
  const src = visitor.freezeFrames[frame] ?? visitor.portrait
  return <img src={src} alt={visitor.claimedName} style={{ height: '100%', filter: 'grayscale(0.3) contrast(1.1)' }} />
}
```

- [ ] **Step 2: 写 Window.tsx（左立绘 / 右对话）**

```tsx
import { useState } from 'react'
import type { Visitor } from '../data/schema'
import Portrait from './Portrait'

export default function Window({ visitor }: { visitor: Visitor }) {
  const [frame, setFrame] = useState(0)
  return (
    <div data-testid="window" style={{ display: 'flex', height: '100%', padding: 24, gap: 24 }}>
      <div style={{ flex: 1, background: '#000', border: '1px solid #333' }} onClick={() => setFrame((f) => (f + 1) % visitor.freezeFrames.length)}>
        <Portrait visitor={visitor} frame={frame} />
        <div style={{ color: '#666', fontSize: 12 }}>点击立绘切换定格帧</div>
      </div>
      <div style={{ flex: 1, background: '#111', padding: 16 }}>
        <h2>{visitor.claimedName}</h2>
        {visitor.glitchLine && <p data-testid="glitch">{visitor.glitchLine}</p>}
        <p style={{ color: '#888' }}>（对话与三槽检视由后续任务接入）</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 写测试**

```tsx
import { render, screen } from '@testing-library/react'
import Window from './Window'
import { v2Skinfit } from '../data/visitors/v2-skinfit'

it('renders visitor name and glitch line for pseudo', () => {
  render(<Window visitor={v2Skinfit} />)
  expect(screen.getByTestId('window')).toBeInTheDocument()
  expect(screen.getByTestId('glitch')).toHaveTextContent('修灯')
})
```

- [ ] **Step 4: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/ui/Window.test.tsx`
Expected: 1 passing

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 窗框 UI（立绘 + 定格 + 卡帧句）"
```

---

### Task 11: 检视 + 判定 UI

**Files:**
- Create: `northridge-gate/src/ui/Inspect.tsx`
- Create: `northridge-gate/src/ui/Verdict.tsx`
- Test: `northridge-gate/src/ui/Verdict.test.tsx`

**Interfaces:**
- Consumes: `Visitor`、`Verdict`、`Tool`；dispatch 回调
- Produces: `<Inspect visitor onInspect={(slot)=>void} reaction={number} />`、`<Verdict onJudge={(verdict, tool?) => void} disabled={boolean} />`

- [ ] **Step 1: 写 Inspect.tsx（三槽）**

```tsx
import { useState } from 'react'
import type { Visitor } from '../data/schema'

export type InspectSlot = 'eye' | 'id' | 'question'

export default function Inspect({ visitor, reaction, onInspect }: {
  visitor: Visitor
  reaction: number
  onInspect: (slot: InspectSlot) => void
}) {
  const [shown, setShown] = useState<Partial<Record<InspectSlot, boolean>>>({})
  const [qi, setQi] = useState(0)

  const slot = (id: InspectSlot, label: string, cost: number, text: string) => (
    <button
      key={id}
      disabled={reaction < cost}
      onClick={() => { setShown((s) => ({ ...s, [id]: true })); onInspect(id) }}
      style={{ marginRight: 8 }}
    >
      {label}（{cost}）
    </button>
  )

  return (
    <div data-testid="inspect">
      {slot('eye', '眼', 20, visitor.tells.eye ?? '')}
      {slot('id', '证', 0, visitor.tells.id ?? '')}
      {slot('question', '问一句', 20, visitor.tells.questions[qi]?.q ?? '')}
      {shown.eye && <p>{visitor.tells.eye}</p>}
      {shown.id && <p>{visitor.tells.id}</p>}
      {shown.question && (
        <div>
          <p>{visitor.tells.questions[qi]?.a}</p>
          <button disabled={qi >= visitor.tells.questions.length - 1} onClick={() => setQi((i) => i + 1)}>换一问</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 写 Verdict.tsx（三判定 + 处决工具）**

```tsx
import { useState } from 'react'
import type { Verdict as V, Tool } from '../data/schema'

const VERDICTS: { v: V; label: string }[] = [
  { v: 'admit', label: '放行' },
  { v: 'execute', label: '处决' },
  { v: 'contain', label: '收容' },
]
const TOOLS: Tool[] = ['axe', 'gun', 'fire']

export default function Verdict({ disabled, onJudge }: {
  disabled: boolean
  onJudge: (verdict: V, tool?: Tool) => void
}) {
  const [pickingTool, setPickingTool] = useState(false)

  if (pickingTool) {
    return (
      <div data-testid="tool-select">
        {TOOLS.map((t) => (
          <button key={t} onClick={() => onJudge('execute', t)}>{t}</button>
        ))}
        <button onClick={() => setPickingTool(false)}>取消</button>
      </div>
    )
  }

  return (
    <div data-testid="verdict">
      {VERDICTS.map(({ v, label }) => (
        <button key={v} disabled={disabled} onClick={() => (v === 'execute' ? setPickingTool(true) : onJudge(v))}>
          {label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 写测试**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import Verdict from './Verdict'

it('fires onJudge with admit directly, execute opens tool select', () => {
  const onJudge = vi.fn()
  render(<Verdict disabled={false} onJudge={onJudge} />)
  fireEvent.click(screen.getByText('放行'))
  expect(onJudge).toHaveBeenCalledWith('admit', undefined)
  fireEvent.click(screen.getByText('处决'))
  fireEvent.click(screen.getByText('gun'))
  expect(onJudge).toHaveBeenCalledWith('execute', 'gun')
})
```

- [ ] **Step 4: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/ui/Verdict.test.tsx`
Expected: 1 passing

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 检视三槽 + 三判定 + 处决工具选择"
```

---

### Task 12: 处决时间轴 Overlay

**Files:**
- Create: `northridge-gate/src/ui/ExecutionOverlay.tsx`
- Test: `northridge-gate/src/ui/ExecutionOverlay.test.tsx`

**Interfaces:**
- Consumes: `ExecutionResult`（engine/execution.ts）
- Produces: `<ExecutionOverlay result={ExecutionResult} onDone={() => void} />`

- [ ] **Step 1: 写 ExecutionOverlay.tsx（遮黑 + 4 帧 + 残渣）**

```tsx
import { useEffect, useState } from 'react'
import type { ExecutionResult } from '../engine/execution'

export default function ExecutionOverlay({ result, onDone }: {
  result: ExecutionResult
  onDone: () => void
}) {
  const [frame, setFrame] = useState(-1) // -1 = 遮黑

  useEffect(() => {
    setFrame(-1)
    const t1 = setTimeout(() => setFrame(0), 2000) // 2 秒遮黑
    const t2 = setTimeout(() => setFrame(1), 2600)
    const t3 = setTimeout(() => setFrame(2), 3200)
    const t4 = setTimeout(() => setFrame(3), 3800)
    const t5 = setTimeout(onDone, 4600)
    return () => [t1, t2, t3, t4, t5].forEach(clearTimeout)
  }, [result, onDone])

  return (
    <div data-testid="exec-overlay" style={{ position: 'absolute', inset: 0, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      {frame === -1 && <div data-testid="blackout">遮黑</div>}
      {frame >= 0 && <img src={result.frames[frame]} alt={`帧${frame}`} style={{ maxHeight: '60%' }} />}
      {frame === 3 && <div data-testid="residue">{result.success ? '残渣：' + result.residue : '东西还站着，走廊脚步远去'}</div>}
    </div>
  )
}
```

- [ ] **Step 2: 写测试（用 fake timers）**

```tsx
import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import ExecutionOverlay from './ExecutionOverlay'

const result = {
  success: true,
  frames: ['/f1.png', '/f2.png', '/f3.png', '/f4.png'],
  residue: '/r.png',
  sanDelta: 0,
  radioDistort: false,
  escaped: false,
}

it('shows blackout first, then calls onDone', () => {
  vi.useFakeTimers()
  const onDone = vi.fn()
  render(<ExecutionOverlay result={result} onDone={onDone} />)
  expect(screen.getByTestId('blackout')).toBeInTheDocument()
  act(() => { vi.advanceTimersByTime(5000) })
  expect(onDone).toHaveBeenCalled()
  vi.useRealTimers()
})
```

- [ ] **Step 3: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/ui/ExecutionOverlay.test.tsx`
Expected: 1 passing

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 处决时间轴 Overlay（遮黑 + 定格 + 残渣）"
```

---

### Task 13: HUD（San 条 + 道具 + 通风）

**Files:**
- Create: `northridge-gate/src/ui/HUD.tsx`
- Test: `northridge-gate/src/ui/HUD.test.tsx`

**Interfaces:**
- Consumes: `GameState`、dispatch 回调
- Produces: `<HUD state={GameState} dispatch={(a: Action) => void} />`

- [ ] **Step 1: 写 HUD.tsx**

```tsx
import type { Action, GameState } from '../engine/state'

export default function HUD({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const bandEffect = state.san >= 70 ? '正常' : state.san >= 40 ? '耳鸣' : state.san >= 15 ? '对调' : '反转'
  return (
    <div data-testid="hud" style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: 16 }}>
      <div>
        <div>San：{state.san}（{bandEffect}）</div>
        <div style={{ width: 200, height: 10, background: '#333' }}>
          <div style={{ width: `${state.san}%`, height: '100%', background: state.san < 40 ? '#a33' : '#3a3' }} />
        </div>
        <div>反应：{state.reaction}/{state.reactionMax}</div>
      </div>
      <div>
        <button disabled={state.coffeeUsed >= 2} onClick={() => dispatch({ type: 'DRINK_COFFEE' })}>咖啡（{2 - state.coffeeUsed}）</button>
        <button disabled={state.sedativeUsed} onClick={() => dispatch({ type: 'USE_SEDATIVE' })}>镇静叶</button>
        <button disabled={state.sofaUsed} onClick={() => dispatch({ type: 'USE_SOFA', claw: Math.random() < 0.15 })}>沙发</button>
        <button onClick={() => dispatch({ type: 'TOGGLE_VENTILATION' })}>通风：{state.ventilationOn ? '开' : '关'}</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 写测试**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import HUD from './HUD'
import { INITIAL_STATE } from '../engine/state'

it('renders san and dispatches coffee', () => {
  const dispatch = vi.fn()
  render(<HUD state={INITIAL_STATE} dispatch={dispatch} />)
  expect(screen.getByTestId('hud')).toHaveTextContent('San：75')
  fireEvent.click(screen.getByText(/咖啡/))
  expect(dispatch).toHaveBeenCalledWith({ type: 'DRINK_COFFEE' })
})
```

- [ ] **Step 3: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/ui/HUD.test.tsx`
Expected: 1 passing

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: HUD（San 条 + 反应 + 道具 + 通风）"
```

---

### Task 14: 天亮翻牌 UI

**Files:**
- Create: `northridge-gate/src/ui/Dawn.tsx`
- Test: `northridge-gate/src/ui/Dawn.test.tsx`

**Interfaces:**
- Consumes: `GameState`、`computeEnding`（engine/endings.ts）、`ENDINGS`（data/endings.ts）
- Produces: `<Dawn state={GameState} />`

- [ ] **Step 1: 写 Dawn.tsx**

```tsx
import { computeEnding } from '../engine/endings'
import { ENDINGS } from '../data/endings'
import type { GameState } from '../engine/state'

export default function Dawn({ state }: { state: GameState }) {
  const endingId = computeEnding({ records: state.records, sanTouchedBelow15: state.sanTouchedBelow15, autoReleased: state.autoReleased })
  const ending = ENDINGS.find((e) => e.id === endingId)!

  return (
    <div data-testid="dawn" style={{ padding: 48 }}>
      <h1>天亮</h1>
      <table>
        <tbody>
          {state.records.map((r, i) => (
            <tr key={i}>
              <td>{r.visitorId}</td>
              <td>{r.verdict}</td>
              <td>{r.correct ? '正确' : '误判'}{r.escaped ? ' · 逃逸' : ''}</td>
            </tr>
          ))}
          {state.autoReleased && (
            <tr>
              <td>{state.autoReleased.id}</td>
              <td>沙发自动放行</td>
              <td>{state.autoReleased.role === 'human' ? '人类' : '伪人'}</td>
            </tr>
          )}
        </tbody>
      </table>
      <h2>{endingId === 'passed' ? '班次合格' : endingId === 'contaminated' ? '设施污染' : '你也不干净'}</h2>
      {ending.lines.map((l) => <p key={l}>{l}</p>)}
    </div>
  )
}
```

- [ ] **Step 2: 写测试**

```tsx
import { render, screen } from '@testing-library/react'
import Dawn from './Dawn'
import { INITIAL_STATE } from '../engine/state'

it('renders the dawn table', () => {
  render(<Dawn state={{ ...INITIAL_STATE, phase: 'dawn' }} />)
  expect(screen.getByTestId('dawn')).toHaveTextContent('天亮')
})
```

- [ ] **Step 3: 运行确认通过**

Run: `cd northridge-gate && npx vitest run src/ui/Dawn.test.tsx`
Expected: 1 passing

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: 天亮翻牌 UI"
```

---

### Task 15: App 组装 + 开局 + 幻觉

**Files:**
- Modify: `northridge-gate/src/App.tsx`
- Modify: `northridge-gate/src/App.test.tsx`

**Interfaces:**
- Consumes: 所有 engine 与 ui 模块
- Produces: 完整可玩闭环：开局 → 4 访客循环 → 处决 → 天亮翻牌；幻觉（第 3 人前走廊多一双鞋）作为一次文本/图提示。

- [ ] **Step 1: 重写 App.tsx**

```tsx
import { useReducer, useState } from 'react'
import { reducer, INITIAL_STATE, currentVisitor } from './engine/state'
import type { Verdict, Tool } from './data/schema'
import type { ExecutionResult } from './engine/execution'
import { resolveExecution } from './engine/execution'
import RoomScene from './scene/RoomScene'
import Window from './ui/Window'
import Inspect, { type InspectSlot } from './ui/Inspect'
import Verdict from './ui/Verdict'
import ExecutionOverlay from './ui/ExecutionOverlay'
import HUD from './ui/HUD'
import Dawn from './ui/Dawn'
import { HOTSPOTS } from './scene/cameras'

export default function App() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
  const [hotspot, setHotspot] = useState('window')
  const [execution, setExecution] = useState<ExecutionResult | null>(null)

  const visitor = currentVisitor(state)

  const handleJudge = (verdict: Verdict, tool?: Tool) => {
    if (verdict === 'execute' && tool && visitor) {
      setExecution(resolveExecution(visitor, tool))
    }
    dispatch({ type: 'JUDGE', verdict, tool })
  }

  if (state.phase === 'opening') {
    return (
      <div style={{ padding: 48 }}>
        <p>窗外有一个剪影在等。</p>
        <p>打开武器柜：消防斧、手枪。窗框贴纸亮起三类对照。</p>
        <button data-testid="start" onClick={() => dispatch({ type: 'START' })}>开始</button>
      </div>
    )
  }

  if (state.phase === 'dawn') return <Dawn state={state} />

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <RoomScene hotspotId={hotspot} />
      <HUD state={state} dispatch={dispatch} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', gap: 8, padding: 8 }}>
        {HOTSPOTS.map((h) => (
          <button key={h.id} onClick={() => setHotspot(h.id)}>{h.label}</button>
        ))}
      </div>
      {hotspot === 'window' && visitor && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)' }}>
          <Window visitor={visitor} />
          <Inspect visitor={visitor} reaction={state.reaction} onInspect={(s: InspectSlot) => dispatch({ type: 'INSPECT', slot: s })} />
          <Verdict disabled={state.reaction <= 0} onJudge={handleJudge} />
          {state.visitorIndex === 2 && !state.hallucinationTriggered && <p data-testid="hallucination">走廊里，多了一双鞋。</p>}
        </div>
      )}
      {execution && <ExecutionOverlay result={execution} onDone={() => setExecution(null)} />}
    </div>
  )
}
```

- [ ] **Step 2: 更新 App.test.tsx（点击开始进入访客循环）**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import App from './App'

it('starts at opening and proceeds to visitor loop', () => {
  render(<App />)
  expect(screen.getByTestId('start')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('start'))
  expect(screen.getByTestId('hud')).toBeInTheDocument()
})
```

- [ ] **Step 3: 运行全量测试**

Run: `cd northridge-gate && npm test`
Expected: 全部通过（引擎 22 + 场景 1 + UI 5 + App 1 = 29）

- [ ] **Step 4: 手动端到端走查**

Run: `cd northridge-gate && npm run dev`
核对：开局剪影 → 开始 → 4 访客逐一到窗 → 检视扣反应 → 判定 → 处决时间轴 → 沙发/咖啡 → 第 3 人前幻觉 → 天亮翻牌。确认后回到 Task 9 处临时改动已还原。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: App 组装 + 开局 + 幻觉，Demo 可玩闭环"
```

---

## 附：本计划之外的后续（非代码任务）

1. **内容填充**：`data/visitors/*`、`world.ts`、`endings.ts` 的草稿文案由「DeepSeek 草稿 → Opus 5.5 精修」流水线覆盖（见 spec §7）。Opus 5.5 用直接 API 调用完成，key 不放任何文件。
2. **Perchance 资产**：`public/assets/` 下的立绘、定格、处决帧、剪影按 spec §8 命名规范由 Perchance 生成后填入路径。
3. **完整版接口**：实验室/综合楼/收容所/武器区不在此计划内，仅保留 Demo 分数存档接口。
