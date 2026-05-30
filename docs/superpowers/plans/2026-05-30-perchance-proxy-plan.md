# Perchance Proxy Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-cost Cloudflare Worker that proxies Perchance.org's AI image generator, accessible from mainland China.

**Architecture:** Single CF Worker file (`worker.js`) serves both the static HTML frontend (input form, result display, IndexedDB history) and a `/api/generate` POST endpoint that forwards requests to Perchance's internal API, converting returned image URLs to Base64.

**Tech Stack:** Cloudflare Workers (free tier), vanilla HTML/CSS/JS (no framework), IndexedDB (browser storage), Wrangler CLI for deploy.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `perchance-proxy/package.json`
- Create: `perchance-proxy/wrangler.toml`
- Create: `perchance-proxy/worker.js` (skeleton)

- [ ] **Step 1: Create project directory**

```bash
mkdir -p perchance-proxy
cd perchance-proxy
```

- [ ] **Step 2: Write package.json**

Create `perchance-proxy/package.json`:
```json
{
  "name": "perchance-proxy",
  "version": "1.0.0",
  "private": true,
  "description": "Proxy wrapper for Perchance AI image generator via Cloudflare Workers",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
```

- [ ] **Step 3: Write wrangler.toml**

Create `perchance-proxy/wrangler.toml`:
```toml
name = "perchance-proxy"
main = "worker.js"
compatibility_date = "2025-06-01"

[observability]
enabled = true
```

- [ ] **Step 4: Write Worker skeleton**

Create `perchance-proxy/worker.js`:
```js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return new Response(JSON.stringify({ success: false, images: [], error: "Not implemented" }), {
        status: 501,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return new Response("<!DOCTYPE html><html><body><h1>Perchance Proxy</h1></body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

- [ ] **Step 5: Install dependencies and smoke test**

```bash
npm install
npx wrangler dev
```

Open http://localhost:8787 — should show "Perchance Proxy" heading.
POST to http://localhost:8787/api/generate — should return 501 JSON.

- [ ] **Step 6: Commit**

```bash
git add perchance-proxy/
git commit -m "feat: scaffold Perchance proxy Worker project"
```

---

### Task 2: Reverse Engineer Perchance API

> This is a manual investigation task. No code to write — we need to find the actual API endpoint.

- [ ] **Step 1: Open Perchance generator in browser**

Open https://perchance.org/ai-text-to-image-generator in Chrome/Edge.
Open DevTools (F12) → Network tab. Check "Preserve log".

- [ ] **Step 2: Trigger an image generation**

Type a simple prompt (e.g., "a red apple") and click Generate.

- [ ] **Step 3: Identify the generation request**

In Network tab, filter by "Fetch/XHR". Look for the request that triggers image generation.

Common patterns to look for:
- A POST to `/api/...` or plugin-specific path
- A request that returns image URLs or base64 data
- A request that takes 5-30 seconds to complete

- [ ] **Step 4: Copy the request details**

Right-click the request → Copy → Copy as fetch (or Copy as cURL).

Document these fields:
- **Full URL** (e.g., `https://perchance.org/api/text-to-image-plugin/generate`)
- **Request method** (likely POST)
- **Request headers** (especially Content-Type, any auth tokens, cookies)
- **Request body** (what parameters are sent — prompt, resolution, seed, etc.)
- **Response body** (what comes back — JSON with image URLs? direct image data?)

- [ ] **Step 5: Test the endpoint directly**

Copy as cURL, paste into terminal. Verify it works from outside the browser.
If it needs cookies/session, note that — Worker will need to handle this.

- [ ] **Step 6: Document findings in a code comment**

Add the discovered API format as a comment at the top of `worker.js`:

```js
/*
 * Perchance API (discovered YYYY-MM-DD):
 *   POST https://perchance.org/... (exact URL)
 *   Headers: Content-Type: application/json, Cookie: ...
 *   Request:  { "prompt": "...", "resolution": "...", ... }
 *   Response: { "images": ["https://...png"], ... }
 *   Auth: session cookie required / no auth needed
 */
```

- [ ] **Step 7: Commit findings**

```bash
git add worker.js
git commit -m "docs: document Perchance API endpoint from reverse engineering"
```

---

### Task 3: Worker API Proxy — Generate Endpoint

