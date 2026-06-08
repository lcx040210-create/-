/**
 * X Broadcaster — Clipboard Edition
 * Puts text on clipboard and calls execCommand('paste').
 * React processes paste events natively — no synthetic input needed.
 */

var currentState = {
  status: 'idle', progress: { done: 0, total: 0, failed: 0 },
  currentHandle: null, errorMessage: null,
};

async function g(k) { var r = await chrome.storage.local.get([k]); if (r[k]) { try { return JSON.parse(r[k]); } catch(e) { return r[k]; } } return null; }
async function s(k, v) { var o = {}; o[k] = JSON.stringify(v); return chrome.storage.local.set(o); }
async function save() { await s('executionState', currentState); }

// ── Send one DM via clipboard paste (React trusts paste events) ──

function sendOneDM(handle, messageText) {
  return new Promise(async function(resolve) {
    try {
      var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

      // Step 1: Open new message dialog
      var btn = document.querySelector('a[aria-label*="New"], a[href="/messages/compose"], [data-testid="newDMButton"]');
      if (btn) { btn.click(); await sleep(1500); }
      else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', keyCode: 78, bubbles: true }));
        await sleep(1500);
      }

      // Step 2: Find search input
      var search = document.querySelector('input[placeholder*="Search people"], [data-testid="searchPeople"] input');
      if (!search) { await sleep(1000); search = document.querySelector('input[placeholder*="Search people"], [data-testid="searchPeople"] input'); }
      if (!search) return resolve({ error: 'no_search' });

      // Step 3: Write handle to clipboard and paste it
      search.focus();
      await navigator.clipboard.writeText(handle);
      document.execCommand('paste');
      await sleep(2000);

      // Step 4: Select first result + click Next
      var first = document.querySelector('[data-testid="TypeaheadUser"], [data-testid="cellInnerDiv"]');
      if (first) { first.click(); await sleep(1000); }
      var next = document.querySelector('[data-testid="nextButton"]');
      if (next) { next.click(); await sleep(1000); }

      // Step 5: Find message input and paste message
      var msg = document.querySelector('[data-testid="dmComposerTextInput"], div[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"]');
      if (!msg) { await sleep(2000); msg = document.querySelector('[data-testid="dmComposerTextInput"], div[contenteditable="true"][role="textbox"]'); }
      if (!msg) return resolve({ error: 'no_msg' });

      msg.focus();
      await navigator.clipboard.writeText(messageText);
      document.execCommand('paste');
      await sleep(1000);

      // Step 6: Click send
      var send = document.querySelector('[data-testid="dmComposerSendButton"], [data-testid="tweetButton"]');
      if (!send) {
        var all = document.querySelectorAll('[role="button"], button');
        for (var i = 0; i < all.length; i++) {
          if ((all[i].getAttribute('aria-label') || '').toLowerCase() === 'send') { send = all[i]; break; }
        }
      }
      if (!send) return resolve({ error: 'no_send' });
      send.click();
      await sleep(2000);

      resolve({ status: 'sent' });
    } catch(e) {
      resolve({ error: e.message });
    }
  });
}

// ── Direct Send ──

async function executeDirectSend(handles) {
  currentState.status = 'sending';
  currentState.progress = { done: 0, total: handles.length, failed: 0 };
  currentState.errorMessage = null;
  await save();

  var config = (await g('taskConfig')) || {};
  var blacklist = (await g('blacklist')) || [];
  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs[0];

  if (!tab || !tab.url || tab.url.indexOf('x.com') === -1) {
    currentState.status = 'error';
    currentState.errorMessage = 'Open x.com first';
    await save();
    return;
  }

  for (var i = 0; i < handles.length; i++) {
    var handle = handles[i];
    if (currentState.status !== 'sending') break;
    if (blacklist.indexOf(handle) !== -1) continue;

    currentState.currentHandle = handle;
    currentState.progress.done = i;
    await save();

    var template = (config.messageTemplates || ['Hi {username}!'])[0];
    var msg = template.replace('{username}', handle).replace('{link}', config.link || '');

    console.log('[bg] Clipboard DM to @' + handle);
    var result = await new Promise(function(resolve) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: sendOneDM,
        args: [handle, msg],
      }, function(r) {
        resolve(r && r[0] ? r[0].result : { error: 'injection failed' });
      });
    });

    console.log('[bg] Result:', result);
    if (result && result.status === 'sent') {
      if (blacklist.indexOf(handle) === -1) { blacklist.push(handle); await s('blacklist', blacklist); }
    } else {
      currentState.progress.failed++;
      currentState.errorMessage = result ? (result.error || JSON.stringify(result)) : 'no response';
      await save();
    }

    var wait = 15 + Math.random() * 10;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
  }

  currentState.status = 'idle';
  await save();
}

