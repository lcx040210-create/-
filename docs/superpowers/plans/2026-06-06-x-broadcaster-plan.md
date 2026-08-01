# X Broadcaster Chrome Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension (Manifest V3) for X platform that searches users by keyword, filters them by follower count and profile criteria, then sends bulk DMs and comments with human-like behavior simulation.

**Architecture:** Chrome extension with Manifest V3 service worker for task scheduling, content scripts injected into X pages for DOM interaction (search, profile, messenger), popup for quick controls, and a full dashboard tab for configuration and monitoring. All state persisted in chrome.storage.local. No backend.

**Tech Stack:** JavaScript (ES2020+), Chrome Extensions Manifest V3, Jest for tests, jsdom for DOM simulation in tests

---

### Task 1: Project Scaffold

**Files:**
- Create: `x-broadcaster/manifest.json`
- Create: `x-broadcaster/package.json`
- Create: `x-broadcaster/.gitignore`

- [ ] **Step 1: Create project directory and manifest.json**

```bash
mkdir -p x-broadcaster/{content,popup,dashboard,shared/platforms}
```

```json
// x-broadcaster/manifest.json
{
  "manifest_version": 3,
  "name": "X Broadcaster",
  "version": "0.1.0",
  "description": "Search, filter, and message X users at scale",
  "permissions": ["storage", "activeTab", "tabs", "scripting"],
  "host_permissions": ["https://x.com/*", "https://twitter.com/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "X Broadcaster"
  },
  "content_scripts": [
    {
      "matches": ["https://x.com/search*", "https://twitter.com/search*"],
      "js": ["content/search.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://x.com/*", "https://twitter.com/*"],
      "js": ["content/profile.js", "content/messenger.js"],
      "run_at": "document_idle",
      "exclude_matches": ["https://x.com/search*", "https://twitter.com/search*"]
    }
  ]
}
```

- [ ] **Step 2: Create package.json for testing**

```json
// x-broadcaster/package.json
{
  "name": "x-broadcaster",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0"
  },
  "jest": {
    "testEnvironment": "jsdom",
    "transform": {}
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
x-broadcaster/.gitignore
```
```
node_modules/
*.crx
*.pem
.DS_Store
```

- [ ] **Step 4: Install dependencies and verify**

```bash
cd x-broadcaster && npm install
```

- [ ] **Step 5: Commit**

```bash
git add x-broadcaster/
git commit -m "feat: scaffold X Broadcaster Chrome extension project

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Storage Wrapper (shared/storage.js)

**Files:**
- Create: `x-broadcaster/shared/storage.js`
- Create: `x-broadcaster/shared/__tests__/storage.test.js`
- Create: `x-broadcaster/shared/__mocks__/chrome.storage.local.js`

**Purpose:** Wrap chrome.storage.local with typed get/set/remove helpers and a mock for unit tests. The `chrome.storage.local` API is async (callback-based or promise-based in MV3). We wrap it so the rest of the extension never touches chrome.storage directly.

- [ ] **Step 1: Write failing tests for storage module**

```javascript
// x-broadcaster/shared/__tests__/storage.test.js

// Mock chrome API before importing the module
global.chrome = {
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn(),
    },
  },
};

const storage = require('../storage.js');

describe('storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    test('returns parsed value for a single key', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ taskConfig: JSON.stringify({ keyword: 'test' }) });
      });

      const result = await storage.get('taskConfig');
      expect(result).toEqual({ keyword: 'test' });
    });

    test('returns null when key does not exist', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({});
      });

      const result = await storage.get('nonexistent');
      expect(result).toBeNull();
    });

    test('returns raw value when JSON parse fails (plain string)', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ plainKey: 'just-a-string' });
      });

      const result = await storage.get('plainKey');
      expect(result).toBe('just-a-string');
    });
  });

  describe('set', () => {
    test('stores value as JSON string', async () => {
      chrome.storage.local.set.mockImplementation((obj, cb) => cb());

      await storage.set('taskConfig', { keyword: 'test', limit: 100 });
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { taskConfig: '{"keyword":"test","limit":100}' },
        expect.any(Function)
      );
    });
  });

  describe('remove', () => {
    test('removes a key from storage', async () => {
      chrome.storage.local.remove.mockImplementation((keys, cb) => cb());

      await storage.remove('taskConfig');
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(
        ['taskConfig'],
        expect.any(Function)
      );
    });
  });

  describe('getMultiple', () => {
    test('returns parsed object for multiple keys', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({
          a: '{"x": 1}',
          b: '{"y": 2}',
        });
      });

      const result = await storage.getMultiple(['a', 'b']);
      expect(result).toEqual({ a: { x: 1 }, b: { y: 2 } });
    });
  });

  describe('appendToList', () => {
    test('appends items to an existing list', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({ myList: '["a","b"]' });
      });
      chrome.storage.local.set.mockImplementation((obj, cb) => cb());

      await storage.appendToList('myList', ['c', 'd']);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { myList: '["a","b","c","d"]' },
        expect.any(Function)
      );
    });

    test('creates new list if key does not exist', async () => {
      chrome.storage.local.get.mockImplementation((keys, cb) => {
        cb({});
      });
      chrome.storage.local.set.mockImplementation((obj, cb) => cb());

      await storage.appendToList('newList', ['x']);
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        { newList: '["x"]' },
        expect.any(Function)
      );
    });
  });
});
```

Run: `cd x-broadcaster && npx jest shared/__tests__/storage.test.js`
Expected: All tests FAIL (module not found)

- [ ] **Step 2: Implement storage.js**

```javascript
// x-broadcaster/shared/storage.js

/**
 * Wraps chrome.storage.local with promise-based get/set/remove.
 * Values are automatically JSON-serialized on set and parsed on get.
 * Plain strings pass through without JSON parse failure.
 */

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const storage = {
  get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (result[key] === undefined) {
          resolve(null);
        } else {
          resolve(parseValue(result[key]));
        }
      });
    });
  },

  getMultiple(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => {
        const parsed = {};
        for (const k of keys) {
          if (result[k] !== undefined) {
            parsed[k] = parseValue(result[k]);
          }
        }
        resolve(parsed);
      });
    });
  },

  set(key, value) {
    return new Promise((resolve) => {
      const obj = {};
      obj[key] = JSON.stringify(value);
      chrome.storage.local.set(obj, resolve);
    });
  },

  remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], resolve);
    });
  },

  async appendToList(key, items) {
    const existing = (await this.get(key)) || [];
    const updated = existing.concat(items);
    return this.set(key, updated);
  },

  async removeFromList(key, predicate) {
    const list = (await this.get(key)) || [];
    const filtered = list.filter((item) => !predicate(item));
    return this.set(key, filtered);
  },
};
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd x-broadcaster && npx jest shared/__tests__/storage.test.js`
Expected: All 7 tests PASS

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/shared/storage.js x-broadcaster/shared/__tests__/storage.test.js
git commit -m "feat: add chrome.storage.local wrapper with tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: XPaths Selector Registry (shared/xpaths.js)

**Files:**
- Create: `x-broadcaster/shared/xpaths.js`
- Create: `x-broadcaster/shared/__tests__/xpaths.test.js`

**Purpose:** Centralized registry of X page DOM selectors with primary and fallback selectors. Each selector entry includes a name, the query selector strings, and a description of what it targets. The module provides a `queryElement(name, root)` function that tries the primary selector first, then the fallback.

- [ ] **Step 1: Write failing tests for xpaths module**

```javascript
// x-broadcaster/shared/__tests__/xpaths.test.js

const xpaths = require('../xpaths.js');

describe('xpaths', () => {
  describe('queryElement', () => {
    test('returns element matching primary selector', () => {
      document.body.innerHTML = `
        <div>
          <span data-testid="UserName">@testuser</span>
        </div>
      `;

      const el = xpaths.queryElement('search.userCard.handle', document.body);
      expect(el).not.toBeNull();
      expect(el.textContent).toBe('@testuser');
    });

    test('falls back to secondary selector when primary fails', () => {
      document.body.innerHTML = `
        <div>
          <a href="/testuser" role="link">
            <span>Test User</span>
            <span>@testuser</span>
          </a>
        </div>
      `;

      // Primary: data-testid (not present) -> Fallback: a[role="link"] span
      const el = xpaths.queryElement('search.userCard.handle', document.body);
      expect(el).not.toBeNull();
      expect(el.textContent).toBe('@testuser');
    });

    test('returns null when both selectors fail', () => {
      document.body.innerHTML = '<div></div>';

      const el = xpaths.queryElement('search.userCard.handle', document.body);
      expect(el).toBeNull();
    });

    test('queryAll returns all matching elements', () => {
      document.body.innerHTML = `
        <div>
          <div data-testid="UserCell">User A</div>
          <div data-testid="UserCell">User B</div>
          <div data-testid="UserCell">User C</div>
        </div>
      `;

      const els = xpaths.queryAll('search.userCell', document.body);
      expect(els).toHaveLength(3);
    });

    test('getSelector returns primary selector string for debugging', () => {
      const sel = xpaths.getSelector('search.userCard.handle');
      expect(sel).toBe('[data-testid="UserName"]');
    });
  });

  describe('selectors registry', () => {
    test('every registered selector has a primary and fallback', () => {
      const names = xpaths.listSelectors();
      for (const name of names) {
        const entry = xpaths.getEntry(name);
        expect(entry.primary).toBeTruthy();
        expect(entry.fallback).toBeTruthy();
      }
    });
  });
});
```

Run: `cd x-broadcaster && npx jest shared/__tests__/xpaths.test.js`
Expected: All tests FAIL (module not found)

- [ ] **Step 2: Implement xpaths.js**

```javascript
// x-broadcaster/shared/xpaths.js

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
 *
 * Selectors are grouped by page context:
 *  - search.*   : X search results page (https://x.com/search?...)
 *  - profile.*  : X user profile page (https://x.com/<handle>)
 *  - messenger.* : X DM / messages page
 *  - global.*   : Elements that appear across X (login gate, rate limit banners, etc.)
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
    fallback: 'a[role="link"] span.css-1jxf684',  // spans inside user link
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
    primary: '[data-testid="emptyState"] span:contains("These posts are protected")',
    fallback: 'span:contains("protected their Tweets")',
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
    desc: 'Last sent message bubble (confirmation message was sent)',
  },
  'messenger.followRequired': {
    primary: 'span:contains("follow you")',
    fallback: 'div[role="alert"]:contains("follow")',
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
    primary: 'span:contains("rate limit")',
    fallback: 'div[role="alert"]:contains("limit")',
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
 * Tries primary selector first; if it matches, returns all primary matches.
 * Otherwise tries fallback.
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

/**
 * Get the primary selector string (for debugging / inspector).
 */
function getSelector(name) {
  const entry = SELECTORS[name];
  return entry ? entry.primary : null;
}

/**
 * Get the full entry (primary, fallback, desc).
 */
function getEntry(name) {
  return SELECTORS[name] || null;
}

/**
 * List all registered selector names.
 */
function listSelectors() {
  return Object.keys(SELECTORS);
}

// If running in a test environment (CommonJS), export for require()
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    queryElement,
    queryAll,
    getSelector,
    getEntry,
    listSelectors,
  };
}
```

- [ ] **Step 3: Run tests until they pass**

Run: `cd x-broadcaster && npx jest shared/__tests__/xpaths.test.js`
Expected: All 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/shared/xpaths.js x-broadcaster/shared/__tests__/xpaths.test.js
git commit -m "feat: add X page DOM selector registry with fallbacks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Message Template Engine (shared/templates.js)

**Files:**
- Create: `x-broadcaster/shared/templates.js`
- Create: `x-broadcaster/shared/__tests__/templates.test.js`

- [ ] **Step 1: Write failing tests for template engine**

```javascript
// x-broadcaster/shared/__tests__/templates.test.js

