/**
 * Content script injected on X search pages.
 *
 * Scrolls through search results, extracts user cards,
 * applies Stage 1 quick filter, and stores candidates to chrome.storage.
 */

(function () {
  'use strict';

  var running = false;
  var stopRequested = false;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function log(msg, data) {
    console.log('[search] ' + msg, data || '');
  }

  // ── USER EXTRACTION: Try multiple strategies ──

  /**
   * Strategy 1: data-testid="UserCell" (old X layout)
   */
  function findUserCellsV1() {
    return document.querySelectorAll('[data-testid="UserCell"]');
  }

  /**
   * Strategy 2: Any div containing a link to a user profile and an avatar image
   */
  function findUserCellsV2() {
    // Look for sections/cells that contain profile links + avatar
    var allLinks = document.querySelectorAll('a[href^="/"][role="link"]');
    var cells = [];
    var seen = {};
    for (var i = 0; i < allLinks.length; i++) {
      var link = allLinks[i];
      var href = link.getAttribute('href') || '';
      // Skip non-user links
      if (!href || href === '/' || href.startsWith('/i/') || href.startsWith('/search') || href.startsWith('/hashtag')) continue;

      // Try to find the containing "cell"
      var cell = link.closest('[data-testid="cellInnerDiv"]') ||
                 link.closest('div[data-testid]') ||
                 link.closest('button[data-testid]') ||
                 link.parentElement;

      if (cell) {
        var key = cell.outerHTML.substring(0, 200);
        if (!seen[key]) {
          seen[key] = true;
          cells.push(cell);
        }
      }
    }
    return cells;
  }

  /**
   * Strategy 3: Find any user links with adjacent avatar images
   */
  function findUserCellsV3() {
    var userLinks = document.querySelectorAll('a[href^="/"][role="link"]:not([href*="/status/"]):not([href*="/search"]):not([href*="/i/"])');
    var cells = [];
    for (var i = 0; i < userLinks.length; i++) {
      var href = userLinks[i].getAttribute('href') || '';
      // Must look like @username (only one path segment, no special chars besides _)
      var parts = href.split('/').filter(Boolean);
      if (parts.length !== 1) continue;
      if (parts[0].length < 2 || parts[0].length > 30) continue;
      cells.push(userLinks[i].closest('div') || userLinks[i]);
    }
    return cells;
  }

  // ── Extract user info from a cell ──

  function extractHandleFromHref(href) {
    if (!href) return null;
    var parts = href.replace(/^\//, '').split('?')[0].split('/');
    return parts[0] || null;
  }

  function extractUserFromCell(cell) {
    // Try multiple ways to get handle
    var handle = null;
    var displayName = '';
    var bio = '';

    // Method 1: Find profile link
    var links = cell.querySelectorAll('a[href^="/"][role="link"]');
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var h = extractHandleFromHref(href);
      if (h && h.length >= 2 && h.length <= 30 && !h.includes('/') && h !== 'i' && h !== 'search') {
        handle = h;
        break;
      }
    }

    // Method 2: Find @handle text
    if (!handle) {
      var spans = cell.querySelectorAll('span');
      for (var j = 0; j < spans.length; j++) {
        var text = spans[j].textContent.trim();
        if (text.startsWith('@') && text.length > 1 && text.length < 30) {
          handle = text.replace('@', '');
          break;
        }
      }
    }

    if (!handle) return null;

    // Display name: first long span text
    for (var k = 0; k < (cell.querySelectorAll('span').length || 0); k++) {
      var t = cell.querySelectorAll('span')[k].textContent.trim();
      if (t.length > 1 && t !== '@' + handle && !t.startsWith('@') && !t.startsWith('#')) {
        displayName = t;
        break;
      }
    }

    // Bio: longer text nodes
    var divs = cell.querySelectorAll('div[dir]');
    for (var d = 0; d < divs.length; d++) {
      var dt = divs[d].textContent.trim();
      if (dt.length > 20 && dt.length < 500) {
        bio = dt;
        break;
      }
    }

    return {
      handle: handle,
      displayName: displayName,
      bio: bio,
      hasAvatar: !!cell.querySelector('img[src*="twimg.com"], img[src*="profile"]'),
      hasBio: bio.length > 0,
      profileUrl: 'https://x.com/' + handle,
      foundAt: new Date().toISOString(),
    };
  }

  // ── Quick filter ──

  function quickFilter(user, rules) {
    if (!rules) return true;
    if (rules.requireAvatar && !user.hasAvatar) return false;
    if (rules.requireBio && !user.hasBio) return false;
    return true;
  }

  // ── Save intermediate results ──

  function saveResults(candidates) {
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
          log('Saved ' + candidates.length + ' new candidates (total: ' + updated.length + ')');
        }
      );
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

    log('Starting search for: ' + keyword + ' (max: ' + maxResults + ')');

    while (running && !stopRequested && candidates.length < maxResults) {
      window.scrollBy({ top: 300 + Math.floor(Math.random() * 700), behavior: 'smooth' });
      await sleep(1500 + Math.random() * 1500);

      // Try multiple strategies to find user cells
      var cells = findUserCellsV1();
      if (cells.length === 0) cells = findUserCellsV2();
      if (cells.length === 0) cells = findUserCellsV3();

      var extractedThisRound = 0;
      for (var i = 0; i < cells.length; i++) {
        if (stopRequested || candidates.length >= maxResults) break;

        var user = extractUserFromCell(cells[i]);
        if (!user || seen.has(user.handle)) continue;
        seen.add(user.handle);

        if (!quickFilter(user, filterRules)) continue;

        candidates.push(user);
        extractedThisRound++;
      }

      // Save every 10 users
      if (candidates.length > 0 && candidates.length % 10 === 0) {
        saveResults(candidates.splice(0, candidates.length));
      }

      var currentCount = cells.length;
      if (currentCount === lastCount) {
        noNewResultsStreak++;
        if (noNewResultsStreak >= 3) break;
      } else {
        noNewResultsStreak = 0;
        lastCount = currentCount;
      }

      // Safety: if we've seen 50+ cells but extracted 0 candidates, DOM is wrong
      if (seen.size >= 30 && extractedThisRound === 0 && candidates.length === 0) {
        log('WARNING: Found ' + seen.size + ' cells but 0 valid users — DOM mismatch, stopping');
        break;
      }
    }

    // Save remaining
    if (candidates.length > 0) {
      saveResults(candidates);
    }

    running = false;
    log('Search finished. Total seen: ' + seen.size);
    return seen.size;
  }

  // ── Diagnostic: dump page structure ──

  function diagnosticDump() {
    var info = {
      url: window.location.href,
      title: document.title,
      bodyText: document.body ? document.body.textContent.substring(0, 500) : 'NO BODY',
      testIds: [],
      linkCount: 0,
      userLinks: [],
    };

    // Check if logged in
    var loginBtn = document.querySelector('a[href="/login"], [data-testid="loginButton"]');
    if (loginBtn) {
      info.loginStatus = 'NOT LOGGED IN — see login button';
    }

    // See what data-testids exist
    var allTestIds = document.querySelectorAll('[data-testid]');
    var testIdSet = {};
    for (var i = 0; i < Math.min(allTestIds.length, 50); i++) {
      var tid = allTestIds[i].getAttribute('data-testid');
      testIdSet[tid] = (testIdSet[tid] || 0) + 1;
    }
    info.testIds = Object.keys(testIdSet).slice(0, 20);

    // Count links
    var allLinks = document.querySelectorAll('a[href^="/"]');
    info.linkCount = allLinks.length;

    // First few user-like links
    for (var j = 0; j < Math.min(allLinks.length, 10); j++) {
      info.userLinks.push(allLinks[j].getAttribute('href'));
    }

    return info;
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
        log('Not on search page, navigating to: ' + searchUrl);
        window.location.href = searchUrl;
        sendResponse({ status: 'navigating', url: searchUrl });
        return true;
      }

      log('On search page, starting extraction...');

      // First do a diagnostic dump
      var diag = diagnosticDump();
      log('DIAGNOSTIC', diag);

      // Check for critical issues
      if (diag.loginStatus) {
        sendResponse({
          status: 'done',
          found: 0,
          total: 0,
          error: 'not_logged_in',
          diagnostic: diag,
        });
        return true;
      }

      runSearch(keyword, maxResults, filterRules)
        .then(function (totalSeen) {
          chrome.storage.local.get(['candidateQueue'], function (result) {
            var queue = [];
            var raw = result.candidateQueue;
            if (raw) {
              queue = typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
            log('Done! Found: ' + queue.length + ' candidates, ' + totalSeen + ' unique users seen');
            sendResponse({
              status: 'done',
              found: queue.length,
              total: queue.length,
              seen: totalSeen,
              diagnostic: diag,
            });
          });
        })
        .catch(function (err) {
          log('Search error: ' + (err && err.message));
          sendResponse({
            status: 'done',
            found: 0,
            total: 0,
            error: err && err.message ? err.message : 'unknown',
          });
        });

      return true;
    }

    if (message.action === 'search:stop') {
      stopRequested = true;
      running = false;
      sendResponse({ status: 'stopped' });
      return true;
    }

    // Diagnose the current page
    if (message.action === 'search:diagnose') {
      sendResponse(diagnosticDump());
      return true;
    }
  });
})();
