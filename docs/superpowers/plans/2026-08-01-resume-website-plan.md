# Rick and Morty 简历网站 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个 Rick and Morty 风格的单页简历网站，支持中英双语切换、Canvas 粒子背景、控制台 UI 和角色彩蛋。

**Architecture:** 纯静态三文件结构——`index.html`（双语内容 + DOM 结构）、`style.css`（视觉系统 + 动画 + 响应式）、`script.js`（Canvas 粒子 + i18n 切换 + 彩蛋系统 + 滚动效果）。零依赖，直接部署 GitHub Pages。

**Tech Stack:** HTML5, CSS3 (Custom Properties, Animations, Grid, Flexbox, Media Queries), Vanilla JS (Canvas 2D, Intersection Observer, localStorage), Google Fonts (Creepster, Inter, Noto Sans SC)

---

## Global Constraints

- 零外部 JS 依赖，纯 Vanilla
- 不包含 Rick and Morty 官方版权图片，仅用 CSS/SVG 原创元素
- 响应式支持 ≥320px 宽度设备
- 语言偏好持久化到 localStorage
- 所有动画 60fps 目标，粒子总数 ≤80
- 内容严格来自 `resume/LiChengxi_Web3_Master_Resume.md` 和 `resume/LiChengxi_Web3_Master_Resume_CN.md`

---

## 文件结构

```
resume-site/
├── index.html    # 创建 — DOM结构 + 双语data属性 + 内联关键CSS
├── style.css     # 创建 — 全局样式 + 控制台UI + 动画 + 响应式
├── script.js     # 创建 — Canvas粒子 + i18n引擎 + 彩蛋系统 + 滚动效果
└── README.md     # 创建
```

**职责边界：**
- `index.html`：纯标记，不含样式和逻辑。每个文本容器同时携带 `data-en` 和 `data-zh`。
- `style.css`：所有视觉效果，包括控制台UI四角装饰、扫描线、传送门动画关键帧、响应式断点。
- `script.js`：4 个独立模块——Canvas 引擎、i18n 切换器、彩蛋管理器、滚动观察器，通过 `DOMContentLoaded` 统一初始化。

---

### Task 1: 项目脚手架 + HTML 骨架

**Files:**
- Create: `resume-site/index.html`
- Create: `resume-site/README.md`

**Interfaces:**
- Produces: DOM 元素含 `data-en` / `data-zh` 属性供 Task 3 i18n 引擎消费
- Produces: `id="portal-canvas"` 供 Task 4 Canvas 引擎挂载
- Produces: `id="easter-egg-layer"` 供 Task 6 彩蛋系统挂载
- Produces: `id="scroll-progress"` 供 Task 7 滚动效果消费
- Produces: `class="console-card"` 供 Task 2 CSS 控制台样式消费

- [ ] **Step 1: 创建目录 + HTML 骨架**

```bash
mkdir -p resume-site
```

创建 `resume-site/index.html`：

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Li Chengxi — Web3 Resume</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Creepster&family=Inter:wght@300;400;500;600;700;800&family=Noto+Sans+SC:wght@300;400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- Canvas background -->
  <canvas id="portal-canvas"></canvas>

  <!-- Scroll progress bar -->
  <div id="scroll-progress"></div>

  <!-- Language toggle -->
  <nav id="navbar">
    <span class="logo">🧪 LI CHENGXI</span>
    <button id="lang-toggle" aria-label="Switch language">
      <span class="lang-label">EN</span>
      <span class="portal-icon"></span>
      <span class="lang-label">中文</span>
    </button>
  </nav>

  <!-- Portal overlay for transition animation -->
  <div id="portal-overlay"></div>

  <!-- Easter egg layer -->
  <div id="easter-egg-layer"></div>

  <main id="content">
    <!-- Sections will be populated here -->
  </main>

  <script src="script.js"></script>
</body>
</html>
```

- [ ] **Step 2: 填充 Hero 区域 (Section 1)**

在 `<main id="content">` 内添加：

```html
<section id="hero" class="console-card">
  <div class="card-corners"></div>
  <h1 class="hero-name" data-en="LI CHENGXI" data-zh="李成蹊">LI CHENGXI</h1>
  <p class="hero-title" data-en="Web3 Ecosystem Growth · AI-Native Operator · Bilingual BD & Support"
     data-zh="Web3 生态增长 · AI-Native 操盘手 · 中英双语 BD & 客服">
     Web3 Ecosystem Growth · AI-Native Operator · Bilingual BD & Support
  </p>
  <div class="hero-contact">
    <span data-en="📍 Chongqing, China (Global Remote)" data-zh="📍 中国重庆（全球远程）">📍 Chongqing, China (Global Remote)</span>
    <span>📧 lcx040210@gmail.com</span>
    <span>📱 +86 191-3205-1589</span>
    <span>𝕏 <a href="https://x.com/LiCheng43225380" target="_blank">@LiCheng43225380</a></span>
    <span>PTE Academic 84 (C1/C2)</span>
  </div>
  <div class="hero-summary" data-en="..." data-zh="...">
    <!-- Full summary text from resume MD -->
  </div>
