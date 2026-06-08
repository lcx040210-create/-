/**
 * X Broadcaster — Service Worker (Simplified)
 *
 * Uses chrome.scripting.executeScript to inject code directly into X pages.
 * No content script message passing — script runs inline, does its work, returns result.
 */

// ── Storage helpers ──

var KEYS = {
  TASK_CONFIG: 'taskConfig',
  CANDIDATE_QUEUE: 'candidateQueue',
  SEND_QUEUE: 'sendQueue',
  BLACKLIST: 'blacklist',
  EXECUTION_STATE: 'executionState',
  SENT_TODAY: 'sentToday',
  LAST_SEND_DATE: 'lastSendDate',
};

var DEFAULT_CONFIG = {
  keywords: [],
  messageTemplates: ['Hi {username}! {link}'],
  link: '',
  interval: { min: 15, max: 30 },
  dailyLimit: 200,
  activeHours: { start: 9, end: 23 },
  maxResults: 100,
};

async function getJSON(key) {
  var result = await chrome.storage.local.get([key]);
  if (result[key]) {
    try { return JSON.parse(result[key]); } catch (e) { return result[key]; }
  }
  return null;
}

async function setJSON(key, value) {
  var obj = {};
  obj[key] = JSON.stringify(value);
  return chrome.storage.local.set(obj);
}

// ── Execution state ──

var currentState = {
  status: 'idle',
  progress: { done: 0, total: 0, failed: 0, skipped: 0 },
  currentHandle: null,
  errorMessage: null,
};

async function saveState() {
  await setJSON(KEYS.EXECUTION_STATE, currentState);
}

async function loadState() {
  var saved = await getJSON(KEYS.EXECUTION_STATE);
  if (saved) currentState = saved;
}

// ── Daily counter ──

async function getTodaysCount() {
  var today = new Date().toISOString().slice(0, 10);
  var lastDate = await getJSON(KEYS.LAST_SEND_DATE);
  if (lastDate !== today) {
    await setJSON(KEYS.SENT_TODAY, 0);
    await setJSON(KEYS.LAST_SEND_DATE, today);
    return 0;
  }
  return (await getJSON(KEYS.SENT_TODAY)) || 0;
}

async function incrementTodaysCount() {
  var count = await getTodaysCount();
  await setJSON(KEYS.SENT_TODAY, count + 1);
}

// ── Script injection helper ──

async function injectAndRun(tabId, funcCode, args) {
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: funcCode,
      args: args || [],
    });
    return results && results[0] ? results[0].result : null;
  } catch (e) {
    console.error('[bg] Script injection failed:', e.message);
    return { error: e.message };
  }
}

// ── Direct Send: inject DM code into active tab ──