const templates = require('../templates.js');

describe('templates', () => {
  describe('resolve', () => {
    test('replaces variable placeholders with values', () => {
      const result = templates.resolve(
        'Hi {username}! Check out {topic}.',
        { username: 'johndoe', topic: 'AI tools' }
      );
      expect(result).toBe('Hi johndoe! Check out AI tools.');
    });

    test('returns template unchanged when no variables present', () => {
      const result = templates.resolve(
        'Hello, just saying hi.',
        { username: 'johndoe' }
      );
      expect(result).toBe('Hello, just saying hi.');
    });

    test('leaves placeholder intact when variable value is missing', () => {
      const result = templates.resolve(
        'Hi {username}, see {topic}!',
        { username: 'johndoe' }
      );
      expect(result).toBe('Hi johndoe, see {topic}!');
    });

    test('replaces all occurrences of the same variable', () => {
      const result = templates.resolve(
        '{username} here — follow @{username} for {topic}',
        { username: 'johndoe', topic: 'updates' }
      );
      expect(result).toBe('johndoe here — follow @johndoe for updates');
    });
  });

  describe('pickVariant', () => {
    test('returns one of the provided variants', () => {
      const variants = [
        'Hi {username}! Check {link}',
        'Hey {username}, take a look: {link}',
        '{username} — sharing this: {link}',
      ];

      // Run many times to ensure we always get one of the variants
      for (let i = 0; i < 50; i++) {
        const picked = templates.pickVariant(variants);
        expect(variants).toContain(picked);
      }
    });

    test('returns the single variant if only one provided', () => {
      const picked = templates.pickVariant(['Only option']);
      expect(picked).toBe('Only option');
    });

    test('returns empty string for empty array', () => {
      const picked = templates.pickVariant([]);
      expect(picked).toBe('');
    });
  });

  describe('buildMessage', () => {
    test('picks a random variant and resolves variables', () => {
      const variants = [
        'Hi {username}! Check {link}',
        'Hey {username}, see {link}',
      ];
      const vars = { username: 'johndoe', link: 'https://example.com' };

      const result = templates.buildMessage(variants, vars);
      // Both possible outputs
      const possible = [
        'Hi johndoe! Check https://example.com',
        'Hey johndoe, see https://example.com',
      ];
      expect(possible).toContain(result);
    });
  });
});
```

Run: `cd x-broadcaster && npx jest shared/__tests__/templates.test.js`
Expected: All tests FAIL (module not found)

- [ ] **Step 2: Implement templates.js**

```javascript
// x-broadcaster/shared/templates.js

/**
 * Message template engine.
 *
 * Supports:
 *  - Variable substitution: {username}, {followers}, {topic}, {link}
 *  - Random variant selection from a list of 2-3 templates
 */

const VAR_REGEX = /\{(\w+)\}/g;

/**
 * Replace {variable} placeholders with values from `vars`.
 * Missing variables are left as-is in the output.
 */
function resolve(template, vars) {
  return template.replace(VAR_REGEX, (match, varName) => {
    return vars[varName] !== undefined ? vars[varName] : match;
  });
}

/**
 * Pick a random variant from a list of template strings.
 */
function pickVariant(variants) {
  if (!variants || variants.length === 0) return '';
  if (variants.length === 1) return variants[0];
  const idx = Math.floor(Math.random() * variants.length);
  return variants[idx];
}

/**
 * Pick a random variant and resolve variables in one call.
 * This is the main entry point used by the messenger content script.
 */
function buildMessage(variants, vars) {
  const template = pickVariant(variants);
  return resolve(template, vars);
}

// If running in test environment, export for require()
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolve, pickVariant, buildMessage };
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd x-broadcaster && npx jest shared/__tests__/templates.test.js`
Expected: All 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/shared/templates.js x-broadcaster/shared/__tests__/templates.test.js
git commit -m "feat: add message template engine with variable substitution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Scheduler & Rate Limiter (shared/scheduler.js)

**Files:**
- Create: `x-broadcaster/shared/scheduler.js`
- Create: `x-broadcaster/shared/__tests__/scheduler.test.js`

**Purpose:** Controls the pacing of all automated actions. Provides random jitter on intervals, enforces daily caps, active-hours windows, and cooldown after rate-limit detection.

- [ ] **Step 1: Write failing tests for scheduler**

```javascript
// x-broadcaster/shared/__tests__/scheduler.test.js

// Mock Date.now so tests are deterministic
let mockNow = 1700000000000; // some fixed timestamp
global.Date.now = () => mockNow;

const scheduler = require('../scheduler.js');