**Files:**
- Modify: `perchance-proxy/worker.js` (full rewrite)

- [ ] **Step 1: Write the complete Worker**

Replace `perchance-proxy/worker.js`:

```js
/*
 * Perchance API (discovered via browser DevTools):
 *   POST <PERCHANCE_API_URL>
 *   Request:  { "prompt": "...", ... }
 *   Response: { ... image data ... }
 *
 * Replace PERCHANCE_API_URL and mapToPerchanceParams() with
 * values discovered in Task 2.
 */

/* ================================================================
 * CONFIGURATION – update these from Task 2 findings
 * ================================================================ */

const PERCHANCE_API_URL = "https://perchance.org/REPLACE_WITH_ACTUAL_ENDPOINT";
const FRONTEND_TIMEOUT_MS = 20000;

/* ================================================================
 * HTML PAGE
 * ================================================================ */

const HTML_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 图片生成器</title>
<style>
  :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --accent: #6366f1; --danger: #ef4444; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .container { max-width: 900px; margin: 0 auto; padding: 20px; }
  h1 { text-align: center; margin-bottom: 24px; font-size: 1.5rem; }
  .card { background: var(--card); border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid var(--border); }
  label { display: block; margin-bottom: 4px; font-size: 0.875rem; color: var(--muted); }
  input, textarea, select { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 0.95rem; }
  textarea { resize: vertical; min-height: 60px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; }
  .row > * { flex: 1; min-width: 120px; }
  button { padding: 10px 24px; border-radius: 8px; border: none; cursor: pointer; font-size: 0.95rem; font-weight: 600; }
  .btn-primary { background: var(--accent); color: #fff; width: 100%; padding: 14px; font-size: 1.1rem; }
  .btn-primary:hover { filter: brightness(1.1); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--text); }
  .spinner { width: 40px; height: 40px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; margin: 20px auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .result-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
  .result-grid img { width: 100%; border-radius: 8px; cursor: pointer; transition: transform 0.2s; }
  .result-grid img:hover { transform: scale(1.02); }
  .history-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .history-grid img { width: 100%; border-radius: 6px; cursor: pointer; }
  .history-item { position: relative; }
  .history-item .delete-btn { position: absolute; top: 4px; right: 4px; background: var(--danger); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; cursor: pointer; display: none; }
  .history-item:hover .delete-btn { display: block; }
  .status-text { text-align: center; color: var(--muted); margin-top: 12px; }
  .error-text { text-align: center; color: var(--danger); margin-top: 12px; }
  .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); z-index: 1000; justify-content: center; align-items: center; }
  .modal.active { display: flex; }
  .modal img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
  .modal-close { position: absolute; top: 20px; right: 30px; color: #fff; font-size: 32px; cursor: pointer; }
  .tabs { display: flex; gap: 8px; margin-bottom: 16px; }
  .tab { padding: 8px 16px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border); background: transparent; color: var(--muted); }
  .tab.active { background: var(--accent); color: #fff; border-color: var(--accent); }
  .hidden { display: none !important; }
  input[type="range"] { accent-color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <h1>\u{1f3a8} AI \u{56fe}\u{7247}\u{751f}\u{6210}\u{5668}</h1>

  <!-- Input Card -->
  <div class="card">
    <label>\u{63d0}\u{793a}\u{8bcd} (Prompt)</label>
    <textarea id="prompt" placeholder="\u{8f93}\u{5165}\u{63cf}\u{8ff0}\u{ff0c}\u{4f8b}\u{5982}\u{ff1a}a cat wearing a hat, digital art, detailed"></textarea>

    <label style="margin-top:12px;">\u{8d1f}\u{9762}\u{63d0}\u{793a}\u{8bcd} (Negative Prompt)</label>
    <textarea id="negativePrompt" placeholder="\u{4f8b}\u{5982}\u{ff1a}ugly, blurry, low quality, distorted"></textarea>

    <div class="row" style="margin-top:12px;">
      <div>
        <label>\u{5206}\u{8fa8}\u{7387}</label>
        <select id="resolution">
          <option value="512x512">512\u{00d7}512</option>
          <option value="512x768" selected>512\u{00d7}768</option>
          <option value="768x512">768\u{00d7}512</option>
        </select>
      </div>
      <div>
        <label>\u{98ce}\u{683c} (Style)</label>
        <select id="style">
          <option value="">\u{65e0}\u{98ce}\u{683c}</option>
          <option value="fantasy-portrait">\u{5e7b}\u{60f3}\u{8096}\u{50cf}</option>
          <option value="anime">\u{52a8}\u{6f2b}</option>
          <option value="realistic">\u{5199}\u{5b9e}</option>
          <option value="oil-painting">\u{6cb9}\u{753b}</option>
          <option value="watercolor">\u{6c34}\u{5f69}</option>
          <option value="pixel-art">\u{50cf}\u{7d20}\u{98ce}</option>
        </select>
      </div>
      <div>
        <label>CFG (<span id="cfgValue">7</span>)</label>
        <input type="range" id="cfg" min="1" max="30" value="7" oninput="document.getElementById('cfgValue').textContent=this.value">
      </div>
      <div>
        <label>\u{79cd}\u{5b50} (Seed, -1=\u{968f}\u{673a})</label>
        <input type="number" id="seed" value="-1">
      </div>
      <div>
        <label>\u{751f}\u{6210}\u{6570}\u{91cf}</label>
        <input type="number" id="count" value="1" min="1" max="10">
      </div>
    </div>

    <button class="btn-primary" id="generateBtn" onclick="generate()">\u{751f}\u{6210}\u{56fe}\u{7247}</button>
  </div>

  <!-- Status Area -->
  <div id="statusArea" class="hidden">
    <div class="spinner"></div>
    <div class="status-text">\u{6b63}\u{5728}\u{751f}\u{6210}\u{ff0c}\u{9884}\u{8ba1} 10-30 \u{79d2}\u{2026}</div>
  </div>

  <!-- Error Area -->
  <div id="errorArea" class="hidden">
    <div class="error-text" id="errorText"></div>
    <button class="btn-primary" onclick="generate()" style="margin-top:12px;">\u{91cd}\u{8bd5}</button>
  </div>

  <!-- Result Area -->
  <div class="card hidden" id="resultCard">
    <div class="result-grid" id="resultGrid"></div>
  </div>

  <!-- History Area -->
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3 style="font-size:1rem;">\u{5386}\u{53f2}\u{8bb0}\u{5f55}</h3>
      <button class="btn-secondary" onclick="clearHistory()">\u{6e05}\u{7a7a}</button>
    </div>
    <div class="history-grid" id="historyGrid"></div>
    <div class="status-text" id="historyEmpty">\u{6682}\u{65e0}\u{8bb0}\u{5f55}</div>
  </div>
</div>

<!-- Image Modal -->
<div class="modal" id="imageModal" onclick="closeModal()">
  <span class="modal-close">&times;</span>
  <img id="modalImage" src="" alt="\u{751f}\u{6210}\u{7684}\u{56fe}\u{7247}">
</div>

<script>
/* ================================================================
 * GLOBALS
 * ================================================================ */

let abortController = null;

/* ================================================================
 * INDEXEDDB
 * ================================================================ */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('PerchanceProxy', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveToHistory(prompt, negPrompt, resolution, style, cfg, seed, images) {
  const db = await openDB();
  const tx = db.transaction('history', 'readwrite');
  tx.objectStore('history').add({
    prompt, negativePrompt: negPrompt, resolution, style, cfg, seed,
    images, createdAt: Date.now()
  });
  await new Promise(r => tx.oncomplete = r);
  db.close();
  loadHistory();
}

async function loadHistory() {
  const db = await openDB();
  const tx = db.transaction('history', 'readonly');
  const items = await new Promise(r => {
    const req = tx.objectStore('history').getAll();
    req.onsuccess = () => r(req.result);
  });
  db.close();

  items.sort((a, b) => b.createdAt - a.createdAt);

  const grid = document.getElementById('historyGrid');
  const empty = document.getElementById('historyEmpty');
  grid.innerHTML = '';

  if (items.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'history-item';
    const img = document.createElement('img');
    img.src = item.images[0];
    img.title = item.prompt;
    img.onclick = () => {
      document.getElementById('prompt').value = item.prompt;
      document.getElementById('negativePrompt').value = item.negativePrompt || '';
      document.getElementById('resolution').value = item.resolution || '512x768';
      document.getElementById('style').value = item.style || '';
      document.getElementById('cfg').value = item.cfg || 7;
      document.getElementById('cfgValue').textContent = item.cfg || 7;
      document.getElementById('seed').value = item.seed || -1;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      const db2 = await openDB();
      const tx2 = db2.transaction('history', 'readwrite');
      tx2.objectStore('history').delete(item.id);
      await new Promise(r => tx2.oncomplete = r);
      db2.close();
      loadHistory();
    };
    div.appendChild(img);
    div.appendChild(delBtn);
    grid.appendChild(div);
  }
}

async function clearHistory() {
  if (!confirm('确定清空所有历史记录吗？')) return;
  const db = await openDB();
  const tx = db.transaction('history', 'readwrite');
  tx.objectStore('history').clear();
  await new Promise(r => tx.oncomplete = r);
  db.close();
  loadHistory();
}

/* ================================================================
 * GENERATE
 * ================================================================ */

async function generate() {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) { alert('请输入提示词'); return; }

  const btn = document.getElementById('generateBtn');
  const statusArea = document.getElementById('statusArea');
  const errorArea = document.getElementById('errorArea');
  const resultCard = document.getElementById('resultCard');
  const resultGrid = document.getElementById('resultGrid');

  btn.disabled = true;
  statusArea.classList.remove('hidden');
  errorArea.classList.add('hidden');
  resultCard.classList.add('hidden');
  resultGrid.innerHTML = '';

  if (abortController) abortController.abort();
  abortController = new AbortController();

  const params = {
    prompt: prompt,
    negativePrompt: document.getElementById('negativePrompt').value.trim(),
    resolution: document.getElementById('resolution').value,
    guidanceScale: parseInt(document.getElementById('cfg').value),
    seed: parseInt(document.getElementById('seed').value),
    style: document.getElementById('style').value,
    count: parseInt(document.getElementById('count').value),
  };

  try {
    const timeoutId = setTimeout(() => abortController.abort(), ${FRONTEND_TIMEOUT_MS});

    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: abortController.signal,
    });

    clearTimeout(timeoutId);

    const data = await resp.json();

    if (data.success && data.images.length > 0) {
      resultCard.classList.remove('hidden');
      for (const img of data.images) {
        const el = document.createElement('img');
        el.src = img;
        el.alt = prompt;
        el.onclick = () => openModal(img);
        resultGrid.appendChild(el);
      }
      await saveToHistory(
        params.prompt, params.negativePrompt, params.resolution,
        params.style, params.guidanceScale, params.seed, data.images
      );
    } else {
      throw new Error(data.error || '生成失败');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      document.getElementById('errorText').textContent = '生成超时，请重试';
    } else {
      document.getElementById('errorText').textContent = '错误: ' + err.message;
    }
    errorArea.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    statusArea.classList.add('hidden');
    abortController = null;
  }
}

function openModal(src) {
  document.getElementById('modalImage').src = src;
  document.getElementById('imageModal').classList.add('active');
}

function closeModal() {
  document.getElementById('imageModal').classList.remove('active');
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ================================================================
 * INIT
 * ================================================================ */
loadHistory();
</script>
</body>
</html>`;