</section>
```

- [ ] **Step 3: 填充核心能力 (Section 2)**

```html
<section id="skills" class="console-card">
  <div class="card-corners"></div>
  <h2 class="section-title scan-line" data-en="🧬 Genetic Scan — Core Competencies" data-zh="🧬 基因扫描 — 核心能力">🧬 Genetic Scan — Core Competencies</h2>
  <div class="skills-grid">
    <div class="skill-panel" data-en-title="Languages" data-zh-title="语言 & 沟通">
      <h3 data-en="🌐 Languages" data-zh="🌐 语言 & 沟通">🌐 Languages</h3>
      <ul data-en="CN/EN Bilingual|Cross-Cultural|Technical Localization|300+ hrs Teaching"
          data-zh="中英双语|跨文化协作|技术本地化|300+ 小时教学">
      </ul>
    </div>
    <!-- Repeat for Web3, BD, AI, Analysis panels -->
  </div>
</section>
```

- [ ] **Step 4: 填充 Web3 经历 (Section 3)**

每个经历卡片结构：

```html
<section id="web3-experience">
  <h2 class="section-title scan-line" data-en="🧪 Lab Log — Web3 Experience" data-zh="🧪 实验日志 — Web3 经历">🧪 Lab Log — Web3 Experience</h2>

  <div class="timeline">
    <div class="timeline-item console-card" id="exp-kcex">
      <div class="card-corners"></div>
      <div class="exp-header">
        <h3 data-en="KCEX Exchange — Customer Support Specialist" data-zh="KCEX 交易所 — 客服专员">KCEX Exchange — Customer Support Specialist</h3>
        <span class="exp-date" data-en="Jul 2026 – Present · Remote" data-zh="2026.07 – 至今 · 远程">Jul 2026 – Present · Remote</span>
      </div>
      <ul class="exp-bullets" data-en="..." data-zh="..."></ul>
    </div>
    <!-- Repeat for BitTap, Contract Trading, Community, Research, Testnet, AI -->
  </div>
</section>
```

- [ ] **Step 5: 填充工作经历、教育、页脚 (Sections 4-6)**

```html
<section id="professional-experience">
  <h2 class="section-title scan-line" data-en="📋 Cross-Dimensional Experience" data-zh="📋 跨维度经验">📋 Cross-Dimensional Experience</h2>
  <!-- 4 compact cards: Jingyu, Seller, Teacher, AI Annotation -->
</section>

<section id="education-languages" class="two-col">
  <div class="console-card">
    <h2 class="section-title" data-en="🎓 Lab Credentials" data-zh="🎓 实验室证书">🎓 Lab Credentials</h2>
    <!-- Education + Languages + Tools -->
  </div>
</section>

<footer>
  <p id="rick-quote" data-en="Wubba lubba dub dub! — Rick Sanchez" data-zh="Wubba lubba dub dub! — Rick Sanchez">Wubba lubba dub dub! — Rick Sanchez</p>
  <p>© 2026 Li Chengxi · Built with Claude Code</p>
</footer>
```

- [ ] **Step 6: 验证 HTML 结构**

用浏览器打开 `index.html`，确认所有元素存在、无 console 错误、语义标签正确。

- [ ] **Step 7: 创建 README.md**

```markdown
# Li Chengxi — Web3 Resume Site

Rick and Morty themed personal resume. Static HTML/CSS/JS, zero dependencies.

## Dev

Open `index.html` in browser. No build step.

## Deploy

Push to GitHub, enable Pages from `/resume-site` or `/ (root)`.
```

- [ ] **Step 8: Commit**

```bash
git add resume-site/index.html resume-site/README.md
git commit -m "feat: add resume site HTML skeleton with bilingual structure

- Single-page layout: Hero, Skills, Web3 Exp, Work Exp, Education, Footer
- All text containers use data-en/data-zh attributes for i18n
- Canvas element, portal overlay, easter egg layer scaffolds in place
- Creepster + Inter + Noto Sans SC fonts linked"
```

---

### Task 2: CSS 视觉系统

**Files:**
- Create: `resume-site/style.css`

**Interfaces:**
- Consumes: `.console-card`, `.scan-line`, `.card-corners`, `#portal-overlay`, `#scroll-progress`, `#lang-toggle`, `.skills-grid`, `.timeline` from Task 1 HTML
- Produces: CSS custom properties (`--portal-green`, `--space-black`, `--lab-gray`, 等) 供全局使用
- Produces: `@keyframes portalExpand`, `fadeInUp`, `scanlinePulse`, `floatUp` 供 Task 6/7 JS 触发

- [ ] **Step 1: CSS 变量 + 全局重置**