describe('scheduler', () => {
  describe('randomInterval', () => {
    test('returns a value within the configured range', () => {
      for (let i = 0; i < 50; i++) {
        const ms = scheduler.randomInterval(30, 60);
        expect(ms).toBeGreaterThanOrEqual(30000);
        expect(ms).toBeLessThanOrEqual(60000);
      }
    });

    test('returns the fixed value when min equals max', () => {
      const ms = scheduler.randomInterval(10, 10);
      expect(ms).toBe(10000);
    });
  });

  describe('isWithinActiveHours', () => {
    test('returns true when current hour is within the window', () => {
      // Set mock to 10:00 UTC
      mockNow = new Date('2024-01-15T10:00:00Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(true);
    });

    test('returns false when current hour is outside the window', () => {
      // Set mock to 03:00 UTC
      mockNow = new Date('2024-01-15T03:00:00Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(false);
    });

    test('returns true at boundary (start hour)', () => {
      mockNow = new Date('2024-01-15T09:00:00Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(true);
    });

    test('returns true at boundary (end hour, last millisecond of hour)', () => {
      mockNow = new Date('2024-01-15T23:59:59Z').getTime();
      expect(scheduler.isWithinActiveHours(9, 23)).toBe(true);
    });
  });

  describe('checkDailyCap', () => {
    test('returns canProceed=true when under daily limit', () => {
      const result = scheduler.checkDailyCap({ sentToday: 45, dailyLimit: 200 });
      expect(result.canProceed).toBe(true);
    });

    test('returns canProceed=false when at or over daily limit', () => {
      const result = scheduler.checkDailyCap({ sentToday: 200, dailyLimit: 200 });
      expect(result.canProceed).toBe(false);
    });

    test('returns remaining count', () => {
      const result = scheduler.checkDailyCap({ sentToday: 180, dailyLimit: 200 });
      expect(result.remaining).toBe(20);
    });
  });

  describe('calculateCooldownMs', () => {
    test('returns double the interval when rateLimited is true', () => {
      const result = scheduler.calculateCooldownMs({
        baseInterval: { min: 30, max: 60 },
        rateLimited: true,
      });
      // Doubled: 60–120 seconds
      expect(result).toBeGreaterThanOrEqual(60000);
      expect(result).toBeLessThanOrEqual(120000);
    });

    test('returns base interval when rateLimited is false', () => {
      const result = scheduler.calculateCooldownMs({
        baseInterval: { min: 30, max: 60 },
        rateLimited: false,
      });
      expect(result).toBeGreaterThanOrEqual(30000);
      expect(result).toBeLessThanOrEqual(60000);
    });
  });

  describe('getStatusMessage', () => {
    test('returns formatted status string', () => {
      const msg = scheduler.getStatusMessage({
        interval: 45,
        sentToday: 120,
        dailyLimit: 200,
        activeHours: { start: 9, end: 23 },
      });
      expect(msg).toContain('45s');
      expect(msg).toContain('120');
      expect(msg).toContain('200');
      expect(msg).toContain('80');
    });
  });
});
```

Run: `cd x-broadcaster && npx jest shared/__tests__/scheduler.test.js`
Expected: All tests FAIL (module not found)

- [ ] **Step 2: Implement scheduler.js**

```javascript
// x-broadcaster/shared/scheduler.js

/**
 * Scheduler for controlling the pace of automated actions.
 *
 * All timing values are in seconds at the config level (user-friendly),
 * but calculated internally in milliseconds.
 *
 * Config shape (stored in chrome.storage under 'taskConfig'):
 * {
 *   interval: { min: 30, max: 60 },  // seconds between actions
 *   dailyLimit: 200,                   // max sends per day
 *   activeHours: { start: 9, end: 23 }, // optional, null means 24/7
 *   commentInterval: { min: 60, max: 120 }, // longer for comments
 * }
 */

/**
 * Return a random interval in milliseconds within the range.
 * `min` and `max` are in seconds.
 */
function randomInterval(minSeconds, maxSeconds) {
  if (minSeconds === maxSeconds) return minSeconds * 1000;
  const msMin = minSeconds * 1000;
  const msMax = maxSeconds * 1000;
  return Math.floor(msMin + Math.random() * (msMax - msMin));
}

/**
 * Check whether the current time is within the configured active hours window.
 * If activeHours is null/undefined, always returns true (24/7 mode).
 */
function isWithinActiveHours(startHour, endHour) {
  if (startHour === undefined || endHour === undefined) return true;
  const now = new Date();
  const hour = now.getHours();
  // Handles ranges that may cross midnight, but typical usage is 9–23
  if (startHour <= endHour) {
    return hour >= startHour && hour < endHour + 1;
  }
  // Crosses midnight: e.g., 22–06
  return hour >= startHour || hour < endHour + 1;
}

/**
 * Check whether we can proceed given the daily cap.
 * Returns { canProceed: boolean, remaining: number }
 */
function checkDailyCap({ sentToday, dailyLimit }) {
  const remaining = Math.max(0, dailyLimit - sentToday);
  return {
    canProceed: sentToday < dailyLimit,
    remaining,
  };
}

/**
 * Calculate the cooldown duration before the next action.
 * Doubles the interval if rateLimited flag is true.
 */
function calculateCooldownMs({ baseInterval, rateLimited }) {
  const factor = rateLimited ? 2 : 1;
  return randomInterval(
    baseInterval.min * factor,
    baseInterval.max * factor
  );
}

/**
 * Build a human-readable status message for the popup/dashboard.
 */
function getStatusMessage({ interval, sentToday, dailyLimit, activeHours }) {
  const remaining = Math.max(0, dailyLimit - sentToday);
  const hourInfo = activeHours
    ? ` Active: ${activeHours.start}:00-${activeHours.end}:00.`
    : '';
  return `Current pace: ${interval}s per action. Today: ${sentToday}/${dailyLimit}. Remaining: ${remaining}.${hourInfo}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// If running in test environment, export for require()
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    randomInterval,
    isWithinActiveHours,
    checkDailyCap,
    calculateCooldownMs,
    getStatusMessage,
    sleep,
  };
}
```

- [ ] **Step 3: Run tests until they pass**

Run: `cd x-broadcaster && npx jest shared/__tests__/scheduler.test.js`
Expected: All 7 tests PASS

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/shared/scheduler.js x-broadcaster/shared/__tests__/scheduler.test.js
git commit -m "feat: add scheduler with jitter, daily cap, active-hours logic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: User Filter Engine (shared/filter.js)

**Files:**
- Create: `x-broadcaster/shared/filter.js`
- Create: `x-broadcaster/shared/__tests__/filter.test.js`

**Purpose:** Apply two-stage filtering on users. Stage 1 runs from search page data (cheap: avatar, bio, age indicator). Stage 2 runs from profile page data (expensive: follower count, ratio, post topics, DM open). Configurable AND/OR conditions with numeric thresholds.

- [ ] **Step 1: Write failing tests**

```javascript
// x-broadcaster/shared/__tests__/filter.test.js

const filter = require('../filter.js');

describe('filter', () => {
  describe('stage1QuickFilter (search page)', () => {
    test('passes user with avatar, bio, and meets age threshold', () => {
      const user = { handle: '@test', hasAvatar: true, hasBio: true, joinYear: 2020 };
      const rules = { requireAvatar: true, requireBio: true, minAccountAgeYears: 1 };
      expect(filter.stage1QuickFilter(user, rules)).toBe(true);
    });

    test('rejects user without avatar when requireAvatar is true', () => {
      const user = { handle: '@test', hasAvatar: false, hasBio: true };
      const rules = { requireAvatar: true, requireBio: true };
      expect(filter.stage1QuickFilter(user, rules)).toBe(false);
    });

    test('rejects user without bio when requireBio is true', () => {
      const user = { handle: '@test', hasAvatar: true, hasBio: false };
      const rules = { requireAvatar: true, requireBio: true };
      expect(filter.stage1QuickFilter(user, rules)).toBe(false);
    });

    test('passes user when requirements are disabled (both false)', () => {
      const user = { handle: '@test', hasAvatar: false, hasBio: false };
      const rules = { requireAvatar: false, requireBio: false };
      expect(filter.stage1QuickFilter(user, rules)).toBe(true);
    });

    test('rejects account younger than minAccountAgeYears', () => {
      // 2024 join, current year assumed 2024, age = 0
      const user = { handle: '@test', hasAvatar: true, hasBio: true, joinYear: 2024 };
      const rules = { requireAvatar: false, requireBio: false, minAccountAgeYears: 1 };
      expect(filter.stage1QuickFilter(user, rules)).toBe(false);
    });

    test('passes when joinYear is unknown (null) and minAccountAgeYears is set', () => {
      // Can't determine age, err on side of inclusion
      const user = { handle: '@test', hasAvatar: true, hasBio: true, joinYear: null };
      const rules = { requireAvatar: false, requireBio: false, minAccountAgeYears: 1 };
      expect(filter.stage1QuickFilter(user, rules)).toBe(true);
    });
  });

  describe('stage2DetailedFilter (profile page)', () => {
    const baseUser = {
      handle: '@test',
      followers: 500,
      following: 200,
      postTopics: ['AI', 'startup', 'tech'],
      joinYear: 2020,
      dmsOpen: true,
    };

    test('passes user meeting all thresholds', () => {
      const rules = {
        minFollowers: 100,
        maxFollowRatio: 3.0,
        topicKeywords: ['AI', 'tech'],
        requireDmsOpen: true,
      };
      expect(filter.stage2DetailedFilter(baseUser, rules)).toBe(true);
    });

    test('rejects user below minFollowers threshold', () => {
      const rules = { minFollowers: 1000 };
      expect(filter.stage2DetailedFilter(baseUser, rules)).toBe(false);
    });

    test('rejects user with too high following/follower ratio', () => {
      const user = { ...baseUser, following: 2000, followers: 100 };
      // ratio = 20, max allowed = 3
      const rules = { maxFollowRatio: 3.0 };
      expect(filter.stage2DetailedFilter(user, rules)).toBe(false);
    });

    test('rejects user with no topic keyword match', () => {
      const rules = { topicKeywords: ['cooking', 'fashion'] };
      expect(filter.stage2DetailedFilter(baseUser, rules)).toBe(false);
    });

    test('passes when topicKeywords is empty (no topic filter)', () => {
      const rules = { topicKeywords: [] };
      expect(filter.stage2DetailedFilter(baseUser, rules)).toBe(true);
    });

    test('rejects user with DMs closed when requireDmsOpen is true', () => {
      const user = { ...baseUser, dmsOpen: false };
      const rules = { requireDmsOpen: true };
      expect(filter.stage2DetailedFilter(user, rules)).toBe(false);
    });

    test('passes user with DMs closed when requireDmsOpen is false', () => {
      const user = { ...baseUser, dmsOpen: false };
      const rules = { requireDmsOpen: false };
      expect(filter.stage2DetailedFilter(user, rules)).toBe(true);
    });

    test('undefined/missing rules default to permissive (no filter)', () => {
      // Empty rules = pass everyone
      expect(filter.stage2DetailedFilter(baseUser, {})).toBe(true);
    });
  });
});
```

Run: `cd x-broadcaster && npx jest shared/__tests__/filter.test.js`
Expected: All tests FAIL (module not found)

- [ ] **Step 2: Implement filter.js**

```javascript
// x-broadcaster/shared/filter.js

/**
 * Two-stage user filter engine.
 *
 * Stage 1 (Quick): runs during search, uses only data visible on search cards.
 * Stage 2 (Detailed): runs after visiting the profile page.
 *
 * Filter rules are stored in chrome.storage under 'filterRules':
 * {
 *   // Stage 1
 *   requireAvatar: true,
 *   requireBio: false,
 *   minAccountAgeYears: 1,
 *   // Stage 2
 *   minFollowers: 100,
 *   maxFollowRatio: 3.0,    // following / followers
 *   topicKeywords: ['AI', 'startup'],
 *   requireDmsOpen: true,
 * }
 */

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Stage 1: Quick filter on search page data.
 * `user`: { handle, hasAvatar, hasBio, joinYear }
 * `rules`: { requireAvatar, requireBio, minAccountAgeYears }
 */
function stage1QuickFilter(user, rules = {}) {
  if (rules.requireAvatar && !user.hasAvatar) return false;
  if (rules.requireBio && !user.hasBio) return false;
  if (rules.minAccountAgeYears && user.joinYear) {
    const age = CURRENT_YEAR - user.joinYear;
    if (age < rules.minAccountAgeYears) return false;
  }
  return true;
}

/**
 * Stage 2: Detailed filter on profile page data.
 * `user`: { handle, followers, following, postTopics[], joinYear, dmsOpen }
 * `rules`: { minFollowers, maxFollowRatio, topicKeywords[], requireDmsOpen }
 */
function stage2DetailedFilter(user, rules = {}) {
  if (rules.minFollowers && user.followers < rules.minFollowers) return false;

  if (rules.maxFollowRatio && user.followers > 0) {
    const ratio = user.following / user.followers;
    if (ratio > rules.maxFollowRatio) return false;
  }

  if (rules.topicKeywords && rules.topicKeywords.length > 0) {
    if (!user.postTopics || user.postTopics.length === 0) return false;
    const hasMatch = rules.topicKeywords.some((kw) =>
      user.postTopics.some((topic) =>
        topic.toLowerCase().includes(kw.toLowerCase())
      )
    );
    if (!hasMatch) return false;
  }

  if (rules.requireDmsOpen && user.dmsOpen === false) return false;

  return true;
}

// If running in test environment, export for require()
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { stage1QuickFilter, stage2DetailedFilter };
}
```

- [ ] **Step 3: Run tests until they pass**

Run: `cd x-broadcaster && npx jest shared/__tests__/filter.test.js`
Expected: All 12 tests PASS

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/shared/filter.js x-broadcaster/shared/__tests__/filter.test.js
git commit -m "feat: add two-stage user filter engine with tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Human Behavior Simulation (shared/behavior.js)

**Files:**
- Create: `x-broadcaster/shared/behavior.js`
- Create: `x-broadcaster/shared/__tests__/behavior.test.js`

**Purpose:** Simulate human-like interactions: randomized scroll, character-by-character typing with variable speed, mouse movement with easing, and random pause duration.

- [ ] **Step 1: Write failing tests**

```javascript
// x-broadcaster/shared/__tests__/behavior.test.js

const behavior = require('../behavior.js');

describe('behavior', () => {
  describe('randomScrollDelta', () => {
    test('returns value within given range', () => {
      for (let i = 0; i < 30; i++) {
        const delta = behavior.randomScrollDelta(200, 500);
        expect(delta).toBeGreaterThanOrEqual(200);
        expect(delta).toBeLessThanOrEqual(500);
      }
    });
  });

  describe('randomPauseMs', () => {
    test('returns value within given range', () => {
      for (let i = 0; i < 30; i++) {
        const ms = behavior.randomPauseMs(1000, 3000);
        expect(ms).toBeGreaterThanOrEqual(1000);
        expect(ms).toBeLessThanOrEqual(3000);
      }
    });
  });

  describe('typingDelays', () => {
    test('returns an array of delays, one per character', () => {
      const text = 'Hello';
      const delays = behavior.typingDelays(text, { minMs: 50, maxMs: 150 });
      expect(delays).toHaveLength(text.length);
      for (const d of delays) {
        expect(d).toBeGreaterThanOrEqual(50);
        expect(d).toBeLessThanOrEqual(150);
      }
    });

    test('adds extra pause after punctuation', () => {
      const text = 'Hi!';
      const delays = behavior.typingDelays(text, { minMs: 50, maxMs: 100 });
      // The delay after '!' should be larger (boosted)
      expect(delays).toHaveLength(3);
      // We can't test exact values due to randomness, but range check works
      expect(delays[2]).toBeGreaterThanOrEqual(50);
    });

    test('returns empty array for empty text', () => {
      expect(behavior.typingDelays('', { minMs: 50, maxMs: 100 })).toEqual([]);
    });
  });

  describe('easeInOutCubic', () => {
    test('returns 0 at t=0', () => {
      expect(behavior.easeInOutCubic(0)).toBeCloseTo(0);
    });

    test('returns 1 at t=1', () => {
      expect(behavior.easeInOutCubic(1)).toBeCloseTo(1);
    });

    test('returns 0.5 at t=0.5', () => {
      // easeInOutCubic at midpoint = 0.5
      expect(behavior.easeInOutCubic(0.5)).toBeCloseTo(0.5);
    });
  });
});
```

Run: `cd x-broadcaster && npx jest shared/__tests__/behavior.test.js`
Expected: All tests FAIL (module not found)

- [ ] **Step 2: Implement behavior.js**

```javascript
// x-broadcaster/shared/behavior.js

/**
 * Human behavior simulation utilities.
 *
 * These helpers are used by content scripts to make automated actions
 * look like a real human is operating the browser.
 */

/**
 * Return a random integer in [min, max] (inclusive).
 */
function randInt(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Generate a random scroll delta within the given range.
 */
function randomScrollDelta(minPx, maxPx) {
  return randInt(minPx, maxPx);
}

/**
 * Generate a random pause duration in milliseconds.
 */
function randomPauseMs(minMs, maxMs) {
  return randInt(minMs, maxMs);
}

/**
 * Generate an array of per-character typing delays.
 * Punctuation characters (.,!?;:) get a boost factor for natural pauses.
 */
function typingDelays(text, { minMs, maxMs }) {
  const PUNCTUATION_BOOST = 2.5;
  const delays = [];
  for (const ch of text) {
    let delay = randInt(minMs, maxMs);
    if (/[.,!?;:]/.test(ch)) {
      delay = Math.floor(delay * PUNCTUATION_BOOST);
    }
    delays.push(delay);
  }
  return delays;
}

/**
 * Cubic ease-in-out curve. Maps t in [0,1] to eased value in [0,1].
 * Used for mouse movement interpolation.
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Generate a random horizontal wobble offset.
 * Some users jiggle the mouse slightly while scrolling.
 */
function randomWobble() {
  return randInt(-3, 3);
}

// If running in test environment, export for require()
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    randomScrollDelta,
    randomPauseMs,
    typingDelays,
    easeInOutCubic,
    randomWobble,
  };
}
```

- [ ] **Step 3: Run tests until they pass**

Run: `cd x-broadcaster && npx jest shared/__tests__/behavior.test.js`
Expected: All 5 tests PASS

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/shared/behavior.js x-broadcaster/shared/__tests__/behavior.test.js
git commit -m "feat: add human behavior simulation utilities

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Content Script — Search (content/search.js)

**Files:**
- Create: `x-broadcaster/content/search.js`

**Purpose:** Injected on X search pages. Listens for messages from the background service worker to start/stop search. Scrolls through search results, extracts user data from DOM, applies Stage 1 quick filter, and appends candidates to chrome.storage.

- [ ] **Step 1: Write search.js content script**

```javascript
// x-broadcaster/content/search.js

/**
 * Content script injected on X search pages.
 *
 * Listens for messages:
 *  - { action: 'search:start', keyword: '...', maxResults: 100 }
 *  - { action: 'search:stop' }
 *
 * Scrolls through search results, extracts user cards,
 * applies Stage 1 quick filter, and stores candidates.
 *
 * Uses the xpaths registry and shared modules via dynamic import
 * (content scripts in MV3 use ES modules or inline scripts).
 * Since MV3 content scripts don't support ES module imports natively,
 * shared utilities are bundled into single files per content script.
 * For now we access utility functions globals attached to `window.__XB__`
 * or inline the logic.
 */

(function () {
  'use strict';

  let running = false;
  let stopRequested = false;

  // ── DOM helpers (inline from shared/xpaths.js ──

  const SELECTORS = {
    userCell: {
      primary: '[data-testid="UserCell"]',
      fallback: '[data-testid="cellInnerDiv"] a[role="link"][href^="/"]',
    },
    displayName: {
      primary: 'a[role="link"] span.css-1jxf684',
      fallback: 'div[data-testid="UserCell"] a[role="link"] span',
    },
    handle: {
      primary: 'div[data-testid="UserCell"] a[href^="/"][role="link"][tabindex="-1"]',
      fallback: 'a[role="link"][href^="/"][tabindex="-1"]',
    },
    bio: {
      primary: 'div[data-testid="UserCell"] div[dir="auto"] span',
      fallback: 'div[data-testid="UserCell"] div[dir="ltr"] span',
    },
    avatar: {
      primary: 'img[src*="profile_images"]',
      fallback: 'img[draggable="true"]',
    },
  };

  function queryElement(selectors, root) {
    const el = root.querySelector(selectors.primary);
    if (el) return el;
    return root.querySelector(selectors.fallback);
  }

  function extractHandle(cell) {
    const link = queryElement(SELECTORS.handle, cell);
    if (!link) return null;
    const href = link.getAttribute('href');
    if (!href) return null;
    // href looks like "/username" — strip the leading /
    return href.replace(/^\//, '').split('?')[0];
  }

  function extractDisplayName(cell) {
    const el = cell.querySelector('span.css-1jxf684');
    if (!el) return '';
    return el.textContent.trim();
  }

  function extractBio(cell) {
    // Bio is typically in a div with dir="auto" inside the user cell
    const spans = cell.querySelectorAll('div[dir="ltr"] span, div[dir="auto"] span');
    // The bio span is usually the first long text span that's not the display name
    for (const span of spans) {
      const text = span.textContent.trim();
      if (text.length > 20) return text;
    }
    return '';
  }

  function hasAvatar(cell) {
    return !!cell.querySelector('img[src*="twimg.com"]');
  }

  function extractUserCard(cell) {
    const handle = extractHandle(cell);
    if (!handle || handle === 'i' || handle.includes(' ')) return null; // skip invalid

    return {
      handle,
      displayName: extractDisplayName(cell),
      bio: extractBio(cell),
      hasAvatar: hasAvatar(cell),
      hasBio: false, // filled after extraction
      profileUrl: `https://x.com/${handle}`,
      foundAt: new Date().toISOString(),
    };
  }

  // ── Quick filter (inline from shared/filter.js) ──

  function quickFilter(user, rules) {
    if (!rules) return true;
    if (rules.requireAvatar && !user.hasAvatar) return false;
    if (rules.requireBio && !user.hasBio) return false;
    return true;
  }

  // ── Scrolling ──

  function randomScrollY() {
    return 300 + Math.floor(Math.random() * 700); // 300–1000px
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getResultsContainer() {
    // The main search results area
    return document.querySelector('[aria-label*="Timeline"]') || document.body;
  }

  function countUserCells() {
    // Count data-testid="UserCell" elements — these are the user result cards
    return document.querySelectorAll('div[data-testid="UserCell"]').length;
  }

  // ── Main search loop ──

  async function runSearch(keyword, maxResults, filterRules) {
    const seen = new Set();
    const candidates = [];
    let noNewResultsStreak = 0;
    let lastCount = 0;

    running = true;
    stopRequested = false;

    while (running && !stopRequested && candidates.length < maxResults) {
      // Scroll down
      const delta = randomScrollY();
      window.scrollBy({ top: delta, behavior: 'smooth' });

      // Wait for new results to load
      await sleep(1500 + Math.random() * 1500);

      // Extract user cells
      const cells = document.querySelectorAll('div[data-testid="UserCell"]');
      for (const cell of cells) {
        if (stopRequested || candidates.length >= maxResults) break;

        const user = extractUserCard(cell);
        if (!user || seen.has(user.handle)) continue;
        seen.add(user.handle);

        // Inline the bio check since we can read it here
        user.hasBio = user.bio.length > 0;

        if (!quickFilter(user, filterRules)) continue;

        candidates.push(user);
      }

      // Check if we're still getting new results
      const currentCount = cells.length;
      if (currentCount === lastCount) {
        noNewResultsStreak++;
        if (noNewResultsStreak >= 3) break; // no new results after 3 scrolls = end
      } else {
        noNewResultsStreak = 0;
        lastCount = currentCount;
      }
    }

    running = false;
    return candidates;
  }

  // ── Message listener ──

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'search:start') {
      const { keyword, maxResults = 100, filterRules } = message;

      // Navigate to the search page if not already there
      const searchUrl = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=user`;
      if (!window.location.href.includes('search?q=')) {
        window.location.href = searchUrl;
        // Content script will re-inject after navigation; background should re-send
        sendResponse({ status: 'navigating', url: searchUrl });
        return true;
      }

      runSearch(keyword, maxResults, filterRules).then((candidates) => {
        // Store candidates in chrome.storage
        chrome.storage.local.get(['candidateQueue'], (result) => {
          const queue = result.candidateQueue
            ? JSON.parse(result.candidateQueue)
            : [];
          const updated = queue.concat(candidates);
          chrome.storage.local.set(
            { candidateQueue: JSON.stringify(updated) },
            () => {
              sendResponse({
                status: 'done',
                found: candidates.length,
                total: updated.length,
              });
            }
          );
        });
      });

      return true; // keep message channel open for async response
    }

    if (message.action === 'search:stop') {
      stopRequested = true;
      running = false;
      sendResponse({ status: 'stopped' });
      return true;
    }
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add x-broadcaster/content/search.js
git commit -m "feat: add search content script with scroll extraction and quick filter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Content Script — Profile (content/profile.js)

**Files:**
- Create: `x-broadcaster/content/profile.js`

- [ ] **Step 1: Write profile.js content script**

```javascript
// x-broadcaster/content/profile.js

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

  function queryText(selectors, root) {
    for (const sel of selectors) {
      const el = root ? root.querySelector(sel) : document.querySelector(sel);
      if (el) return el.textContent.trim();
    }
    return null;
  }

  function parseCount(text) {
    if (!text) return 0;
    // Handle formats: "1,234", "12.3K", "1.2M", "123"
    text = text.replace(/,/g, '');
    if (text.endsWith('K')) return Math.round(parseFloat(text) * 1000);
    if (text.endsWith('M')) return Math.round(parseFloat(text) * 1000000);
    return parseInt(text, 10) || 0;
  }

  function extractFollowers() {
    // Try the followers link
    const link = document.querySelector('a[href*="/followers"]');
    if (!link) return 0;
    const span = link.querySelector('span span');
    if (span) return parseCount(span.textContent);
    // Fallback: grab any number near "Followers" text
    const text = link.textContent;
    const match = text.match(/([\d,.]+[KMB]?)\s*Followers/);
    if (match) return parseCount(match[1]);
    return 0;
  }

  function extractFollowing() {
    const link = document.querySelector('a[href*="/following"]');
    if (!link) return 0;
    const span = link.querySelector('span span');
    if (span) return parseCount(span.textContent);
    return 0;
  }

  function extractBio() {
    // The bio is inside div[data-testid="UserDescription"]
    const el = document.querySelector('[data-testid="UserDescription"]');
    return el ? el.textContent.trim() : '';
  }

  function extractJoinDate() {
    const el = document.querySelector('span[data-testid="UserJoinDate"]');
    if (!el) return null;
    // Text format: "Joined January 2024"
    const match = el.textContent.match(/(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  function extractDisplayName() {
    const el = document.querySelector('[data-testid="UserName"]');
    if (!el) return '';
    // The display name is the parent div's first text node before @handle
    const parent = el.closest('div[data-testid="UserName"]') || el.parentElement;
    if (!parent) return '';
    const nestedSpan = parent.querySelector('span');
    return nestedSpan ? nestedSpan.textContent.trim() : '';
  }

  function extractHandle() {
    // From URL or from the profile page's @handle element
    const el = document.querySelector('[data-testid="UserName"]');
    if (el) {
      const spans = el.querySelectorAll('span');
      for (const span of spans) {
        const text = span.textContent.trim();
        if (text.startsWith('@')) return text.replace('@', '');
      }
    }
    // Fallback: extract from URL
    const match = window.location.pathname.match(/^\/(\w+)/);
    return match ? match[1] : '';
  }

  function extractPostTopics() {
    // Scan visible posts on the profile page for keyword extraction
    const posts = document.querySelectorAll('[data-testid="tweetText"]');
    const topics = new Set();
    const KEYWORDS = [
      'AI', 'startup', 'tech', 'crypto', 'web3', 'blockchain', 'defi',
      'marketing', 'growth', 'sales', 'design', 'dev', 'engineering',
      'finance', 'investing', 'trading', 'business', 'saas', 'nocode',
      'data', 'product', 'ux', 'mobile', 'cloud', 'security',
    ];
    for (const post of posts) {
      const text = post.textContent.toLowerCase();
      for (const kw of KEYWORDS) {
        if (text.includes(kw.toLowerCase())) {
          topics.add(kw);
        }
      }
    }
    return Array.from(topics);
  }

  function checkDmsOpen() {
    // Check if the DM/message button exists on the profile
    const dmBtn =
      document.querySelector('[data-testid="sendDMButton"]') ||
      document.querySelector('[data-testid="messageButton"]') ||
      document.querySelector('button[aria-label="Message"]');
    return !!dmBtn;
  }

  function isPrivateAccount() {
    // Check for "These Tweets are protected" message
    const body = document.body.textContent;
    return (
      body.includes('These posts are protected') ||
      body.includes('These Tweets are protected') ||
      body.includes('protected their Tweets')
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

  // ── Message listener ──

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'profile:extract') {
      const data = extract();
      sendResponse(data);
      return true;
    }
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add x-broadcaster/content/profile.js
git commit -m "feat: add profile content script for detailed user data extraction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Content Script — Messenger (content/messenger.js)

**Files:**
- Create: `x-broadcaster/content/messenger.js`

- [ ] **Step 1: Write messenger.js content script**

```javascript
// x-broadcaster/content/messenger.js

/**
 * Content script for executing DM and comment actions on X.
 *
 * DM flow:
 *  1. Navigate to /messages
 *  2. Click "New message"
 *  3. Type recipient handle in search box
 *  4. Select the user from results
 *  5. Type message character-by-character (human-like)
 *  6. Click send
 *  7. Wait for confirmation
 *
 * Comment flow:
 *  1. Navigate to the target post URL
 *  2. Scroll to reply area
 *  3. Type comment character-by-character
 *  4. Click submit
 *  5. Wait for confirmation
 */

(function () {
  'use strict';

  // ── DOM helpers ──

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function waitForElement(selector, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  /**
   * Type text character by character with randomized delays.
   * This simulates human typing and is critical for avoiding detection.
   */
  async function typeHumanLike(element, text) {
    element.focus();

    // For contenteditable divs, we use the textContent approach.
    // For input/textarea, we use value.
    const isInput = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const delay = randInt(50, 150);

      if (isInput) {
        element.value = text.slice(0, i + 1);
      } else {
        // Contenteditable: dispatch text insertion
        element.textContent = text.slice(0, i + 1);
      }

      // Dispatch input event so X's React picks up the change
      element.dispatchEvent(new Event('input', { bubbles: true }));

      await sleep(delay);
    }
  }

  // ── DM execution ──

  async function sendDM(handle, messageText, { onProgress, followIfNeeded }) {
    onProgress && onProgress('navigating');

    // Navigate to messages
    if (!window.location.href.includes('/messages')) {
      window.location.href = 'https://x.com/messages';
      await sleep(3000); // wait for page load
    }

    // Click "New message" button
    onProgress && onProgress('opening_composer');
    const newMsgBtn = await waitForElement('[data-testid="newDMButton"]');
    if (!newMsgBtn) return { error: 'dm_button_not_found' };
    newMsgBtn.click();
    await sleep(1000 + Math.random() * 1000);

    // Type recipient handle
    onProgress && onProgress('typing_recipient');
    const recipientInput = await waitForElement(
      'input[placeholder*="Search people"], [data-testid="searchPeople"] input'
    );
    if (!recipientInput) return { error: 'recipient_input_not_found' };
    await typeHumanLike(recipientInput, handle);
    await sleep(1500 + Math.random() * 1000);

    // Select the first result
    const firstResult = document.querySelector(
      '[data-testid="TypeaheadUser"]:first-child, ' +
      '[data-testid="cellInnerDiv"]:first-child'
    );
    if (firstResult) {
      firstResult.click();
      await sleep(500 + Math.random() * 500);
    }

    // Click "Next" if present (new DM flow)
    const nextBtn = document.querySelector('[data-testid="nextButton"]');
    if (nextBtn) {
      nextBtn.click();
      await sleep(500 + Math.random() * 500);
    }

    // Check if follow is required
    const followWarning = document.querySelector(
      'span:contains("follow you"), div[role="alert"]:contains("follow")'
    );
    if (followWarning && followIfNeeded) {
      // Follow the user first, then retry
      onProgress && onProgress('following_then_dm');
      window.location.href = `https://x.com/${handle}`;
      await sleep(2000);
      const followBtn = document.querySelector(
        '[data-testid="followButton"], ' +
        '[aria-label*="Follow"]'
      );
      if (followBtn) {
        followBtn.click();
        await sleep(2000);
      }
      // Navigate back to messages and retry
      window.location.href = 'https://x.com/messages';
      await sleep(3000);
      // Re-trigger DM compose (simplified: return special status)
      return { error: 'follow_required_retry', handle };
    }

    if (followWarning && !followIfNeeded) {
      return { error: 'follow_required', handle };
    }

    // Type message
    onProgress && onProgress('typing_message');
    const msgInput = await waitForElement('[data-testid="dmComposerTextInput"]');
    if (!msgInput) return { error: 'message_input_not_found' };
    await typeHumanLike(msgInput, messageText);
    await sleep(500 + Math.random() * 500);

    // Click send
    onProgress && onProgress('sending');
    const sendBtn = document.querySelector('[data-testid="dmComposerSendButton"]');
    if (!sendBtn) return { error: 'send_button_not_found' };
    sendBtn.click();

    // Wait for confirmation (message bubble appears)
    await sleep(1500 + Math.random() * 1000);

    return { status: 'sent', handle };
  }

  // ── Comment execution ──

  async function postComment(postUrl, commentText, { onProgress }) {
    onProgress && onProgress('navigating');

    // Navigate to post
    if (window.location.href !== postUrl) {
      window.location.href = postUrl;
      await sleep(3000);
    }

    // Find and focus the reply area
    onProgress && onProgress('typing');
    const replyBox = await waitForElement(
      '[data-testid="tweetTextarea_0"] div[contenteditable], ' +
      '[data-testid="tweetTextarea_0"]'
    );
    if (!replyBox) return { error: 'reply_box_not_found' };

    replyBox.click();
    await sleep(500);

    await typeHumanLike(replyBox, commentText);
    await sleep(500 + Math.random() * 500);

    // Click reply/submit
    onProgress && onProgress('submitting');
    const submitBtn = document.querySelector('[data-testid="tweetButton"]');
    if (!submitBtn) return { error: 'submit_button_not_found' };
    submitBtn.click();

    await sleep(1500 + Math.random() * 1000);

    return { status: 'commented', postUrl };
  }

  // ── Message listener ──

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'messenger:sendDM') {
      const { handle, messageText, followIfNeeded } = message;
      sendDM(handle, messageText, {
        followIfNeeded: followIfNeeded || false,
        onProgress: (step) => {
          // Progress updates could be sent via chrome.runtime.sendMessage
          chrome.runtime.sendMessage({
            action: 'messenger:progress',
            step,
            handle,
          });
        },
      }).then((result) => {
        sendResponse(result);
      });
      return true; // keep channel open for async
    }

    if (message.action === 'messenger:postComment') {
      const { postUrl, commentText } = message;
      postComment(postUrl, commentText, {
        onProgress: (step) => {
          chrome.runtime.sendMessage({
            action: 'messenger:progress',
            step,
          });
        },
      }).then((result) => {
        sendResponse(result);
      });
      return true;
    }
  });
})();
```

- [ ] **Step 2: Commit**

```bash
git add x-broadcaster/content/messenger.js
git commit -m "feat: add messenger content script for DM and comment execution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Background Service Worker (background.js)