// ── Search (same as before, DOM extraction from search page) ──

async function executeSearchAndSend() {
  currentState.status = 'searching'; currentState.errorMessage = null; await save();
  var config = (await g('taskConfig')) || {};
  var keyword = config.keywords && config.keywords[0];
  if (!keyword) { currentState.status = 'error'; currentState.errorMessage = 'No keyword configured'; await save(); return; }

  var tabs = await chrome.tabs.query({ url: 'https://x.com/search*' });
  var tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=user', active: true });
  } else {
    tab = await chrome.tabs.create({ url: 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=user', active: true });
  }
  await new Promise(function(r) { setTimeout(r, 5000); });

  var results = await new Promise(function(resolve) {
    chrome.scripting.executeScript({ target: { tabId: tab.id },
      func: function(kw, max) {
        return new Promise(async function(resolve) {
          var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
          var results = []; var seen = new Set(); var streak = 0;
          while (results.length < max && streak < 3) {
            window.scrollBy({ top: 300 + Math.random() * 500, behavior: 'smooth' });
            await sleep(2000);
            var links = document.querySelectorAll('a[href^="/"][role="link"]');
            var found = 0;
            for (var i = 0; i < links.length; i++) {
              var href = (links[i].getAttribute('href') || '').replace(/^\//, '').split('?')[0];
              if (href.indexOf('/') !== -1 || href.length < 2 || href.length > 25) continue;
              if (['i','search','home','explore','notifications','messages'].indexOf(href) !== -1) continue;
              if (seen.has(href)) continue;
              seen.add(href); results.push({ handle: href }); found++;
              if (results.length >= max) break;
            }
            if (found === 0) streak++; else streak = 0;
          }
          resolve(results);
        });
      },
      args: [keyword, config.maxResults || 100],
    }, function(r) { resolve(r && r[0] ? r[0].result : []); });
  });

  if (!results.length) { currentState.status = 'error'; currentState.errorMessage = 'No users found'; await save(); return; }

  await s('candidateQueue', results);
  currentState.status = 'sending';
  currentState.progress = { done: 0, total: results.length, failed: 0 };
  await save();

  // Open messages
  var msgTabs = await chrome.tabs.query({ url: ['https://x.com/messages*', 'https://x.com/i/chat*'] });
  var msgTab;
  if (msgTabs.length > 0) { msgTab = msgTabs[0]; await chrome.tabs.update(msgTab.id, { active: true }); }
  else { msgTab = await chrome.tabs.create({ url: 'https://x.com/messages', active: true }); }
  await new Promise(function(r) { setTimeout(r, 4000); });

  var blacklist = (await g('blacklist')) || [];
  for (var i = 0; i < results.length; i++) {
    var handle = results[i].handle;
    if (currentState.status !== 'sending') break;
    if (blacklist.indexOf(handle) !== -1) continue;

    currentState.currentHandle = handle; currentState.progress.done = i; await save();

    var template = (config.messageTemplates || ['Hi {username}!'])[0];
    var msg = template.replace('{username}', handle).replace('{link}', config.link || '');

    console.log('[bg] DM ' + (i+1) + '/' + results.length + ' to @' + handle);
    var result = await new Promise(function(resolve) {
      chrome.scripting.executeScript({
        target: { tabId: msgTab.id },
        func: sendOneDM,
        args: [handle, msg],
      }, function(r) { resolve(r && r[0] ? r[0].result : { error: 'injection failed' }); });
    });

    if (result && result.status === 'sent') {
      if (blacklist.indexOf(handle) === -1) { blacklist.push(handle); await s('blacklist', blacklist); }
    } else { currentState.progress.failed++; }

    var wait = 15 + Math.random() * 10;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
  }

  currentState.status = 'idle'; await save();
}

// ── Handler ──
chrome.runtime.onMessage.addListener(function(msg, sender, respond) {
  if (msg.action === 'task:directSend') {
    var handles = (msg.handles || []).map(function(h) { return h.trim().replace(/^@/, ''); }).filter(Boolean);
    if (!handles.length) { respond({ error: 'no handles' }); return true; }
    executeDirectSend(handles).then(function() { respond({ started: true }); });
    return true;
  }
  if (msg.action === 'task:start') {
    executeSearchAndSend().then(function() { respond({ started: true }); });
    return true;
  }
  if (msg.action === 'task:pause') { currentState.status = 'paused'; save().then(function() { respond({ paused: true }); }); return true; }
  if (msg.action === 'task:stop') { currentState.status = 'idle'; currentState.progress = { done:0,total:0,failed:0 }; save().then(function() { respond({ stopped: true }); }); return true; }
  if (msg.action === 'task:status') { respond(currentState); return true; }
});

save().then(function() { console.log('[bg] Ready'); });
