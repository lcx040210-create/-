/*
 * Perchance Proxy Worker
 * Proxies image-generation.perchance.org API behind Cloudflare Workers.
 *
 * Perchance API flow (reverse-engineered 2026-05-30):
 *   1. GET  perchance.org/api/getAccessCodeForAdPoweredStuff → adAccessCode
 *   2. POST image-generation.perchance.org/api/generate      → submit job
 *   3. GET  image-generation.perchance.org/api/awaitExistingGenerationRequest → wait
 *   4. GET  image-generation.perchance.org/api/downloadTemporaryImageViaProxy → image
 */

/* ================================================================
 * CONFIGURATION
 * ================================================================ */

const PERCHANCE_MAIN = "https://perchance.org";
const IMAGE_GEN_BASE = "https://image-generation.perchance.org";
const CHANNEL = "ai-text-to-image-generator";
const FRONTEND_TIMEOUT_MS = 20000;
const MAX_POLL_SECONDS = 60;

// Browser-like headers to bypass Cloudflare bot detection
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "Origin": PERCHANCE_MAIN,
  "Referer": PERCHANCE_MAIN + "/ai-text-to-image-generator",
};

const IMAGE_GEN_HEADERS = {
  ...BROWSER_HEADERS,
  "Origin": IMAGE_GEN_BASE,
  "Referer": IMAGE_GEN_BASE + "/embed",
};

/* ================================================================
 * HELPERS
 * ================================================================ */

function randomHex(length) {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

async function imageUrlToBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Image download failed: " + resp.status);
  const blob = await resp.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return "data:" + (blob.type || "image/png") + ";base64," + btoa(binary);
}

/* ================================================================
 * PERCHANCE API CLIENT
 * ================================================================ */

async function getAdAccessCode() {
  const resp = await fetch(`${PERCHANCE_MAIN}/api/getAccessCodeForAdPoweredStuff?__cacheBust=${Math.random()}`);
  if (!resp.ok) throw new Error("Failed to get ad access code: " + resp.status);
  const data = await resp.json();
  return data.adAccessCode || data.code || data;
}

async function submitGeneration(userKey, adAccessCode, requestId, params) {
  const url = `${IMAGE_GEN_BASE}/api/generate?userKey=${userKey}&requestId=${requestId}&adAccessCode=${adAccessCode}&__cacheBust=${Math.random()}`;
  const body = {
    prompt: params.prompt,
    negativePrompt: params.negativePrompt || "",
    seed: params.seed ?? -1,
    resolution: params.resolution || "512x768",
    guidanceScale: params.guidanceScale ?? 7,
    channel: CHANNEL,
    subChannel: "public",
    userKey: userKey,
    adAccessCode: adAccessCode,
    requestId: requestId,
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8", "Origin": IMAGE_GEN_BASE, "Referer": `${IMAGE_GEN_BASE}/embed` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error("Generate request failed: " + resp.status + " " + text.slice(0, 300));
  }
}

async function awaitGeneration(userKey) {
  const url = `${IMAGE_GEN_BASE}/api/awaitExistingGenerationRequest?userKey=${userKey}&__cacheBust=${Math.random()}`;
  const resp = await fetch(url, {
    headers: { "Origin": IMAGE_GEN_BASE, "Referer": `${IMAGE_GEN_BASE}/embed` },
  });
  if (!resp.ok) throw new Error("Await request failed: " + resp.status);
  return resp.json();
}