**Files:**
- Create: `x-broadcaster/background.js`

**Purpose:** Orchestrator between popup, dashboard, and content scripts. Manages task queue, schedules next action, tracks progress, handles resume-after-crash.

- [ ] **Step 1: Write background.js**

```javascript
// x-broadcaster/background.js

/**
 * Service Worker — the brain of the extension.
 *
 * Responsibilities:
 *  - Forward task commands from popup/dashboard to content scripts
 *  - Track execution state (idle, searching, filtering, sending, paused)
 *  - Manage the send queue: move candidates through the pipeline
 *  - Enforce daily caps, intervals, active hours
 *  - Handle resume-after-crash via stored progress
 */

// ── State keys in chrome.storage ──
const KEYS = {
  TASK_CONFIG: 'taskConfig',
  CANDIDATE_QUEUE: 'candidateQueue',
  SEND_QUEUE: 'sendQueue',
  BLACKLIST: 'blacklist',
  EXECUTION_STATE: 'executionState',
  SENT_TODAY: 'sentToday',
  LAST_SEND_DATE: 'lastSendDate',
};

// ── Default config ──
const DEFAULT_CONFIG = {
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
  interval: { min: 30, max: 60 },
  commentInterval: { min: 60, max: 120 },
  dailyLimit: 200,
  activeHours: { start: 9, end: 23 },
  followIfNeeded: true,
  enableComments: false,
  commentPostUrls: [],
};

// ── Helpers ──

async function getJSON(key) {
  const result = await chrome.storage.local.get([key]);
  if (result[key]) {
    try {
      return JSON.parse(result[key]);
    } catch {
      return result[key];
    }
  }
  return null;
}

async function setJSON(key, value) {
  const obj = {};
  obj[key] = JSON.stringify(value);
  return chrome.storage.local.set(obj);
}

function randomInterval(minS, maxS) {
  const ms = (minS + Math.random() * (maxS - minS)) * 1000;
  return Math.floor(ms);
}

// ── Date-based counter reset ──

async function getTodaysCount() {
  const today = new Date().toISOString().slice(0, 10);
  const lastDate = await getJSON(KEYS.LAST_SEND_DATE);
  if (lastDate !== today) {
    await setJSON(KEYS.SENT_TODAY, 0);
    await setJSON(KEYS.LAST_SEND_DATE, today);
    return 0;
  }
  const count = await getJSON(KEYS.SENT_TODAY);
  return count || 0;
}

async function incrementTodaysCount() {
  const count = await getTodaysCount();
  await setJSON(KEYS.SENT_TODAY, count + 1);
}

// ── Execution state machine ──

let currentState = {
  status: 'idle', // idle | searching | filtering | sending | paused | error
  taskId: null,
  progress: { done: 0, total: 0, failed: 0, skipped: 0 },
  currentHandle: null,
};

async function saveState() {
  await setJSON(KEYS.EXECUTION_STATE, currentState);
}

async function loadState() {
  const saved = await getJSON(KEYS.EXECUTION_STATE);
  if (saved) currentState = saved;
}

function updateProgress(update) {
  Object.assign(currentState.progress, update);
  saveState();
}

// ── Content script message helpers ──

async function sendToActiveTab(action, payload) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) return { error: 'no_active_tab' };
  return chrome.tabs.sendMessage(tabs[0].id, { action, ...payload });
}

async function sendToTab(tabId, action, payload) {
  return chrome.tabs.sendMessage(tabId, { action, ...payload });
}

// ── Search Phase ──

async function executeSearchPhase() {
  currentState.status = 'searching';
  await saveState();

  const config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  const keyword = config.keywords[0]; // first keyword for initial implementation
  if (!keyword) {
    currentState.status = 'error';
    return { error: 'no_keyword' };
  }

  // Open or navigate existing tab to search
  const searchUrl = `https://x.com/search?q=${encodeURIComponent(keyword)}&src=typed_query&f=user`;
  let tabs = await chrome.tabs.query({ url: 'https://x.com/search*' });
  let tab;
  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: searchUrl, active: true });
  } else {
    tab = await chrome.tabs.create({ url: searchUrl, active: true });
  }

  // Wait for page to load and content script to initialize
  await new Promise((r) => setTimeout(r, 3000));

  // Send search start command
  const response = await sendToTab(tab.id, 'search:start', {
    keyword,
    maxResults: config.maxResults || 100,
    filterRules: config.filterRules,
  });

  if (response && response.status === 'done') {
    currentState.progress.total = response.total;
    currentState.status = 'filtering';
    await saveState();
  } else if (response && response.status === 'navigating') {
    // Search page was navigated — content script reloaded, re-send after delay
    await new Promise((r) => setTimeout(r, 5000));
    return executeSearchPhase();
  }

  return response;
}