```css
:root {
  --portal-green: #97ce4c;
  --portal-green-glow: rgba(151, 206, 76, 0.4);
  --portal-blue: #00b5cc;
  --morty-yellow: #f5e642;
  --space-black: #0a0e17;
  --lab-gray: #1a1f2e;
  --lab-gray-light: #222840;
  --text-white: #e8e8e8;
  --text-dim: #94a3b8;
  --text-muted: #64748b;
  --font-display: 'Creepster', cursive;
  --font-body: 'Inter', 'Noto Sans SC', -apple-system, sans-serif;
}

*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  font-family: var(--font-body);
  background: var(--space-black);
  color: var(--text-white);
  line-height: 1.6;
  overflow-x: hidden;
}

#portal-canvas {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  z-index: 0; pointer-events: none;
}
```

- [ ] **Step 2: 控制台卡片系统**

```css
.console-card {
  background: var(--lab-gray);
  border: 1px solid rgba(151, 206, 76, 0.25);
  border-radius: 4px;
  padding: 28px 32px;
  position: relative;
  transition: border-color 0.3s ease, box-shadow 0.3s ease;
  z-index: 1;
}

.console-card:hover {
  border-color: rgba(151, 206, 76, 0.7);
  box-shadow: 0 0 20px rgba(151, 206, 76, 0.08), inset 0 0 20px rgba(151, 206, 76, 0.02);
}

/* Four-corner decorations */
.card-corners::before,
.card-corners::after {
  position: absolute; color: rgba(151, 206, 76, 0.5);
  font-family: monospace; font-size: 0.75rem;
  pointer-events: none;
}
.card-corners::before { content: '┌┐'; top: 6px; left: 10px; letter-spacing: calc(100% - 24px); }
.card-corners::after  { content: '└┘'; bottom: 6px; left: 10px; letter-spacing: calc(100% - 24px); }

/* Scan line effect on section titles */
.scan-line {
  font-family: var(--font-display);
  font-size: 1.5rem;
  color: var(--portal-green);
  letter-spacing: 0.04em;
  position: relative;
}
.scan-line::after {
  content: '';
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  background: repeating-linear-gradient(
    0deg, transparent, transparent 2px,
    rgba(151, 206, 76, 0.03) 2px, rgba(151, 206, 76, 0.03) 4px
  );
  pointer-events: none;
  animation: scanlinePulse 3s linear infinite;
}
@keyframes scanlinePulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.7; }
}
```

- [ ] **Step 3: 导航栏 + 语言切换按钮**

```css
#navbar {
  position: fixed; top: 0; left: 0; right: 0;
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 32px;
  background: rgba(10, 14, 23, 0.92);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(151, 206, 76, 0.2);
  z-index: 100;
}
.logo { font-family: var(--font-display); font-size: 1.1rem; color: var(--portal-green); }

#lang-toggle {
  display: flex; align-items: center; gap: 8px;
  background: var(--lab-gray);
  border: 1px solid rgba(151, 206, 76, 0.3);
  border-radius: 20px; padding: 6px 16px;
  color: var(--text-white); cursor: pointer;
  font-family: var(--font-body); font-size: 0.8rem;
  transition: border-color 0.3s, box-shadow 0.3s;
}
#lang-toggle:hover {
  border-color: var(--portal-green);
  box-shadow: 0 0 12px var(--portal-green-glow);
}
```

- [ ] **Step 4: Hero 区域样式**

```css
#hero {
  max-width: 800px; margin: 100px auto 40px;
  text-align: center;
}
.hero-name {
  font-family: var(--font-display);
  font-size: 3rem;
  color: var(--portal-green);
  text-shadow: 0 0 30px var(--portal-green-glow);
  letter-spacing: 0.04em;
}
.hero-title {
  font-size: 0.95rem; color: var(--text-dim); margin-top: 8px;
}
.hero-contact {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 12px;
  margin-top: 16px; font-size: 0.8rem; color: var(--text-dim);
}
.hero-contact a { color: var(--portal-blue); text-decoration: none; }
.hero-summary {
  margin-top: 20px; font-size: 0.85rem; color: var(--text-dim);
  text-align: left; line-height: 1.8;
}
```

- [ ] **Step 5: 技能仪表盘 + 时间线**

```css
.skills-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px;
  margin-top: 20px;
}
.skill-panel {
  background: rgba(26, 31, 46, 0.8);
  border: 1px solid rgba(151, 206, 76, 0.2);
  border-radius: 4px; padding: 16px;
  transition: border-color 0.3s;
}
.skill-panel:hover { border-color: var(--portal-green); }
.skill-panel h3 { font-size: 0.8rem; color: var(--portal-green); margin-bottom: 10px; }
.skill-panel li { font-size: 0.72rem; color: var(--text-dim); padding: 3px 0; list-style: none; }
.skill-panel li::before { content: '▸ '; color: var(--portal-green); }

.timeline { position: relative; padding-left: 0; }
.timeline-item { margin-bottom: 20px; }
.exp-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
.exp-header h3 { font-size: 0.95rem; color: var(--portal-green); }
.exp-date { font-size: 0.72rem; color: var(--text-muted); }
.exp-bullets { list-style: none; padding: 0; }
.exp-bullets li {
  font-size: 0.78rem; color: var(--text-dim); padding: 4px 0 4px 16px;
  position: relative; line-height: 1.6;
}
.exp-bullets li::before { content: '▸'; position: absolute; left: 0; color: var(--portal-green); font-size: 0.6rem; top: 6px; }
```

