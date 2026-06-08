/**
 * Service Worker — orchestrator for the X Broadcaster extension.
 *
 * Responsibilities:
 *  - Forward task commands from popup/dashboard to content scripts
 *  - Track execution state (idle, searching, filtering, sending, paused)
 *  - Manage the send queue through the pipeline
 *  - Enforce daily caps, intervals, active hours
 *  - Handle resume-after-crash via stored progress
 */

// ── Storage keys ──

var KEYS = {
  TASK_CONFIG: 'taskConfig',
  CANDIDATE_QUEUE: 'candidateQueue',
  SEND_QUEUE: 'sendQueue',
  BLACKLIST: 'blacklist',
  EXECUTION_STATE: 'executionState',
  SENT_TODAY: 'sentToday',
  LAST_SEND_DATE: 'lastSendDate',
};

// ── Default config ──

var DEFAULT_CONFIG = {
  keywords: [],
  filterRules: {
    requireAvatar: true,
    requireBio: true,
    minAccountAgeYears: 0,
    minFollowers: 0,
    maxFollowRatio: 5.0,
    topicKeywords: [],
    requireDmsOpen: true,
  },
  messageTemplates: [
    'Hi {username}! Noticed your posts on {topic}. Check this out: {link}',
  ],
  link: '',
  interval: { min: 15, max: 30 },
  commentInterval: { min: 60, max: 120 },
  dailyLimit: 200,
  activeHours: { start: 9, end: 23 },
  followIfNeeded: true,
  enableComments: false,
  commentPostUrls: [],
  maxResults: 100,
};

// ── JSON storage helpers ──

async function getJSON(key) {
  var result = await chrome.storage.local.get([key]);
  if (result[key]) {
    try {
      return JSON.parse(result[key]);
    } catch (e) {
      return result[key];
    }
  }
  return null;
}

async function setJSON(key, value) {
  var obj = {};
  obj[key] = JSON.stringify(value);
  return chrome.storage.local.set(obj);
}

function randomInterval(minS, maxS) {
  var ms = (minS + Math.random() * (maxS - minS)) * 1000;
  return Math.floor(ms);
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
  var count = await getJSON(KEYS.SENT_TODAY);
  return count || 0;
}

async function incrementTodaysCount() {
  var count = await getTodaysCount();
  await setJSON(KEYS.SENT_TODAY, count + 1);
}

// ── Execution state ──

