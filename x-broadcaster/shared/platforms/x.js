/**
 * X (Twitter) Platform Adapter
 *
 * Implements the PlatformAdapter interface for X.
 * Methods delegate to content scripts via chrome.tabs.sendMessage.
 */

var xAdapter = {
  name: 'x',

  searchUsers: async function (keyword, opts) {
    return { platform: 'x', status: 'delegated_to_content_script' };
  },

  getProfile: async function (handle) {
    return { platform: 'x', status: 'delegated_to_content_script' };
  },

  sendDM: async function (handle, messageText) {
    return { platform: 'x', status: 'delegated_to_content_script' };
  },

  postComment: async function (postUrl, commentText) {
    return { platform: 'x', status: 'delegated_to_content_script' };
  },

  checkRateLimit: async function () {
    var banner =
      document.querySelector('span') ||
      document.querySelector('div[role="alert"]');
    if (banner) {
      var text = banner.textContent.toLowerCase();
      return text.indexOf('rate limit') !== -1 || text.indexOf('limit') !== -1;
    }
    return false;
  },

  checkCaptcha: async function () {
    return !!(
      document.querySelector('[data-testid="ocfChallenge"]') ||
      document.querySelector('iframe[src*="arkoselabs"]')
    );
  },

  checkLoggedIn: async function () {
    return !(
      document.querySelector('[data-testid="loginButton"]') ||
      document.querySelector('a[href="/login"]')
    );
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = xAdapter;
}