- [ ] **Step 6: 传送门覆盖动画**

```css
#portal-overlay {
  position: fixed; top: 0; left: 0; width: 100%; height: 100%;
  background: radial-gradient(circle, var(--portal-green) 0%, transparent 70%);
  opacity: 0; pointer-events: none; z-index: 200;
  transition: opacity 0.15s ease;
  clip-path: circle(0% at 50% 50%);
}
#portal-overlay.active {
  clip-path: circle(150% at 50% 50%);
  opacity: 0.6;
  transition: clip-path 0.4s ease-in, opacity 0.3s ease;
}
```

- [ ] **Step 7: 滚动进度条**

```css
#scroll-progress {
  position: fixed; left: 0; top: 0; width: 3px; height: 0%;
  background: var(--portal-green);
  box-shadow: 0 0 8px var(--portal-green-glow);
  z-index: 150;
  transition: height 0.1s linear;
}
```

- [ ] **Step 8: 动画关键帧**

```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-in {
  animation: fadeInUp 0.5s ease forwards;
}

@keyframes floatUp {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  100% { opacity: 0; transform: translateY(-60px) scale(0.8); }
}

@keyframes portalSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
```

- [ ] **Step 9: 响应式**

```css
@media (max-width: 1199px) {
  .skills-grid { grid-template-columns: repeat(3, 1fr); }
  #hero { margin-top: 80px; padding: 0 20px; }
  .hero-name { font-size: 2.2rem; }
}

@media (max-width: 767px) {
  .skills-grid { grid-template-columns: 1fr; }
  #navbar { padding: 10px 16px; }
  .logo { font-size: 0.9rem; }
  .hero-name { font-size: 1.8rem; }
  .console-card { padding: 20px 16px; }
  .exp-header { flex-direction: column; gap: 4px; }
  #content { padding: 0 12px; }
  .two-col { grid-template-columns: 1fr; }
}
```

- [ ] **Step 10: 页脚**

```css
footer {
  text-align: center; padding: 40px 20px;
  border-top: 1px solid rgba(151, 206, 76, 0.15);
  margin-top: 40px;
}
#rick-quote {
  font-family: var(--font-display); font-size: 1.2rem;
  color: var(--portal-green); opacity: 0.7;
}
```

- [ ] **Step 11: 验证 CSS**

浏览器打开 `index.html`，确认所有样式正常渲染，控制台无 CSS 警告。使用 DevTools 切换移动/平板/桌面视图确认响应式断点生效。

- [ ] **Step 12: Commit**

```bash
git add resume-site/style.css
git commit -m "feat: add Rick & Morty visual system CSS

- CSS custom properties for portal-green, space-black, lab-gray palette
- Console card with four-corner decorations and hover glow
- Scanline animation on section titles
- Fixed navbar with backdrop blur
- Hero section with green text shadow glow
- 5-column skills dashboard grid, timeline cards
- Portal overlay clip-path transition for language switch
- Scroll progress bar, fadeInUp/fadeOut animations
- Responsive breakpoints: desktop 1200+, tablet 768-1199, mobile <768"
```

---

### Task 3: i18n 语言切换引擎

**Files:**
- Create: `resume-site/script.js`

**Interfaces:**
- Consumes: DOM elements with `data-en` / `data-zh` attributes from Task 1 HTML
- Consumes: `#lang-toggle` button from Task 1
- Consumes: `#portal-overlay` element + `.active` class from Task 2 CSS
- Produces: `I18nEngine` object — `init()`, `toggle()`, `getLang()` methods

- [ ] **Step 1: 创建 script.js + i18n 核心逻辑**

创建 `resume-site/script.js`：

