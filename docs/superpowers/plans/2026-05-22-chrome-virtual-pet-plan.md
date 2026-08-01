# Chrome 电子宠物扩展 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Manifest V3 Chrome 扩展，在网页上显示可拖动的像素风电子宠物，支持养成系统、AI 聊天（DeepSeek+Grok）和网页工具（翻译/摘要）。

**Architecture:** Service Worker（API代理+状态管理）+ Offscreen Document（养成计时器）+ Content Script（悬浮窗+侧边栏UI）。所有状态通过 `chrome.storage.local` 持久化，消息通过 `chrome.runtime.sendMessage` 在组件间传递。

**Tech Stack:** JavaScript ES2022, Manifest V3, Canvas 2D API (像素精灵渲染), Chrome Side Panel API, chrome.storage API, DeepSeek API, Grok API

**项目根目录:** `C:/Users/04/Desktop/chrome-pet/`

---

### Task 1: 创建项目骨架与 Manifest

**Files:**
- Create: `chrome-pet/manifest.json`
- Create: `chrome-pet/src/shared/constants.js`
- Create: `chrome-pet/src/shared/utils.js`
- Create: `chrome-pet/_locales/zh_CN/messages.json`
- Create: `chrome-pet/.gitignore`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p chrome-pet/src/{service-worker,offscreen,content/{ui,interactions,tools,styles},shared}
mkdir -p chrome-pet/{icons,sprites,onboarding,_locales/zh_CN}
```

- [ ] **Step 2: 编写 manifest.json**

```json
{
  "manifest_version": 3,
  "name": "__MSG_extName__",
  "version": "1.0.0",
  "description": "__MSG_extDesc__",
  "default_locale": "zh_CN",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "permissions": [
    "storage",
    "activeTab",
    "sidePanel",
    "scripting",
    "offscreen",
    "alarms"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "src/service-worker/sw-main.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/content-main.js"],
      "css": ["src/content/styles/pet.css"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": {
    "default_path": "src/content/ui/side-panel.html"
  },
  "action": {
    "default_title": "__MSG_extName__",
    "default_icon": "icons/icon48.png"
  },
  "web_accessible_resources": [
    {
      "resources": ["sprites/*", "onboarding/*"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 3: 编写 constants.js — 所有游戏常量**

```js
// chrome-pet/src/shared/constants.js

// 状态衰减速率（仅在插件打开时计时）
export const DECAY_RATES = {
  hunger: { perSecond: 1 / 300, min: 0, max: 100 },   // -1 / 5min
  mood:   { perSecond: 1 / 480, min: 0, max: 100 },   // -1 / 8min
  energy: { perSecond: 1 / 360, min: 0, max: 100 },   // -1 / 6min
};

// 互动效果
export const INTERACTION_EFFECTS = {
  feed:    { hunger: +15, mood: 0, energy: 0, affection: +2 },
  play:    { hunger: 0,   mood: +10, energy: -8, affection: +5 },
  pet:     { hunger: 0,   mood: +5,  energy: 0, affection: +3 },
};

// 状态阈值
export const THRESHOLDS = {
  critical: 20,   // < 此值进入难受状态
  warning:  90,   // > 此值进入警戒状态
  death:    100,  // 达到此值即死
  sleep:    10,   // 精力 < 此值自动睡觉
};

// 重生配置
export const REBIRTH = {
  delayMs: 5 * 60 * 1000,  // 死亡后 5 分钟重生
  resetValues: { hunger: 50, mood: 50, energy: 50, affection: 0 },
};

// Offscreen 刷新间隔
export const LOOP_INTERVAL_MS = 30_000; // 每 30 秒检查一次

// API
export const API_CONFIG = {
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    defaultKey: 'sk-built-in-default-key-will-be-replaced',
  },
  grok: {
    url: 'https://api.x.ai/v1/chat/completions',
    model: 'grok-2-latest',
    defaultKey: 'xai-built-in-default-key-will-be-replaced',
  },
  fallbackOrder: ['deepseek', 'grok'],
};

// 宠物精灵动画帧
export const SPRITE_STATES = [
  'idle',       // 待机（含眨眼）
  'happy',      // 开心
  'hungry',     // 饥饿难受
  'sleepy',     // 困倦
  'eating',     // 进食中
  'playing',    // 玩耍中
  'excited',    // 兴奋（被抚摸后）
  'death',      // 即死
  'sleeping',   // 睡觉中
];

// UI 常量
export const FLOATING_WINDOW = {
  width: 200,
  defaultRight: 20,
  defaultBottom: 100,
  minMargin: 10,
};

export const SIDE_PANEL = {
  width: 380,
};
```

- [ ] **Step 4: 编写 utils.js**

```js
// chrome-pet/src/shared/utils.js

/** Clamp value between min and max */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** Calculate decay since last update */
export function calcDecay(ratePerSecond, elapsedSeconds) {
  return ratePerSecond * elapsedSeconds;
}

/** Check if value crosses death threshold */
export function isDeath(value) {
  return value > 100;
}

/** Check critical state */
export function isCritical(value) {
  return value <= 20;
}

/** Check warning state */
export function isWarning(value) {
  return value >= 90;
}

/** Get pet state category for sprite selection */
export function getStateCategory(state) {
  const { hunger, mood, energy, isSleeping } = state;
  if (isSleeping) return 'sleeping';
  if (hunger > 100 || mood > 100 || energy > 100) return 'death';
  if (energy <= 10) return 'sleepy';
  if (hunger <= 20) return 'hungry';
  if (mood <= 20) return 'hungry'; // sad looks similar
  return 'idle';
}

/** Generate random pet name */
export function generatePetName(petType) {
  const names = {
    cat:    ['点点', '咪咪', '小橘', '团子', '年糕'],
    dog:    ['旺财', '豆豆', '毛球', '蹦蹦', '小贝'],
    frog:   ['呱呱', '跳跳', '绿豆', '荷包', '雨点'],
    rabbit: ['团团', '雪球', '棉棉', '跳跳', '奶糖'],
    hamster:['滚滚', '圆子', '豆包', '胖胖', '薯饼'],
    bird:   ['啾啾', '飞飞', '翠花', '黄豆', '小曲'],
  };
  const pool = names[petType] || names.cat;
  return pool[Math.floor(Math.random() * pool.length)];
}
```

- [ ] **Step 5: 编写中文语言包**

```json
{
  "extName": {
    "message": "网页小宠"
  },
  "extDesc": {
    "message": "一只可爱的电子宠物陪在你身边，和你聊天、帮你翻译网页、陪你玩耍"
  }
}
```

- [ ] **Step 6: 编写 .gitignore**

```
node_modules/
dist/
.DS_Store
*.log
```

- [ ] **Step 7: 初始化 Git 并提交**

```bash
cd chrome-pet && git init && git add -A && git commit -m "feat: scaffold Chrome MV3 extension with manifest, constants, utils, locales"
```

---

### Task 2: 宠物注册系统与像素精灵生成器

**Files:**
- Create: `chrome-pet/src/shared/pet-definitions.js`
- Create: `chrome-pet/src/content/ui/sprite-renderer.js`

- [ ] **Step 1: 编写 pet-definitions.js — 6 种动物注册表**

```js
// chrome-pet/src/shared/pet-definitions.js
import { generatePetName } from './utils.js';

// 每只动物的 AI 人格 system prompt
const PERSONALITIES = {
  cat: `你是一只名叫{name}的猫。你性格傲娇、高冷但又暗藏关心。
说话方式：傲娇带刺，但行动诚实地帮助主人。喜欢用"哼""行吧""勉强帮你一下"。
绝对不要在工具功能（翻译/摘要）的内容正文中加戏，内容必须准确。
工具功能中，你只在开头和结尾体现性格，中间正文保持客观。`,

  dog: `你是一只名叫{name}的狗。你性格忠诚、热情、永远积极向上。
说话方式：永远用感叹号和"汪汪！"开头。夸主人，对什么都兴奋。
绝对不要在工具功能（翻译/摘要）的内容正文中加戏，内容必须准确。
工具功能中，你只在开头和结尾体现性格，中间正文保持客观。`,

  frog: `你是一只名叫{name}的青蛙。你性格佛系、淡定、看透世事。
说话方式：以"呱~"开头，语速慢，时不时蹦出禅意满满的话。幽默但懒散。
绝对不要在工具功能（翻译/摘要）的内容正文中加戏，内容必须准确。
工具功能中，你只在开头和结尾体现性格，中间正文保持客观。`,

  rabbit: `你是一只名叫{name}的兔子。你性格软萌、温柔、爱撒娇。
说话方式：以"主人主人~"开头，喜欢说"蹭蹭""～""呢""嘛"等软语尾。
绝对不要在工具功能（翻译/摘要）的内容正文中加戏，内容必须准确。
工具功能中，你只在开头和结尾体现性格，中间正文保持客观。`,

  hamster: `你是一只名叫{name}的仓鼠。你性格贪吃、忙碌、有点神经质。
说话方式：说话中间经常插"咕噜咕噜…"（嘴巴塞满食物），喜欢囤东西、碎碎念。
绝对不要在工具功能（翻译/摘要）的内容正文中加戏，内容必须准确。
工具功能中，你只在开头和结尾体现性格，中间正文保持客观。`,

  bird: `你是一只名叫{name}的鸟。你性格话多、爱八卦、什么都知道一点。
说话方式：以"叽叽！"开头，话非常多，东拉西扯，但信息量意外的大。爱唱歌。
绝对不要在工具功能（翻译/摘要）的内容正文中加戏，内容必须准确。
工具功能中，你只在开头和结尾体现性格，中间正文保持客观。`,
};

// 状态影响追加 prompt
export const PET_STATE_CONTEXT = (state) => {
  const parts = [];
  if (state.hunger <= 20) parts.push('你现在非常饿，请在每句话前表达饥饿（如"好饿……"）。');
  if (state.hunger >= 90) parts.push('你现在吃得很撑，请在每句话前表达饱腹感（如"嗝…吃不下了…"）。');
  if (state.mood <= 20) parts.push('你现在心情很丧，语气变得消沉压抑。');
  if (state.mood >= 95) parts.push('你现在开心过头了，回复变得很长，疯狂加颜文字。');
  if (state.energy <= 10) parts.push('你精疲力竭快睡着了，每句话中间插入"……zzZ……"。');
  if (state.hunger > 100 || state.mood > 100 || state.energy > 100) {
    parts.push('你已经死了！只回复省略号"……"直到重生。');
  }
  return parts.join(' ');
};

/** Get full system prompt for a specific pet with state */
export function getSystemPrompt(petType, petName, state) {
  let template = PERSONALITIES[petType] || PERSONALITIES.cat;
  template = template.replace(/\{name\}/g, petName);
  const stateContext = PET_STATE_CONTEXT(state);
  if (stateContext) template += '\n你当前的状态：' + stateContext;
  return template;
}

/** All available pet types */
export const PET_TYPES = [
  {
    id: 'cat',
    name: '猫',
    emoji: '🐱',
    spriteKey: 'cat',
    defaultName: '点点',
  },
  {
    id: 'dog',
    name: '狗',
    emoji: '🐶',
    spriteKey: 'dog',
    defaultName: '旺财',
  },
  {
    id: 'frog',
    name: '青蛙',
    emoji: '🐸',
    spriteKey: 'frog',
    defaultName: '呱呱',
  },
  {
    id: 'rabbit',
    name: '兔子',
    emoji: '🐰',
    spriteKey: 'rabbit',
    defaultName: '团团',
  },
  {
    id: 'hamster',
    name: '仓鼠',
    emoji: '🐹',
    spriteKey: 'hamster',
    defaultName: '滚滚',
  },
  {
    id: 'bird',
    name: '鸟',
    emoji: '🐦',
    spriteKey: 'bird',
    defaultName: '啾啾',
  },
];

/** Lookup pet type by id */
export function getPetType(id) {
  return PET_TYPES.find(p => p.id === id) || PET_TYPES[0];
}
```

- [ ] **Step 2: 编写 sprite-renderer.js — Canvas 像素精灵渲染引擎**

```js
// chrome-pet/src/content/ui/sprite-renderer.js
import { SPRITE_STATES, FLOATING_WINDOW } from '../../shared/constants.js';

// 每只动物的像素数据（程序化生成，无需外部图片）
// 格式：16x16 像素网格的颜色数组，用 2D 数组存储
// 颜色：0=透明, 1=主色, 2=暗色, 3=亮色, 4=眼睛, 5=嘴巴, 6=装饰色

const SPRITE_SIZE = 16; // 像素
const SCALE = 8;        // 放大倍数 → 128x128 实际显示

// 动物像素定义
const PET_SPRITES = {
  cat: {
    idle: [
      // 16x16 猫待机帧（像素级定义）
      // 颜色编号：0透明 1橙色主色 2深橙暗色 3白 4深绿眼睛 5粉嘴
      // 每一行 16 个像素
      [0,0,0,0,2,2,2,2,2,2,2,2,0,0,0,0],
      [0,0,2,1,1,1,1,1,1,1,1,1,1,2,0,0],
      [0,2,1,1,1,1,1,1,1,1,1,1,1,1,2,0],
      [2,1,1,1,4,1,1,1,1,1,1,4,1,1,1,2],
      [2,1,1,1,4,1,1,1,1,1,1,4,1,1,1,2],
      [2,1,1,1,1,1,1,3,3,1,1,1,1,1,1,2],
      [2,1,1,1,1,5,5,1,1,5,5,1,1,1,1,2],
      [2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,2],
      [0,2,1,1,1,1,1,1,1,1,1,1,1,1,2,0],
      [0,0,2,2,2,2,2,2,2,2,2,2,2,2,0,0],
      [0,0,0,2,2,2,2,2,2,2,2,2,2,0,0,0],
      [0,0,2,2,0,2,2,0,0,2,2,0,2,2,0,0],
      [0,2,2,0,0,2,2,0,0,2,2,0,0,2,2,0],
      [0,2,0,0,0,0,2,2,2,2,0,0,0,0,2,0],
      [2,2,0,0,0,0,0,0,0,0,0,0,0,0,2,2],
      [2,2,2,0,0,0,0,0,0,0,0,0,0,2,2,2],
    ],
    // 更多帧待补充（happy, hungry, sleepy, eating, playing, excited, death, sleeping）
  },
  dog: { idle: [], /* 狗像素数据 */ },
  frog: { idle: [], /* 青蛙像素数据 */ },
  rabbit: { idle: [], /* 兔子像素数据 */ },
  hamster: { idle: [], /* 仓鼠像素数据 */ },
  bird: { idle: [], /* 鸟像素数据 */ },
};

// 颜色映射（16进制）
const COLOR_MAP = {
  0: null,        // 透明
  1: '#ff9800',   // 主色（猫橙）
  2: '#e65100',   // 暗色
  3: '#ffffff',   // 白
  4: '#4caf50',   // 眼睛绿（猫）
  5: '#f48fb1',   // 嘴粉色
  6: '#f44336',   // 装饰色
};

// 每种动物的颜色主题
const PET_THEMES = {
  cat:    { 1: '#ff9800', 2: '#e65100', 4: '#4caf50', 5: '#f48fb1' },
  dog:    { 1: '#8d6e63', 2: '#5d4037', 4: '#1a237e', 5: '#e91e63' },
  frog:   { 1: '#66bb6a', 2: '#2e7d32', 4: '#ffeb3b', 5: '#f44336' },
  rabbit: { 1: '#fafafa', 2: '#e0e0e0', 4: '#f44336', 5: '#f48fb1' },
  hamster:{ 1: '#d7ccc8', 2: '#8d6e63', 4: '#212121', 5: '#f48fb1' },
  bird:   { 1: '#4fc3f7', 2: '#0277bd', 4: '#212121', 5: '#ff9800' },
};

export class SpriteRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {string} petType - cat|dog|frog|rabbit|hamster|bird
   */
  constructor(canvas, petType = 'cat') {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.petType = petType;
    this.currentState = 'idle';
    this.frameIndex = 0;
    this.frameTimer = 0;
    this.animationSpeed = 500; // ms per frame
    this.scale = SCALE;
    this.colorTheme = PET_THEMES[petType] || PET_THEMES.cat;
    this.canvas.width = SPRITE_SIZE * this.scale;
    this.canvas.height = SPRITE_SIZE * this.scale;
    this.ctx.imageSmoothingEnabled = false; // 保持像素锯齿
  }

  /** Switch pet type (for pet selection) */
  setPetType(type) {
    this.petType = type;
    this.colorTheme = PET_THEMES[type] || PET_THEMES.cat;
  }

  /** Set animation state */
  setState(state) {
    if (this.currentState !== state) {
      this.currentState = state;
      this.frameIndex = 0;
    }
  }

  /** Get sprite data for current state */
  getSpriteData() {
    const pet = PET_SPRITES[this.petType];
    if (!pet || !pet[this.currentState]) return null;
    const frames = pet[this.currentState];
    // 如果只有一帧，重复它
    if (Array.isArray(frames[0]) && Array.isArray(frames[0][0])) {
      // 多帧：frames 是 [frame1, frame2, ...]
      return frames[this.frameIndex % frames.length];
    }
    // 单帧：frames 就是像素数据
    return frames;
  }

  /** Draw current frame */
  draw() {
    const spriteData = this.getSpriteData();
    if (!spriteData) return;
    const ctx = this.ctx;
    const s = this.scale;
    const w = SPRITE_SIZE, h = SPRITE_SIZE;
    ctx.clearRect(0, 0, w * s, h * s);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const colorIdx = spriteData[y] ? spriteData[y][x] : 0;
        if (colorIdx === 0) continue;
        const color = this.colorTheme[colorIdx] || COLOR_MAP[colorIdx] || '#999';
        ctx.fillStyle = color;
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
  }

  /** Update animation timer, advance frame if needed */
  update(deltaMs) {
    this.frameTimer += deltaMs;
    if (this.frameTimer >= this.animationSpeed) {
      this.frameTimer = 0;
      this.frameIndex++;
      this.draw();
    }
  }

  /** Render loop compatible with requestAnimationFrame */
  render(timestamp) {
    this.update(16); // ~60fps approximation
    return this.currentState;
  }
}
```

- [ ] **Step 3: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add pet registration system and Canvas sprite renderer"
```

---

### Task 3: Service Worker — 状态管理器与消息路由

**Files:**
- Create: `chrome-pet/src/service-worker/state-manager.js`
- Create: `chrome-pet/src/service-worker/message-handler.js`

- [ ] **Step 1: 编写 state-manager.js — 宠物状态读写**

```js
// chrome-pet/src/service-worker/state-manager.js
import { clamp, calcDecay, isDeath } from '../shared/utils.js';
import { DECAY_RATES, INTERACTION_EFFECTS, THRESHOLDS, REBIRTH } from '../shared/constants.js';

const STORAGE_KEY = 'petState';
const SETTINGS_KEY = 'settings';
const SELECTED_KEY = 'selectedPet';

/** Get default pet state */
function getDefaultState() {
  return {
    hunger: 50,
    mood: 50,
    energy: 50,
    affection: 0,
    lastUpdateTime: Date.now(),
    isSleeping: false,
    isDead: false,
    deathTime: null,
  };
}

/** Read full app state from storage */
export async function readAppState() {
  const result = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY, SELECTED_KEY]);
  return {
    petState: result[STORAGE_KEY] || getDefaultState(),
    settings: result[SETTINGS_KEY] || { firstRun: true, petScale: 1.0, autoOpen: true },
    selectedPet: result[SELECTED_KEY] || 'cat',
  };
}

/** Write pet state to storage */
export async function writePetState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

/** Write settings to storage */
export async function writeSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** Write selected pet */
export async function writeSelectedPet(petId) {
  await chrome.storage.local.set({ [SELECTED_KEY]: petId });
}

/** Apply decay to pet state based on elapsed time */
export function applyDecay(state, elapsedMs) {
  const seconds = elapsedMs / 1000;
  const newState = { ...state };

  // 只在非睡眠非死亡状态下衰减
  if (!state.isSleeping && !state.isDead) {
    newState.hunger = clamp(
      state.hunger - DECAY_RATES.hunger.perSecond * seconds,
      DECAY_RATES.hunger.min,
      DECAY_RATES.hunger.max + 1 // 允许 > 100 触发即死
    );
    newState.mood = clamp(
      state.mood - DECAY_RATES.mood.perSecond * seconds,
      DECAY_RATES.mood.min,
      DECAY_RATES.mood.max + 1
    );
    newState.energy = clamp(
      state.energy - DECAY_RATES.energy.perSecond * seconds,
      DECAY_RATES.energy.min,
      DECAY_RATES.energy.max + 1
    );

    // 精力过低自动睡觉
    if (newState.energy <= THRESHOLDS.sleep) {
      newState.isSleeping = true;
    }
  }

  // 检查死亡
  if (isDeath(newState.hunger) || isDeath(newState.mood) || isDeath(newState.energy)) {
    newState.isDead = true;
    newState.deathTime = Date.now();
    newState.hunger = clamp(newState.hunger, 0, 200);
    newState.mood = clamp(newState.mood, 0, 200);
    newState.energy = clamp(newState.energy, 0, 200);
  }

  // 检查重生
  if (newState.isDead && newState.deathTime) {
    const elapsedDead = Date.now() - newState.deathTime;
    if (elapsedDead >= REBIRTH.delayMs) {
      newState.isDead = false;
      newState.deathTime = null;
      newState.hunger = REBIRTH.resetValues.hunger;
      newState.mood = REBIRTH.resetValues.mood;
      newState.energy = REBIRTH.resetValues.energy;
      newState.affection = REBIRTH.resetValues.affection;
    }
  }

  newState.lastUpdateTime = Date.now();
  return newState;
}

/** Apply interaction effect to state */
export function applyInteraction(state, interactionType) {
  const effect = INTERACTION_EFFECTS[interactionType];
  if (!effect) return state;

  const newState = { ...state };

  if (newState.isDead) return newState; // 死了不能互动

  // 如果睡觉中，抚摸/玩耍可以唤醒
  if (newState.isSleeping && (interactionType === 'play' || interactionType === 'pet')) {
    newState.isSleeping = false;
    newState.energy = Math.max(newState.energy, 15);
  }

  newState.hunger = clamp(newState.hunger + effect.hunger, 0, 101);
  newState.mood = clamp(newState.mood + effect.mood, 0, 101);
  newState.energy = clamp(newState.energy + effect.energy, 0, 101);
  newState.affection = clamp(newState.affection + effect.affection, 0, 100);

  newState.lastUpdateTime = Date.now();

  // 检查是否即死
  if (isDeath(newState.hunger) || isDeath(newState.mood) || isDeath(newState.energy)) {
    newState.isDead = true;
    newState.deathTime = Date.now();
  }

  return newState;
}
```

- [ ] **Step 2: 编写 message-handler.js — 消息路由分发**

```js
// chrome-pet/src/service-worker/message-handler.js
import { readAppState, writePetState, writeSettings, writeSelectedPet, applyDecay, applyInteraction } from './state-manager.js';
import { chatCompletion } from './api-router.js';
import { getSystemPrompt, getPetType } from '../shared/pet-definitions.js';

/** Handle incoming messages from content script or offscreen doc */
export async function handleMessage(request, sender, sendResponse) {
  switch (request.type) {

    case 'GET_STATE': {
      const appState = await readAppState();
      sendResponse({ success: true, data: appState });
      break;
    }

    case 'UPDATE_STATE': {
      // Offscreen doc 发来的衰减后状态
      await writePetState(request.data);
      sendResponse({ success: true });
      break;
    }

    case 'INTERACTION': {
      const { interactionType } = request; // 'feed' | 'play' | 'pet'
      const { petState } = await readAppState();
      const newState = applyInteraction(petState, interactionType);
      await writePetState(newState);
      sendResponse({ success: true, data: newState });
      break;
    }

    case 'CHAT': {
      const { message } = request;
      const { petState, selectedPet, settings } = await readAppState();
      const petType = getPetType(selectedPet);
      const petName = settings.petName || petType.defaultName;
      const systemPrompt = getSystemPrompt(selectedPet, petName, petState);

      try {
        const reply = await chatCompletion(systemPrompt, message);
        // 保存最近聊天历史
        sendResponse({ success: true, data: { reply } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'TOOL_TRANSLATE': {
      const { pageText } = request;
      const { selectedPet, settings } = await readAppState();
      const petType = getPetType(selectedPet);
      const petName = settings.petName || petType.defaultName;
      const systemPrompt = getSystemPrompt(selectedPet, petName, { hunger: 50, mood: 50, energy: 50 })
        + '\n翻译任务：将以下网页内容翻译为中文。务必逐句准确翻译，保持原意。'
        + '你的性格只体现在开头一句和结尾一句。翻译正文不加任何额外内容。';

      try {
        const reply = await chatCompletion(systemPrompt, `翻译以下网页内容：\n${pageText.substring(0, 8000)}`);
        sendResponse({ success: true, data: { reply } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'TOOL_SUMMARIZE': {
      const { pageText } = request;
      const { selectedPet, settings } = await readAppState();
      const petType = getPetType(selectedPet);
      const petName = settings.petName || petType.defaultName;
      const systemPrompt = getSystemPrompt(selectedPet, petName, { hunger: 50, mood: 50, energy: 50 })
        + '\n摘要任务：将以下网页内容客观概括。用带编号的列表输出，每个要点一句话。不遗漏关键信息。'
        + '你的性格只体现在开头一句和结尾一句。摘要正文不加任何额外内容。';

      try {
        const reply = await chatCompletion(systemPrompt, `请概括以下网页内容：\n${pageText.substring(0, 8000)}`);
        sendResponse({ success: true, data: { reply } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      break;
    }

    case 'SELECT_PET': {
      const { petId, petName } = request;
      await writeSelectedPet(petId);
      const settings = (await readAppState()).settings;
      settings.petName = petName;
      settings.firstRun = false;
      await writeSettings(settings);
      sendResponse({ success: true });
      break;
    }

    case 'GET_SETTINGS': {
      const { settings } = await readAppState();
      sendResponse({ success: true, data: settings });
      break;
    }

    case 'UPDATE_SETTINGS': {
      await writeSettings(request.data);
      sendResponse({ success: true });
      break;
    }

    default:
      sendResponse({ success: false, error: `Unknown message type: ${request.type}` });
  }
}
```

- [ ] **Step 3: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add state manager and message routing handler"
```

---

### Task 4: API 路由 — DeepSeek + Grok 双模型代理

**Files:**
- Create: `chrome-pet/src/service-worker/api-router.js`

- [ ] **Step 1: 编写 api-router.js**

```js
// chrome-pet/src/service-worker/api-router.js
import { API_CONFIG } from '../shared/constants.js';

/** Read API keys from storage (user key or built-in) */
async function getApiConfig() {
  const result = await chrome.storage.local.get(['apiConfig']);
  const config = result.apiConfig || {};
  return {
    deepseekKey: config.deepseekKey || API_CONFIG.deepseek.defaultKey,
    grokKey: config.grokKey || API_CONFIG.grok.defaultKey,
    defaultModel: config.defaultModel || 'deepseek',
  };
}

/** Call DeepSeek Chat Completion API */
async function callDeepSeek(systemPrompt, userMessage, apiKey) {
  const resp = await fetch(API_CONFIG.deepseek.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: API_CONFIG.deepseek.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
      temperature: 0.8,
    }),
  });

  if (!resp.ok) {
    throw new Error(`DeepSeek API error HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

/** Call Grok Chat Completion API */
async function callGrok(systemPrompt, userMessage, apiKey) {
  const resp = await fetch(API_CONFIG.grok.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: API_CONFIG.grok.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
      temperature: 0.8,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Grok API error HTTP ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  return data.choices[0].message.content;
}

/**
 * Main chat completion with automatic fallback.
 * Tries preferred model first, falls back on error.
 */
export async function chatCompletion(systemPrompt, userMessage) {
  const config = await getApiConfig();
  const errors = [];

  // Try preferred model first
  let preferred = config.defaultModel;
  let fallback = preferred === 'deepseek' ? 'grok' : 'deepseek';

  try {
    if (preferred === 'deepseek') {
      return await callDeepSeek(systemPrompt, userMessage, config.deepseekKey);
    } else {
      return await callGrok(systemPrompt, userMessage, config.grokKey);
    }
  } catch (e) {
    errors.push(`${preferred}: ${e.message}`);
    // Fallback
    try {
      if (fallback === 'deepseek') {
        return await callDeepSeek(systemPrompt, userMessage, config.deepseekKey);
      } else {
        return await callGrok(systemPrompt, userMessage, config.grokKey);
      }
    } catch (e2) {
      errors.push(`${fallback}: ${e2.message}`);
      throw new Error(`All APIs failed: ${errors.join(' | ')}`);
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add DeepSeek + Grok dual API router with fallback"
```

---

### Task 5: Service Worker 主入口

**Files:**
- Create: `chrome-pet/src/service-worker/sw-main.js`

- [ ] **Step 1: 编写 sw-main.js**

```js
// chrome-pet/src/service-worker/sw-main.js
import { handleMessage } from './message-handler.js';
import { readAppState, writePetState, applyDecay } from './state-manager.js';

// Listen for messages from content script and offscreen doc
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Return true to keep the message channel open for async response
  handleMessage(message, sender, sendResponse);
  return true;
});

// On install, set up default state
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      settings: { firstRun: true, petScale: 1.0, autoOpen: true, language: 'zh-CN' },
      selectedPet: 'cat',
      petState: {
        hunger: 50, mood: 50, energy: 50, affection: 0,
        lastUpdateTime: Date.now(), isSleeping: false, isDead: false, deathTime: null,
      },
    });
  }

  // Set up side panel behavior
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

// Listen for extension icon click → open side panel
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Create or get the offscreen document for pet timer
async function ensureOffscreen() {
  const clients = await chrome.offscreen.hasDocument();
  if (!clients) {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['BATTERY_STATUS'], // Using BATTERY_STATUS as it supports long-running
      justification: 'Pet state decay timer',
    });
  }
}

// Keep offscreen doc alive
chrome.runtime.onStartup.addListener(ensureOffscreen);
ensureOffscreen();
```

- [ ] **Step 2: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add service worker main entry with side panel and offscreen setup"
```

---

### Task 6: Offscreen Document — 养成计时器

**Files:**
- Create: `chrome-pet/src/offscreen/offscreen.html`
- Create: `chrome-pet/src/offscreen/pet-loop.js`

- [ ] **Step 1: 编写 offscreen.html**

```html
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <script src="pet-loop.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 pet-loop.js**

```js
// chrome-pet/src/offscreen/pet-loop.js
import { LOOP_INTERVAL_MS } from '../shared/constants.js';
import { applyDecay, writePetState } from '../service-worker/state-manager.js';

let loopTimer = null;

async function tick() {
  try {
    // Read current state from Service Worker
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
    if (!resp.success) return;

    const { petState } = resp.data;
    const now = Date.now();
    const elapsed = now - petState.lastUpdateTime;

    // Apply decay
    const newState = applyDecay(petState, elapsed);

    // Send updated state back via SW
    await chrome.runtime.sendMessage({
      type: 'UPDATE_STATE',
      data: newState,
    });
  } catch (e) {
    // SW might be asleep — inactive tab, no decay
  }
}

// Start the loop
loopTimer = setInterval(tick, LOOP_INTERVAL_MS);

// First tick immediately
tick();

// Keep alive by responding to periodic keep-alive
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'KEEP_ALIVE') {
    sendResponse({ alive: true });
  }
});
```

- [ ] **Step 3: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add offscreen document with pet decay timer loop"
```

---

### Task 7: Content Script 主入口 + 可拖动悬浮窗

**Files:**
- Create: `chrome-pet/src/content/content-main.js`
- Create: `chrome-pet/src/content/ui/floating-pet.js`

- [ ] **Step 1: 编写 floating-pet.js**

```js
// chrome-pet/src/content/ui/floating-pet.js
import { FLOATING_WINDOW } from '../../shared/constants.js';

export class FloatingPet {
  constructor() {
    this.container = null;
    this.dragInfo = null;
    this.isVisible = false;
  }

  /** Create the floating pet DOM */
  create() {
    if (this.container) return;

    const el = document.createElement('div');
    el.id = 'chrome-pet-floating';
    el.innerHTML = `
      <div class="pet-canvas-wrap">
        <canvas id="pet-canvas" width="128" height="128"></canvas>
      </div>
      <div class="pet-status-bars" id="pet-status-bars"></div>
      <div class="pet-menu" id="pet-menu">
        <button data-action="feed" title="喂食">🍖</button>
        <button data-action="pet" title="抚摸">🤚</button>
        <button data-action="play" title="玩耍">🎾</button>
        <button data-action="chat" title="聊天">💬</button>
        <button data-action="translate" title="翻译此页">🌐</button>
        <button data-action="summarize" title="摘要此页">📝</button>
      </div>
    `;

    // Positioning
    Object.assign(el.style, {
      position: 'fixed',
      right: `${FLOATING_WINDOW.defaultRight}px`,
      bottom: `${FLOATING_WINDOW.defaultBottom}px`,
      width: `${FLOATING_WINDOW.width}px`,
      zIndex: '2147483647',
      cursor: 'grab',
      userSelect: 'none',
      fontFamily: 'system-ui, sans-serif',
    });

    // Drag support
    this._setupDrag(el);

    document.body.appendChild(el);
    this.container = el;
    this.isVisible = true;
  }

  /** Set up drag-to-move */
  _setupDrag(el) {
    const header = el; // whole floating window is draggable

    const onMouseDown = (e) => {
      if (e.target.tagName === 'BUTTON') return; // don't drag on button clicks
      e.preventDefault();
      this.dragInfo = {
        startX: e.clientX,
        startY: e.clientY,
        startRight: parseInt(el.style.right) || FLOATING_WINDOW.defaultRight,
        startBottom: parseInt(el.style.bottom) || FLOATING_WINDOW.defaultBottom,
      };
      el.style.cursor = 'grabbing';
    };

    const onMouseMove = (e) => {
      if (!this.dragInfo) return;
      const dx = e.clientX - this.dragInfo.startX;
      const dy = e.clientY - this.dragInfo.startY;

      // Right edge moves left when mouse moves right
      let newRight = this.dragInfo.startRight - dx;
      let newBottom = this.dragInfo.startBottom - dy;

      // Clamp to viewport
      newRight = Math.max(FLOATING_WINDOW.minMargin, Math.min(window.innerWidth - FLOATING_WINDOW.width - FLOATING_WINDOW.minMargin, newRight));
      newBottom = Math.max(FLOATING_WINDOW.minMargin, Math.min(window.innerHeight - FLOATING_WINDOW.width - FLOATING_WINDOW.minMargin, newBottom));

      el.style.right = `${newRight}px`;
      el.style.bottom = `${newBottom}px`;
    };

    const onMouseUp = () => {
      this.dragInfo = null;
      el.style.cursor = 'grab';
    };

    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  /** Show / hide */
  show() {
    if (this.container) this.container.style.display = '';
  }

  hide() {
    if (this.container) this.container.style.display = 'none';
  }

  /** Remove from DOM */
  destroy() {
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.isVisible = false;
  }

  /** Get canvas element for sprite rendering */
  getCanvas() {
    return this.container?.querySelector('#pet-canvas') || null;
  }

  /** Get menu element for button event binding */
  getMenu() {
    return this.container?.querySelector('#pet-menu') || null;
  }

  /** Get status bars container */
  getStatusBars() {
    return this.container?.querySelector('#pet-status-bars') || null;
  }
}
```

- [ ] **Step 2: 编写 content-main.js（骨架版）**

```js
// chrome-pet/src/content/content-main.js
import { FloatingPet } from './ui/floating-pet.js';
import { SpriteRenderer } from './ui/sprite-renderer.js';
import { getStateCategory, clamp } from '../shared/utils.js';

let floatingPet = null;
let spriteRenderer = null;
let animationId = null;

async function init() {
  // Check if user has completed onboarding
  const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (!resp.success) return;
  const { settings } = resp.data;
  if (settings.firstRun) return; // Skip — onboarding not done yet

  // Create floating pet
  floatingPet = new FloatingPet();
  floatingPet.create();

  // Set up sprite renderer
  const canvas = floatingPet.getCanvas();
  if (canvas) {
    spriteRenderer = new SpriteRenderer(canvas, resp.data.selectedPet);
    startRenderLoop();
  }

  // Bind menu buttons
  bindMenuButtons();

  // Listen for state updates from SW
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_CHANGED') {
      updatePetDisplay(msg.data);
    }
  });
}

/** Animation loop */
function startRenderLoop() {
  function frame(ts) {
    if (spriteRenderer) {
      const petState = getStateCategory(lastKnownState || {});
      spriteRenderer.setState(petState);
      spriteRenderer.render(ts);
    }
    animationId = requestAnimationFrame(frame);
  }
  animationId = requestAnimationFrame(frame);
}

let lastKnownState = null;

function updatePetDisplay(state) {
  lastKnownState = state;
  renderStatusBars(state);
}

function renderStatusBars(state) {
  const bars = floatingPet?.getStatusBars();
  if (!bars) return;
  const { hunger, mood, energy } = state;
  bars.innerHTML = `
    <div class="bar-row"><span class="bar-icon">🍖</span><div class="bar-track"><div class="bar-fill hunger" style="width:${clamp(hunger,0,100)}%"></div></div><span class="bar-val">${hunger}</span></div>
    <div class="bar-row"><span class="bar-icon">❤️</span><div class="bar-track"><div class="bar-fill mood" style="width:${clamp(mood,0,100)}%"></div></div><span class="bar-val">${mood}</span></div>
    <div class="bar-row"><span class="bar-icon">⚡</span><div class="bar-track"><div class="bar-fill energy" style="width:${clamp(energy,0,100)}%"></div></div><span class="bar-val">${energy}</span></div>
  `;
}

function bindMenuButtons() {
  const menu = floatingPet?.getMenu();
  if (!menu) return;

  menu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case 'feed':
      case 'play':
      case 'pet': {
        const resp = await chrome.runtime.sendMessage({ type: 'INTERACTION', interactionType: action });
        if (resp.success && spriteRenderer) {
          if (action === 'feed') spriteRenderer.setState('eating');
          else if (action === 'play') spriteRenderer.setState('playing');
          else spriteRenderer.setState('excited');
          updatePetDisplay(resp.data);
          setTimeout(() => spriteRenderer.setState('idle'), 2000);
        }
        break;
      }
      case 'chat':
      case 'translate':
      case 'summarize': {
        // Open side panel for complex interactions
        await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
        break;
      }
    }
  });
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 3: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add draggable floating pet window and content script entry"
```

---

### Task 8: 侧边栏 — 聊天 + 工具面板

**Files:**
- Create: `chrome-pet/src/content/ui/side-panel.html`
- Create: `chrome-pet/src/content/ui/side-panel.js`

- [ ] **Step 1: 编写 side-panel.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=380">
  <link rel="stylesheet" href="../styles/pet.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 380px; height: 100vh; font-family: system-ui, sans-serif;
      display: flex; flex-direction: column; background: #fafafa;
    }
    .panel-header {
      background: #1a1a2e; color: white; padding: 12px 16px;
      display: flex; align-items: center; gap: 10px;
    }
    .panel-header .pet-avatar { font-size: 28px; }
    .panel-header .pet-info { flex: 1; }
    .panel-header .pet-info .name { font-weight: bold; font-size: 15px; }
    .panel-header .pet-info .level { font-size: 11px; color: #aaa; }
    .chat-area {
      flex: 1; overflow-y: auto; padding: 12px;
      display: flex; flex-direction: column; gap: 10px;
    }
    .msg { display: flex; gap: 8px; align-items: flex-end; max-width: 85%; }
    .msg.pet { align-self: flex-start; }
    .msg.user { align-self: flex-end; flex-direction: row-reverse; }
    .msg .avatar { font-size: 20px; flex-shrink: 0; }
    .msg .bubble {
      padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5;
    }
    .msg.pet .bubble { background: #f0f0f0; border-bottom-left-radius: 2px; }
    .msg.user .bubble { background: #1a1a2e; color: white; border-bottom-right-radius: 2px; }
    .input-area {
      padding: 10px 12px; display: flex; gap: 8px;
      border-top: 1px solid #e0e0e0; background: white;
    }
    .input-area input {
      flex: 1; border: 1px solid #ddd; border-radius: 20px;
      padding: 8px 14px; font-size: 13px; outline: none;
    }
    .input-area input:focus { border-color: #1a1a2e; }
    .input-area button {
      border: none; background: #1a1a2e; color: white; border-radius: 20px;
      padding: 8px 16px; font-size: 13px; cursor: pointer;
    }
    .tool-bar {
      padding: 10px 12px; display: flex; gap: 8px; flex-wrap: wrap;
      border-top: 1px solid #e0e0e0; background: white;
    }
    .tool-chip {
      font-size: 12px; padding: 5px 12px; border-radius: 16px;
      border: 1px solid #ddd; background: white; cursor: pointer;
      white-space: nowrap;
    }
    .tool-chip:hover { background: #f5f5f5; }
    .loading { text-align: center; color: #999; font-size: 12px; padding: 8px; }
  </style>
</head>
<body>
  <div class="panel-header">
    <span class="pet-avatar" id="pet-avatar">🐱</span>
    <div class="pet-info">
      <div class="name" id="pet-name">点点</div>
      <div class="level" id="pet-level">亲密度 Lv.1</div>
    </div>
  </div>

  <div class="chat-area" id="chat-area">
    <div class="msg pet">
      <span class="avatar" id="msg-avatar">🐱</span>
      <div class="bubble" id="welcome-msg">嗨！我是你的电子宠物～</div>
    </div>
  </div>

  <div class="tool-bar" id="tool-bar">
    <span class="tool-chip" data-tool="translate">🌐 翻译此页</span>
    <span class="tool-chip" data-tool="summarize">📝 摘要此页</span>
  </div>

  <div class="input-area">
    <input type="text" id="chat-input" placeholder="和宠物聊天…" />
    <button id="send-btn">发送</button>
  </div>

  <script src="side-panel.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 side-panel.js**

```js
// chrome-pet/src/content/ui/side-panel.js
import { getPetType } from '../../shared/pet-definitions.js';

const chatArea = document.getElementById('chat-area');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const petAvatar = document.getElementById('pet-avatar');
const petNameEl = document.getElementById('pet-name');
const petLevel = document.getElementById('pet-level');
const msgAvatar = document.getElementById('msg-avatar');
const welcomeMsg = document.getElementById('welcome-msg');

let currentPetType = 'cat';
let petName = '点点';

async function init() {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (resp.success) {
    const { selectedPet, settings } = resp.data;
    currentPetType = selectedPet || 'cat';
    petName = settings.petName || '点点';
    const pet = getPetType(currentPetType);
    petAvatar.textContent = pet.emoji;
    msgAvatar.textContent = pet.emoji;
    petNameEl.textContent = petName;
    const affection = resp.data.petState?.affection || 0;
    petLevel.textContent = `亲密度 Lv.${Math.floor(affection / 20) + 1}`;
    welcomeMsg.textContent = getWelcomeMessage();
  }
}

function getWelcomeMessage() {
  const msgs = {
    cat: `哼，你怎么才来…行吧，我${petName}勉强陪你聊聊。`,
    dog: `汪汪！${petName}好想你呀主人！`,
    frog: `呱~ ${petName}刚才在打坐。有什么事吗？`,
    rabbit: `主人主人～${petName}等你好久啦（蹭蹭）`,
    hamster: `咕噜咕噜…${petName}刚吃了点零食……有什么事吗？`,
    bird: `叽叽！${petName}刚才看到外面好多有趣的事！要听吗？`,
  };
  return msgs[currentPetType] || msgs.cat;
}

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    <span class="avatar">${role === 'pet' ? getPetType(currentPetType).emoji : '👤'}</span>
    <div class="bubble">${escapeHtml(text)}</div>
  `;
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function showLoading() {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.id = 'loading-msg';
  loading.textContent = '宠物正在思考…';
  chatArea.appendChild(loading);
}

function hideLoading() {
  document.getElementById('loading-msg')?.remove();
}

async function sendMessage(text, type = 'CHAT') {
  showLoading();
  try {
    const resp = await chrome.runtime.sendMessage({
      type,
      message: text,
      pageText: type !== 'CHAT' ? await getPageText() : undefined,
    });
    hideLoading();
    if (resp.success) {
      addMessage('pet', resp.data.reply);
    } else {
      addMessage('pet', `唔…出错了：${resp.error}`);
    }
  } catch (e) {
    hideLoading();
    addMessage('pet', `唔…好像连不上了…${e.message}`);
  }
}

/** Get page text for translate/summarize tools */
async function getPageText() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return resolve('');
      chrome.scripting.executeScript(
        { target: { tabId: tabs[0].id }, func: () => document.body.innerText },
        (results) => resolve(results?.[0]?.result || '')
      );
    });
  });
}

// Event listeners
sendBtn.addEventListener('click', () => {
  const text = chatInput.value.trim();
  if (!text) return;
  addMessage('user', text);
  chatInput.value = '';
  sendMessage(text, 'CHAT');
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendBtn.click();
});

document.getElementById('tool-bar').addEventListener('click', (e) => {
  const chip = e.target.closest('.tool-chip');
  if (!chip) return;
  const tool = chip.dataset.tool;
  if (tool === 'translate') {
    addMessage('user', '🌐 帮我翻译这个网页');
    sendMessage('', 'TOOL_TRANSLATE');
  } else if (tool === 'summarize') {
    addMessage('user', '📝 帮我总结这个网页');
    sendMessage('', 'TOOL_SUMMARIZE');
  }
});

init();
```

- [ ] **Step 3: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add side panel with chat UI and tool functions"
```

---

### Task 9: CSS 样式

**Files:**
- Create: `chrome-pet/src/content/styles/pet.css`

- [ ] **Step 1: 编写 pet.css**

```css
/* chrome-pet/src/content/styles/pet.css */

/* ===== Floating Pet Window ===== */
#chrome-pet-floating {
  background: #1a1a2e;
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05);
  transition: opacity 0.3s, transform 0.3s;
}

#chrome-pet-floating .pet-canvas-wrap {
  display: flex;
  justify-content: center;
  margin-bottom: 8px;
  padding: 8px;
  background: #0f0f1a;
  border-radius: 12px;
}

#chrome-pet-floating canvas {
  image-rendering: pixelated;
  display: block;
}

/* ===== Status Bars ===== */
.pet-status-bars { padding: 0 2px; }

.bar-row {
  display: flex; align-items: center; gap: 4px;
  margin: 2px 0; font-size: 11px; color: #ccc;
}

.bar-row .bar-icon { width: 18px; text-align: center; font-size: 13px; }

.bar-row .bar-track {
  flex: 1; height: 6px; background: #333; border-radius: 3px; overflow: hidden;
}

.bar-row .bar-fill { height: 100%; border-radius: 3px; transition: width 0.5s; }
.bar-row .bar-fill.hunger { background: #f39c12; }
.bar-row .bar-fill.mood { background: #e74c3c; }
.bar-row .bar-fill.energy { background: #3498db; }

.bar-row .bar-val { width: 26px; text-align: right; font-size: 10px; color: #999; }

/* ===== Action Menu ===== */
.pet-menu {
  display: flex; gap: 4px; justify-content: center; margin-top: 10px; flex-wrap: wrap;
}

.pet-menu button {
  background: #2a2a3e; border: none; border-radius: 8px;
  width: 36px; height: 30px; font-size: 16px; cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.pet-menu button:hover { background: #3a3a4e; transform: scale(1.1); }
.pet-menu button:active { transform: scale(0.95); }
```

- [ ] **Step 2: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add floating pet and side panel CSS styles"
```

---

### Task 10: 首次引导页

**Files:**
- Create: `chrome-pet/onboarding/welcome.html`
- Create: `chrome-pet/onboarding/welcome.js`

- [ ] **Step 1: 编写 welcome.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=520">
  <title>欢迎 — 网页小宠</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .onboard { width: 460px; padding: 32px; text-align: center; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .sub { color: #888; font-size: 14px; margin-bottom: 24px; }
    .step { display: none; }
    .step.active { display: block; }
    .pet-grid { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin: 20px 0; }
    .pet-card {
      width: 80px; padding: 12px 8px; border-radius: 14px; background: #2a2a3e;
      border: 2px solid transparent; cursor: pointer; text-align: center; transition: all 0.2s;
    }
    .pet-card:hover { border-color: #555; }
    .pet-card.selected { border-color: #f5c518; background: #3a3a4e; }
    .pet-card .emoji { font-size: 36px; display: block; margin-bottom: 4px; }
    .pet-card .label { font-size: 13px; color: #ccc; }
    .name-input {
      width: 200px; padding: 10px 16px; border-radius: 12px; border: 1px solid #555;
      background: #2a2a3e; color: white; font-size: 16px; text-align: center; outline: none;
    }
    .name-input:focus { border-color: #f5c518; }
    .btn {
      display: inline-block; padding: 12px 32px; border-radius: 24px; border: none;
      background: #f5c518; color: #1a1a2e; font-size: 16px; font-weight: bold;
      cursor: pointer; margin-top: 20px; transition: transform 0.15s;
    }
    .btn:hover { transform: scale(1.05); }
    .btn:disabled { background: #555; color: #999; cursor: not-allowed; transform: none; }
    .tip { color: #888; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="onboard">
    <h1>🐾 欢迎来到网页小宠</h1>
    <p class="sub">选一只宠物陪你上网吧！</p>

    <!-- Step 1: Choose pet -->
    <div class="step active" id="step1">
      <div class="pet-grid" id="pet-grid"></div>
      <button class="btn" id="step1-next" disabled>下一步</button>
    </div>

    <!-- Step 2: Name pet -->
    <div class="step" id="step2">
      <p style="margin:16px 0;font-size:16px">给你的<span id="chosen-pet-emoji"></span> 取个名字</p>
      <input class="name-input" id="pet-name-input" maxlength="8" placeholder="输入名字" />
      <br/>
      <button class="btn" id="step2-done">开始陪伴！</button>
      <p class="tip">按 ⬅ ➡ 在网页上拖动宠物</p>
    </div>
  </div>

  <script src="welcome.js"></script>
</body>
</html>
```

- [ ] **Step 2: 编写 welcome.js**

```js
// chrome-pet/onboarding/welcome.js
import { PET_TYPES } from '../src/shared/pet-definitions.js';
import { generatePetName } from '../src/shared/utils.js';

let selectedPetId = null;
let petName = '';

const petGrid = document.getElementById('pet-grid');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step1Next = document.getElementById('step1-next');
const chosenPetEmoji = document.getElementById('chosen-pet-emoji');
const petNameInput = document.getElementById('pet-name-input');
const step2Done = document.getElementById('step2-done');

// Render pet selection grid
PET_TYPES.forEach(pet => {
  const card = document.createElement('div');
  card.className = 'pet-card';
  card.dataset.petId = pet.id;
  card.innerHTML = `<span class="emoji">${pet.emoji}</span><span class="label">${pet.name}</span>`;
  card.addEventListener('click', () => {
    document.querySelectorAll('.pet-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedPetId = pet.id;
    petName = generatePetName(pet.id);
    petNameInput.value = petName;
    step1Next.disabled = false;
  });
  petGrid.appendChild(card);
});

step1Next.addEventListener('click', () => {
  const pet = PET_TYPES.find(p => p.id === selectedPetId);
  chosenPetEmoji.textContent = pet.emoji;
  step1.classList.remove('active');
  step2.classList.add('active');
});

step2Done.addEventListener('click', async () => {
  const inputName = petNameInput.value.trim();
  if (inputName) petName = inputName;

  await chrome.runtime.sendMessage({
    type: 'SELECT_PET',
    petId: selectedPetId,
    petName: petName,
  });

  // Close this tab
  window.close();
});
```

- [ ] **Step 3: 在 sw-main.js 中添加入口引导**

在 `sw-main.js` 的 `runtime.onInstalled` 中添加：

```js
// After install, open welcome page
if (details.reason === 'install') {
  chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/welcome.html') });
}
```

- [ ] **Step 4: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add onboarding welcome page with pet selection"
```

---

### Task 11: 扩展图标生成

**Files:**
- Create: `chrome-pet/icons/icon16.png`
- Create: `chrome-pet/icons/icon48.png`
- Create: `chrome-pet/icons/icon128.png`

- [ ] **Step 1: 生成简易图标（Canvas 程序化生成）**

```bash
cd chrome-pet && node -e "
const { createCanvas } = require('canvas'); // fallback: use Python
" 2>/dev/null || python -c "
# Generate simple paw-print icons as PNGs
import struct, zlib, os

def create_png(width, height, pixels):
    \"\"\"Create minimal PNG file with RGBA pixel data\"\"\"
    def make_chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    header = b'\\x89PNG\\r\\n\\x1a\\n'
    ihdr = make_chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))

    # Build raw image data with filter byte
    raw = b''
    for row in pixels:
        raw += b'\\x00' + row  # filter: none

    idat = make_chunk(b'IDAT', zlib.compress(raw))
    iend = make_chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def make_icon(size):
    # Simple paw emoji-like pixel art
    # Purple/dark blue background with a simple shape
    pixels = []
    for y in range(size):
        row = b''
        for x in range(size):
            # Simple circle for icon
            cx, cy = size/2, size/2
            dist = ((x-cx)**2 + (y-cy)**2) ** 0.5
            if dist < size*0.38 and dist > size*0.15:
                # outer ring
                row += struct.pack('BBBB', 255, 200, 50, 255)  # golden
            elif dist < size*0.15:
                # center
                row += struct.pack('BBBB', 26, 58, 92, 255)  # dark blue
            else:
                row += struct.pack('BBBB', 26, 58, 92, 255)  # bg
        pixels.append(row)
    return create_png(size, size, pixels)

for size in [16, 48, 128]:
    png = make_icon(size)
    with open(f'icons/icon{size}.png', 'wb') as f:
        f.write(png)
    print(f'Created icon{size}.png ({len(png)} bytes)')
"
```

> *如果 Python 生成太复杂，替代方案：使用纯色方块 + CSS 风格的简单 SVG 转 PNG，或直接放置占位图标文件并标注"后续替换为正式图标"*

- [ ] **Step 2: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "feat: add extension icons"
```

---

### Task 12: 集成联调与修复

**Files:**
- Modify: `chrome-pet/manifest.json` — 确保所有路径正确
- Modify: `chrome-pet/src/service-worker/sw-main.js` — 完善消息监听
- Modify: `chrome-pet/src/content/content-main.js` — 完善渲染循环

- [ ] **Step 1: 检查 manifest.json 中所有文件路径与实际文件匹配**

逐一核对：
```
src/service-worker/sw-main.js ✓
src/content/content-main.js ✓
src/content/styles/pet.css ✓
src/content/ui/side-panel.html ✓
src/offscreen/offscreen.html ✓
onboarding/welcome.html ✓
```

- [ ] **Step 2: 完善 sw-main.js 中缺失的消息类型**

在 `message-handler.js` 的 `handleMessage` switch 中添加：

```js
case 'OPEN_SIDE_PANEL': {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await chrome.sidePanel.open({ windowId: tab.windowId });
  sendResponse({ success: true });
  break;
}
```

- [ ] **Step 3: 在 content-main.js 中添加状态轮询**

```js
// Poll state every 8 seconds from SW (in addition to offscreen doc pushes)
setInterval(async () => {
  const resp = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
  if (resp.success) {
    updatePetDisplay(resp.data.petState);
  }
}, 8000);
```

- [ ] **Step 4: 修复 sprite-renderer.js — 补齐 6 种动物的全部精灵帧**

为每种动物生成 idle 帧数据。至少每种动物有一个 16x16 像素定义，使用对应的颜色主题。如果手动定义 6 种动物 × 9 个状态帧太多，则先用程序化生成的简单几何形状代替，后续可替换为真正的像素艺术。

```js
// 在 sprite-renderer.js 中添加程序化精灵生成备用逻辑：
function generateFallbackSprite(petType) {
  // 如果某状态帧缺失，用基础几何形状生成
  const size = 16;
  const pixels = Array.from({length: size}, () => Array(size).fill(0));
  const cx = 8, cy = 8;
  const theme = PET_THEMES[petType] || PET_THEMES.cat;

  // 身体：圆形
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.sqrt((x-cx)**2 + (y-cy)**2);
      if (d < 6) pixels[y][x] = 1; // 主色身体
      if (d < 3 && (x > cx-2 && x < cx+2 && y > cy-2 && y < cy+2)) pixels[y][x] = 4; // 眼睛
      if (d < 2 && y > cy && Math.abs(x-cx) < 3) pixels[y][x] = 5; // 嘴
    }
  }
  return pixels;
}
```

- [ ] **Step 5: 加载扩展到 Chrome 并测试**

```
chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选择 chrome-pet 文件夹
```

验证：
1. 安装后弹出 welcome 引导页
2. 选择宠物后悬浮窗出现在网页右下角
3. 宠物可拖动
4. 点击按钮有反应
5. 侧边栏可打开
6. 关闭页面后状态不丢失

- [ ] **Step 6: 提交**

```bash
cd chrome-pet && git add -A && git commit -m "fix: integration fixes, sprite fallback, state polling"
```

---

### Task 13: 最终测试与验证清单

- [ ] **验证项 1: 安装流程**
  - 加载扩展 → welcome 页自动弹出 → 选猫 → 取名 → 完成
  - 刷新任意网页 → 宠物悬浮窗出现在右下角

- [ ] **验证项 2: 拖动**
  - 鼠标按住悬浮窗 → 拖动到任意位置 → 释放 → 停留在新位置
  - 不会拖出视口边界

- [ ] **验证项 3: 养成互动**
  - 点击喂食 → 饥饿度 +15
  - 点击抚摸 → 心情 +5
  - 点击玩耍 → 心情 +10 精力 -8
  - 数值超过 100 触发即死动画

- [ ] **验证项 4: 侧边栏**
  - 点击扩展图标 → 侧边栏打开
  - 显示宠物信息（名称、亲密度等级）
  - 可发送消息（需配置有效 API Key）

- [ ] **验证项 5: 状态持久化**
  - 记录当前数值 → 关闭网页 → 重新打开 → 数值恢复
  - 关闭期间数值未衰减

- [ ] **验证项 6: 宠物切换**
  - 手动修改 storage 中 selectedPet 值 → 刷新 → 宠物更换

- [ ] **提交**

```bash
cd chrome-pet && git add -A && git commit -m "docs: add integration test checklist"
```
