# X Broadcaster — Chrome Extension Design Spec

**Date**: 2026-06-06
**Status**: Draft
**Scope**: X social media outreach assistant as a Chrome extension (Manifest V3)

---

## 1. Overview

A Chrome browser extension that helps small teams find target users on X (Twitter), filter them by audience criteria, and send bulk direct messages and comments—all from a real browser session.

### 1.1 Goals

- Search X for users by keywords
- Filter users by follower count, profile completeness, post topics
- Send direct messages (DMs) in bulk
- @mention users in post comments
- Manage tasks, blacklists, and logs via a dashboard UI
- Avoid X spam/automation detection through human-like behavior simulation

### 1.2 Non-Goals

- Multi-platform support (X only; architecture allows future expansion)
- Heavy concurrent multi-account (single logged-in X account per browser)
- Server-side backend (local-first; optional lightweight backend later)
- X API integration (100% DOM/UI automation)

---

## 2. Architecture

### 2.1 Extension Structure

```
x-broadcaster/
├── manifest.json           # MV3 manifest, permissions, content script rules
├── background.js           # Service Worker — task scheduling, cross-tab state
├── content/
│   ├── search.js           # Injects on X search pages — iterate results, extract user info
│   ├── profile.js          # Injects on X profile pages — fetch detailed user data
│   └── messenger.js        # Injects on X pages — execute DM/comment actions
├── popup/
│   ├── popup.html          # Extension popup — quick status, pause/resume
│   ├── popup.js            # Popup logic
│   └── popup.css           # Popup styles
├── dashboard/
│   ├── dashboard.html      # Full dashboard tab — task config, logs, blacklist
│   ├── dashboard.js        # Dashboard logic
│   └── dashboard.css       # Dashboard styles
└── shared/
    ├── storage.js          # chrome.storage.local read/write wrappers
    ├── xpaths.js           # Centralized X page DOM selectors with fallbacks
    ├── templates.js        # Message template engine with variable substitution
    ├── scheduler.js        # Interval control, daily caps, cooldown logic
    └── platforms/          # Future: per-platform adapters (tg.js, xiaohongshu.js, ...)
```

### 2.2 Key Design Decisions

- **Manifest V3**: Required for current Chrome. Service worker (background.js) for scheduling, not persistent background page.
- **Popup vs Dashboard**: Popup is a lightweight control surface (start/stop/status). Dashboard is a full-page tab for configuration, logs, and blacklist management.
- **chrome.storage.local**: All state persisted locally. ~10MB limit; sufficient for thousands of task records. No database.
- **DOM selector isolation**: All X page element selectors centralized in `shared/xpaths.js`. Each selector has a primary and fallback selector. X page structure changes only require updating this file.
- **Multi-platform extensibility**: `shared/platforms/` directory structure for future Telegram, Xiaohongshu, TikTok adapters. Each platform adapter implements a common interface: `searchUsers`, `getProfile`, `sendDM`, `postComment`.

### 2.3 Component Communication

```
[Popup] ←→ [chrome.storage] ←→ [Dashboard]
                ↕
[Background Service Worker]
                ↕ (chrome.tabs.sendMessage)
[Content Scripts: search.js, profile.js, messenger.js]
```

---

## 3. Module Design

### 3.1 Module ① — User Search

**Purpose**: Discover target users on X by keyword, output candidate list for filtering.

**Flow**:
1. User configures search keywords in Dashboard
2. Content script injects into `https://x.com/search?q={keyword}&src=typed_query&f=user` (People tab)
3. Script iterates through search results: scroll, extract user cards
4. From each user card DOM, extract: @handle, display name, bio snippet, follower count (if visible), profile link
5. Deduplicate and push to "pending filter" queue in chrome.storage

**Key behavior**:
- Scroll incrementally with randomized distance and delay
- Stop when: no new results loaded, daily search cap reached, or user pauses task
- Search depth configurable (e.g., "first 100 results" vs "first 500")

### 3.2 Module ② — User Filtering

**Purpose**: Two-stage funnel to identify qualified prospects.

**Stage 1 — Quick filter (on search page)**:
- Has avatar (yes/no)
- Has bio (yes/no)
- Account age indicator (if visible — e.g., "Joined January 2024")
- These checks are cheap; run inline during search

**Stage 2 — Detailed filter (requires profile visit)**:
- Follower count ≥ threshold (configurable range)
- Following/follower ratio
- Post topics match (keyword-based scan of recent post text on profile page)
- Account age (extracted from profile page)
- Whether DMs are open

**Implementation**:
- Stage 1 results flow into Stage 2
- Profile page navigation: `window.location` or `chrome.tabs.update` to profile URL
- Each profile visit extracts data via `profile.js`
- Filter logic is a configurable rule engine (AND/OR conditions with thresholds)
- Users passing all filters go to the "send queue"

### 3.3 Module ③ — Message Execution

**Purpose**: Deliver DMs and comments to filtered users.

#### Direct Messages

```
Navigate to DM page → Click "New message" → Type @handle →
Wait for user input box → Type message content (with variables resolved) →
Click send → Wait for ✓ confirmation → Record result → Cooldown → Next user
```