```javascript
// ========== I18N ENGINE ==========
const I18nEngine = {
  currentLang: localStorage.getItem('resume-lang') || 'en',

  init() {
    this.applyLang(this.currentLang);
    this.updateToggleButton();
    document.getElementById('lang-toggle').addEventListener('click', () => this.toggle());
  },

  toggle() {
    const overlay = document.getElementById('portal-overlay');
    // Phase 1: expand portal
    overlay.classList.add('active');

    setTimeout(() => {
      // Phase 2: swap all text
      this.currentLang = this.currentLang === 'en' ? 'zh' : 'en';
      localStorage.setItem('resume-lang', this.currentLang);
      this.applyLang(this.currentLang);
      this.updateToggleButton();

      // Phase 3: collapse portal
      setTimeout(() => {
        overlay.classList.remove('active');
      }, 150);
    }, 300);
  },

  applyLang(lang) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-en][data-zh]').forEach(el => {
      el.textContent = el.getAttribute(`data-${lang}`);
    });

    // Handle structured content (lists with pipe-delimited items)
    document.querySelectorAll(`[data-${lang}]`).forEach(el => {
      const data = el.getAttribute(`data-${lang}`);
      if (data && el.tagName === 'UL') {
        el.innerHTML = data.split('|').map(item => `<li>${item.trim()}</li>`).join('');
      }
    });

    // Handle bullet lists on experience cards
    document.querySelectorAll('.exp-bullets').forEach(ul => {
      const data = ul.getAttribute(`data-${lang}`);
      if (data) {
        ul.innerHTML = data.split('|').map(item => `<li>${item.trim()}</li>`).join('');
      }
    });
  },

  updateToggleButton() {
    const btn = document.getElementById('lang-toggle');
    const enLabel = btn.querySelector('.lang-label:first-child');
    const zhLabel = btn.querySelector('.lang-label:last-child');
    if (this.currentLang === 'en') {
      enLabel.style.fontWeight = '700';
      enLabel.style.color = 'var(--portal-green)';
      zhLabel.style.fontWeight = '400';
      zhLabel.style.color = 'var(--text-dim)';
    } else {
      zhLabel.style.fontWeight = '700';
      zhLabel.style.color = 'var(--portal-green)';
      enLabel.style.fontWeight = '400';
      enLabel.style.color = 'var(--text-dim)';
    }
  },

  getLang() { return this.currentLang; }
};
```

- [ ] **Step 2: 验证 i18n 切换**

浏览器打开 `index.html`，点击语言切换按钮。确认：
- 传送门绿色漩涡动画播放（300ms 展开 → 文本替换 → 150ms 收回）
- 所有文本正确切换为中文
- 再次点击切回英文
- 刷新页面后语言偏好保持（localStorage）

- [ ] **Step 3: Commit**

```bash
git add resume-site/script.js
git commit -m "feat: add i18n engine with portal transition animation

- data-en/data-zh attribute-based text swapping
- Portal overlay clip-path expand/collapse during language switch
- localStorage persistence for language preference
- Pipe-delimited list rendering for structured content"
```

---

### Task 4: Canvas 粒子背景

**Files:**
- Modify: `resume-site/script.js` — 追加 Canvas 模块

**Interfaces:**
- Consumes: `<canvas id="portal-canvas">` from Task 1 HTML
- Produces: `PortalCanvas` object — `init()`, `resize()`, `destroy()` methods
- Internal: `Particle` class, `PortalVortex` class, `PixelCharacter` class

- [ ] **Step 1: Canvas 初始化 + 粒子类**

在 `script.js` 末尾追加：

```javascript
// ========== CANVAS PARTICLE BACKGROUND ==========
const PortalCanvas = {
  canvas: null, ctx: null,
  particles: [], vortices: [], characters: [],
  animFrame: null,
  width: 0, height: 0,

  init() {
    this.canvas = document.getElementById('portal-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Create particles (80% of 60 = 48 floating particles)
    for (let i = 0; i < 48; i++) {
      this.particles.push(new FloatingParticle(this.width, this.height));
    }
    // Create vortex particles (15% = 9)
    for (let i = 0; i < 9; i++) {
      this.vortices.push(new PortalVortexParticle(this.width, this.height));
    }
    // Create pixel characters (5% = 3)
    this.characters.push(new PixelCharacter(this.width, this.height, 'rick'));
    this.characters.push(new PixelCharacter(this.width, this.height, 'morty'));
    this.characters.push(new PixelCharacter(this.width, this.height, 'rick'));

    this.animate();
  },

  resize() {
    this.width = this.canvas.width = window.innerWidth;
    this.height = this.canvas.height = window.innerHeight;
    // Update particle bounds
    this.particles.forEach(p => p.updateBounds(this.width, this.height));
  },

  animate() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.particles.forEach(p => { p.update(); p.draw(this.ctx); });
    this.vortices.forEach(v => { v.update(); v.draw(this.ctx); });
    this.characters.forEach(c => { c.update(); c.draw(this.ctx); });

    this.animFrame = requestAnimationFrame(() => this.animate());
  }
};
```

- [ ] **Step 2: 浮动粒子类**

```javascript
class FloatingParticle {
  constructor(w, h) {
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.size = Math.random() * 2.5 + 1;
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.speedY = (Math.random() - 0.5) * 0.3 - 0.2; // slight upward drift
    this.opacity = Math.random() * 0.5 + 0.2;
    this.width = w; this.height = h;
  }

  updateBounds(w, h) { this.width = w; this.height = h; }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    // Wrap around edges
    if (this.x < -5) this.x = this.width + 5;
    if (this.x > this.width + 5) this.x = -5;
    if (this.y < -5) this.y = this.height + 5;
    if (this.y > this.height + 5) this.y = -5;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(151, 206, 76, ${this.opacity})`;
    ctx.fill();
    // Small glow
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(151, 206, 76, ${this.opacity * 0.15})`;
    ctx.fill();
  }
}
```

