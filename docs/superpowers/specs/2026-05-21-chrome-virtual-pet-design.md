# Chrome 电子宠物扩展 — 设计文档

**日期**: 2026-05-21
**目标用户**: 零计算机基础的普通用户（开箱即用、零配置）

---

## 1. 产品概述

一个 Chrome 浏览器扩展，在网页上显示可拖动的像素风电子宠物。用户可选择 6 种动物，通过养成系统（喂食/玩耍/抚摸）和 AI 聊天与宠物互动。宠物还可执行翻译网页、摘要网页等工具功能。

## 2. 核心需求

### 2.1 展示方式
- **混合模式**：默认悬浮窗（网页右下角）+ 可展开为 Chrome Side Panel 侧边栏
- 悬浮窗支持自由拖动
- 悬浮窗始终在网页最上层

### 2.2 宠物类型（6 种，架构支持后续扩展）
- 🐱 猫、🐶 狗、🐸 青蛙、🐰 兔子、🐹 仓鼠、🐦 鸟
- 通过 `pet-definitions.js` 注册表扩展，新增品种只需精灵图 + 注册记录

### 2.3 AI 聊天
- 模型：DeepSeek + Grok 双兼容，一个不可用时自动 fallback
- 默认内置免费 API Key（零配置），用户可选填自己的 Key
- 每只宠物有独特 AI 人格（system prompt 注入）
- 养成数值影响对话语气（饥饿、心情、精力）

### 2.4 养成系统
- 属性：饥饿度、心情值、精力值、亲密度
- **仅插件打开时计时**，关闭浏览器或关闭插件时时间冻结
- 数值范围 0-100，超过 100 触发即死：撑死/笑死/发疯
- 死亡后 5 分钟重生

### 2.5 工具功能
- 翻译网页：宠物性格包装开头/结尾，翻译正文准确无加戏
- 摘要网页：宠物性格包装，摘要内容客观完整
- 后续可扩展更多工具

### 2.6 视觉风格
- 像素风（Pixel Art），通过 Canvas 渲染精灵图动画
- 每只动物一张精灵图，包含多动作帧
- 支持动作：待机/眨眼/开心/饥饿/困倦/进食/玩耍/兴奋/即死

---

## 3. 技术架构

### 3.1 整体方案
Manifest V3 + Service Worker + Offscreen Document + Content Script

```
Chrome Extension (MV3)
├── Service Worker        — API代理、状态管理、消息路由
├── Offscreen Document    — 养成计时器、状态衰减（长期运行不中断）
└── Content Script        — 悬浮窗口 + 侧边栏 + Canvas渲染 + 用户交互
```

### 3.2 通信流
```
用户操作 → Content Script → chrome.runtime.sendMessage()
  → Service Worker → API Call / chrome.storage
  → Response → Content Script → UI 更新
```

### 3.3 权限
`storage`, `activeTab`, `sidePanel`, `scripting`, `alarms`

---

## 4. 文件结构

```
chrome-pet/
├── manifest.json
├── icons/
├── sprites/                       # 像素精灵图，每动物一张PNG
│   ├── cat.png, dog.png, frog.png
│   ├── rabbit.png, hamster.png, bird.png
│   └── sprite-registry.json       # 帧坐标定义
├── src/
│   ├── service-worker/
│   │   ├── sw-main.js
│   │   ├── api-router.js          # DeepSeek / Grok 代理
│   │   ├── state-manager.js
│   │   └── message-handler.js
│   ├── offscreen/
│   │   ├── offscreen.html
│   │   └── pet-loop.js            # 养成计时 + 状态衰减
│   ├── content/
│   │   ├── content-main.js
│   │   ├── ui/
│   │   │   ├── floating-pet.js    # 悬浮窗 + 拖动
│   │   │   ├── side-panel.js      # 侧边栏（聊天+工具）
│   │   │   ├── sprite-renderer.js # Canvas精灵动画
│   │   │   └── pet-state-ui.js    # 状态条UI
│   │   ├── interactions/
│   │   │   ├── petting.js, playing.js, feeding.js
│   │   ├── tools/
│   │   │   ├── translator.js, summarizer.js
│   │   └── styles/pet.css
│   └── shared/
│       ├── constants.js           # 衰减速率等常量
│       ├── pet-definitions.js     # 动物注册表（可扩展）
│       └── utils.js
├── onboarding/welcome.html        # 首次引导页
└── _locales/zh_CN/messages.json
```

