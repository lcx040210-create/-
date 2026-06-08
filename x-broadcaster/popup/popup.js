var $ = function (sel) { return document.querySelector(sel); };

var btnStart = $('#btnStart');
var btnPause = $('#btnPause');
var btnStop = $('#btnStop');
var btnDirectStart = $('#btnDirectStart');
var btnDirectStop = $('#btnDirectStop');
var statusBadge = $('#statusBadge');
var sentToday = $('#sentToday');
var dailyLimit = $('#dailyLimit');
var currentAction = $('#currentAction');
var actionText = $('#actionText');
var directHandles = $('#directHandles');

function setButtons(start, pause, stop) {
  btnStart.disabled = !start;
  btnPause.disabled = !pause;
  btnStop.disabled = !stop;
}

function updateUI(state) {
  statusBadge.textContent = state.status;
  statusBadge.className = 'badge ' + state.status;

  if (state.status === 'sending') {
    setButtons(false, true, true);
    currentAction.classList.remove('hidden');
    actionText.textContent =
      'Sending to ' + (state.currentHandle || '...') +
      ' (' + (state.progress.done || 0) + '/' + (state.progress.total || 0) + ')';
  } else if (state.status === 'paused') {
    setButtons(false, true, true);
    currentAction.classList.add('hidden');
  } else if (state.status === 'searching' || state.status === 'filtering') {
    setButtons(false, false, true);
    currentAction.classList.remove('hidden');
    actionText.textContent = state.status + '...';
  } else if (state.status === 'error') {
    setButtons(true, false, true);
    currentAction.classList.remove('hidden');
    currentAction.style.color = '#f4212e';
    actionText.textContent = state.errorMessage || 'Unknown error';
  } else {
    setButtons(true, false, false);
    currentAction.classList.add('hidden');
  }
}

async function refresh() {
  chrome.runtime.sendMessage({ action: 'task:status' }, function (state) {
    if (chrome.runtime.lastError) return;
    if (state) updateUI(state);
  });

  chrome.storage.local.get(['sentToday', 'taskConfig'], function (result) {
    var today = result.sentToday ? JSON.parse(result.sentToday) : 0;
    var config = result.taskConfig ? JSON.parse(result.taskConfig) : {};
    sentToday.textContent = today;
    dailyLimit.textContent = config.dailyLimit || 200;
  });
}

// ── Direct Send ──

btnDirectStart.addEventListener('click', function () {
  var text = directHandles.value.trim();
  if (!text) return;

  // Parse handles: support @handle, handle, comma-separated, newline-separated
  var handles = text
    .split(/[\n,]+/)
    .map(function (s) { return s.trim().replace(/^@/, ''); })
    .filter(Boolean);

  if (handles.length === 0) return;

  chrome.runtime.sendMessage({
    action: 'task:directSend',
    handles: handles,
  }, function (response) {
    if (chrome.runtime.lastError) return;
    console.log('[popup] Direct send queued:', response);
  });

  directHandles.value = '';
  refresh();
});

btnDirectStop.addEventListener('click', function () {
  chrome.runtime.sendMessage({ action: 'task:stop' });
  refresh();
});

// ── Search-based ──

btnStart.addEventListener('click', function () {
  chrome.runtime.sendMessage({ action: 'task:start' });
  refresh();
});

btnPause.addEventListener('click', function () {
  chrome.runtime.sendMessage({ action: 'task:pause' });
  refresh();
});

btnStop.addEventListener('click', function () {
  chrome.runtime.sendMessage({ action: 'task:stop' });
  refresh();
});

$('#openDashboard').addEventListener('click', function (e) {
  e.preventDefault();
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard/dashboard.html'),
  });
});

refresh();
setInterval(refresh, 3000);