- [ ] **Step 3: 传送门漩涡粒子类**

```javascript
class PortalVortexParticle {
  constructor(w, h) {
    this.reset(w, h);
  }

  reset(w, h) {
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.radius = 0;
    this.maxRadius = Math.random() * 40 + 20;
    this.growing = true;
    this.life = 0;
    this.maxLife = Math.random() * 180 + 120; // 3-5 seconds at 60fps
    this.width = w; this.height = h;
  }

  updateBounds(w, h) { this.width = w; this.height = h; }

  update() {
    this.life++;
    if (this.growing) {
      this.radius += 0.4;
      if (this.radius >= this.maxRadius) this.growing = false;
    } else {
      this.radius -= 0.3;
    }
    if (this.life >= this.maxLife) this.reset(this.width, this.height);
  }

  draw(ctx) {
    const alpha = 1 - (this.life / this.maxLife);
    // Outer ring
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(0, 181, 204, ${alpha * 0.6})`;
    ctx.lineWidth = 2;
    ctx.stroke();
    // Inner glow
    const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
    gradient.addColorStop(0, `rgba(151, 206, 76, ${alpha * 0.4})`);
    gradient.addColorStop(1, `rgba(151, 206, 76, 0)`);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}
```

- [ ] **Step 4: 像素小人角色类**

```javascript
class PixelCharacter {
  constructor(w, h, type) {
    this.type = type; // 'rick' or 'morty'
    this.size = type === 'rick' ? 8 : 6;
    this.x = Math.random() * w;
    this.y = h - 40 - Math.random() * 200;
    this.speed = type === 'rick' ? 0.5 : 1.2;
    this.direction = Math.random() > 0.5 ? 1 : -1;
    this.walkFrame = 0;
    this.active = Math.random() > 0.7; // 30% chance to be visible at start
    this.cooldown = Math.floor(Math.random() * 300);
    this.width = w; this.height = h;
    // Simple pixel art: Rick = green spikes, Morty = yellow shirt
    this.color = type === 'rick' ? '#97ce4c' : '#f5e642';
    this.secondary = type === 'rick' ? '#00b5cc' : '#e8a850';
  }

  updateBounds(w, h) { this.width = w; this.height = h; }

  update() {
    if (!this.active) {
      this.cooldown--;
      if (this.cooldown <= 0) {
        this.active = true;
        this.x = this.direction > 0 ? -20 : this.width + 20;
        this.y = this.height - 40 - Math.random() * 100;
        this.cooldown = Math.floor(Math.random() * 600 + 300);
      }
      return;
    }
    this.x += this.speed * this.direction;
    this.walkFrame = (this.walkFrame + 0.1) % 2;
    // Walk off screen
    if (this.x > this.width + 30 || this.x < -30) {
      this.active = false;
      this.direction *= -1;
    }
  }

  draw(ctx) {
    if (!this.active) return;
    const s = this.size;
    const x = Math.floor(this.x);
    const y = Math.floor(this.y + (this.walkFrame > 1 ? 1 : 0));
    // Body
    ctx.fillStyle = this.color;
    ctx.fillRect(x, y + s, s * 2, s * 2);
    // Head
    ctx.fillStyle = this.secondary;
    ctx.fillRect(x + s/2, y, s, s);
    // Legs (alternating walk)
    ctx.fillStyle = '#555';
    ctx.fillRect(x, y + s * 3, s, s);
    ctx.fillRect(x + s, y + s * 3, s, s);
  }
}
```

- [ ] **Step 5: 移动端粒子减少**

在 `PortalCanvas.init()` 中根据屏幕宽度调整粒子数量。修改 init 中的循环：

```javascript
const isMobile = window.innerWidth < 768;
const particleCount = isMobile ? 18 : 48;
const vortexCount = isMobile ? 3 : 9;
const charCount = isMobile ? 0 : 3;
```

- [ ] **Step 6: 验证 Canvas**

浏览器打开 `index.html`，确认：
- 绿色粒子缓慢上浮，从边缘循环
- 偶尔出现蓝色传送门漩涡（3-5 秒生命周期）
- 偶尔有 Rick/Morty 像素小人在边缘走动
- 无性能问题（DevTools Performance 面板确认 60fps）
- 移动端（<768px）粒子数量减少

- [ ] **Step 7: Commit**

```bash
git add resume-site/script.js
git commit -m "feat: add Canvas portal particle background