var currentState = {
  status: 'idle',
  taskId: null,
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

function updateProgress(update) {
  Object.assign(currentState.progress, update);
  saveState();
}

// ── Tab messaging helpers ──

async function sendToTab(tabId, action, payload, timeoutMs) {
  timeoutMs = timeoutMs || 10000;
  return new Promise(function (resolve, reject) {
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      reject(new Error('sendToTab timeout: ' + action));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, { action: action, ...payload }, function (response) {
      clearTimeout(timer);
      if (timedOut) return;
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ── Search Phase ──

async function executeSearchPhase() {
  currentState.status = 'searching';
  await saveState();

  var config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  console.log('[bg] Search phase — loaded config. keywords:', config.keywords, 'full config keys:', Object.keys(config));
  var keyword = config.keywords && config.keywords[0];
  if (!keyword) {
    console.warn('[bg] No keyword found. Config:', JSON.stringify(config).substring(0, 200));
    currentState.status = 'error';
    currentState.errorMessage = 'No search keyword configured. Go to Dashboard → Config.';
    await saveState();
    return { error: 'no_keyword' };
  }

  var searchUrl =
    'https://x.com/search?q=' +
    encodeURIComponent(keyword) +
    '&src=typed_query&f=user';

  var tabs = await chrome.tabs.query({ url: 'https://x.com/search*' });
  var tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: searchUrl, active: true });
  } else {
    tab = await chrome.tabs.create({ url: searchUrl, active: true });
  }

  // Wait for page to fully load + content script to initialize
  await new Promise(function (r) { setTimeout(r, 5000); });

  // Use longer timeout for search — it scrolls and can take 30-60s
  var response;
  try {
    response = await sendToTab(tab.id, 'search:start', {
      keyword: keyword,
      maxResults: config.maxResults || 100,
      filterRules: config.filterRules,
    }, 120000);
  } catch (searchErr) {
    console.error('[bg] Search sendToTab failed:', searchErr.message);
    currentState.status = 'error';
    currentState.errorMessage = 'Search tab not ready. Is X logged in? ' + searchErr.message;
    await saveState();
    return { error: 'search_tab_failed' };
  }

  if (!response) {
    console.error('[bg] Search got null/undefined response from content script');
    currentState.status = 'error';
    currentState.errorMessage = 'Search returned empty response. Check X page.';
    await saveState();
    return { error: 'null_response' };
  }

  if (response.status === 'done') {
    // Log diagnostic info from the search page
    if (response.diagnostic) {
      console.log('[bg] Search page diagnostic:', JSON.stringify(response.diagnostic));
      if (response.diagnostic.loginStatus) {
        console.error('[bg] User is NOT logged into X!');
        currentState.status = 'error';
        currentState.errorMessage = 'Not logged into X. Please log in at x.com first.';
        await saveState();
        return { error: 'not_logged_in' };
      }
    }
    if (response.found === 0) {
      console.warn('[bg] Search found 0 users. Page testIds:', response.diagnostic && response.diagnostic.testIds);
    }
    currentState.progress.total = response.total;
    currentState.status = 'filtering';
    console.log('[bg] Search done. Found ' + response.found + ' candidates');
    await saveState();
  } else if (response.status === 'navigating') {
    console.log('[bg] Search page still navigating, retrying...');
    await new Promise(function (r) { setTimeout(r, 5000); });
    return executeSearchPhase();
  } else {
    console.warn('[bg] Search unexpected response:', JSON.stringify(response));
    currentState.status = 'error';
    currentState.errorMessage = 'Unexpected search response: ' + (response.error || JSON.stringify(response));
    await saveState();
    return { error: 'unexpected_response' };
  }

  return response;
}

// ── Filter Phase ──

async function executeFilterPhase() {
  currentState.status = 'filtering';
  await saveState();

  var config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  var candidates = await getJSON(KEYS.CANDIDATE_QUEUE);
  if (!candidates || candidates.length === 0) {
    currentState.status = 'idle';
    await saveState();
    return { error: 'no_candidates' };
  }

  var sendQueue = [];
  var rules = config.filterRules || {};
  var hasDetailedRules =
    rules.minFollowers || (rules.topicKeywords && rules.topicKeywords.length > 0);

  if (!hasDetailedRules) {
    await setJSON(KEYS.SEND_QUEUE, candidates);
    currentState.progress.total = candidates.length;
    currentState.status = 'sending';
    await saveState();
    return { status: 'filtered', count: candidates.length };
  }

  for (var i = 0; i < candidates.length; i++) {
    if (currentState.status !== 'filtering') break;

    try {
      var profileTab = await chrome.tabs.create({
        url: 'https://x.com/' + candidates[i].handle,
        active: false,
      });

      // Wait longer for profile page content script to load
      await new Promise(function (r) { setTimeout(r, 5000); });

      // Retry up to 2 times if content script isn't ready
      var profileData = null;
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          profileData = await sendToTab(profileTab.id, 'profile:extract');
          if (profileData) break;
        } catch (msgErr) {
          console.warn('[bg] Profile extract attempt ' + (attempt + 1) + ' failed for ' + candidates[i].handle + ': ' + msgErr.message);
          if (attempt < 1) await new Promise(function (r) { setTimeout(r, 3000); });
        }
      }

      if (profileData && !profileData.error) {
        var pass = true;
        if (rules.minFollowers && profileData.followers < rules.minFollowers) {
          pass = false;
        }
        if (rules.maxFollowRatio && profileData.followers > 0) {
          var ratio = profileData.following / profileData.followers;
          if (ratio > rules.maxFollowRatio) pass = false;
        }
        if (rules.topicKeywords && rules.topicKeywords.length > 0) {
          var topics = profileData.postTopics || [];
          var hasMatch = rules.topicKeywords.some(function (kw) {
            return topics.some(function (t) {
              return t.toLowerCase().indexOf(kw.toLowerCase()) !== -1;
            });
          });
          if (!hasMatch) pass = false;
        }
        if (rules.requireDmsOpen && !profileData.dmsOpen) pass = false;

        if (pass) {
          var merged = {};
          Object.assign(merged, candidates[i], profileData);
          sendQueue.push(merged);
        }
      }

      chrome.tabs.remove(profileTab.id);
    } catch (err) {
      console.warn('[bg] Filter error for ' + candidates[i].handle + ':', err);
      try { chrome.tabs.remove(profileTab.id); } catch (e2) { /* ignore */ }
    }

    await new Promise(function (r) {
      setTimeout(r, 2000 + Math.random() * 2000);
    });
  }

  await setJSON(KEYS.SEND_QUEUE, sendQueue);
  currentState.progress.total = sendQueue.length;
  currentState.status = 'sending';
  await saveState();

  return { status: 'filtered', count: sendQueue.length };
}