- If user has DMs restricted to followers: follow first, DM, optionally unfollow after (configurable)
- If DM input box not found after timeout: mark "unreachable", skip

#### Post Comments

```
Navigate to target post URL (user-provided) → Scroll to comment box →
Type "@handle message" → Submit → Wait for confirmation → Record result → Cooldown → Next
```

- Comment mode uses its own, longer interval (default 60–120s)
- Can be toggled on/off independently from DMs

#### Message Templates

Variables supported in message content:
- `{username}` — @handle without the @
- `{followers}` — follower count
- `{topic}` — matched search keyword

Anti-spam: 2-3 template variants configured per campaign; system randomly selects one per recipient.

### 3.4 Module ④ — Task Management (Dashboard)

**Sections**:

1. **Task Config**: Keywords, filter thresholds, message templates, intervals, daily caps
2. **Candidate List**: Filtered results with manual override (check/uncheck per user)
3. **Execution Monitor**: Real-time progress bar, success/fail/skip counts, current status
4. **Logs & Stats**: Per-date execution history, success rate
5. **Blacklist**: Auto-added after sending; manual add/remove; prevents duplicate outreach

---

## 4. Anti-Detection & Risk Control

### 4.1 Behavior Simulation

| Dimension | Strategy |
|-----------|----------|
| **Timing** | Random jitter on all intervals (e.g., config 30–60s means random within range) |
| **Scrolling** | `scrollBy` with randomized distance, not `scrollTo`; slight horizontal wobble |
| **Typing** | Character-by-character input with variable speed, not paste |
| **Mouse** | Move cursor before critical clicks; ease curve, not straight line |
| **Schedule** | Optional "active hours" window (e.g., 9:00–23:00); auto-pause outside |

### 4.2 Platform Limit Responses

| Trigger | Response |
|---------|----------|
| DM frequency limit | Auto-pause 1–4 hours when limit UI detected |
| Spam detection (duplicate content) | Template rotation (2-3 variants per campaign, randomized per recipient) |
| Rate limit warning | Double the current interval, notify user |
| Captcha prompt | Pause all tasks, alert user to solve manually |
| Logged out | Pause all tasks, alert user to re-login |

### 4.3 User Guidance

Dashboard always shows:
> Current pace: {interval}s per action. Today: {count}/{limit}. Remaining: {remaining}

Suggested limits displayed prominently:
- New account (< 3 months): ≤ 50/day
- Established account: up to 200/day

---

## 5. Error Handling & Robustness

### 5.1 DOM Changes

- Every selector in `xpaths.js` has a primary + fallback selector
- Action timeout (default 10s); on timeout: log error → skip current user → continue
- If critical selectors all fail (suggesting major X redesign): pause tasks, notify user to update selectors

### 5.2 Operational Errors

| Scenario | Handling |
|----------|----------|
| Private/locked account | Mark "unreachable", skip |
| DMs closed | Detect missing DM input, skip + record reason |
| Network flakiness | Retry once after timeout, then skip |
| Send confirmation missing | Record as "unknown" status for manual review |

### 5.3 Continuity

- After each completed action: update `currentProgress` in chrome.storage
- Browser close/crash: on next Dashboard open, detect unfinished task → prompt "Resume previous task?"
- Resume: skip already-processed users, continue from last incomplete

---

## 6. Testing Strategy

| Level | What | How |
|-------|------|-----|
| **Unit** | Selector parsing, filter logic, template variable substitution | Jest, pure functions |
| **Integration** | Search → filter data pipeline, scheduler logic | Mock DOM with real X HTML snapshots |
| **Manual (E2E)** | Full search → filter → send flow | Real X test account, real browser |

### 6.1 Test Priorities

1. Selector robustness: validate against X HTML snapshots in different states (logged in/out, various languages, layout variants)
2. Filter correctness: given a batch of mock user data, verify filter output matches expected set
3. Error recovery: simulate DOM changes, timeouts; verify task continues cleanly

---

## 7. Future Expansion

| Capability | When | Approach |
|------------|------|----------|
| Telegram (Bot API) | After X stable | `shared/platforms/tg.js` |
| Xiaohongshu | After X stable | `shared/platforms/xhs.js` with DOM automation |
| TikTok | After X stable | `shared/platforms/tiktok.js` with DOM automation |
| Lightweight backend | When team sharing needed | FastAPI + SQLite; tasks stored on server, plugin becomes thin client |
| Multi-account support | When scaling | Account rotation logic within a single plugin instance |

---

## 8. File Summary

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `manifest.json` | ~40 | Extension declaration |
| `background.js` | ~100 | Task scheduling, tab management |
| `content/search.js` | ~250 | Search page DOM interaction |
| `content/profile.js` | ~180 | Profile page data extraction |
| `content/messenger.js` | ~200 | DM and comment execution |
| `popup/*` | ~150 | Quick control popup |
| `dashboard/*` | ~400 | Full config and monitoring UI |
| `shared/storage.js` | ~80 | Storage wrapper |
| `shared/xpaths.js` | ~120 | DOM selectors with fallbacks |
| `shared/templates.js` | ~60 | Message template engine |
| `shared/scheduler.js` | ~100 | Interval and rate limit logic |
| **Total** | **~1,680** | |
