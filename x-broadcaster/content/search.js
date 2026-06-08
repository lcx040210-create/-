/**
 * Content script injected on X search pages.
 *
 * Listens for messages from the background service worker:
 *  - { action: 'search:start', keyword: '...', maxResults: 100, filterRules: {...} }
 *  - { action: 'search:stop' }
 *
 * Scrolls through search results, extracts user cards,
 * applies Stage 1 quick filter, and stores candidates to chrome.storage.
 */

(function () {
  'use strict';

  var running = false;
  var stopRequested = false;

  var SEL_USER_CELL = 'div[data-testid="UserCell"]';
  var SEL_HANDLE_LINK = 'a[href^="/"][role="link"][tabindex="-1"]';
  var SEL_HANDLE_LINK_FB = 'a[role="link"][href^="/"][tabindex="-1"]';
  var SEL_DISPLAY_NAME = 'span.css-1jxf684';
  var SEL_AVATAR_IMG = 'img[src*="twimg.com"]';

  // ── DOM extraction ──

  function extractHandle(cell) {
    var link = cell.querySelector(SEL_HANDLE_LINK);
    if (!link) link = cell.querySelector(SEL_HANDLE_LINK_FB);
    if (!link) return null;
    var href = link.getAttribute('href');
    if (!href) return null;
    return href.replace(/^\//, '').split('?')[0];
  }

  function extractDisplayName(cell) {
    var el = cell.querySelector(SEL_DISPLAY_NAME);
    return el ? el.textContent.trim() : '';
  }

  function extractBio(cell) {
    var spans = cell.querySelectorAll(
      'div[dir="ltr"] span, div[dir="auto"] span'
    );
    for (var i = 0; i < spans.length; i++) {
      var text = spans[i].textContent.trim();
      if (text.length > 20) return text;
    }
    return '';
  }

  function hasAvatar(cell) {
    return !!cell.querySelector(SEL_AVATAR_IMG);
  }

  function extractUserCard(cell) {
    var handle = extractHandle(cell);
    if (!handle || handle === 'i' || handle.includes(' ') || handle.length < 2) {
      return null;
    }

    return {
      handle: handle,
      displayName: extractDisplayName(cell),
      bio: extractBio(cell),
      hasAvatar: hasAvatar(cell),
      hasBio: false,
      profileUrl: 'https://x.com/' + handle,
      foundAt: new Date().toISOString(),
    };
  }

  // ── Quick filter (Stage 1) ──

  function quickFilter(user, rules) {
    if (!rules) return true;
    if (rules.requireAvatar && !user.hasAvatar) return false;
    if (rules.requireBio && !user.hasBio) return false;
    return true;
  }

  // ── Scrolling helpers ──

  function randomScrollY() {
    return 300 + Math.floor(Math.random() * 700);
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  // ── Main search loop ──

  async function runSearch(keyword, maxResults, filterRules) {
    var seen = new Set();
    var candidates = [];
    var noNewResultsStreak = 0;
    var lastCount = 0;

    running = true;
    stopRequested = false;

    while (running && !stopRequested && candidates.length < maxResults) {
      window.scrollBy({ top: randomScrollY(), behavior: 'smooth' });
      await sleep(1500 + Math.random() * 1500);

      var cells = document.querySelectorAll(SEL_USER_CELL);

      for (var i = 0; i < cells.length; i++) {
        if (stopRequested || candidates.length >= maxResults) break;

        var user = extractUserCard(cells[i]);
        if (!user || seen.has(user.handle)) continue;
        seen.add(user.handle);

        user.hasBio = user.bio.length > 0;

        if (!quickFilter(user, filterRules)) continue;

        candidates.push(user);
      }

      var currentCount = cells.length;
      if (currentCount === lastCount) {
        noNewResultsStreak++;
        if (noNewResultsStreak >= 3) break;
      } else {
        noNewResultsStreak = 0;
        lastCount = currentCount;
      }
    }

    running = false;
    return candidates;
  }

  // ── Message listener ──

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'search:start') {
      var keyword = message.keyword;
      var maxResults = message.maxResults || 100;
      var filterRules = message.filterRules;

      var searchUrl =
        'https://x.com/search?q=' +
        encodeURIComponent(keyword) +
        '&src=typed_query&f=user';

      if (!window.location.href.includes('search?q=')) {
        window.location.href = searchUrl;
        sendResponse({ status: 'navigating', url: searchUrl });
        return true;
      }

      runSearch(keyword, maxResults, filterRules)
        .then(function (candidates) {
          // Always respond, even if 0 results
          chrome.storage.local.get(['candidateQueue'], function (result) {
            var queue = [];
            var raw = result.candidateQueue;
            if (raw) {
              queue = typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
            var updated = queue.concat(candidates);
            chrome.storage.local.set(
              { candidateQueue: JSON.stringify(updated) },
              function () {
                sendResponse({
                  status: 'done',
                  found: candidates.length,
                  total: updated.length,
                });
              }
            );
          });
        })
        .catch(function (err) {
          console.error('[search] runSearch error:', err);
          sendResponse({
            status: 'done',
            found: 0,
            total: 0,
            error: err && err.message ? err.message : 'search_error',
          });
        });

      return true; // keep message channel open
    }

    if (message.action === 'search:stop') {
      stopRequested = true;
      running = false;
      sendResponse({ status: 'stopped' });
      return true;
    }
  });
})();