async function downloadImage(token) {
  const url = `${IMAGE_GEN_BASE}/api/downloadTemporaryImageViaProxy?t=${encodeURIComponent(token)}`;
  const resp = await fetch(url, {
    headers: { "Origin": IMAGE_GEN_BASE, "Referer": `${IMAGE_GEN_BASE}/embed` },
  });
  if (!resp.ok) throw new Error("Download failed: " + resp.status);
  const blob = await resp.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return "data:" + (blob.type || "image/png") + ";base64," + btoa(binary);
}

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
  .history-item .delete-btn { position: absolute; top: 4px; right: 4px; background: var(--danger); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; cursor: pointer; display: none; line-height: 22px; text-align: center; }
  .history-item:hover .delete-btn { display: block; }
  .status-text { text-align: center; color: var(--muted); margin-top: 12px; }
  .error-text { text-align: center; color: var(--danger); margin-top: 12px; }
  .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); z-index: 1000; justify-content: center; align-items: center; }
  .modal.active { display: flex; }
  .modal img { max-width: 90vw; max-height: 90vh; border-radius: 8px; }
  .modal-close { position: absolute; top: 20px; right: 30px; color: #fff; font-size: 32px; cursor: pointer; }
  .hidden { display: none !important; }
  input[type="range"] { accent-color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <h1>🎨 AI 图片生成器</h1>

  <!-- Input Card -->
  <div class="card">
    <label>提示词 (Prompt)</label>
    <textarea id="prompt" placeholder="输入描述，例如：a cat wearing a hat, digital art, detailed"></textarea>

    <label style="margin-top:12px;">负面提示词 (Negative Prompt)</label>
    <textarea id="negativePrompt" placeholder="例如：ugly, blurry, low quality, distorted"></textarea>

    <div class="row" style="margin-top:12px;">
      <div>
        <label>分辨率</label>
        <select id="resolution">
          <option value="512x512">512×512</option>
          <option value="512x768" selected>512×768</option>
          <option value="768x512">768×512</option>
          <option value="768x768">768×768</option>
        </select>
      </div>
      <div>
        <label>CFG (<span id="cfgValue">7</span>)</label>
        <input type="range" id="cfg" min="1" max="30" value="7" oninput="document.getElementById('cfgValue').textContent=this.value">
      </div>
      <div>
        <label>种子 (Seed, -1=随机)</label>
        <input type="number" id="seed" value="-1">
      </div>
      <div>
        <label>生成数量</label>
        <input type="number" id="count" value="1" min="1" max="4">
      </div>
    </div>

    <button class="btn-primary" id="generateBtn" onclick="generate()">生成图片</button>
  </div>

  <!-- Status Area -->
  <div id="statusArea" class="hidden">
    <div class="spinner"></div>
    <div class="status-text">正在生成，预计 10-30 秒…</div>
  </div>

  <!-- Error Area -->
  <div id="errorArea" class="hidden">
    <div class="error-text" id="errorText"></div>
    <button class="btn-primary" onclick="generate()" style="margin-top:12px;">重试</button>
  </div>

  <!-- Debug Log -->
  <div class="card hidden" id="debugCard">
    <h3 style="font-size:0.9rem; margin-bottom:8px;">🔍 调试日志</h3>
    <div id="debugLog" style="font-family: monospace; font-size: 0.75rem; color: var(--muted); max-height: 300px; overflow-y: auto; white-space: pre-wrap; line-height: 1.4;"></div>
  </div>

  <!-- Result Area -->
  <div class="card hidden" id="resultCard">
    <div class="result-grid" id="resultGrid"></div>
  </div>

  <!-- History Area -->
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3 style="font-size:1rem;">历史记录</h3>
      <button class="btn-secondary" onclick="clearHistory()">清空</button>
    </div>
    <div class="history-grid" id="historyGrid"></div>
    <div class="status-text" id="historyEmpty">暂无记录</div>
  </div>
</div>

<!-- Image Modal -->
<div class="modal" id="imageModal" onclick="closeModal()">
  <span class="modal-close">&times;</span>
  <img id="modalImage" src="" alt="生成的图片">
</div>

<script>
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

async function saveToHistory(prompt, negPrompt, resolution, cfg, seed, images) {
  try {
    const db = await openDB();
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').add({
      prompt, negativePrompt: negPrompt, resolution, cfg, seed,
      images, createdAt: Date.now()
    });
    await new Promise(r => tx.oncomplete = r);
    db.close();
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      alert('存储空间已满，请清理历史记录后重试');
    }
  }
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
      if (item.cfg) { document.getElementById('cfg').value = item.cfg; document.getElementById('cfgValue').textContent = item.cfg; }
      document.getElementById('seed').value = item.seed ?? -1;
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

let abortController = null;
let pollTimer = null;

function debugLog(msg) {
  const card = document.getElementById('debugCard');
  const log = document.getElementById('debugLog');
  card.classList.remove('hidden');
  const time = new Date().toLocaleTimeString();
  log.textContent += '[' + time + '] ' + msg + '\\n';
  log.scrollTop = log.scrollHeight;
}