/* ================================================================
 * API HELPERS
 * ================================================================ */

/**
 * Transform our frontend params into Perchance API format.
 * UPDATE THIS based on actual Perchance API discovered in Task 2.
 */
function mapToPerchanceParams(params) {
  // Example mapping — adjust to match actual Perchance API format
  const result = {
    prompt: params.prompt,
    negativePrompt: params.negativePrompt || "",
    resolution: params.resolution,
    guidanceScale: params.guidanceScale,
    seed: params.seed,
    numOutputs: params.count,
  };
  if (params.style) {
    result.style = params.style;
  }
  return result;
}

/**
 * Parse Perchance API response and extract image sources.
 * UPDATE THIS based on actual Perchance API response format.
 */
function extractImageUrls(perchanceResponse) {
  // Example — adjust to match actual response format
  // Perchance might return { images: ["https://..."] } or { url: "https://..." }
  if (perchanceResponse.images && Array.isArray(perchanceResponse.images)) {
    return perchanceResponse.images;
  }
  if (perchanceResponse.url) {
    return [perchanceResponse.url];
  }
  return [];
}

/**
 * Download an image from URL and return as Base64 data URI.
 */
async function imageUrlToBase64(url) {
  const resp = await fetch(url);
  const blob = await resp.blob();
  const buffer = await blob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const mime = blob.type || "image/png";
  return "data:" + mime + ";base64," + base64;
}

