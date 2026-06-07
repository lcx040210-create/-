/**
 * Content script for X profile pages.
 * Extracts detailed user data: follower count, following count, bio,
 * join date, recent post topics, DM availability.
 *
 * Triggered by message: { action: 'profile:extract' }
 * Responds with extracted user data or error.
 */

(function () {
  'use strict';

  function parseCount(text) {
    if (!text) return 0;
    text = text.replace(/,/g, '');
    if (text.endsWith('K')) return Math.round(parseFloat(text) * 1000);
    if (text.endsWith('M')) return Math.round(parseFloat(text) * 1000000);
    return parseInt(text, 10) || 0;
  }

  function extractFollowers() {
    var link = document.querySelector(
      'a[href$="/followers"], a[href$="/verified_followers"]'
    );
    if (!link) return 0;
    var span = link.querySelector('span span');
    if (span) return parseCount(span.textContent);
    var text = link.textContent;
    var match = text.match(/([\d,.]+[KMB]?)\s*Followers/);
    if (match) return parseCount(match[1]);
    return 0;
  }

  function extractFollowing() {
    var link = document.querySelector('a[href$="/following"]');
    if (!link) return 0;
    var span = link.querySelector('span span');
    if (span) return parseCount(span.textContent);
    return 0;
  }

  function extractBio() {
    var el = document.querySelector('[data-testid="UserDescription"]');
    return el ? el.textContent.trim() : '';
  }

  function extractJoinDate() {
    var el = document.querySelector('span[data-testid="UserJoinDate"]');
    if (!el) return null;
    var match = el.textContent.match(/(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  function extractDisplayName() {
    var el = document.querySelector('[data-testid="UserName"]');
    if (!el) return '';
    var parent = el.closest('div[data-testid="UserName"]') || el.parentElement;
    if (!parent) return '';
    var nestedSpan = parent.querySelector('span');
    return nestedSpan ? nestedSpan.textContent.trim() : '';
  }

  function extractHandle() {
    var el = document.querySelector('[data-testid="UserName"]');
    if (el) {
      var spans = el.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var text = spans[i].textContent.trim();
        if (text.startsWith('@')) return text.replace('@', '');
      }
    }
    var match = window.location.pathname.match(/^\/(\w+)/);
    return match ? match[1] : '';
  }

  function extractPostTopics() {
    var posts = document.querySelectorAll('[data-testid="tweetText"]');
    var topics = {};
    var KEYWORDS = [
      'AI', 'startup', 'tech', 'crypto', 'web3', 'blockchain', 'defi',
      'marketing', 'growth', 'sales', 'design', 'dev', 'engineering',
      'finance', 'investing', 'trading', 'business', 'saas', 'nocode',
      'data', 'product', 'ux', 'mobile', 'cloud', 'security',
    ];
    for (var i = 0; i < posts.length; i++) {
      var text = posts[i].textContent.toLowerCase();
      for (var j = 0; j < KEYWORDS.length; j++) {
        if (text.indexOf(KEYWORDS[j].toLowerCase()) !== -1) {
          topics[KEYWORDS[j]] = true;
        }
      }
    }
    return Object.keys(topics);
  }

  function checkDmsOpen() {
    var dmBtn =
      document.querySelector('[data-testid="sendDMButton"]') ||
      document.querySelector('[data-testid="messageButton"]') ||
      document.querySelector('button[aria-label="Message"]');
    return !!dmBtn;
  }

  function isPrivateAccount() {
    var body = document.body.textContent;
    return (
      body.indexOf('These posts are protected') !== -1 ||
      body.indexOf('These Tweets are protected') !== -1 ||
      body.indexOf('protected their Tweets') !== -1
    );
  }

  function extract() {
    if (isPrivateAccount()) {
      return { error: 'private_account', handle: extractHandle() };
    }

    return {
      handle: extractHandle(),
      displayName: extractDisplayName(),
      bio: extractBio(),
      followers: extractFollowers(),
      following: extractFollowing(),
      joinYear: extractJoinDate(),
      postTopics: extractPostTopics(),
      dmsOpen: checkDmsOpen(),
      profileUrl: window.location.href,
    };
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'profile:extract') {
      sendResponse(extract());
      return true;
    }
  });
})();
