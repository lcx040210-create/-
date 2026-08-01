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
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; overflow: hidden; background: #0f172a; }
  iframe { width: 100%; height: 100%; border: none; }
  .banner { position: fixed; top: 0; left: 0; right: 0; z-index: 10;
    background: linear-gradient(180deg, rgba(15,23,42,1) 0%, rgba(15,23,42,0.8) 60%, transparent 100%);
    padding: 8px 16px; display: flex; align-items: center; gap: 8px;
    pointer-events: none; }
  .banner span { color: #94a3b8; font-family: -apple-system, sans-serif; font-size: 0.8rem; }
  .loader { position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 100;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: #0f172a; transition: opacity 0.5s; }
  .loader.hidden { opacity: 0; pointer-events: none; }
  .spinner { width: 40px; height: 40px; border: 4px solid #334155; border-top-color: #6366f1;
    border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loader p { color: #94a3b8; font-family: -apple-system, sans-serif; font-size: 0.9rem; }
</style>
</head>
<body>
<div class="loader" id="loader">
  <div class="spinner"></div>
  <p>正在加载 AI 图片生成器…</p>
</div>
<div class="banner"><span>AI 图片生成器</span></div>
<iframe id="frame" src="https://perchance.org/ai-text-to-image-generator"
  onload="document.getElementById('loader').classList.add('hidden')"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
<script>
// Hide loader after 15s even if onload didn't fire
setTimeout(() => document.getElementById('loader').classList.add('hidden'), 15000);
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
    // Requires userKey from frontend (generated & registered by browser)
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
        const userKey = params.userKey;
        if (!userKey) {
          return Response.json(
            { success: false, images: [], error: "缺少 userKey" },
            { headers: { "Access-Control-Allow-Origin": "*" } }
          );
        }

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

        const genDebug = [];

        // Step 2: Submit all generation requests using the browser-provided userKey
        const tasks = [];
        for (let i = 0; i < count; i++) {
          const requestId = `${Math.random()}`;

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
            headers: { "Content-Type": "text/plain;charset=UTF-8", ...IMAGE_GEN_HEADERS },
            body: JSON.stringify(genBody),
          });
          const genRespText = await genResp.text().catch(() => "");
          let genRespData;
          try { genRespData = JSON.parse(genRespText); } catch { genRespData = genRespText.slice(0, 300); }
          genDebug.push({ step: "generate", httpStatus: genResp.status, response: genRespData });
          tasks.push({ userKey, requestId });
        }

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
