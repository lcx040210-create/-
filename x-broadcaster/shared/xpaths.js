/**
 * X page DOM selector registry.
 *
 * Every selector has:
 *  - name: unique dotted key (e.g. 'search.userCard.handle')
 *  - primary: first-choice CSS selector
 *  - fallback: backup CSS selector if primary fails
 *  - desc: what this selector targets
 *
 * When X changes its markup, only this file needs updating.
 */

const SELECTORS = {
  // ── Search Page ──────────────────────────────────────────
  'search.userCell': {
    primary: '[data-testid="UserCell"]',
    fallback: '[data-testid="cellInnerDiv"] a[role="link"][href^="/"]',
    desc: 'Individual user result card in search results',
  },
  'search.userCard.handle': {
    primary: '[data-testid="UserName"]',
    fallback: 'a[role="link"] span.css-1jxf684',
    desc: '@handle text inside a user card',
  },
  'search.userCard.displayName': {
    primary: '[data-testid="UserDescription"]',
    fallback: 'a[role="link"] span.css-1jxf684:nth-child(1)',
    desc: 'Display name inside a user card',
  },
  'search.userCard.bio': {
    primary: '[data-testid="UserDescription"] + div span',
    fallback: '[data-testid="cellInnerDiv"] div[dir="auto"] span',
    desc: 'Bio snippet inside a user card',
  },
  'search.userCard.avatar': {
    primary: '[data-testid="UserCell"] img[src*="profile_images"]',
    fallback: 'img[draggable="true"][src*="twimg.com"]',
    desc: 'Avatar image element',
  },
  'search.userCard.profileLink': {
    primary: '[data-testid="UserCell"] a[role="link"][href^="/"][tabindex="-1"]',
    fallback: 'a[href^="/"][role="link"]:not([aria-label])',
    desc: 'Link to user profile page',
  },
  'search.resultsContainer': {
    primary: '[data-testid="cellInnerDiv"]',
    fallback: '[aria-label*="Timeline"] div > div',
    desc: 'Container holding search result items',
  },
  'search.noResults': {
    primary: '[data-testid="emptyState"]',
    fallback: 'div[aria-label*="No results"]',
    desc: '"No results found" message',
  },

  // ── Profile Page ─────────────────────────────────────────
  'profile.userName': {
    primary: '[data-testid="UserName"]',
    fallback: 'div[data-testid="UserDescription"] span',
    desc: '@handle on profile page',
  },
  'profile.displayName': {
    primary: '[data-testid="UserDescription"] span',
    fallback: 'h2[role="heading"] span',
    desc: 'Display name on profile page',
  },
  'profile.bio': {
    primary: '[data-testid="UserDescription"]',
    fallback: 'div[data-testid="UserProfileHeader_Items"] ~ div span',
    desc: 'Bio text on profile page',
  },
  'profile.followersCount': {
    primary: 'a[href$="/verified_followers"] span, a[href$="/followers"] span',
    fallback: 'a[href*="followers"] span span',
    desc: 'Follower count on profile page',
  },
  'profile.followingCount': {
    primary: 'a[href$="/following"] span',
    fallback: 'a[href*="following"] span span',
    desc: 'Following count on profile page',
  },
  'profile.joinDate': {
    primary: '[data-testid="UserProfileHeader_Items"] span[data-testid="UserJoinDate"]',
    fallback: 'span[data-testid="UserJoinDate"]',
    desc: '"Joined <date>" text',
  },
  'profile.posts': {
    primary: '[data-testid="tweet"]',
    fallback: 'article[data-testid="tweet"]',
    desc: 'Individual post/tweet on profile timeline',
  },
  'profile.postText': {
    primary: '[data-testid="tweetText"]',
    fallback: 'div[data-testid="tweetText"] span',
    desc: 'Text content of a post',
  },
  'profile.privateAccount': {
    primary: '[data-testid="emptyState"] span',
    fallback: 'span',
    desc: 'Indicator for private/locked accounts',
  },
  'profile.dmButton': {
    primary: '[data-testid="sendDMButton"]',
    fallback: '[data-testid="messageButton"], [aria-label="Message"]',
    desc: 'Message/DM button on profile',
  },

  // ── Messenger / DM Page ──────────────────────────────────
  'messenger.newMessageButton': {
    primary: '[data-testid="newDMButton"]',
    fallback: 'a[aria-label="New message"], a[href="/messages/compose"]',
    desc: '"New message" button',
  },
  'messenger.recipientInput': {
    primary: '[data-testid="searchPeople"] input',
    fallback: 'input[placeholder*="Search people"]',
    desc: 'Search/recipient input in DM compose',
  },
  'messenger.messageInput': {
    primary: '[data-testid="dmComposerTextInput"]',
    fallback: 'div[data-testid="dmComposerTextInput"] [contenteditable]',
    desc: 'Message text input box',
  },
  'messenger.sendButton': {
    primary: '[data-testid="dmComposerSendButton"]',
    fallback: 'button[data-testid="dmComposerSendButton"]',
    desc: 'Send button in DM composer',
  },
  'messenger.sentConfirm': {
    primary: '[data-testid="messageEntry"]:last-child',
    fallback: 'div[data-testid="cellInnerDiv"]:last-child [data-testid="messageEntry"]',
    desc: 'Last sent message bubble (confirmation)',
  },
  'messenger.followRequired': {
    primary: 'span',
    fallback: 'div[role="alert"]',
    desc: 'Indicator that user requires follow before DM',
  },

  // ── Comment / Reply ──────────────────────────────────────
  'comment.replyButton': {
    primary: '[data-testid="reply"]',
    fallback: 'div[aria-label="Reply"]',
    desc: 'Reply button on a post',
  },
  'comment.composerInput': {
    primary: '[data-testid="tweetTextarea_0"]',
    fallback: 'div[data-testid="tweetTextarea_0"] [contenteditable]',
    desc: 'Comment/reply text input',
  },
  'comment.submitButton': {
    primary: '[data-testid="tweetButton"]',
    fallback: 'button[data-testid="tweetButtonInline"]',
    desc: 'Submit reply button',
  },

  // ── Global / Cross-page ──────────────────────────────────
  'global.loginGate': {
    primary: '[data-testid="loginButton"]',
    fallback: 'a[href="/login"]',
    desc: 'Login prompt (indicates user was logged out)',
  },
  'global.rateLimitBanner': {
    primary: 'span',
    fallback: 'div[role="alert"]',
    desc: 'Rate limit warning banner',
  },
  'global.captcha': {
    primary: '[data-testid="ocfChallenge"]',
    fallback: 'iframe[src*="arkoselabs"], iframe[src*="recaptcha"]',
    desc: 'Captcha/verification challenge',
  },
};

/**
 * Query a single element by selector name.
 * Tries primary selector, then fallback.
 * Returns the element or null.
 */
function queryElement(name, root = document) {
  const entry = SELECTORS[name];
  if (!entry) {
    console.warn(`[xpaths] Unknown selector: "${name}"`);
    return null;
  }
  const el = root.querySelector(entry.primary);
  if (el) return el;
  return root.querySelector(entry.fallback);
}

/**
 * Query all matching elements by selector name.
 */
function queryAll(name, root = document) {
  const entry = SELECTORS[name];
  if (!entry) {
    console.warn(`[xpaths] Unknown selector: "${name}"`);
    return [];
  }
  const results = root.querySelectorAll(entry.primary);
  if (results.length > 0) return Array.from(results);
  return Array.from(root.querySelectorAll(entry.fallback));
}

function getSelector(name) {
  const entry = SELECTORS[name];
  return entry ? entry.primary : null;
}

function getEntry(name) {
  return SELECTORS[name] || null;
}

function listSelectors() {
  return Object.keys(SELECTORS);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    queryElement,
    queryAll,
    getSelector,
    getEntry,
    listSelectors,
  };
}
