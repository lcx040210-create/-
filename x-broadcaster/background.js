/**
 * X Broadcaster — execCommand Edition
 * Uses document.execCommand('insertText') for text input.
 * This triggers React's beforeinput handler — React WILL process it.
 */

var currentState = {
  status: 'idle', progress: { done: 0, total: 0, failed: 0 },
  currentHandle: null, errorMessage: null,
};

async function g(k) { var r = await chrome.storage.local.get([k]); if (r[k]) { try { return JSON.parse(r[k]); } catch(e) { return r[k]; } } return null; }
async function s(k, v) { var o = {}; o[k] = JSON.stringify(v); return chrome.storage.local.set(o); }
async function save() { await s('executionState', currentState); }

// ── The DM sender (injected via executeScript) ──
// Uses execCommand('insertText') which triggers React's beforeinput

function sendOneDM(handle, messageText) {
  return new Promise(function(resolve) {
    var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };

    // Magic: execCommand('insertText') fires beforeinput → React processes it
    function typeText(el, text) {
      el.focus();
      el.click();
      // Try execCommand first (this is what React hooks into)
      document.execCommand('selectAll', false, null);
      var ok = document.execCommand('insertText', false, text);
      // Fallback: direct value assignment + InputEvent
      if (!ok) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          el.value = text;
        } else {
          el.textContent = text; el.innerText = text;
        }
      }
      // Always fire input event
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function run() {
      // Step 1: Open new message dialog
      var btn = document.querySelector('a[aria-label*="New"], a[href="/messages/compose"], [data-testid="composeButton"], [data-testid="newDMButton"]');
      if (!btn) {
        // Try finding by text
        var all = document.querySelectorAll('a, button, [role="button"]');
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].textContent || '').trim();
          var a = (all[i].getAttribute('aria-label') || '').toLowerCase();
          if (t === 'New message' || t === 'New Message' || a.indexOf('new message') !== -1 || a === 'compose') {
            btn = all[i]; break;
          }
        }
      }
      if (btn) { btn.click(); await sleep(1500); }
      else {
        // Fallback: keyboard shortcut 'n'
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', keyCode: 78, bubbles: true }));
        await sleep(1500);
      }

      // Step 2: Type handle into search
      var search = document.querySelector('input[placeholder*="Search people"], [data-testid="searchPeople"] input');
      if (!search) { await sleep(1000); search = document.querySelector('input[placeholder*="Search people"], [data-testid="searchPeople"] input'); }
      if (!search) return resolve({ error: 'no_search', msg: 'No search box found' });

      typeText(search, handle);
      await sleep(2000);

      // Step 3: Select first result
      var first = document.querySelector('[data-testid="TypeaheadUser"], [data-testid="cellInnerDiv"]');
      if (first) { first.click(); await sleep(1000); }

      // Step 4: Next button (if present)
      var next = document.querySelector('[data-testid="nextButton"]');
      if (next) { next.click(); await sleep(1000); }

      // Step 5: Message input
      var msg = document.querySelector('[data-testid="dmComposerTextInput"], div[contenteditable="true"][role="textbox"], [data-testid="tweetTextarea_0"]');
      if (!msg) { await sleep(2000); msg = document.querySelector('[data-testid="dmComposerTextInput"], div[contenteditable="true"][role="textbox"]'); }
      if (!msg) return resolve({ error: 'no_msg', msg: 'No message input found' });

      typeText(msg, messageText);
      await sleep(1000);

      // Step 6: Send button
      var send = document.querySelector('[data-testid="dmComposerSendButton"], [data-testid="tweetButton"]');
      if (!send) {
        var buttons = document.querySelectorAll('[role="button"], button');
        for (var j = 0; j < buttons.length; j++) {
          if ((buttons[j].getAttribute('aria-label') || '').toLowerCase() === 'send') { send = buttons[j]; break; }
        }
      }
      if (!send) return resolve({ error: 'no_send', msg: 'No send button' });

      send.click();
      await sleep(2000);
      resolve({ status: 'sent' });
    }

    run().catch(function(e) { resolve({ error: e.message }); });
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
    currentState.errorMessage = 'Open X messages page first (x.com/messages)';
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

    console.log('[bg] DM to @' + handle);
    var result = await new Promise(function(resolve) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: sendOneDM,
        args: [handle, msg],
      }, function(frameResults) {
        var r = frameResults && frameResults[0] ? frameResults[0].result : null;
        resolve(r || { error: 'script failed' });
      });
    });

    console.log('[bg] Result:', result);
    if (result && result.status === 'sent') {
      if (blacklist.indexOf(handle) === -1) { blacklist.push(handle); await s('blacklist', blacklist); }
    } else {
      currentState.progress.failed++;
    }

    var wait = 15 + Math.random() * 10;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
  }

  currentState.status = 'idle';
  await save();
}

// ── Search ──

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
              if (href.indexOf('/') !== -1) continue;
              if (href.length < 2 || href.length > 25) continue;
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
    }, function(frameResults) {
      resolve(frameResults && frameResults[0] ? frameResults[0].result : []);
    });
  });

  console.log('[bg] Found ' + results.length + ' users');
  if (!results.length) { currentState.status = 'error'; currentState.errorMessage = 'No users found'; await save(); return; }

  await s('candidateQueue', results);
  currentState.status = 'sending';
  currentState.progress = { done: 0, total: results.length, failed: 0 };
  await save();

  // Open messages tab
  var msgTabs = await chrome.tabs.query({ url: ['https://x.com/messages*', 'https://x.com/i/chat*'] });
  var msgTab;
  if (msgTabs.length > 0) {
    msgTab = msgTabs[0]; await chrome.tabs.update(msgTab.id, { active: true });
  } else {
    msgTab = await chrome.tabs.create({ url: 'https://x.com/messages', active: true });
  }
  await new Promise(function(r) { setTimeout(r, 4000); });

  var blacklist = (await g('blacklist')) || [];
  for (var i = 0; i < results.length; i++) {
    var handle = results[i].handle;
    if (currentState.status !== 'sending') break;
    if (blacklist.indexOf(handle) !== -1) continue;

    currentState.currentHandle = handle; currentState.progress.done = i; await save();

    var template = (config.messageTemplates || ['Hi {username}!'])[0];
    var msg = template.replace('{username}', handle).replace('{link}', config.link || '');

    console.log('[bg] ' + (i+1) + '/' + results.length + ' to @' + handle);
    var result = await new Promise(function(resolve) {
      chrome.scripting.executeScript({
        target: { tabId: msgTab.id },
        func: sendOneDM,
        args: [handle, msg],
      }, function(frameResults) {
        resolve(frameResults && frameResults[0] ? frameResults[0].result : null);
      });
    });

    if (result && result.status === 'sent') {
      if (blacklist.indexOf(handle) === -1) { blacklist.push(handle); await s('blacklist', blacklist); }
    } else { currentState.progress.failed++; }

    var wait = 15 + Math.random() * 10;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
  }

  currentState.status = 'idle'; await save();
}

// ── Message Handler ──
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
