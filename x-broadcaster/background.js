/**
 * X Broadcaster — API Edition
 * Calls X's internal API directly from the page context.
 * No DOM interaction for text input — uses fetch() with page cookies.
 */

var currentState = {
  status: 'idle', progress: { done: 0, total: 0, failed: 0 },
  currentHandle: null, errorMessage: null,
};

async function g(k) { var r = await chrome.storage.local.get([k]); if (r[k]) { try { return JSON.parse(r[k]); } catch(e) { return r[k]; } } return null; }
async function s(k, v) { var o = {}; o[k] = JSON.stringify(v); return chrome.storage.local.set(o); }
async function save() { await s('executionState', currentState); }

// ── Send DM via X's internal API (runs in page context) ──

function sendDMviaAPI(handle, messageText, ct0) {
  // This runs inside the X page via executeScript — has full cookie access
  return new Promise(async function(resolve) {
    try {
      console.log('[injected] Sending DM to ' + handle + ': ' + messageText.substring(0, 30) + '...');
      // Extract CSRF token from cookies if not provided
      if (!ct0) {
        var match = document.cookie.match(/ct0=([a-f0-9]+)/);
        ct0 = match ? match[1] : '';
      }

      // Try multiple DM API endpoints with different formats
      var endpoints = [
        // JSON format (modern endpoint)
        {
          url: 'https://x.com/i/api/1.1/dm/new2.json',
          headers: {
            'Content-Type': 'application/json',
            'X-Csrf-Token': ct0,
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Twitter-Active-User': 'yes',
            'X-Twitter-Auth-Type': 'OAuth2Session',
          },
          body: JSON.stringify({
            text: messageText,
            participant_screen_names: [handle],
          })
        },
        // Form-encoded (legacy)
        {
          url: 'https://x.com/i/api/1.1/dm/new.json',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Csrf-Token': ct0,
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Twitter-Active-User': 'yes',
            'X-Twitter-Auth-Type': 'OAuth2Session',
          },
          body: 'text=' + encodeURIComponent(messageText) + '&screen_name=' + encodeURIComponent(handle)
        },
        // JSON with recipients
        {
          url: 'https://x.com/i/api/1.1/dm/new2.json',
          headers: {
            'Content-Type': 'application/json',
            'X-Csrf-Token': ct0,
            'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'X-Twitter-Active-User': 'yes',
            'X-Twitter-Auth-Type': 'OAuth2Session',
          },
          body: JSON.stringify({
            text: messageText,
            conversation: { participant_screen_names: [handle] },
          })
        },
      ];

      var debugInfo = ['DM API Test for @' + handle];
      var results = [];
      for (var i = 0; i < endpoints.length; i++) {
        try {
          var e = endpoints[i];
          var resp = await fetch(e.url, {
            method: 'POST',
            headers: e.headers,
            body: e.body,
            credentials: 'include',
          });

          var text = await resp.text();
          results.push({ url: e.url.split('/').pop(), status: resp.status, body: text.substring(0, 200) });

          if (resp.ok) {
            try {
              var data = JSON.parse(text);
              alert('DM SENT to @' + handle + '!\nResponse: ' + text.substring(0, 300));
              return resolve({ status: 'sent', handle: handle, id: data.id || data.id_str });
            } catch(e) {
              alert('DM SENT to @' + handle + ' (non-JSON response)\n' + text.substring(0, 300));
              return resolve({ status: 'sent', handle: handle });
            }
          }
        } catch(e) {
          results.push({ url: 'fetch_error', error: e.message });
        }
      }

      debugInfo.push('ALL FAILED:');
      for (var j = 0; j < results.length; j++) {
        debugInfo.push('  [' + results[j].status + '] ' + results[j].url.split('/').pop() + ': ' + (results[j].body || results[j].error || ''));
      }
      alert(debugInfo.join('\n'));
      resolve({ error: 'all_api_failed', details: results, debug: debugInfo.join('\n') });
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
    currentState.errorMessage = 'Open any x.com page first';
    await save();
    return;
  }

  // Get CSRF token from the page
  var ct0Result = await new Promise(function(resolve) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function() { var m = document.cookie.match(/ct0=([a-f0-9]+)/); return m ? m[1] : ''; },
    }, function(r) { resolve(r && r[0] ? r[0].result : ''); });
  });

  for (var i = 0; i < handles.length; i++) {
    var handle = handles[i];
    if (currentState.status !== 'sending') break;
    if (blacklist.indexOf(handle) !== -1) continue;

    currentState.currentHandle = handle;
    currentState.progress.done = i;
    await save();

    var template = (config.messageTemplates || ['Hi {username}!'])[0];
    var msg = template.replace('{username}', handle).replace('{link}', config.link || '');

    console.log('[bg] API DM to @' + handle);
    var result = await new Promise(function(resolve) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: sendDMviaAPI,
        args: [handle, msg, ct0Result],
      }, function(frameResults) {
        resolve(frameResults && frameResults[0] ? frameResults[0].result : { error: 'injection failed' });
      });
    });

    console.log('[bg] Result:', JSON.stringify(result));
    if (result && result.status === 'sent') {
      if (blacklist.indexOf(handle) === -1) { blacklist.push(handle); await s('blacklist', blacklist); }
    } else {
      currentState.progress.failed++;
      currentState.errorMessage = 'Failed: ' + (result ? (result.error || JSON.stringify(result.details)) : 'no response');
      await save();
    }

    var wait = 15 + Math.random() * 10;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
  }

  currentState.status = 'idle';
  await save();
}

// ── Search (API-based) ──

async function executeSearchAndSend() {
  currentState.status = 'searching'; currentState.errorMessage = null; await save();
  var config = (await g('taskConfig')) || {};
  var keyword = config.keywords && config.keywords[0];
  if (!keyword) { currentState.status = 'error'; currentState.errorMessage = 'No keyword configured'; await save(); return; }

  // Open search page
  var tabs = await chrome.tabs.query({ url: 'https://x.com/search*' });
  var tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=user', active: true });
  } else {
    tab = await chrome.tabs.create({ url: 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=user', active: true });
  }
  await new Promise(function(r) { setTimeout(r, 5000); });

  // Inject search
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

  // Get CSRF token from search page
  var ct0Result = await new Promise(function(resolve) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function() { var m = document.cookie.match(/ct0=([a-f0-9]+)/); return m ? m[1] : ''; },
    }, function(r) { resolve(r && r[0] ? r[0].result : ''); });
  });

  var blacklist = (await g('blacklist')) || [];
  for (var i = 0; i < results.length; i++) {
    var handle = results[i].handle;
    if (currentState.status !== 'sending') break;
    if (blacklist.indexOf(handle) !== -1) continue;

    currentState.currentHandle = handle; currentState.progress.done = i; await save();

    var template = (config.messageTemplates || ['Hi {username}!'])[0];
    var msg = template.replace('{username}', handle).replace('{link}', config.link || '');

    console.log('[bg] API DM ' + (i+1) + '/' + results.length + ' to @' + handle);
    var result = await new Promise(function(resolve) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: sendDMviaAPI,
        args: [handle, msg, ct0Result],
      }, function(frameResults) {
        resolve(frameResults && frameResults[0] ? frameResults[0].result : { error: 'injection failed' });
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