async function generate() {
  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt) { alert('请输入提示词'); return; }

  const btn = document.getElementById('generateBtn');
  const statusArea = document.getElementById('statusArea');
  const errorArea = document.getElementById('errorArea');
  const resultCard = document.getElementById('resultCard');
  const resultGrid = document.getElementById('resultGrid');
  const debugLogEl = document.getElementById('debugLog');
  debugLogEl.textContent = ''; // clear previous

  // Clean up any previous run
  if (abortController) abortController.abort();
  if (pollTimer) clearInterval(pollTimer);
  abortController = new AbortController();

  btn.disabled = true;
  statusArea.classList.remove('hidden');
  errorArea.classList.add('hidden');
  resultCard.classList.add('hidden');
  resultGrid.innerHTML = '';

  const params = {
    prompt: prompt,
    negativePrompt: document.getElementById('negativePrompt').value.trim(),
    resolution: document.getElementById('resolution').value,
    guidanceScale: parseInt(document.getElementById('cfg').value),
    seed: parseInt(document.getElementById('seed').value),
    count: parseInt(document.getElementById('count').value),
  };

  debugLog('开始生成，参数: ' + JSON.stringify(params));
  document.querySelector('.status-text').textContent = params.count > 1
    ? '正在提交 ' + params.count + ' 张图片…' : '正在提交…';

  try {
    // Phase 1: Submit generation jobs
    debugLog('POST /api/generate …');
    const submitResp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: abortController.signal,
    });
    debugLog('提交响应 HTTP ' + submitResp.status);
    const submitData = await submitResp.json();
    debugLog('提交结果: ' + JSON.stringify({success: submitData.success, tasks: submitData.tasks?.length, error: submitData.error}));
    if (submitData.genDebug) debugLog('Generate API响应: ' + JSON.stringify(submitData.genDebug, null, 2));

    if (!submitData.success) {
      throw new Error(submitData.error || '提交失败');
    }

    debugLog('获得 ' + submitData.tasks.length + ' 个任务, adAccessCode=' + (submitData.adAccessCode||'').slice(0,12)+'…');

    const collected = [];
    let tasks = submitData.tasks;
    const adAccessCode = submitData.adAccessCode;
    const startTime = Date.now();
    const maxWait = 90000;
    let pollCount = 0;

    document.querySelector('.status-text').textContent = '正在生成，预计 10-60 秒…';

    // Phase 2: Poll for completion
    pollTimer = setInterval(async () => {
      pollCount++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      try {
        debugLog('轮询 #' + pollCount + ' (' + elapsed + 's) POST /api/check …');
        const checkResp = await fetch('/api/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks, adAccessCode }),
          signal: abortController.signal,
        });
        const checkData = await checkResp.json();
        debugLog('检查结果: ' + JSON.stringify({success: checkData.success, images: checkData.images?.length, pending: checkData.pending?.length, allDone: checkData.allDone, error: checkData.error}));
        if (checkData.debug) debugLog('Perchance原始响应: ' + JSON.stringify(checkData.debug, null, 2));

        if (checkData.success && checkData.images.length > 0) {
          debugLog('✓ 获得 ' + checkData.images.length + ' 张图片');
          collected.push(...checkData.images);
          for (const img of checkData.images) {
            const el = document.createElement('img');
            el.src = img;
            el.alt = prompt;
            el.onclick = () => openModal(img);
            resultGrid.appendChild(el);
          }
          resultCard.classList.remove('hidden');
        }

        if (checkData.allDone) {
          clearInterval(pollTimer);
          pollTimer = null;
          btn.disabled = false;
          statusArea.classList.add('hidden');
          debugLog('全部完成！共 ' + collected.length + ' 张图片');

          if (collected.length > 0) {
            await saveToHistory(params.prompt, params.negativePrompt, params.resolution,
              params.guidanceScale, params.seed, collected);
          } else {
            debugLog('✗ 完成但无图片');
            throw new Error('生成完成但未获取到图片');
          }
        } else if (Date.now() - startTime > maxWait) {
          clearInterval(pollTimer);
          pollTimer = null;
          btn.disabled = false;
          statusArea.classList.add('hidden');
          debugLog('超时 (' + maxWait/1000 + 's)，已完成 ' + collected.length + '/' + params.count);
          if (collected.length > 0) {
            await saveToHistory(params.prompt, params.negativePrompt, params.resolution,
              params.guidanceScale, params.seed, collected);
            document.querySelector('.status-text').textContent = '部分图片生成超时，已显示完成的图片';
          } else {
            throw new Error('生成超时，请重试');
          }
        } else {
          tasks = checkData.pending;
          document.querySelector('.status-text').textContent =
            '正在生成… (' + elapsed + 's) 已完成: ' + collected.length + '/' + params.count;
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          clearInterval(pollTimer);
          pollTimer = null;
          debugLog('✗ 轮询错误: ' + err.message);
          document.getElementById('errorText').textContent = '错误: ' + err.message;
          errorArea.classList.remove('hidden');
          btn.disabled = false;
          statusArea.classList.add('hidden');
        }
      }
    }, 2000);

  } catch (err) {
    debugLog('✗ 提交错误: ' + err.message);
    if (err.name === 'AbortError') {
      document.getElementById('errorText').textContent = '生成超时，请重试';
    } else {
      document.getElementById('errorText').textContent = '错误: ' + err.message;
    }
    errorArea.classList.remove('hidden');
    btn.disabled = false;
    statusArea.classList.add('hidden');
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

    // POST /api/generate — submit generation jobs, return keys immediately
    if (url.pathname === "/api/generate" && request.method === "POST") {
      try {
        const params = await request.json();
        if (!params.prompt) {
          return Response.json(
            { success: false, images: [], error: "提示词不能为空" },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        const count = Math.min(Math.max(params.count || 1, 1), 4);

        // Step 1: Get ad access code
        let adAccessCode;
        try {
          const adResp = await fetch(`${PERCHANCE_MAIN}/api/getAccessCodeForAdPoweredStuff?__cacheBust=${Math.random()}`, { headers: BROWSER_HEADERS });
          const adText = await adResp.text();
          try { const adJson = JSON.parse(adText); adAccessCode = adJson.adAccessCode || adJson.code || adJson; }
          catch { adAccessCode = adText.trim(); }
          if (!adAccessCode) throw new Error("No adAccessCode in response: " + adText.slice(0, 200));
        } catch (err) {
          return Response.json(
            { success: false, images: [], error: "获取广告授权码失败: " + err.message },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        // Step 2: Visit embed page first to establish session/cookies
        let sessionCookies = "";
        try {
          const embedResp = await fetch(`${IMAGE_GEN_BASE}/embed`, { headers: IMAGE_GEN_HEADERS });
          const setCookie = embedResp.headers.get("set-cookie");
          if (setCookie) {
            sessionCookies = setCookie.split(",").map(c => c.split(";")[0]).join("; ");
          }
          genDebug.push({ step: "embed", hasCookies: !!sessionCookies, cookieSample: sessionCookies.slice(0,100) });
        } catch (e) {
          genDebug.push({ step: "embed", error: e.message });
        }

        // Build headers with cookies for image-gen API
        const authedHeaders = { ...IMAGE_GEN_HEADERS };
        if (sessionCookies) {
          authedHeaders["Cookie"] = sessionCookies;
        }

        // Step 3: Submit all generation requests
        const tasks = [];
        for (let i = 0; i < count; i++) {
          const userKey = randomHex(64);
          const requestId = `${Math.random()}`;

          // Register/validate the userKey
          try {
            const checkUrl = `${IMAGE_GEN_BASE}/api/checkUserVerificationStatus?userKey=${userKey}&cacheKey=993370269`;
            const checkResp = await fetch(checkUrl, { headers: authedHeaders });
            const checkText = await checkResp.text();
            genDebug.push({ step: "checkKey", userKey: userKey.slice(0,12)+"…", status: checkResp.status, response: checkText.slice(0,200) });
          } catch (e) {
            genDebug.push({ step: "checkKey", error: e.message });
          }

          const genUrl = `${IMAGE_GEN_BASE}/api/generate?userKey=${userKey}&requestId=${requestId}&adAccessCode=${adAccessCode}&__cacheBust=${Math.random()}`;
          const genBody = {
            prompt: params.prompt,
            negativePrompt: params.negativePrompt || "",
            seed: params.seed ?? -1,
            resolution: params.resolution || "512x768",
            guidanceScale: params.guidanceScale ?? 7,
            channel: CHANNEL, subChannel: "public",
            userKey, adAccessCode, requestId,
          };
          const genResp = await fetch(genUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=UTF-8", ...authedHeaders },
            body: JSON.stringify(genBody),
          });
          const genRespText = await genResp.text().catch(() => "");
          let genRespData;
          try { genRespData = JSON.parse(genRespText); } catch { genRespData = genRespText.slice(0, 300); }
          genDebug.push({ step: "generate", userKey: userKey.slice(0,12)+"…", requestId, httpStatus: genResp.status, response: genRespData });
          tasks.push({ userKey, requestId });
        }

        // Return immediately — frontend will poll /api/check
        return Response.json(
          { success: true, tasks, adAccessCode, error: null, genDebug },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        );
      } catch (err) {
        return Response.json(
          { success: false, images: [], error: "服务器错误: " + err.message },
          { status: 500, headers: { "Access-Control-Allow-Origin": "*" } }
        );
      }
    }

    // POST /api/check — poll generation status and return completed images
    if (url.pathname === "/api/check" && request.method === "POST") {
      try {
        const body = await request.json();
        const tasks = body.tasks || [];
        const adAccessCode = body.adAccessCode;

        if (!tasks.length) {
          return Response.json(
            { success: false, images: [], error: "无任务" },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

        const completed = [];
        const pending = [];
        let debug = [];

        for (const task of tasks) {
          try {
            // Use getUserQueuePosition for fast status check (non-blocking)
            const posUrl = `${IMAGE_GEN_BASE}/api/getUserQueuePosition?userKey=${task.userKey}&requestId=${task.requestId}`;
            const posResp = await fetch(posUrl, { headers: IMAGE_GEN_HEADERS });
            let posText = "";
            let isReady = false;
            if (posResp.ok) {
              posText = await posResp.text();
              try {
                const posData = JSON.parse(posText);
                debug.push({ step: "getUserQueuePosition", status: posResp.status, data: posData });
                // Check various completion signals
                if (posData && (
                  posData.position === 0 ||
                  posData.status === "done" ||
                  posData.status === "complete" ||
                  posData.ready === true ||
                  posData.done === true ||
                  (posData.requestStatus && posData.requestStatus === "done")
                )) {
                  isReady = true;
                }
              } catch { debug.push({ step: "getUserQueuePosition", status: posResp.status, raw: posText.slice(0, 200) }); }
            } else {
              debug.push({ step: "getUserQueuePosition", error: "HTTP " + posResp.status });
            }

            if (isReady) {
              // Now safely call await to get the image token (should return immediately)
              const awaitUrl = `${IMAGE_GEN_BASE}/api/awaitExistingGenerationRequest?userKey=${task.userKey}&__cacheBust=${Math.random()}`;
              const awaitResp = await fetch(awaitUrl, {
                headers: IMAGE_GEN_HEADERS,
                signal: AbortSignal.timeout(5000),
              });
              if (awaitResp.ok) {
                const awaitData = await awaitResp.json();
                debug.push({ step: "awaitExistingGenerationRequest", data: awaitData });
                const token = awaitData?.imageToken || (awaitData?.images?.[0]) || awaitData?.token;
                if (token) {
                  const downloadUrl = `${IMAGE_GEN_BASE}/api/downloadTemporaryImageViaProxy?t=${encodeURIComponent(token)}`;
                  const imgResp = await fetch(downloadUrl, {
                    headers: IMAGE_GEN_HEADERS,
                    signal: AbortSignal.timeout(10000),
                  });
                  if (imgResp.ok) {
                    const blob = await imgResp.blob();
                    const buffer = await blob.arrayBuffer();
                    const bytes = new Uint8Array(buffer);
                    let binary = "";
                    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                    completed.push("data:" + (blob.type || "image/png") + ";base64," + btoa(binary));
                    continue; // done with this task
                  }
                }
              }
            }
            pending.push(task); // still generating or failed, retry
          } catch (e) {
            pending.push(task); // error, retry next poll
          }
        }

        return Response.json(
          { success: true, images: completed, pending, allDone: pending.length === 0, error: null, debug },
          { headers: { "Access-Control-Allow-Origin": "*" } }
        );
      } catch (err) {
        return Response.json(
          { success: false, images: [], error: "检查状态失败: " + err.message },
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