---

## 5. 状态管理

### 5.1 chrome.storage.local 数据结构

```js
{
  selectedPet: "cat",
  petState: {
    hunger: 80,        // 0-100
    mood: 75,          // 0-100
    energy: 60,        // 0-100
    affection: 45,     // 0-100（亲密度，互动累积）
    lastUpdateTime: 1700000000,
    isSleeping: false,
  },
  apiConfig: {
    deepseekKey: "",
    grokKey: "",
    defaultModel: "deepseek",
  },
  settings: {
    petScale: 1.0,
    autoOpen: true,
    language: "zh-CN",
    firstRun: false,
  },
  chatHistory: [ ... ]
}
```

### 5.2 状态衰减规则（仅在插件打开时计时）

| 属性 | 衰减速度 | < 下限 | > 上限 |
|------|----------|--------|--------|
| 饥饿度 | -1 / 5min | <20 饿晕 | >100 **撑死** |
| 心情值 | -1 / 8min | <20 抑郁 | >100 **笑死** |
| 精力值 | -1 / 6min | <10 累倒 | >100 **发疯** |

### 5.3 互动增减

| 操作 | 饥饿度 | 心情值 | 精力值 | 亲密度 |
|------|--------|--------|--------|--------|
| 喂食 | +15 | — | — | +2 |
| 玩耍 | — | +10 | -8 | +5 |
| 抚摸 | — | +5 | — | +3 |

### 5.4 死亡机制
- 任意属性 > 100 → 即死动画 → 宠物短暂消失 → 5分钟后重生，所有属性重置为50

---

## 6. AI 集成设计

### 6.1 API 策略
- 内置默认 Key（DeepSeek + Grok），安装即用
- 用户可选填自己 Key 切换
- 双 API fallback：一个不可用时自动切换

### 6.2 宠物 AI 人格

| 宠物 | 性格 | 说话风格示例 |
|------|------|-------------|
| 🐱 | 傲娇 | "哼，我才不是想帮你…行吧行吧。" |
| 🐶 | 热情 | "汪汪！主人你好棒！" |
| 🐸 | 佛系 | "呱~一切随缘…" |
| 🐰 | 软萌 | "主人主人~（蹭蹭）" |
| 🐹 | 贪吃 | "咕噜咕噜…（嘴巴塞满）" |
| 🐦 | 话多 | "叽叽！我跟你说——" |

### 6.3 工具模式要求
- 翻译/摘要内容必须准确、客观、不遗漏关键信息
- 宠物性格仅影响开头语和结尾语
- 翻译正文标准格式，摘要正文编号列表

---

## 7. UI 设计

### 7.1 悬浮宠物窗
- 位置：网页右下角，可自由拖动
- 显示：宠物像素动画 + 3条状态条（饥饿/心情/精力）
- 按钮：喂食/抚摸/玩耍/聊天/翻译/摘要

### 7.2 侧边栏（Chrome Side Panel）
- 宽度：380px
- 顶部：宠物信息（名称+亲密度等级）
- 中间：聊天对话区（气泡式）
- 底部：输入框 + 发送按钮 + 工具快捷按钮

### 7.3 首次引导
- 安装后弹出 welcome.html
- 引导选择宠物 → 取名字 → 简单教程（3步）

---

## 8. 可扩展性设计

- **动物扩展**：`pet-definitions.js` 注册表，新增精灵图 + 一条配置即可
- **工具扩展**：`tools/` 目录下新增文件，注册到 `tool-registry`
- **后续规划**：更多动物、小游戏、宠物装扮、社区分享

---

## 9. 非功能性要求

- 悬浮窗总资源 < 200KB（含精灵图）
- 侧边栏打开 < 1 秒
- API 响应 < 3 秒（翻译/摘要）
- UI 60fps 流畅动画
- 支持 Chrome 109+