- FloatingParticle: 48 green particles with slow upward drift and glow
- PortalVortexParticle: 9 blue-green vortex rings with lifecycle fade
- PixelCharacter: 3 Rick/Morty pixel sprites walking across edges
- Mobile optimization: reduced particle count below 768px
- 60fps target with requestAnimationFrame loop"
```

---

### Task 5: 彩蛋系统

**Files:**
- Modify: `resume-site/script.js` — 追加彩蛋模块

**Interfaces:**
- Consumes: `#easter-egg-layer` from Task 1 HTML
- Consumes: `#hero` element from Task 1 (portal gun cursor zone)
- Produces: `EasterEggs` object — `init()` method

- [ ] **Step 1: Rick 吐槽气泡**

在 `script.js` 末尾追加：

```javascript
// ========== EASTER EGG SYSTEM ==========
const EasterEggs = {
  quotes: {
    en: [
      "This resume is *burp* the best in the multiverse, Morty!",
      "You gotta pump those numbers up, those are rookie numbers!",
      "Wubba lubba dub dub! Hire this guy!",
      "I turned myself into a resume, Morty! I'm Resume Rick!",
      "In an infinite multiverse, this is the best hire you'll make.",
      "Don't think about it, just hire him, Morty!"
    ],
    zh: [
      "这份简历是*嗝*多元宇宙里最棒的，Morty！",
      "你得把那些数字搞上去，这都是菜鸟水平！",
      "Wubba lubba dub dub！快雇这个人！",
      "我把自己变成了一份简历，Morty！我是简历 Rick！",
      "在无限多元宇宙里，这是你能做出的最好招聘。",
      "别想了，就雇他吧，Morty！"
    ]
  },
  bubbleTimer: null,

  init() {
    this.scheduleBubble();
    this.initPortalGunCursor();
    this.initTitleGlitch();
  },

  scheduleBubble() {
    const delay = Math.random() * 15000 + 15000; // 15-30 seconds
    this.bubbleTimer = setTimeout(() => {
      this.showBubble();
      this.scheduleBubble();
    }, delay);
  },

  showBubble() {
    const lang = I18nEngine.getLang();
    const quotes = this.quotes[lang] || this.quotes.en;
    const quote = quotes[Math.floor(Math.random() * quotes.length)];

    const bubble = document.createElement('div');
    bubble.className = 'rick-bubble';
    bubble.innerHTML = `
      <div class="bubble-avatar">🧪</div>
      <div class="bubble-text">${quote}</div>
    `;
    document.getElementById('easter-egg-layer').appendChild(bubble);

    // Float up and fade out
    setTimeout(() => {
      bubble.style.animation = 'floatUp 1.5s ease forwards';
      setTimeout(() => bubble.remove(), 1500);
    }, 5000);
  },

  // Portal gun cursor in hero area
  initPortalGunCursor() {
    const hero = document.getElementById('hero');
    const portalCursorSVG = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="6" fill="none" stroke="#97ce4c" stroke-width="2"/>' +
      '<circle cx="12" cy="12" r="2" fill="#97ce4c"/>' +
      '<line x1="12" y1="6" x2="12" y2="2" stroke="#97ce4c" stroke-width="1.5"/>' +
      '<line x1="18" y1="12" x2="22" y2="12" stroke="#97ce4c" stroke-width="1.5"/>' +
      '</svg>'
    )}`;

    hero.addEventListener('mouseenter', () => {
      hero.style.cursor = `url('${portalCursorSVG}') 12 12, auto`;
    });
    hero.addEventListener('mouseleave', () => {
      hero.style.cursor = 'default';
    });
  },

  // Random title character glitch (Rick's influence)
  initTitleGlitch() {
    setInterval(() => {
      if (Math.random() > 0.85) { // 15% chance every 3 seconds
        const name = document.querySelector('.hero-name');
        const original = name.textContent;
        const glitchText = original.split('').map(c =>
          Math.random() > 0.9 ? String.fromCharCode(33 + Math.random() * 90) : c
        ).join('');
        name.textContent = glitchText;
        setTimeout(() => { name.textContent = I18nEngine.getLang() === 'zh' ?
          name.getAttribute('data-zh') : name.getAttribute('data-en'); }, 150);
      }
    }, 3000);
  }
};
```

- [ ] **Step 2: CSS 气泡样式**

在 `style.css` 末尾追加：

```css
/* Rick bubble */
.rick-bubble {
  position: fixed; bottom: 80px; right: 20px; z-index: 180;
  display: flex; align-items: flex-start; gap: 10px;
  max-width: 320px; padding: 14px 18px;
  background: var(--lab-gray);
  border: 1px solid var(--portal-green);
  border-radius: 12px;
  box-shadow: 0 0 20px rgba(151, 206, 76, 0.15);
  animation: fadeInUp 0.4s ease;
}
.bubble-avatar { font-size: 1.5rem; }
.bubble-text { font-size: 0.8rem; color: var(--text-dim); line-height: 1.5; font-style: italic; }
```

- [ ] **Step 3: 验证彩蛋**

浏览器打开 `index.html`，确认：
- 15-30 秒后右下角出现 Rick 吐槽气泡，5 秒后上浮消失
- Hero 区域鼠标变为传送门光标
- 每 3 秒有 15% 概率名字短暂乱码（glitch 效果）

- [ ] **Step 4: Commit**

```bash
git add resume-site/script.js resume-site/style.css
git commit -m "feat: add Rick & Morty easter egg system

