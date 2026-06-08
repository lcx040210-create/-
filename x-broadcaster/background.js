/**
 * X Broadcaster — Minimal Service Worker
 * Uses chrome.scripting.executeScript for everything. No content script messaging.
 */

var currentState = {
  status: 'idle',
  progress: { done: 0, total: 0, failed: 0 },
  currentHandle: null,
  errorMessage: null,
};

async function getJSON(key) {
  var r = await chrome.storage.local.get([key]);
  if (r[key]) { try { return JSON.parse(r[key]); } catch(e) { return r[key]; } }
  return null;
}

async function setJSON(key, val) {
  var o = {}; o[key] = JSON.stringify(val);
  return chrome.storage.local.set(o);
}

async function saveState() { await setJSON('executionState', currentState); }

// ── Direct Send: inject code into the active tab ──

async function injectAndRun(func, args) {
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return { error: 'no_active_tab' };
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: func,
      args: args || [],
    });
    return results && results[0] ? results[0].result : { error: 'no_result' };
  } catch(e) {
    return { error: e.message };
  }
}

// ── The DM sender (runs in page context) ──

function sendOneDM(handle, messageText) {
  // This function is injected into X pages via executeScript
  return new Promise(function(resolve) {
    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    async function doIt() {
      // Step 1: Press 'n' to open new message dialog (X shortcut)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', keyCode: 78, bubbles: true }));
      await sleep(1500);

      // Step 2: Find the recipient search input
      var searchInput = document.querySelector(
        'input[placeholder*="Search people"], [data-testid="searchPeople"] input, input[aria-label*="Search"]'
      );

      // If not found, try clicking New Message button first
      if (!searchInput) {
        var buttons = document.querySelectorAll('a, button, [role="button"]');
        for (var i = 0; i < buttons.length; i++) {
          var a = (buttons[i].getAttribute('aria-label') || '').toLowerCase();
          if (a.indexOf('new message') !== -1 || a.indexOf('compose') !== -1) {
            buttons[i].click();
            await sleep(1500);
            break;
          }
        }
        searchInput = document.querySelector(
          'input[placeholder*="Search people"], [data-testid="searchPeople"] input'
        );
      }

      if (!searchInput) {
        return resolve({ error: 'no_search_input', msg: 'Could not find DM search box. Are you on the messages page?' });
      }

      // Step 3: Type handle character by character
      searchInput.focus();
      for (var i = 0; i < handle.length; i++) {
        searchInput.value = handle.slice(0, i + 1);
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(40 + Math.random() * 80);
      }
      await sleep(1500);

      // Step 4: Click first search result
      var first = document.querySelector('[data-testid="TypeaheadUser"], [data-testid="cellInnerDiv"]');
      if (first) { first.click(); await sleep(800); }

      // Step 5: Click Next if present
      var next = document.querySelector('[data-testid="nextButton"]');
      if (next) { next.click(); await sleep(800); }

      // Step 6: Type message
      var msgInput = document.querySelector(
        '[data-testid="dmComposerTextInput"], div[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"] [contenteditable="true"]'
      );
      if (!msgInput) {
        return resolve({ error: 'no_msg_input', msg: 'Could not find message input. The user may not accept DMs.' });
      }
      msgInput.focus();
      for (var j = 0; j < messageText.length; j++) {
        msgInput.value = messageText.slice(0, j + 1);
        msgInput.textContent = messageText.slice(0, j + 1);
        msgInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(30 + Math.random() * 80);
      }
      await sleep(500);

      // Step 7: Click send
      var sendBtn = document.querySelector('[data-testid="dmComposerSendButton"], button[aria-label="Send"], [data-testid="tweetButton"]');
      if (!sendBtn) return resolve({ error: 'no_send_btn' });
      sendBtn.click();
      await sleep(1500);

      return resolve({ status: 'sent' });
    }

    doIt().catch(function(e) { resolve({ error: e.message }); });
  });
}

// ── Execute Direct Send ──

async function executeDirectSend(handles) {
  currentState.status = 'sending';
  currentState.progress = { done: 0, total: handles.length, failed: 0 };
  currentState.errorMessage = null;
  await saveState();

  var config = (await getJSON('taskConfig')) || {};
  var blacklist = (await getJSON('blacklist')) || [];

  for (var i = 0; i < handles.length; i++) {
    var handle = handles[i];
    if (currentState.status !== 'sending') break;

    currentState.currentHandle = handle;
    currentState.progress.done = i;
    await saveState();

    var template = (config.messageTemplates || ['Hi {username}!'])[0];
    var msg = template.replace('{username}', handle).replace('{link}', config.link || '');

    console.log('[bg] Sending DM to ' + handle + ': ' + msg);
    var result = await injectAndRun(sendOneDM, [handle, msg]);
    console.log('[bg] Result: ', result);

    if (result && result.status === 'sent') {
      // success — add to blacklist
      if (blacklist.indexOf(handle) === -1) {
        blacklist.push(handle);
        await setJSON('blacklist', blacklist);
      }
    } else {
      currentState.progress.failed++;
      var errMsg = (result && (result.error || result.msg)) || 'unknown';
      console.warn('[bg] DM failed for ' + handle + ': ' + errMsg);
    }

    // Wait between sends
    var wait = (config.interval ? config.interval.min : 15) + Math.random() * 10;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
  }

  if (i >= handles.length) { currentState.status = 'idle'; }
  await saveState();
}

