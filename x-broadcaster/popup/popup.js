var $ = function (sel) { return document.querySelector(sel); };

var btnStart = $('#btnStart');
var btnPause = $('#btnPause');
var btnStop = $('#btnStop');
var statusBadge = $('#statusBadge');
var sentToday = $('#sentToday');
var dailyLimit = $('#dailyLimit');
var queueRemaining = $('#queueRemaining');
var currentAction = $('#currentAction');
var actionText = $('#actionText');

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

  chrome.storage.local.get(['sendQueue'], function (r) {
    var queue = r.sendQueue ? JSON.parse(r.sendQueue) : [];
    queueRemaining.textContent = queue.length;
  });
}

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