function dmSender(handle, messageText) {
  // This function runs AS INJECTED CODE in the X page context
  return new Promise(function (resolve) {
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function waitFor(selectors, timeoutMs) {
      timeoutMs = timeoutMs || 10000;
      if (typeof selectors === 'string') selectors = [selectors];
      return new Promise(function (resolveEl) {
        for (var i = 0; i < selectors.length; i++) {
          var found = document.querySelector(selectors[i]);
          if (found) return resolveEl(found);
        }
        var observer = new MutationObserver(function () {
          for (var i = 0; i < selectors.length; i++) {
            var f = document.querySelector(selectors[i]);
            if (f) { observer.disconnect(); resolveEl(f); return; }
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () { observer.disconnect(); resolveEl(null); }, timeoutMs);
      });
    }

    async function typeText(el, text) {
      el.focus();
      for (var i = 0; i < text.length; i++) {
        el.value = text.slice(0, i + 1);
        el.textContent = text.slice(0, i + 1);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(40 + Math.random() * 100);
      }
    }

    async function doSend() {
      // 1. Press 'n' to open new message dialog
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', keyCode: 78, bubbles: true }));
      await sleep(1500);

      // 2. Find search/recipient input
      var searchInput = await waitFor([
        'input[placeholder*="Search people"]',
        '[data-testid="searchPeople"] input',
        'input[aria-label*="Search"]',
      ], 5000);

      if (!searchInput) {
        // Try clicking the new message button
        var btns = document.querySelectorAll('a, button, [role="button"]');
        for (var b = 0; b < btns.length; b++) {
          var aria = (btns[b].getAttribute('aria-label') || '').toLowerCase();
          if (aria.indexOf('new message') !== -1 || aria.indexOf('compose') !== -1) {
            btns[b].click(); await sleep(1500); break;
          }
        }
        searchInput = await waitFor([
          'input[placeholder*="Search people"]',
          '[data-testid="searchPeople"] input',
        ], 3000);
      }

      if (!searchInput) return resolve({ error: 'no_search_input' });

      // 3. Type recipient handle
      await typeText(searchInput, handle);
      await sleep(2000);

      // 4. Click first result
      var firstResult = document.querySelector('[data-testid="TypeaheadUser"]') ||
                        document.querySelector('[data-testid="cellInnerDiv"]');
      if (firstResult) { firstResult.click(); await sleep(1000); }

      // 5. Click Next if present
      var nextBtn = document.querySelector('[data-testid="nextButton"]');
      if (nextBtn) { nextBtn.click(); await sleep(1000); }

      // 6. Find message input and type
      var msgInput = await waitFor([
        '[data-testid="dmComposerTextInput"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[data-testid="tweetTextarea_0"] [contenteditable="true"]',
      ], 5000);
      if (!msgInput) return resolve({ error: 'no_msg_input' });

      await typeText(msgInput, messageText);
      await sleep(800);

      // 7. Click send
      var sendBtn = document.querySelector('[data-testid="dmComposerSendButton"]') ||
                    document.querySelector('button[aria-label="Send"]') ||
                    document.querySelector('[data-testid="tweetButton"]');
      if (!sendBtn) return resolve({ error: 'no_send_btn' });
      sendBtn.click();
      await sleep(2000);

      return resolve({ status: 'sent' });
    }

    doSend().catch(function (e) { resolve({ error: e.message }); });
  });
}

// ── Direct Send pipeline ──

async function executeDirectSend(handles) {
  currentState.status = 'sending';
  currentState.progress = { done: 0, total: handles.length, failed: 0, skipped: 0 };
  currentState.errorMessage = null;
  await saveState();

  var config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  var blacklist = (await getJSON(KEYS.BLACKLIST)) || [];
  var activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

  if (!activeTab || activeTab.url.indexOf('x.com') === -1) {
    currentState.status = 'error';
    currentState.errorMessage = 'Please open X messages page first (x.com/messages)';
    await saveState();
    return;
  }

  // Ensure we're on the messages page
  if (activeTab.url.indexOf('/messages') === -1 && activeTab.url.indexOf('/i/chat') === -1) {
    await chrome.tabs.update(activeTab.id, { url: 'https://x.com/messages' });
    await new Promise(function (r) { setTimeout(r, 4000); });
    activeTab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  }

  for (var i = 0; i < handles.length; i++) {
    var handle = handles[i];

    if (currentState.status !== 'sending') break;

    var sentToday = await getTodaysCount();
    if (sentToday >= (config.dailyLimit || 200)) {
      currentState.status = 'paused'; await saveState(); break;
    }

    if (blacklist.indexOf(handle) !== -1) {
      currentState.progress.skipped++; await saveState(); continue;
    }

    currentState.currentHandle = handle;
    currentState.progress.done = i;
    await saveState();

    var variant = config.messageTemplates[Math.floor(Math.random() * config.messageTemplates.length)];
    var messageText = variant
      .replace('{username}', handle)
      .replace('{topic}', config.keywords[0] || '')
      .replace('{link}', config.link || '');

    console.log('[bg] Sending DM to ' + handle + ': ' + messageText);

    var result = await injectAndRun(activeTab.id, dmSender, [handle, messageText]);
    console.log('[bg] DM result for ' + handle + ':', result);

    if (result && result.status === 'sent') {
      await incrementTodaysCount();
      var bl = (await getJSON(KEYS.BLACKLIST)) || [];
      if (bl.indexOf(handle) === -1) { bl.push(handle); await setJSON(KEYS.BLACKLIST, bl); }
    } else {
      currentState.progress.failed++;
    }

    var interval = (config.interval.min + Math.random() * (config.interval.max - config.interval.min)) * 1000;
    await new Promise(function (r) { setTimeout(r, interval); });
  }

  if (currentState.progress.done >= handles.length - 1) {
    currentState.status = 'idle';
  }
  await saveState();
}

// ── Search function (injected into search page) ──

function searchAndExtract(keyword, maxResults) {
  // This runs as injected code in the X search page
  return new Promise(async function (resolve) {
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    var candidates = [];
    var seen = new Set();
    var noNewStreak = 0;
    var lastCount = 0;

    while (candidates.length < maxResults && noNewStreak < 3) {
      window.scrollBy({ top: 300 + Math.floor(Math.random() * 700), behavior: 'smooth' });
      await sleep(2000);

      // Find user links
      var links = document.querySelectorAll('a[href^="/"][role="link"]');
      var newUsers = 0;
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        var parts = href.replace(/^\//, '').split('?')[0].split('/');
        if (parts.length !== 1 || parts[0].length < 2 || parts[0].length > 25) continue;
        var handle = parts[0];
        if (handle === 'i' || handle === 'search' || handle === 'home' || handle === 'explore' || handle === 'notifications' || handle === 'messages') continue;
        if (seen.has(handle)) continue;
        seen.add(handle);
        candidates.push({ handle: handle, profileUrl: 'https://x.com/' + handle, foundAt: new Date().toISOString() });
        newUsers++;
        if (candidates.length >= maxResults) break;
      }

      if (newUsers === 0) noNewStreak++; else { noNewStreak = 0; lastCount = links.length; }
    }

    return resolve(candidates);
  });
}

// ── Search pipeline ──

async function executeSearchAndSend() {
  currentState.status = 'searching';
  currentState.errorMessage = null;
  await saveState();

  var config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  var keyword = config.keywords[0];
  if (!keyword) {
    currentState.status = 'error';
    currentState.errorMessage = 'No keyword configured';
    await saveState();
    return;
  }

  // Open search page
  var searchUrl = 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=user';
  var tabs = await chrome.tabs.query({ url: 'https://x.com/search*' });
  var tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: searchUrl, active: true });
  } else {
    tab = await chrome.tabs.create({ url: searchUrl, active: true });
  }
  await new Promise(function (r) { setTimeout(r, 5000); });

  // Inject search extraction
  console.log('[bg] Injecting search script...');
  var result = await injectAndRun(tab.id, searchAndExtract, [keyword, config.maxResults || 100]);

  if (!result || result.error) {
    currentState.status = 'error';
    currentState.errorMessage = 'Search failed: ' + (result && result.error ? result.error : 'no result');
    await saveState();
    return;
  }

  var candidates = result;
  console.log('[bg] Search found ' + candidates.length + ' users');

  if (candidates.length === 0) {
    currentState.status = 'error';
    currentState.errorMessage = 'No users found. Try a different keyword.';
    await saveState();
    return;
  }

  // Store and transition to sending
  await setJSON(KEYS.CANDIDATE_QUEUE, candidates);
  currentState.status = 'sending';
  currentState.progress = { done: 0, total: candidates.length, failed: 0, skipped: 0 };
  await saveState();

  // Send DMs — use the current active search tab or open messages
  console.log('[bg] Search done, starting sends...');

  var config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  var blacklist = (await getJSON(KEYS.BLACKLIST)) || [];

  for (var i = 0; i < candidates.length; i++) {
    var handle = candidates[i].handle;

    if (currentState.status !== 'sending') break;

    var sentToday = await getTodaysCount();
    if (sentToday >= (config.dailyLimit || 200)) {
      currentState.status = 'paused'; await saveState(); break;
    }

    if (blacklist.indexOf(handle) !== -1) {
      currentState.progress.skipped++; await saveState(); continue;
    }

    currentState.currentHandle = handle;
    currentState.progress.done = i;
    await saveState();

    var variant = config.messageTemplates[Math.floor(Math.random() * config.messageTemplates.length)];
    var messageText = variant
      .replace('{username}', handle)
      .replace('{topic}', keyword)
      .replace('{link}', config.link || '');

    // Navigate to messages
    var msgTabs = await chrome.tabs.query({ url: ['https://x.com/messages*', 'https://x.com/i/chat*'] });
    var msgTab;
    if (msgTabs.length > 0) {
      msgTab = msgTabs[0];
      await chrome.tabs.update(msgTab.id, { active: true });
    } else {
      msgTab = await chrome.tabs.create({ url: 'https://x.com/messages', active: true });
    }
    await new Promise(function (r) { setTimeout(r, 3000); });

    console.log('[bg] Sending DM ' + (i+1) + '/' + candidates.length + ' to ' + handle);
    var dmResult = await injectAndRun(msgTab.id, dmSender, [handle, messageText]);
    console.log('[bg] DM ' + (i+1) + ' result:', dmResult);

    if (dmResult && dmResult.status === 'sent') {
      await incrementTodaysCount();
      if (blacklist.indexOf(handle) === -1) { blacklist.push(handle); await setJSON(KEYS.BLACKLIST, blacklist); }
    } else {
      currentState.progress.failed++;
    }

    var interval = (config.interval.min + Math.random() * (config.interval.max - config.interval.min)) * 1000;
    await new Promise(function (r) { setTimeout(r, interval); });
  }

  if (i >= candidates.length) {
    currentState.status = 'idle';
  }
  await saveState();
}

// ── Message handler ──

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === 'task:directSend') {
    var handles = (message.handles || []).map(function (h) { return h.trim().replace(/^@/, ''); }).filter(Boolean);
    if (!handles.length) { sendResponse({ error: 'no_handles' }); return true; }
    executeDirectSend(handles).then(function () { sendResponse({ status: 'started' }); });
    return true;
  }

  if (message.action === 'task:start') {
    executeSearchAndSend().then(function () { sendResponse({ status: 'started' }); });
    return true;
  }

  if (message.action === 'task:pause') {
    currentState.status = 'paused'; saveState().then(function () { sendResponse({ status: 'paused' }); });
    return true;
  }

  if (message.action === 'task:stop') {
    currentState.status = 'idle';
    currentState.progress = { done: 0, total: 0, failed: 0, skipped: 0 };
    saveState().then(function () { sendResponse({ status: 'stopped' }); });
    return true;
  }

  if (message.action === 'task:status') {
    sendResponse(currentState);
    return true;
  }
});

// ── Startup ──

loadState().then(function () {
  console.log('[bg] X Broadcaster ready. State: ' + currentState.status);
});