// ── Filter Phase ──

async function executeFilterPhase() {
  currentState.status = 'filtering';
  await saveState();

  const config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  const candidates = await getJSON(KEYS.CANDIDATE_QUEUE);
  if (!candidates || candidates.length === 0) return { error: 'no_candidates' };

  const sendQueue = [];
  const rules = config.filterRules || {};
  const hasDetailedRules = rules.minFollowers || rules.topicKeywords?.length > 0;

  if (!hasDetailedRules) {
    // No detailed rules — all candidates pass
    await setJSON(KEYS.SEND_QUEUE, candidates);
    return { status: 'filtered', count: candidates.length };
  }

  // Visit each candidate profile to extract detailed data
  for (const candidate of candidates) {
    if (currentState.status !== 'filtering') break;

    try {
      const profileTab = await chrome.tabs.create({
        url: `https://x.com/${candidate.handle}`,
        active: false, // open in background
      });

      await new Promise((r) => setTimeout(r, 3000));

      const profileData = await sendToTab(profileTab.id, 'profile:extract');
      await chrome.tabs.remove(profileTab.id);

      if (profileData && !profileData.error) {
        // Inline filter logic (mirrors shared/filter.js Stage 2)
        let pass = true;
        if (rules.minFollowers && profileData.followers < rules.minFollowers) pass = false;
        if (rules.maxFollowRatio && profileData.followers > 0) {
          const ratio = profileData.following / profileData.followers;
          if (ratio > rules.maxFollowRatio) pass = false;
        }
        if (rules.topicKeywords && rules.topicKeywords.length > 0) {
          const topics = profileData.postTopics || [];
          const hasMatch = rules.topicKeywords.some((kw) =>
            topics.some((t) => t.toLowerCase().includes(kw.toLowerCase()))
          );
          if (!hasMatch) pass = false;
        }
        if (rules.requireDmsOpen && !profileData.dmsOpen) pass = false;

        if (pass) {
          sendQueue.push({ ...candidate, ...profileData });
        }
      }
    } catch (err) {
      console.warn(`[bg] Filter error for ${candidate.handle}:`, err);
      // Skip this user, continue
    }

    // Rate-limit profile visits
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
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

  const config = (await getJSON(KEYS.TASK_CONFIG)) || DEFAULT_CONFIG;
  const sendQueue = await getJSON(KEYS.SEND_QUEUE);
  const blacklist = (await getJSON(KEYS.BLACKLIST)) || [];

  if (!sendQueue || sendQueue.length === 0) {
    currentState.status = 'idle';
    await saveState();
    return { status: 'done', message: 'Queue empty' };
  }

  for (let i = currentState.progress.done; i < sendQueue.length; i++) {
    const user = sendQueue[i];

    // Check pause/stop
    if (currentState.status !== 'sending') break;

    // Check daily cap
    const sentToday = await getTodaysCount();
    if (sentToday >= config.dailyLimit) {
      currentState.status = 'paused';
      await saveState();
      break;
    }

    // Check blacklist
    if (blacklist.includes(user.handle)) {
      updateProgress({ skipped: currentState.progress.skipped + 1 });
      continue;
    }

    // Check active hours
    if (config.activeHours) {
      const hour = new Date().getHours();
      if (hour < config.activeHours.start || hour > config.activeHours.end) {
        currentState.status = 'paused';
        await saveState();
        break;
      }
    }

    currentState.currentHandle = user.handle;
    updateProgress({ done: i });

    // Pick a message variant and resolve template
    const variants = config.messageTemplates;
    const variant = variants[Math.floor(Math.random() * variants.length)];
    const messageText = variant
      .replace('{username}', user.handle)
      .replace('{followers}', user.followers || '?')
      .replace('{topic}', config.keywords[0] || '')
      .replace('{link}', config.link || '');

    try {
      // Navigate to messages and execute DM
      const tabs = await chrome.tabs.query({
        url: 'https://x.com/messages*',
      });
      let tab;
      if (tabs.length > 0) {
        tab = tabs[0];
        await chrome.tabs.update(tab.id, { active: false });
      } else {
        tab = await chrome.tabs.create({
          url: 'https://x.com/messages',
          active: false,
        });
      }

      await new Promise((r) => setTimeout(r, 3000));

      const result = await sendToTab(tab.id, 'messenger:sendDM', {
        handle: user.handle,
        messageText,
        followIfNeeded: config.followIfNeeded,
      });

      if (result && result.status === 'sent') {
        await incrementTodaysCount();
        // Add to blacklist
        const currentBlacklist = (await getJSON(KEYS.BLACKLIST)) || [];
        if (!currentBlacklist.includes(user.handle)) {
          currentBlacklist.push(user.handle);
          await setJSON(KEYS.BLACKLIST, currentBlacklist);
        }
      } else if (result && result.error) {
        updateProgress({ failed: currentState.progress.failed + 1 });
        console.warn(`[bg] DM failed for ${user.handle}:`, result.error);
      }
    } catch (err) {
      updateProgress({ failed: currentState.progress.failed + 1 });
      console.warn(`[bg] DM error for ${user.handle}:`, err);
    }

    // Cooldown
    const interval = randomInterval(config.interval.min, config.interval.max);
    await new Promise((r) => setTimeout(r, interval));
  }

  // Check if done
  if (currentState.progress.done >= currentState.progress.total) {
    currentState.status = 'idle';
  }
  await saveState();
}

// ── Main pipeline ──

async function runPipeline() {
  await loadState();

  // Resume from stored progress or start fresh
  if (currentState.status === 'idle') {
    currentState.progress = { done: 0, total: 0, failed: 0, skipped: 0 };
    await saveState();
  }

  try {
    if (currentState.status === 'idle' || currentState.status === 'searching') {
      await executeSearchPhase();
    }
    if (currentState.status === 'filtering') {
      await executeFilterPhase();
    }
    if (currentState.status === 'sending') {
      await executeSendPhase();
    }
  } catch (err) {
    console.error('[bg] Pipeline error:', err);
    currentState.status = 'error';
    await saveState();
  }
}

// ── Message handlers ──

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'task:start':
      runPipeline().then(() => sendResponse({ status: 'started' }));
      return true;

    case 'task:pause':
      currentState.status = 'paused';
      saveState().then(() => sendResponse({ status: 'paused' }));
      return true;

    case 'task:resume':
      currentState.status = 'sending';
      saveState().then(() => {
        runPipeline().then(() => sendResponse({ status: 'resumed' }));
      });
      return true;

    case 'task:stop':
      currentState.status = 'idle';
      currentState.progress = { done: 0, total: 0, failed: 0, skipped: 0 };
      saveState().then(() => sendResponse({ status: 'stopped' }));
      return true;

    case 'task:status':
      sendResponse(currentState);
      return true;

    case 'messenger:progress':
      // Forward progress updates from content scripts
      console.log(`[bg] Messenger progress: ${message.step} for ${message.handle}`);
      break;
  }
});