// ── Send Phase ──

async function executeSendPhase() {
  currentState.status = 'sending';
  await saveState();

  var config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  var sendQueue = await getJSON(KEYS.SEND_QUEUE);
  var blacklist = (await getJSON(KEYS.BLACKLIST)) || [];

  if (!sendQueue || sendQueue.length === 0) {
    currentState.status = 'idle';
    await saveState();
    return { status: 'done', message: 'Queue empty' };
  }

  for (var i = currentState.progress.done; i < sendQueue.length; i++) {
    var user = sendQueue[i];

    if (currentState.status !== 'sending') break;

    var sentToday = await getTodaysCount();
    if (sentToday >= (config.dailyLimit || 200)) {
      currentState.status = 'paused';
      await saveState();
      break;
    }

    if (blacklist.indexOf(user.handle) !== -1) {
      updateProgress({ skipped: currentState.progress.skipped + 1 });
      continue;
    }

    if (config.activeHours) {
      var hour = new Date().getHours();
      if (hour < config.activeHours.start || hour > config.activeHours.end) {
        currentState.status = 'paused';
        await saveState();
        break;
      }
    }

    currentState.currentHandle = user.handle;
    updateProgress({ done: i });

    var variants = config.messageTemplates;
    var variant = variants[Math.floor(Math.random() * variants.length)];
    var messageText = variant
      .replace('{username}', user.handle)
      .replace('{followers}', user.followers || '?')
      .replace('{topic}', config.keywords[0] || '')
      .replace('{link}', config.link || '');

    try {
      var tabs = await chrome.tabs.query({ url: 'https://x.com/messages*' });
      var tab;
      if (tabs.length > 0) {
        tab = tabs[0];
        // Activate the tab so X fully loads the DM UI
        await chrome.tabs.update(tab.id, { active: true });
      } else {
        tab = await chrome.tabs.create({
          url: 'https://x.com/messages',
          active: true,
        });
      }

      // Wait for messages page to fully load
      console.log('[bg] Waiting for messages page to load (tab ' + tab.id + ')...');
      await new Promise(function (r) { setTimeout(r, 5000); });

      console.log('[bg] Sending DM to ' + user.handle);
      var result = await sendToTab(tab.id, 'messenger:sendDM', {
        handle: user.handle,
        messageText: messageText,
        followIfNeeded: config.followIfNeeded,
      }, 30000); // 30s timeout for DM send

      if (result && result.status === 'sent') {
        await incrementTodaysCount();
        var currentBlacklist = (await getJSON(KEYS.BLACKLIST)) || [];
        if (currentBlacklist.indexOf(user.handle) === -1) {
          currentBlacklist.push(user.handle);
          await setJSON(KEYS.BLACKLIST, currentBlacklist);
        }
      } else if (result && result.error) {
        updateProgress({ failed: currentState.progress.failed + 1 });
        console.warn('[bg] DM failed for ' + user.handle + ':', result.error);
      }
    } catch (err) {
      updateProgress({ failed: currentState.progress.failed + 1 });
      console.warn('[bg] DM error for ' + user.handle + ':', err);
    }

    var interval = randomInterval(
      config.interval.min,
      config.interval.max
    );
    await new Promise(function (r) { setTimeout(r, interval); });
  }

  // Check if we finished all items naturally (loop completed without break)
  if (i >= sendQueue.length) {
    updateProgress({ done: sendQueue.length });
    currentState.status = 'idle';
  }
  await saveState();
}

