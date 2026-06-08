var $ = function (sel) { return document.querySelector(sel); };
var $$ = function (sel) { return document.querySelectorAll(sel); };

// ── Tab switching ──

$$('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    $$('.tab').forEach(function (t) { t.classList.remove('active'); });
    $$('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Default config ──

var DEFAULT_CONFIG = {
  keywords: [],
  filterRules: {
    requireAvatar: true,
    requireBio: true,
    minAccountAgeYears: 0,
    minFollowers: 0,
    maxFollowRatio: 3.0,
    topicKeywords: [],
    requireDmsOpen: true,
  },
  messageTemplates: ['Hi {username}! Check {link}'],
  link: '',
  interval: { min: 30, max: 60 },
  commentInterval: { min: 60, max: 120 },
  dailyLimit: 200,
  activeHours: { start: 9, end: 23 },
  followIfNeeded: true,
  enableComments: false,
  commentPostUrls: [],
};

async function loadConfig() {
  var result = await chrome.storage.local.get(['taskConfig']);
  var config = result.taskConfig ? JSON.parse(result.taskConfig) : DEFAULT_CONFIG;

  $('#cfgKeywords').value = (config.keywords || []).join(', ');
  $('#cfgRequireAvatar').checked = config.filterRules.requireAvatar;
  $('#cfgRequireBio').checked = config.filterRules.requireBio;
  $('#cfgMinAccountAge').value = config.filterRules.minAccountAgeYears || 0;
  $('#cfgMinFollowers').value = config.filterRules.minFollowers || 0;
  $('#cfgMaxFollowRatio').value = config.filterRules.maxFollowRatio || 3.0;
  $('#cfgTopicKeywords').value = (config.filterRules.topicKeywords || []).join(', ');
  $('#cfgRequireDmsOpen').checked = config.filterRules.requireDmsOpen !== false;
  $('#cfgMessageTemplates').value = (config.messageTemplates || []).join('\n');
  $('#cfgLink').value = config.link || '';
  $('#cfgFollowIfNeeded').checked = config.followIfNeeded !== false;
  $('#cfgEnableComments').checked = config.enableComments || false;
  $('#cfgCommentPostUrls').value = (config.commentPostUrls || []).join('\n');
  $('#cfgIntervalMin').value = config.interval.min;
  $('#cfgIntervalMax').value = config.interval.max;
  $('#cfgCommentIntervalMin').value = config.commentInterval ? config.commentInterval.min : 60;
  $('#cfgCommentIntervalMax').value = config.commentInterval ? config.commentInterval.max : 120;
  $('#cfgDailyLimit').value = config.dailyLimit;
  $('#cfgActiveStart').value = config.activeHours ? config.activeHours.start : 9;
  $('#cfgActiveEnd').value = config.activeHours ? config.activeHours.end : 23;
}

function collectConfig() {
  return {
    keywords: $('#cfgKeywords').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    filterRules: {
      requireAvatar: $('#cfgRequireAvatar').checked,
      requireBio: $('#cfgRequireBio').checked,
      minAccountAgeYears: parseInt($('#cfgMinAccountAge').value) || 0,
      minFollowers: parseInt($('#cfgMinFollowers').value) || 0,
      maxFollowRatio: parseFloat($('#cfgMaxFollowRatio').value) || 3.0,
      topicKeywords: $('#cfgTopicKeywords').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
      requireDmsOpen: $('#cfgRequireDmsOpen').checked,
    },
    messageTemplates: $('#cfgMessageTemplates').value.split('\n').filter(Boolean),
    link: $('#cfgLink').value.trim(),
    interval: {
      min: parseInt($('#cfgIntervalMin').value) || 30,
      max: parseInt($('#cfgIntervalMax').value) || 60,
    },
    commentInterval: {
      min: parseInt($('#cfgCommentIntervalMin').value) || 60,
      max: parseInt($('#cfgCommentIntervalMax').value) || 120,
    },
    dailyLimit: parseInt($('#cfgDailyLimit').value) || 200,
    activeHours: {
      start: parseInt($('#cfgActiveStart').value) || 9,
      end: parseInt($('#cfgActiveEnd').value) || 23,
    },
    followIfNeeded: $('#cfgFollowIfNeeded').checked,
    enableComments: $('#cfgEnableComments').checked,
    commentPostUrls: $('#cfgCommentPostUrls').value.split('\n').filter(Boolean),
  };
}

$('#btnSaveConfig').addEventListener('click', async function () {
  var config = collectConfig();
  try {
    await chrome.storage.local.set({ taskConfig: JSON.stringify(config) });
    // Verify immediately
    var verify = await chrome.storage.local.get(['taskConfig']);
    console.log('[Dashboard] Saved config. Keywords:', config.keywords, 'Stored:', verify.taskConfig ? 'OK' : 'MISSING');
    $('#saveStatus').textContent = 'Saved!';
    $('#saveStatus').style.color = '#00ba7c';
  } catch (e) {
    console.error('[Dashboard] Save failed:', e);
    $('#saveStatus').textContent = 'Error: ' + e.message;
    $('#saveStatus').style.color = '#f4212e';
  }
  setTimeout(function () { $('#saveStatus').textContent = ''; }, 3000);
});

// ── Candidates Tab ──

async function loadCandidates() {
  var result = await chrome.storage.local.get(['candidateQueue']);
  var candidates = result.candidateQueue ? JSON.parse(result.candidateQueue) : [];
  $('#candidateCount').textContent = candidates.length + ' candidates';
  $('#candidateList').innerHTML = candidates.map(function (c) {
    return '<div class="list-item"><span>@' + c.handle + (c.displayName ? ' — ' + c.displayName : '') + '</span><span style="color:#8b98a5;font-size:11px">' + (c.hasAvatar ? '🖼' : '') + ' ' + (c.hasBio ? '📝' : '') + '</span></div>';
  }).join('');
}

$('#btnClearCandidates').addEventListener('click', async function () {
  await chrome.storage.local.remove(['candidateQueue']);
  loadCandidates();
});

// ── Monitor Tab ──

async function updateMonitor() {
  var state = await new Promise(function (resolve) {
    chrome.storage.local.get(['executionState'], function (r) {
      resolve(r.executionState ? JSON.parse(r.executionState) : null);
    });
  });
  if (!state) return;

  $('#monitorStatus').textContent = state.status;
  $('#monitorStatus').className = 'badge ' + state.status;

  var p = state.progress || {};
  $('#monitorDone').textContent = p.done || 0;
  $('#monitorFailed').textContent = p.failed || 0;
  $('#monitorSkipped').textContent = p.skipped || 0;
  $('#monitorTotal').textContent = p.total || 0;

  var pct = p.total > 0 ? Math.round(((p.done || 0) / p.total) * 100) : 0;
  $('#progressBar').style.width = pct + '%';

  if (state.currentHandle) {
    $('#currentActionDetail').textContent = 'Currently processing: @' + state.currentHandle;
  }
}

// ── Blacklist Tab ──

async function loadBlacklist() {
  var result = await chrome.storage.local.get(['blacklist']);
  var list = result.blacklist ? JSON.parse(result.blacklist) : [];
  $('#blacklistCount').textContent = list.length + ' entries';
  $('#blacklistEntries').innerHTML = list.map(function (h) {
    return '<div class="list-item"><span>@' + h + '</span><button class="btn small danger" data-handle="' + h + '">Remove</button></div>';
  }).join('');

  $$('#blacklistEntries .btn').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var handle = btn.dataset.handle;
      var r = await chrome.storage.local.get(['blacklist']);
      var l = r.blacklist ? JSON.parse(r.blacklist) : [];
      var updated = l.filter(function (h) { return h !== handle; });
      await chrome.storage.local.set({ blacklist: JSON.stringify(updated) });
      loadBlacklist();
    });
  });
}

$('#btnBlacklistAdd').addEventListener('click', async function () {
  var handle = $('#blacklistAddInput').value.trim().replace('@', '');
  if (!handle) return;
  var r = await chrome.storage.local.get(['blacklist']);
  var l = r.blacklist ? JSON.parse(r.blacklist) : [];
  if (l.indexOf(handle) === -1) {
    l.push(handle);
    await chrome.storage.local.set({ blacklist: JSON.stringify(l) });
    $('#blacklistAddInput').value = '';
    loadBlacklist();
  }
});

$('#btnBlacklistClear').addEventListener('click', async function () {
  await chrome.storage.local.set({ blacklist: JSON.stringify([]) });
  loadBlacklist();
});

// ── Init ──

loadConfig();
setInterval(updateMonitor, 3000);

$$('.tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    var tabName = tab.dataset.tab;
    if (tabName === 'candidates') loadCandidates();
    if (tabName === 'blacklist') loadBlacklist();
    if (tabName === 'monitor') updateMonitor();
  });
});