- Random Rick quote bubbles (15-30s interval, auto-dismiss with floatUp)
- Portal gun custom cursor in hero section (SVG data-URI)
- Title glitch effect (15% chance every 3s, reverts after 150ms)
- Bilingual quotes (EN/CN) matching current language"
```

---

### Task 6: 滚动效果 + DOMContentLoaded 入口

**Files:**
- Modify: `resume-site/script.js` — 追加滚动模块 + 统一初始化

**Interfaces:**
- Consumes: `#scroll-progress` from Task 1
- Consumes: `.console-card` elements from Task 1
- Consumes: `I18nEngine`, `PortalCanvas`, `EasterEggs` from Tasks 3-5
- Produces: `ScrollEffects` object — `init()` method

- [ ] **Step 1: 滚动进度条 + 卡片淡入**

```javascript
// ========== SCROLL EFFECTS ==========
const ScrollEffects = {
  init() {
    this.initProgressBar();
    this.initFadeInObserver();
  },

  initProgressBar() {
    const bar = document.getElementById('scroll-progress');
    window.addEventListener('scroll', () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      bar.style.height = `${Math.min(progress, 100)}%`;
    }, { passive: true });
  },

  initFadeInObserver() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.console-card').forEach(card => {
      observer.observe(card);
    });
  }
};
```

- [ ] **Step 2: DOMContentLoaded 统一入口**

在 `script.js` 末尾追加：

```javascript
// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  I18nEngine.init();
  PortalCanvas.init();
  EasterEggs.init();
  ScrollEffects.init();
  console.log('🧪 Resume site initialized — Wubba lubba dub dub!');
});
```

- [ ] **Step 3: 验证滚动效果**

浏览器打开 `index.html`，确认：
- 左侧绿色进度线随滚动增长
- 卡片进入视口时 fadeInUp 动画触发
- 控制台输出初始化日志

- [ ] **Step 4: Commit**

```bash
git add resume-site/script.js
git commit -m "feat: add scroll effects and unified init

- Scroll progress bar (left edge, portal green, shadow glow)
- IntersectionObserver fadeInUp for console cards
- DOMContentLoaded unified init: I18n → Canvas → EasterEggs → Scroll"
```

---

### Task 7: 部署到 GitHub Pages

**Files:**
- Modify: (none — GitHub Pages 配置在仓库设置中，或在根目录创建 `index.html` 重定向)

- [ ] **Step 1: 在根目录创建重定向**

如果 GitHub Pages 指向根目录，在 `C:\Users\04\Desktop` 创建：

```html
<!-- index.html at repo root -->
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="refresh" content="0;url=resume-site/">
</head>
<body>
  <p>Redirecting to <a href="resume-site/">resume</a>...</p>
</body>
</html>
```

- [ ] **Step 2: 配置 GitHub Pages**

```bash
# 在 GitHub 仓库: Settings → Pages → Source: "Deploy from a branch"
# Branch: main, Folder: /resume-site (或 / (root) 如果使用重定向)
```

- [ ] **Step 3: 推送所有代码**

```bash
git add resume-site/ docs/superpowers/specs/2026-08-01-resume-website-design.md docs/superpowers/plans/2026-08-01-resume-website-plan.md
git commit -m "feat: complete Rick & Morty resume site

- Single-page resume with bilingual EN/CN support
- Canvas portal particle background with vortex and pixel characters
- Console card UI with corner decorations and scanline effects
- Rick & Morty easter eggs: quote bubbles, portal gun cursor, title glitch
- Scroll progress bar and fade-in animations
- Responsive: desktop/tablet/mobile breakpoints

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin feat/volume-engine
```

- [ ] **Step 4: 验证线上版本**

推送后等待 GitHub Pages 部署（约 1-2 分钟），访问 `https://<username>.github.io/<repo>/resume-site/` 或自定义域名，确认所有功能正常。

- [ ] **Step 5: Commit (deploy config)**

```bash
git add index.html  # if root redirect added
git commit -m "chore: add root redirect for GitHub Pages deployment"
```

---

## 最终文件清单

```
resume-site/
├── index.html    # 完整双语 DOM，Creepster + Inter + Noto Sans SC 字体
├── style.css     # CSS 变量、控制台UI、动画关键帧、响应式、传送门覆盖、气泡
├── script.js     # I18nEngine + PortalCanvas + EasterEggs + ScrollEffects + DOMContentLoaded init
└── README.md     # 项目说明
```

**总计：4 文件 | ~800 行代码 | 零外部依赖**