// ── Main pipeline ──

async function runPipeline() {
  await loadState();

  if (currentState.status === 'idle') {
    currentState.progress = { done: 0, total: 0, failed: 0, skipped: 0 };
    currentState.errorMessage = null;
    await saveState();
  }

  try {
    if (currentState.status === 'idle' || currentState.status === 'searching') {
      try {
        await executeSearchPhase();
      } catch (e) {
        console.error('[bg] Search phase error:', e);
        currentState.status = 'error';
        currentState.errorMessage = 'Search failed: ' + (e.message || e);
        await saveState();
        return;
      }
    }
    if (currentState.status === 'filtering') {
      try {
        await executeFilterPhase();
      } catch (e) {
        console.error('[bg] Filter phase error:', e);
        currentState.status = 'error';
        currentState.errorMessage = 'Filter failed: ' + (e.message || e);
        await saveState();
        return;
      }
    }
    if (currentState.status === 'sending') {
      try {
        await executeSendPhase();
      } catch (e) {
        console.error('[bg] Send phase error:', e);
        currentState.status = 'error';
        currentState.errorMessage = 'Send failed: ' + (e.message || e);
        await saveState();
        return;
      }
    }
  } catch (err) {
    console.error('[bg] Pipeline error:', err);
    currentState.status = 'error';
    currentState.errorMessage = 'Pipeline: ' + (err.message || err);
    await saveState();
  }
}

// ── Message handlers ──

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  switch (message.action) {
    case 'task:start':
      runPipeline().then(function () {
        sendResponse({ status: 'started' });
      });
      return true;

    case 'task:pause':
      currentState.status = 'paused';
      saveState().then(function () {
        sendResponse({ status: 'paused' });
      });
      return true;

    case 'task:resume':
      currentState.status = 'sending';
      saveState().then(function () {
        runPipeline().then(function () {
          sendResponse({ status: 'resumed' });
        });
      });
      return true;

    case 'task:stop':
      currentState.status = 'idle';
      currentState.progress = { done: 0, total: 0, failed: 0, skipped: 0 };
      saveState().then(function () {
        sendResponse({ status: 'stopped' });
      });
      return true;

    case 'task:status':
      sendResponse(currentState);
      return true;

    case 'task:directSend':
      (async function () {
        var handles = message.handles || [];
        if (!handles.length) {
          sendResponse({ error: 'no_handles' });
          return;
        }

        var config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;

        // Create simple send queue from handles
        var sendQueue = handles.map(function (h) {
          return { handle: h, displayName: '', bio: '', followers: 0, following: 0, postTopics: [], dmsOpen: true, profileUrl: 'https://x.com/' + h };
        });

        // Reset state
        currentState.status = 'sending';
        currentState.progress = { done: 0, total: sendQueue.length, failed: 0, skipped: 0 };
        currentState.errorMessage = null;

        await setJSON(KEYS.SEND_QUEUE, sendQueue);
        await saveState();

        console.log('[bg] Direct send: queued ' + sendQueue.length + ' handles, starting send phase');
        sendResponse({ status: 'started', count: sendQueue.length });

        // Run the send phase directly
        try {
          await executeSendPhase();
        } catch (e) {
          console.error('[bg] Direct send phase error:', e);
          currentState.status = 'error';
          currentState.errorMessage = 'Direct send failed: ' + (e.message || e);
          await saveState();
        }
      })();
      return true;

    case 'messenger:progress':
      console.log(
        '[bg] Messenger progress: ' + message.step + ' for ' + message.handle
      );
      break;
  }
});

// ── Startup ──

loadState().then(function () {
  console.log(
    '[bg] X Broadcaster service worker ready. State: ' + currentState.status
  );
});
