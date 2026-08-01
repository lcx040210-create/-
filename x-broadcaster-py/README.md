# X Broadcaster — Python Edition

Search X users by keyword, filter by followers/bio/topics, and send bulk DMs.

## How It Works

- Uses X's **internal API** (the same one the web app uses)
- Authenticates via **browser cookies** — no API key needed
- Pure HTTP requests — no DOM, no browser automation, no breakage on X UI changes

## Setup

```bash
pip install -r requirements.txt
```

### Get Cookies

**Option A — Auto (recommended):**
```bash
pip install browser-cookie3
python main.py  # auto-extracts from Chrome
```

**Option B — Manual:**
1. Install [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) Chrome extension
2. Visit `x.com` (make sure you're logged in)
3. Click the extension → Export → Save as `cookies.txt` in this folder

## Usage

1. Edit `main.py` → `CONFIG` section:
   - `keyword`: What to search for
   - `filters`: Who to target (followers, bio, etc.)
   - `message`: What to send
   - `dry_run`: Set to `False` to actually send

2. Run:
```bash
python main.py
```

3. First do a **dry run** (`dry_run: True`) to preview who you'd message.

## Config Reference

```python
CONFIG = {
    "keyword": "AI startup",       # Search term
    "max_search": 100,             # Max users to find
    "filters": {
        "min_followers": 50,       # Min follower count
        "require_avatar": True,     # Must have profile pic
        "require_bio": True,        # Must have bio
        "topic_keywords": [],       # Bio must contain: ["AI", "crypto"]
        "min_tweets": 10,          # Min post count
        "exclude_protected": True,  # Skip private accounts
    },
    "message": "Hi {name}! ...",   # {name}, {handle}, {followers}
    "dm_interval_min": 30,         # Min seconds between DMs
    "dm_interval_max": 60,         # Max seconds between DMs
    "daily_limit": 50,             # Max DMs per run
    "dry_run": True,               # Preview only (set False to send)
}
```

## Notes

- X rate limits ~50-100 DMs/day for regular accounts
- Keep intervals reasonable (30s+) to avoid detection
- The script skips users it's already messaged (tracked in `sent_handles.txt`)