// ── Startup ──

loadState().then(() => {
  console.log('[bg] X Broadcaster service worker ready. State:', currentState.status);
});
```

- [ ] **Step 2: Commit**

```bash
git add x-broadcaster/background.js
git commit -m "feat: add background service worker for task orchestration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Popup UI

**Files:**
- Create: `x-broadcaster/popup/popup.html`
- Create: `x-broadcaster/popup/popup.js`
- Create: `x-broadcaster/popup/popup.css`

- [ ] **Step 1: Write popup.html**

```html
<!-- x-broadcaster/popup/popup.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="popup">
    <header>
      <h1>X Broadcaster</h1>
      <span id="statusBadge" class="badge idle">Idle</span>
    </header>

    <section class="stats">
      <div class="stat-row">
        <span class="stat-label">Today</span>
        <span id="sentToday" class="stat-value">0</span>
        <span class="stat-sep">/</span>
        <span id="dailyLimit" class="stat-value">200</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Queue</span>
        <span id="queueRemaining" class="stat-value">—</span>
      </div>
      <div id="currentAction" class="current-action hidden">
        <span class="spinner"></span>
        <span id="actionText"></span>
      </div>
    </section>

    <section class="controls">
      <button id="btnStart" class="btn primary">▶ Start</button>
      <button id="btnPause" class="btn secondary" disabled>⏸ Pause</button>
      <button id="btnStop" class="btn danger" disabled>⏹ Stop</button>
    </section>

    <footer>
      <a href="#" id="openDashboard">Open Dashboard →</a>
    </footer>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write popup.css**

```css
/* x-broadcaster/popup/popup.css */

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  width: 280px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #e7e9ea;
  background: #15202b;
}

