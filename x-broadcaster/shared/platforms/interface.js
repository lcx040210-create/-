/**
 * Platform Adapter Interface
 *
 * Every platform (X, Telegram, Xiaohongshu, TikTok) must implement
 * these seven methods. New platforms are added as files in this directory
 * and registered in the adapter registry.
 *
 * Each method returns { status, data } or { error, message }.
 */

/**
 * Validate that an adapter object implements the required interface.
 * Returns an array of missing method names (empty = valid).
 */
function validateAdapter(adapter, name) {
  var required = [
    'searchUsers',
    'getProfile',
    'sendDM',
    'postComment',
    'checkRateLimit',
    'checkCaptcha',
    'checkLoggedIn',
  ];
  var missing = required.filter(function (method) {
    return typeof adapter[method] !== 'function';
  });
  if (missing.length > 0) {
    console.error(
      '[platforms] Adapter "' + name + '" missing methods: ' + missing.join(', ')
    );
  }
  return missing;
}

// Registry
var adapters = {};

function register(name, adapter) {
  var missing = validateAdapter(adapter, name);
  if (missing.length === 0) {
    adapters[name] = adapter;
    console.log('[platforms] Registered adapter: ' + name);
  }
}

function get(name) {
  return adapters[name] || null;
}

function list() {
  return Object.keys(adapters);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateAdapter: validateAdapter, register: register, get: get, list: list, adapters: adapters };
}