/* ================================================================
 * HANDLER
 * ================================================================ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // POST /api/generate — proxy to Perchance
    if (url.pathname === "/api/generate" && request.method === "POST") {
      try {
        const params = await request.json();

        if (!params.prompt) {
          return Response.json(
            { success: false, images: [], error: "提示词不能为空" },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        const perchanceBody = mapToPerchanceParams(params);
        const perchanceResp = await fetch(PERCHANCE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Add any required auth headers/cookies here from Task 2 findings
          },
          body: JSON.stringify(perchanceBody),
        });

        if (!perchanceResp.ok) {
          const text = await perchanceResp.text().catch(() => "");
          return Response.json(
            { success: false, images: [], error: "Perchance returned " + perchanceResp.status + ": " + text.slice(0, 200) },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        const perchanceData = await perchanceResp.json();
        const imageUrls = extractImageUrls(perchanceData);

        if (imageUrls.length === 0) {
          return Response.json(
            { success: false, images: [], error: "Perchance 未返回图片" },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        // Convert image URLs to Base64
        const base64Images = [];
        for (const imgUrl of imageUrls) {
          try {
            const dataUri = await imageUrlToBase64(imgUrl);
            base64Images.push(dataUri);
          } catch (err) {
            console.error("Failed to convert image:", imgUrl, err.message);
          }
        }

        if (base64Images.length === 0) {
          return Response.json(
            { success: false, images: [], error: "图片下载失败" },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        return Response.json(
          { success: true, images: base64Images, error: null },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        );

      } catch (err) {
        return Response.json(
          { success: false, images: [], error: "服务器错误: " + err.message },
          { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    // GET / — serve HTML page
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

- [ ] **Step 2: Test locally with wrangler dev**

```bash
npx wrangler dev
```

Open http://localhost:8787 — should see the full UI with form, inputs, and history section.

- [ ] **Step 3: Test the API endpoint with a mock**

Use curl to POST to /api/generate. It will call Perchance (or fail if the endpoint isn't configured yet):

```bash
curl -X POST http://localhost:8787/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test","resolution":"512x512","guidanceScale":7,"seed":-1,"style":"","count":1}'
```

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add complete Worker with HTML frontend and API proxy"
```

---

### Task 4: Update API Mapping from Task 2 Findings

**Files:**
- Modify: `perchance-proxy/worker.js`

- [ ] **Step 1: Update PERCHANCE_API_URL**

Replace the placeholder with the actual URL discovered in Task 2:

```js
const PERCHANCE_API_URL = "https://perchance.org/api/ACTUAL_ENDPOINT_HERE";
```

- [ ] **Step 2: Update mapToPerchanceParams()**

Match the actual parameter names Perchance expects. For example, if Perchance uses `negative_prompt` instead of `negativePrompt`:

```js
function mapToPerchanceParams(params) {
  return {
    prompt: params.prompt,
    negative_prompt: params.negativePrompt || "",
    resolution: params.resolution,
    guidance_scale: params.guidanceScale,
    seed: params.seed,
    num_outputs: params.count,
    style: params.style || undefined,
  };
}
```

- [ ] **Step 3: Update extractImageUrls()**

Match the actual response structure:

```js
function extractImageUrls(perchanceResponse) {
  // Update based on actual response format from Task 2
  // Common patterns: .images[], .output[], .data.url
  return perchanceResponse.images || [];
}
```

- [ ] **Step 4: Add auth headers if needed**

If Task 2 found that Perchance requires cookies or tokens, add them:

```js
const perchanceResp = await fetch(PERCHANCE_API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Cookie": "session=...",  // if needed
    "X-CSRF-Token": "...",     // if needed
  },
  body: JSON.stringify(perchanceBody),
});
```

- [ ] **Step 5: End-to-end test with wrangler dev**

```bash
npx wrangler dev
```

Open http://localhost:8787, enter a prompt, click Generate. Verify:
- Image appears in the result grid
- Image is saved to history (IndexedDB)
- Clicking a history item restores the parameters

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "fix: update Perchance API mapping from reverse engineering findings"
```

---

### Task 5: Deploy and Verify

- [ ] **Step 1: Deploy to Cloudflare Workers**

```bash
npx wrangler deploy
```

Note the deployed URL (e.g., `https://perchance-proxy.<your-subdomain>.workers.dev`).

- [ ] **Step 2: Test deployed Worker**

```bash
curl https://perchance-proxy.<your-subdomain>.workers.dev/
# Should return HTML page

curl -X POST https://perchance-proxy.<your-subdomain>.workers.dev/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test cat","resolution":"512x512","guidanceScale":7,"seed":-1,"style":"","count":1}'
# Should return JSON with generated images
```

- [ ] **Step 3: Test from China**

Have someone in China open the URL and verify:
- Page loads
- Image generation works
- No VPN needed

- [ ] **Step 4: If workers.dev is blocked in China**

If `*.workers.dev` doesn't work from China, configure a custom domain:
1. Buy a cheap domain (or use a free one from freenom)
2. Add it to Cloudflare DNS
3. In `wrangler.toml`, add route or custom domain config
4. Redeploy

- [ ] **Step 5: Commit and write README**

Create `perchance-proxy/README.md`:

```markdown
# Perchance AI Image Generator Proxy

Proxy wrapper for Perchance.org's AI text-to-image generator, deployed on Cloudflare Workers.

## Deploy

```bash
npm install
npx wrangler deploy
```

## Local Dev

```bash
npx wrangler dev
```

Open http://localhost:8787

## API

POST /api/generate
Content-Type: application/json

{
  "prompt": "a cat",
  "negativePrompt": "ugly",
  "resolution": "512x768",
  "guidanceScale": 7,
  "seed": -1,
  "style": "",
  "count": 1
}
```

```bash
git add README.md
git commit -m "docs: add README with deploy and API instructions"
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: finalize Perchance proxy deployment"
```

---

### Task 6 (Optional): UI Polish — Loading Skeleton & Error Retry

Only do this if basic functionality is working and you want better UX.

**Files:**
- Modify: `perchance-proxy/worker.js` (HTML section)

- [ ] **Step 1: Add progress indicator for batch generation**

Update the status display to show "正在生成第 X/Y 张…" for batch generation.
This requires incremental updates — achievable if Perchance returns images one at a time, or if we send multiple requests.

For a simple implementation (send all requests at once, wait for all):

In the `generate()` function, update the status text before the fetch call:

```js
if (params.count > 1) {
  document.querySelector('.status-text').textContent =
    '正在生成 ' + params.count + ' 张图片，预计 10-60 秒…';
} else {
  document.querySelector('.status-text').textContent =
    '正在生成，预计 10-30 秒…';
}
```

- [ ] **Step 2: Add download-all button**

After generation, add a button to download all images as a zip-like experience (individual downloads):

```js
// After populating resultGrid, add download buttons
for (let i = 0; i < data.images.length; i++) {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  // ... existing img code ...
  const downloadBtn = document.createElement('a');
  downloadBtn.href = data.images[i];
  downloadBtn.download = 'image_' + (i + 1) + '.png';
  downloadBtn.textContent = '⬇ 下载';
  downloadBtn.className = 'btn-secondary';
  downloadBtn.style.cssText = 'position:absolute; bottom:8px; right:8px; font-size:0.8rem; padding:4px 8px;';
  wrapper.appendChild(img);
  wrapper.appendChild(downloadBtn);
  resultGrid.appendChild(wrapper);
}
```

- [ ] **Step 3: Add IndexedDB quota exceeded handling**

Wrap the `saveToHistory` function's `add()` call with a try-catch for `QuotaExceededError`:

```js
async function saveToHistory(prompt, negPrompt, resolution, style, cfg, seed, images) {
  try {
    const db = await openDB();
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').add({
      prompt, negativePrompt: negPrompt, resolution, style, cfg, seed,
      images, createdAt: Date.now()
    });
    await new Promise(r => tx.oncomplete = r);
    db.close();
    loadHistory();
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      alert('存储空间已满，请清理历史记录后重试');
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add batch progress indicator, download buttons, and storage quota handling"
```