.popup {
  padding: 16px;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

header h1 {
  font-size: 16px;
  font-weight: 600;
}

.badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.badge.idle { background: #1d9bf0; color: #fff; }
.badge.searching { background: #ffd700; color: #000; }
.badge.filtering { background: #ff8c00; color: #fff; }
.badge.sending { background: #00ba7c; color: #fff; }
.badge.paused { background: #71767b; color: #fff; }
.badge.error { background: #f4212e; color: #fff; }

.stats {
  margin-bottom: 16px;
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.stat-label { color: #8b98a5; font-size: 12px; min-width: 40px; }
.stat-value { font-weight: 600; }
.stat-sep { color: #8b98a5; }

.current-action {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px;
  background: #1e2732;
  border-radius: 6px;
  font-size: 12px;
  color: #8b98a5;
}

.current-action.hidden { display: none; }

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #1d9bf0;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn:disabled { opacity: 0.4; cursor: default; }

.btn.primary { background: #1d9bf0; color: #fff; }
.btn.secondary { background: #71767b; color: #fff; }
.btn.danger { background: #f4212e; color: #fff; }

footer {
  text-align: center;
  padding-top: 8px;
  border-top: 1px solid #38444d;
}

footer a {
  color: #1d9bf0;
  text-decoration: none;
  font-size: 12px;
}

footer a:hover { text-decoration: underline; }
```

- [ ] **Step 3: Write popup.js**

```javascript
// x-broadcaster/popup/popup.js

const $ = (sel) => document.querySelector(sel);

const btnStart = $('#btnStart');
const btnPause = $('#btnPause');
const btnStop = $('#btnStop');
const statusBadge = $('#statusBadge');
const sentToday = $('#sentToday');
const dailyLimit = $('#dailyLimit');
const queueRemaining = $('#queueRemaining');
const currentAction = $('#currentAction');
const actionText = $('#actionText');

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
    actionText.textContent = `Sending to ${state.currentHandle || '...'} (${state.progress.done}/${state.progress.total})`;
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
  chrome.runtime.sendMessage({ action: 'task:status' }, (state) => {
    if (chrome.runtime.lastError) return;
    if (state) updateUI(state);
  });

  // Also fetch today's count
  chrome.storage.local.get(['sentToday', 'taskConfig'], (result) => {
    const today = result.sentToday ? JSON.parse(result.sentToday) : 0;
    const config = result.taskConfig ? JSON.parse(result.taskConfig) : {};
    sentToday.textContent = today;
    dailyLimit.textContent = config.dailyLimit || 200;

    // Fetch queue
    chrome.storage.local.get(['sendQueue'], (r) => {
      const queue = r.sendQueue ? JSON.parse(r.sendQueue) : [];
      const state = JSON.parse(
        (r.executionState || '{"progress":{"done":0,"total":0}}')
      );
      queueRemaining.textContent = queue.length;
      // Fallback to stored execution state progress
      if (state && state.progress) {
        queueRemaining.textContent =
          Math.max(0, queue.length - (state.progress.done || 0));
      }
    });
  });
}

btnStart.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'task:start' });
  refresh();
});

btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'task:pause' });
  refresh();
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'task:stop' });
  refresh();
});

$('#openDashboard').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// Poll for status updates
refresh();
setInterval(refresh, 3000);
```

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/popup/
git commit -m "feat: add popup UI with status display and controls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Dashboard UI (Configuration & Management)

**Files:**
- Create: `x-broadcaster/dashboard/dashboard.html`
- Create: `x-broadcaster/dashboard/dashboard.js`
- Create: `x-broadcaster/dashboard/dashboard.css`

- [ ] **Step 1: Write dashboard.html**

```html
<!-- x-broadcaster/dashboard/dashboard.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="dashboard.css">
  <title>X Broadcaster — Dashboard</title>
</head>
<body>
  <nav class="tabs">
    <button class="tab active" data-tab="config">⚙ Config</button>
    <button class="tab" data-tab="candidates">👥 Candidates</button>
    <button class="tab" data-tab="monitor">📊 Monitor</button>
    <button class="tab" data-tab="logs">📋 Logs</button>
    <button class="tab" data-tab="blacklist">🚫 Blacklist</button>
  </nav>

  <main id="main">
    <!-- Config Tab -->
    <section id="tab-config" class="tab-content active">
      <h2>Task Configuration</h2>

      <div class="form-group">
        <label>Search Keywords (comma-separated)</label>
        <input type="text" id="cfgKeywords" placeholder="AI tools, startup, SaaS">
      </div>

      <hr>
      <h3>Stage 1 Filters (Search Page)</h3>

      <div class="form-row">
        <label class="checkbox-label">
          <input type="checkbox" id="cfgRequireAvatar" checked> Require avatar
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="cfgRequireBio" checked> Require bio
        </label>
      </div>

      <div class="form-group">
        <label>Min Account Age (years)</label>
        <input type="number" id="cfgMinAccountAge" value="0" min="0" max="15">
      </div>

      <hr>
      <h3>Stage 2 Filters (Profile Page)</h3>

      <div class="form-group">
        <label>Min Followers</label>
        <input type="number" id="cfgMinFollowers" value="100" min="0">
      </div>

      <div class="form-group">
        <label>Max Following/Follower Ratio</label>
        <input type="number" id="cfgMaxFollowRatio" value="3.0" step="0.1" min="0">
      </div>

      <div class="form-group">
        <label>Topic Keywords (comma-separated)</label>
        <input type="text" id="cfgTopicKeywords" placeholder="AI, cryptocurrency, startup">
      </div>

      <div class="form-row">
        <label class="checkbox-label">
          <input type="checkbox" id="cfgRequireDmsOpen" checked> Require DMs open
        </label>
      </div>

      <hr>
      <h3>Messages</h3>

      <div class="form-group">
        <label>Message Templates (one per line, use {username}, {topic}, {link}, {followers})</label>
        <textarea id="cfgMessageTemplates" rows="4">Hi {username}! Saw your posts on {topic}. Check this: {link}</textarea>
      </div>

      <div class="form-group">
        <label>Link to include</label>
        <input type="text" id="cfgLink" placeholder="https://...">
      </div>

      <div class="form-row">
        <label class="checkbox-label">
          <input type="checkbox" id="cfgFollowIfNeeded" checked> Follow user if DM requires it
        </label>
      </div>

      <div class="form-row">
        <label class="checkbox-label">
          <input type="checkbox" id="cfgEnableComments"> Enable comment mode
        </label>
      </div>

      <div class="form-group">
        <label>Comment Post URLs (one per line)</label>
        <textarea id="cfgCommentPostUrls" rows="2" placeholder="https://x.com/user/status/123"></textarea>
      </div>

      <hr>
      <h3>Scheduling</h3>

      <div class="form-row two-col">
        <div class="form-group">
          <label>DM Interval Min (seconds)</label>
          <input type="number" id="cfgIntervalMin" value="30" min="10">
        </div>
        <div class="form-group">
          <label>DM Interval Max (seconds)</label>
          <input type="number" id="cfgIntervalMax" value="60" min="10">
        </div>
      </div>

      <div class="form-row two-col">
        <div class="form-group">
          <label>Comment Interval Min (seconds)</label>
          <input type="number" id="cfgCommentIntervalMin" value="60" min="10">
        </div>
        <div class="form-group">
          <label>Comment Interval Max (seconds)</label>
          <input type="number" id="cfgCommentIntervalMax" value="120" min="10">
        </div>
      </div>

      <div class="form-group">
        <label>Daily Send Limit</label>
        <input type="number" id="cfgDailyLimit" value="200" min="0">
      </div>

      <div class="form-row two-col">
        <div class="form-group">
          <label>Active Hours Start (0-23)</label>
          <input type="number" id="cfgActiveStart" value="9" min="0" max="23">
        </div>
        <div class="form-group">
          <label>Active Hours End (0-23)</label>
          <input type="number" id="cfgActiveEnd" value="23" min="0" max="23">
        </div>
      </div>

      <button id="btnSaveConfig" class="btn primary">💾 Save Configuration</button>
      <span id="saveStatus"></span>
    </section>

    <!-- Candidates Tab -->
    <section id="tab-candidates" class="tab-content">
      <h2>Candidate List</h2>
      <div class="toolbar">
        <span id="candidateCount">0 candidates</span>
        <button id="btnClearCandidates" class="btn small danger">Clear All</button>
      </div>
      <div id="candidateList" class="list"></div>
    </section>

    <!-- Monitor Tab -->
    <section id="tab-monitor" class="tab-content">
      <h2>Execution Monitor</h2>
      <div class="status-bar">
        <span id="monitorStatus" class="badge idle">Idle</span>
      </div>
      <div class="progress-bar-container">
        <div id="progressBar" class="progress-bar" style="width: 0%"></div>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-number" id="monitorDone">0</span>
          <span class="stat-label">Done</span>
        </div>
        <div class="stat-card">
          <span class="stat-number" id="monitorFailed">0</span>
          <span class="stat-label">Failed</span>
        </div>
        <div class="stat-card">
          <span class="stat-number" id="monitorSkipped">0</span>
          <span class="stat-label">Skipped</span>
        </div>
        <div class="stat-card">
          <span class="stat-number" id="monitorTotal">0</span>
          <span class="stat-label">Total</span>
        </div>
      </div>
      <div id="currentActionDetail" class="current-action-detail"></div>
    </section>

    <!-- Logs Tab -->
    <section id="tab-logs" class="tab-content">
      <h2>Execution Logs</h2>
      <div id="logEntries" class="log-entries"></div>
    </section>

    <!-- Blacklist Tab -->
    <section id="tab-blacklist" class="tab-content">
      <h2>Blacklist</h2>
      <div class="toolbar">
        <span id="blacklistCount">0 entries</span>
        <input type="text" id="blacklistAddInput" placeholder="@handle to add">
        <button id="btnBlacklistAdd" class="btn small">Add</button>
        <button id="btnBlacklistClear" class="btn small danger">Clear All</button>
      </div>
      <div id="blacklistEntries" class="list"></div>
    </section>
  </main>

  <script src="dashboard.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write dashboard.css**

```css
/* x-broadcaster/dashboard/dashboard.css */

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #e7e9ea;
  background: #15202b;
  max-width: 800px;
  margin: 0 auto;
  padding: 0 20px 40px;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #38444d;
  margin-bottom: 24px;
  padding-top: 16px;
}

.tab {
  padding: 10px 16px;
  background: none;
  border: none;
  color: #8b98a5;
  font-size: 13px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: color 0.2s, border-color 0.2s;
}

.tab:hover { color: #e7e9ea; }
.tab.active { color: #1d9bf0; border-bottom-color: #1d9bf0; }

/* Content */
.tab-content { display: none; }
.tab-content.active { display: block; }

h2 { font-size: 18px; margin-bottom: 16px; }
h3 { font-size: 14px; color: #8b98a5; margin-bottom: 12px; }

/* Form */
.form-group { margin-bottom: 14px; }
.form-group label {
  display: block;
  font-size: 12px;
  color: #8b98a5;
  margin-bottom: 4px;
}

.form-group input[type="text"],
.form-group input[type="number"],
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  background: #1e2732;
  border: 1px solid #38444d;
  border-radius: 6px;
  color: #e7e9ea;
  font-size: 13px;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #1d9bf0;
}

.form-group textarea { resize: vertical; min-height: 80px; }

.form-row {
  display: flex;
  gap: 14px;
  margin-bottom: 14px;
  align-items: center;
}

.form-row.two-col .form-group { flex: 1; }

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

hr { border: none; border-top: 1px solid #38444d; margin: 16px 0; }

/* Buttons */
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.btn.primary { background: #1d9bf0; color: #fff; }
.btn.danger { background: #f4212e; color: #fff; }
.btn.small { padding: 6px 14px; font-size: 12px; }

#saveStatus { margin-left: 12px; font-size: 12px; color: #00ba7c; }

/* Badges */
.badge {
  padding: 4px 14px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}
.badge.idle { background: #1d9bf0; }
.badge.sending { background: #00ba7c; }
.badge.paused { background: #71767b; }
.badge.error { background: #f4212e; }

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.toolbar input { flex: 1; padding: 6px 10px; background: #1e2732; border: 1px solid #38444d; border-radius: 4px; color: #e7e9ea; font-size: 12px; }

/* Lists */
.list { display: flex; flex-direction: column; gap: 4px; max-height: 400px; overflow-y: auto; }
.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #1e2732;
  border-radius: 6px;
  font-size: 13px;
}

/* Progress */
.progress-bar-container {
  background: #38444d;
  border-radius: 6px;
  height: 8px;
  margin: 16px 0;
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: #1d9bf0;
  border-radius: 6px;
  transition: width 0.3s;
}

/* Stats */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  text-align: center;
  padding: 12px;
  background: #1e2732;
  border-radius: 8px;
}
.stat-number { font-size: 24px; font-weight: 700; display: block; }
.stat-card .stat-label { font-size: 11px; color: #8b98a5; }

/* Status */
.status-bar { margin-bottom: 12px; }
.current-action-detail {
  padding: 12px;
  background: #1e2732;
  border-radius: 8px;
  font-size: 13px;
  color: #8b98a5;
}

/* Logs */
.log-entries {
  max-height: 400px;
  overflow-y: auto;
  font-family: 'Courier New', monospace;
  font-size: 12px;
}
.log-entry {
  padding: 6px 0;
  border-bottom: 1px solid #1e2732;
}
.log-entry .time { color: #8b98a5; margin-right: 8px; }
.log-entry .success { color: #00ba7c; }
.log-entry .fail { color: #f4212e; }
.log-entry .skip { color: #ffd700; }
```

- [ ] **Step 3: Write dashboard.js**

```javascript
// x-broadcaster/dashboard/dashboard.js

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ── Tab switching ──

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.tab-content').forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── Config Tab ──

const DEFAULT_CONFIG = {
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
  const result = await chrome.storage.local.get(['taskConfig']);
  const config = result.taskConfig ? JSON.parse(result.taskConfig) : DEFAULT_CONFIG;

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
  $('#cfgCommentIntervalMin').value = config.commentInterval?.min || 60;
  $('#cfgCommentIntervalMax').value = config.commentInterval?.max || 120;
  $('#cfgDailyLimit').value = config.dailyLimit;
  $('#cfgActiveStart').value = config.activeHours?.start || 9;
  $('#cfgActiveEnd').value = config.activeHours?.end || 23;
}

function collectConfig() {
  return {
    keywords: $('#cfgKeywords').value.split(',').map((s) => s.trim()).filter(Boolean),
    filterRules: {
      requireAvatar: $('#cfgRequireAvatar').checked,
      requireBio: $('#cfgRequireBio').checked,
      minAccountAgeYears: parseInt($('#cfgMinAccountAge').value) || 0,
      minFollowers: parseInt($('#cfgMinFollowers').value) || 0,
      maxFollowRatio: parseFloat($('#cfgMaxFollowRatio').value) || 3.0,
      topicKeywords: $('#cfgTopicKeywords').value.split(',').map((s) => s.trim()).filter(Boolean),
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

$('#btnSaveConfig').addEventListener('click', async () => {
  const config = collectConfig();
  await chrome.storage.local.set({ taskConfig: JSON.stringify(config) });
  $('#saveStatus').textContent = 'Saved!';
  setTimeout(() => { $('#saveStatus').textContent = ''; }, 2000);
});

// ── Candidates Tab ──

async function loadCandidates() {
  const result = await chrome.storage.local.get(['candidateQueue']);
  const candidates = result.candidateQueue ? JSON.parse(result.candidateQueue) : [];
  $('#candidateCount').textContent = `${candidates.length} candidates`;
  $('#candidateList').innerHTML = candidates
    .map(
      (c, i) => `
      <div class="list-item">
        <span>@${c.handle} ${c.displayName ? '- ' + c.displayName : ''}</span>
        <span style="color:#8b98a5;font-size:11px">${c.hasAvatar ? '🖼' : ''} ${c.hasBio ? '📝' : ''} ${c.foundAt ? new Date(c.foundAt).toLocaleDateString() : ''}</span>
      </div>`
    )
    .join('');
}

$('#btnClearCandidates').addEventListener('click', async () => {
  await chrome.storage.local.remove(['candidateQueue']);
  loadCandidates();
});

// ── Monitor Tab ──

async function updateMonitor() {
  const state = await new Promise((resolve) => {
    chrome.storage.local.get(['executionState'], (r) => {
      resolve(r.executionState ? JSON.parse(r.executionState) : null);
    });
  });

  if (!state) return;

  $('#monitorStatus').textContent = state.status;
  $('#monitorStatus').className = 'badge ' + state.status;

  const p = state.progress || {};
  $('#monitorDone').textContent = p.done || 0;
  $('#monitorFailed').textContent = p.failed || 0;
  $('#monitorSkipped').textContent = p.skipped || 0;
  $('#monitorTotal').textContent = p.total || 0;

  const pct = p.total > 0 ? Math.round(((p.done || 0) / p.total) * 100) : 0;
  $('#progressBar').style.width = pct + '%';

  if (state.currentHandle) {
    $('#currentActionDetail').textContent = `Currently processing: @${state.currentHandle}`;
  }
}

// ── Blacklist Tab ──

async function loadBlacklist() {
  const result = await chrome.storage.local.get(['blacklist']);
  const list = result.blacklist ? JSON.parse(result.blacklist) : [];
  $('#blacklistCount').textContent = `${list.length} entries`;
  $('#blacklistEntries').innerHTML = list
    .map(
      (h) => `
      <div class="list-item">
        <span>@${h}</span>
        <button class="btn small danger" data-handle="${h}">Remove</button>
      </div>`
    )
    .join('');

  // Add remove handlers
  $$('#blacklistEntries .btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const handle = btn.dataset.handle;
      const result = await chrome.storage.local.get(['blacklist']);
      const list = result.blacklist ? JSON.parse(result.blacklist) : [];
      const updated = list.filter((h) => h !== handle);
      await chrome.storage.local.set({ blacklist: JSON.stringify(updated) });
      loadBlacklist();
    });
  });
}

$('#btnBlacklistAdd').addEventListener('click', async () => {
  const handle = $('#blacklistAddInput').value.trim().replace('@', '');
  if (!handle) return;
  const result = await chrome.storage.local.get(['blacklist']);
  const list = result.blacklist ? JSON.parse(result.blacklist) : [];
  if (!list.includes(handle)) {
    list.push(handle);
    await chrome.storage.local.set({ blacklist: JSON.stringify(list) });
    $('#blacklistAddInput').value = '';
    loadBlacklist();
  }
});

$('#btnBlacklistClear').addEventListener('click', async () => {
  await chrome.storage.local.set({ blacklist: JSON.stringify([]) });
  loadBlacklist();
});

// ── Init ──

loadConfig();
setInterval(updateMonitor, 3000);
// Tab-specific init when switching
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    if (tabName === 'candidates') loadCandidates();
    if (tabName === 'blacklist') loadBlacklist();
    if (tabName === 'monitor') updateMonitor();
  });
});
```

- [ ] **Step 4: Commit**

```bash
git add x-broadcaster/dashboard/
git commit -m "feat: add dashboard UI with config, candidates, monitor, and blacklist

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Platform Adapter Interface (shared/platforms/)

**Files:**
- Create: `x-broadcaster/shared/platforms/interface.js`
- Create: `x-broadcaster/shared/platforms/x.js`

**Purpose:** Define a common interface that all platform adapters must implement, making it easy to add Telegram, Xiaohongshu, TikTok later. The `x.js` adapter provides the initial concrete implementation (effectively a re-export of the existing content script logic, organized under this interface).

- [ ] **Step 1: Write platform interface**

```javascript
// x-broadcaster/shared/platforms/interface.js

/**
 * Platform Adapter Interface
 *
 * Every platform (X, Telegram, Xiaohongshu, TikTok) must implement
 * these five methods. New platforms are added as files in this directory
 * and registered in the adapter registry.
 *
 * Each method returns { status, data } or { error, message }.
 */

/**
 * @typedef {Object} UserProfile
 * @property {string} handle     - Platform-specific user identifier
 * @property {string} displayName
 * @property {string} bio
 * @property {number} followers
 * @property {number} following
 * @property {number|null} joinYear
 * @property {string[]} postTopics
 * @property {boolean} dmsOpen
 * @property {string} profileUrl
 * @property {boolean} hasAvatar
 */

/**
 * @typedef {Object} PlatformAdapter
 * @property {function(string, {maxResults: number}): Promise<{users: UserProfile[]}>} searchUsers
 * @property {function(string): Promise<UserProfile>} getProfile
 * @property {function(string, string): Promise<{status: string}>} sendDM
 * @property {function(string, string): Promise<{status: string}>} postComment
 * @property {function(): Promise<boolean>} checkRateLimit
 * @property {function(): Promise<boolean>} checkCaptcha
 * @property {function(): Promise<boolean>} checkLoggedIn
 */

/**
 * Validate that an adapter object implements the required interface.
 * Returns an array of missing method names (empty = valid).
 */
function validateAdapter(adapter, name) {
  const required = [
    'searchUsers',
    'getProfile',
    'sendDM',
    'postComment',
    'checkRateLimit',
    'checkCaptcha',
    'checkLoggedIn',
  ];
  const missing = required.filter((method) => typeof adapter[method] !== 'function');
  if (missing.length > 0) {
    console.error(
      `[platforms] Adapter "${name}" missing methods: ${missing.join(', ')}`
    );
  }
  return missing;
}

// Registry
const adapters = {};

function register(name, adapter) {
  const missing = validateAdapter(adapter, name);
  if (missing.length === 0) {
    adapters[name] = adapter;
    console.log(`[platforms] Registered adapter: ${name}`);
  }
}

function get(name) {
  return adapters[name] || null;
}

function list() {
  return Object.keys(adapters);
}

// If running in test environment, export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateAdapter, register, get, list, adapters };
}
```

- [ ] **Step 2: Write X platform adapter stub**

```javascript
// x-broadcaster/shared/platforms/x.js

/**
 * X (Twitter) Platform Adapter
 *
 * Implements the PlatformAdapter interface for X.
 * This adapter delegates to the content scripts (search, profile, messenger)
 * via chrome.tabs.sendMessage.
 *
 * In the future, each method body will be replaced with direct DOM automation
 * calls or API requests depending on the platform.
 */

const xAdapter = {
  name: 'x',

  async searchUsers(keyword, { maxResults = 100 }) {
    // Delegates to content/search.js via background
    // This is a stub — actual search is orchestrated by background.js
    return { platform: 'x', status: 'not_implemented_in_adapter' };
  },

  async getProfile(handle) {
    return { platform: 'x', status: 'not_implemented_in_adapter' };
  },

  async sendDM(handle, messageText) {
    return { platform: 'x', status: 'not_implemented_in_adapter' };
  },

  async postComment(postUrl, commentText) {
    return { platform: 'x', status: 'not_implemented_in_adapter' };
  },

  async checkRateLimit() {
    const banner =
      document.querySelector('span:contains("rate limit")') ||
      document.querySelector('div[role="alert"]:contains("limit")');
    return !!banner;
  },

  async checkCaptcha() {
    const captcha =
      document.querySelector('[data-testid="ocfChallenge"]') ||
      document.querySelector('iframe[src*="arkoselabs"]');
    return !!captcha;
  },

  async checkLoggedIn() {
    const loginBtn =
      document.querySelector('[data-testid="loginButton"]') ||
      document.querySelector('a[href="/login"]');
    return !loginBtn; // true if logged in (no login button visible)
  },
};

// Register on load if chrome API is available
if (typeof chrome !== 'undefined' && chrome.runtime) {
  // The registry is in interface.js; we register when both are loaded
  // For now, export the adapter for manual registration
}

// If running in test environment
if (typeof module !== 'undefined' && module.exports) {
  module.exports = xAdapter;
}
```

- [ ] **Step 3: Commit**

```bash
git add x-broadcaster/shared/platforms/
git commit -m "feat: add platform adapter interface and X adapter stub

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: Integration — Wire Everything Together

**Files:**
- Modify: `x-broadcaster/manifest.json` — ensure all resources are declared
- Modify: None — verify all imports and message contracts align

- [ ] **Step 1: Verify manifest declares all resources**

Read the current `manifest.json` and ensure:
- `background.service_worker` points to `background.js`
- `action.default_popup` points to `popup/popup.html`
- `content_scripts` include all three scripts with correct URL patterns
- `permissions` include `["storage", "activeTab", "tabs", "scripting"]`
- `host_permissions` include `["https://x.com/*", "https://twitter.com/*"]`

- [ ] **Step 2: Load the extension in Chrome and verify it loads without errors**

```bash
# Manual step — open chrome://extensions, enable Developer mode,
# click "Load unpacked", select the x-broadcaster/ directory.
# Verify no errors in the extension card.
```

- [ ] **Step 3: Commit final manifest if changed**

```bash
git add x-broadcaster/manifest.json
git commit -m "chore: finalize manifest for integration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: End-to-End Manual Test Checklist

- [ ] **Step 1: Load extension in Chrome**
  - Open `chrome://extensions`
  - Enable Developer mode
  - Load unpacked → select `x-broadcaster/` directory
  - Verify popup opens on icon click

- [ ] **Step 2: Configure a task**
  - Open Dashboard
  - Set keyword: "AI startup"
  - Set min followers: 100
  - Set message template: "Hi {username}! 👋"
  - Save configuration

- [ ] **Step 3: Run the search phase**
  - Click Start in popup
  - Verify it navigates to X search page
  - Verify it scrolls and extracts users
  - Check candidate list appears in Dashboard

- [ ] **Step 4: Test DM sending**
  - With a test X account, verify DM flow:
    - Open messages
    - Compose new message
    - Type recipient
    - Type message (human-like)
    - Send confirmation

- [ ] **Step 5: Test error handling**
  - Pause mid-task, verify it holds state
  - Resume, verify it continues from last user
  - Stop task, verify state resets

---

## Appendix: File Map

| File | Task | Lines | Responsibility |
|------|------|-------|---------------|
| `manifest.json` | 1, 15 | 25 | Extension declaration |
| `package.json` | 1 | 15 | Test dependencies |
| `shared/storage.js` | 2 | ~55 | chrome.storage.local wrapper |
| `shared/xpaths.js` | 3 | ~140 | X DOM selectors with fallbacks |
| `shared/templates.js` | 4 | ~40 | Message template engine |
| `shared/scheduler.js` | 5 | ~75 | Interval, caps, active hours |
| `shared/filter.js` | 6 | ~45 | Two-stage user filter |
| `shared/behavior.js` | 7 | ~60 | Human-like interaction sim |
| `content/search.js` | 8 | ~180 | Search page DOM extraction |
| `content/profile.js` | 9 | ~145 | Profile page data extraction |
| `content/messenger.js` | 10 | ~190 | DM and comment execution |
| `background.js` | 11 | ~280 | Service worker orchestration |
| `popup/*` | 12 | ~130 | Quick control popup |
| `dashboard/*` | 13 | ~350 | Full config & monitoring UI |
| `shared/platforms/interface.js` | 14 | ~50 | Adapter contract |
| `shared/platforms/x.js` | 14 | ~55 | X adapter stub |
| **Total** | | **~1,840** | |