// ── Search & Extract (injected into search page) ──

function searchAndExtract(keyword, maxResults) {
  return new Promise(async function(resolve) {
    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    var results = [];
    var seen = new Set();
    var streak = 0;

    while (results.length < maxResults && streak < 3) {
      window.scrollBy({ top: 300 + Math.random() * 500, behavior: 'smooth' });
      await sleep(2000);

      var links = document.querySelectorAll('a[href^="/"][role="link"]');
      var found = 0;
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        var parts = href.replace(/^\//, '').split('?')[0].split('/');
        if (parts.length !== 1) continue;
        var h = parts[0];
        if (h.length < 2 || h.length > 25) continue;
        if (['i','search','home','explore','notifications','messages'].indexOf(h) !== -1) continue;
        if (seen.has(h)) continue;
        seen.add(h);
        results.push({ handle: h, profileUrl: 'https://x.com/' + h });
        found++;
        if (results.length >= maxResults) break;
      }

      if (found === 0) streak++; else streak = 0;
    }

    resolve(results);
  });
}

// ── Search + Send Pipeline ──

async function executeSearchAndSend() {
  currentState.status = 'searching';
  currentState.errorMessage = null;
  await saveState();

  var config = (await getJSON('taskConfig')) || {};
  var keyword = config.keywords && config.keywords[0];
  if (!keyword) {
    currentState.status = 'error';
    currentState.errorMessage = 'No keyword. Go to Dashboard -> Config first.';
    await saveState();
    return;
  }

  // Open search page
  var tabs = await chrome.tabs.query({ url: 'https://x.com/search*' });
  var tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, {
      url: 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=user',
      active: true
    });
  } else {
    tab = await chrome.tabs.create({
      url: 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=user',
      active: true
    });
  }
  await new Promise(function(r) { setTimeout(r, 5000); });

  // Inject search extraction
  console.log('[bg] Injecting search for: ' + keyword);
  var results = await injectAndRun(searchAndExtract, [keyword, config.maxResults || 100]);
  console.log('[bg] Search results:', results);

  if (!results || results.error) {
    currentState.status = 'error';
    currentState.errorMessage = 'Search failed: ' + (results && results.error);
    await saveState();
    return;
  }

  if (!results.length) {
    currentState.status = 'error';
    currentState.errorMessage = 'No users found. Try a different keyword.';
    await saveState();
    return;
  }

  // Transition to sending
  await setJSON('candidateQueue', results);
  currentState.status = 'sending';
  currentState.progress = { done: 0, total: results.length, failed: 0 };
  await saveState();

  // Now send DMs
  var config = (await getJSON('taskConfig')) || {};
  var blacklist = (await getJSON('blacklist')) || [];

  // Open messages tab first
  var msgTabs = await chrome.tabs.query({ url: ['https://x.com/messages*', 'https://x.com/i/chat*'] });
  var msgTab;
  if (msgTabs.length > 0) {
    msgTab = msgTabs[0];
    await chrome.tabs.update(msgTab.id, { active: true });
  } else {
    msgTab = await chrome.tabs.create({ url: 'https://x.com/messages', active: true });
  }
  await new Promise(function(r) { setTimeout(r, 4000); });

  for (var i = 0; i < results.length; i++) {
    var handle = results[i].handle;
    if (currentState.status !== 'sending') break;

    if (blacklist.indexOf(handle) !== -1) continue;

    currentState.currentHandle = handle;
    currentState.progress.done = i;
    await saveState();

    var template = (config.messageTemplates || ['Hi {username}!'])[0];
    var msg = template.replace('{username}', handle).replace('{link}', config.link || '');

    console.log('[bg] ' + (i+1) + '/' + results.length + ' Sending to ' + handle);
    var result = await injectAndRun(sendOneDM, [handle, msg]);
    console.log('[bg] DM result:', result);

    if (result && result.status === 'sent') {
      if (blacklist.indexOf(handle) === -1) { blacklist.push(handle); await setJSON('blacklist', blacklist); }
    } else {
      currentState.progress.failed++;
    }

    var wait = (config.interval ? config.interval.min : 15) + Math.random() * 10;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
  }

  if (i >= results.length) { currentState.status = 'idle'; }
  await saveState();
}

// ── Message Handler ──

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'task:directSend') {
    var handles = (msg.handles || []).map(function(h) { return h.trim().replace(/^@/, ''); }).filter(Boolean);
    if (!handles.length) { sendResponse({ error: 'no handles' }); return true; }
    executeDirectSend(handles).then(function() { sendResponse({ started: true }); });
    return true;
  }

  if (msg.action === 'task:start') {
    executeSearchAndSend().then(function() { sendResponse({ started: true }); });
    return true;
  }

  if (msg.action === 'task:pause') {
    currentState.status = 'paused'; saveState().then(function() { sendResponse({ paused: true }); });
    return true;
  }

  if (msg.action === 'task:stop') {
    currentState.status = 'idle';
    currentState.progress = { done: 0, total: 0, failed: 0 };
    saveState().then(function() { sendResponse({ stopped: true }); });
    return true;
  }

  if (msg.action === 'task:status') {
    sendResponse(currentState);
    return true;
  }
});

saveState().then(function() {
  console.log('[bg] Ready. State: ' + currentState.status);
});
