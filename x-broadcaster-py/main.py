"""
X Broadcaster — Python Edition
Search X users by keyword, filter by criteria, and send bulk DMs.

Setup:
    1. pip install -r requirements.txt
    2. Export cookies from browser (see below)
    3. Edit the CONFIG section below
    4. Run: python main.py

Cookie Export:
    Option A (auto): pip install browser-cookie3  → script reads from Chrome
    Option B (manual): Install "Get cookies.txt LOCALLY" Chrome extension
                       → Visit x.com → export → save as cookies.txt
"""

import json
import time
import random
import sys
from pathlib import Path

from x_client import XClient, load_cookies_from_browser
from filter import filter_users

# ═══════════════════════════════════════════════════════════
# CONFIGURATION — Edit these settings
# ═══════════════════════════════════════════════════════════

CONFIG = {
    # Search keyword (required)
    "keyword": "AI startup",

    # How many users to search for
    "max_search": 100,

    # Filter rules (set to 0/None to disable)
    "filters": {
        "min_followers": 50,        # Minimum followers (0 = no min)
        "max_followers": None,      # Maximum followers (None = no max)
        "max_follow_ratio": 5.0,    # Max following/followers ratio
        "require_avatar": True,     # Must have profile pic
        "require_bio": True,        # Must have bio
        "min_tweets": 10,           # Minimum tweets
        "exclude_protected": True,  # Skip private accounts
        "topic_keywords": [],       # Bio must contain one of: ["AI", "crypto"]
    },

    # Message to send (use {name} and {handle} as placeholders)
    "message": "Hi {name}! Noticed your profile. Would love to connect!",

    # Rate limits (seconds)
    "dm_interval_min": 30,         # Min seconds between DMs
    "dm_interval_max": 60,         # Max seconds between DMs
    "daily_limit": 50,             # Max DMs per run

    # Set to True for a dry run (search + filter only, no DMs sent)
    "dry_run": True,
}

# ═══════════════════════════════════════════════════════════


def format_message(template: str, user: dict) -> str:
    """Replace {name}, {handle}, {followers} in template."""
    return (
        template.replace("{name}", user.get("name", user.get("handle", "")))
        .replace("{handle}", user.get("handle", ""))
        .replace("{followers}", str(user.get("followers", 0)))
    )


def load_sent_handles() -> set:
    """Load previously sent handles to avoid duplicates."""
    sent_file = Path("sent_handles.txt")
    if sent_file.exists():
        return set(sent_file.read_text().strip().split("\n"))
    return set()


def save_sent_handle(handle: str):
    """Record a handle as sent."""
    with open("sent_handles.txt", "a") as f:
        f.write(handle + "\n")


def main():
    print("=" * 60)
    print("  X Broadcaster — Python Edition")
    print("=" * 60)

    cfg = CONFIG
    if cfg["dry_run"]:
        print("\n[!] DRY RUN — no messages will be sent\n")

    # ── 1. Authentication ──────────────────────────────────

    print("[1/5] Loading cookies...")

    # Try auto-extract from browser first
    cookies_file = Path("cookies.txt")
    if not cookies_file.exists():
        print("  No cookies.txt found, trying browser auto-extract...")
        success = False
        for browser in ["chrome", "edge", "brave"]:
            try:
                if load_cookies_from_browser(browser):
                    success = True
                    break
            except Exception:
                pass

        if not success:
            print("\n[X] Cannot auto-extract cookies (requires admin on Windows).")
            print()
            print("  Manual method (takes 30 seconds):")
            print("  1. Open Chrome → go to x.com → log in")
            print("  2. Install 'Get cookies.txt LOCALLY' extension:")
            print("     https://chrome.google.com/webstore/detail/cclelndahbckbenkjhflpdbgdldlbecc")
            print("  3. Click the extension icon → Export")
            print("  4. Save the file as: cookies.txt")
            print(f"     in: {Path.cwd()}")
            print("  5. Run: python main.py")
            sys.exit(1)

    try:
        client = XClient(str(cookies_file))
    except (FileNotFoundError, ValueError) as e:
        print(f"\n[X] {e}")
        sys.exit(1)

    print("  [OK] Authenticated\n")

    # ── 2. Search ──────────────────────────────────────────

    keyword = cfg["keyword"]
    print(f"[2/5] Searching: '{keyword}'...")

    users = client.search_users_all(keyword, max_results=cfg["max_search"])
    print(f"  [OK] Found {len(users)} users\n")

    if not users:
        print("No users found. Try a different keyword.")
        return

    # ── 3. Filter ──────────────────────────────────────────

    rules = cfg["filters"]
    print(f"[3/5] Filtering with rules: {json.dumps(rules)}")

    filtered = filter_users(users, rules)
    print(f"  [OK] {len(filtered)} passed ({len(users) - len(filtered)} filtered out)\n")

    if not filtered:
        print("All users filtered out. Relax your filter criteria.")
        return

    # Show top results
    print("  Top matches:")
    for i, u in enumerate(filtered[:10]):
        print(
            f"    {i+1}. @{u['handle']} — "
            f"{u['followers']:,} followers, "
            f"{u.get('bio', '')[:60]}..."
        )
    print()

    # ── 4. Confirm ─────────────────────────────────────────

    if cfg["dry_run"]:
        print("[4/5] DRY RUN — skipping DM send.")
        print(f"  Would send to {len(filtered)} users.")
        print("  Edit CONFIG and set dry_run=False to send for real.")
        return

    print(f"[4/5] Ready to send DMs to {len(filtered)} users.")
    confirm = input("  Continue? (yes/no): ").strip().lower()
    if confirm not in ("yes", "y"):
        print("  Cancelled.")
        return

    # ── 5. Send DMs ────────────────────────────────────────

    sent_handles = load_sent_handles()
    template = cfg["message"]
    count = 0

    print(f"\n[5/5] Sending DMs...")

    for i, user in enumerate(filtered):
        handle = user["handle"]

        # Skip already sent
        if handle in sent_handles:
            print(f"  [{i+1}/{len(filtered)}] @{handle} — already sent, skip")
            continue

        if count >= cfg["daily_limit"]:
            print(f"\n  Daily limit ({cfg['daily_limit']}) reached. Stopping.")
            break

        msg = format_message(template, user)
        print(f"  [{i+1}/{len(filtered)}] @{handle} — ", end="", flush=True)

        result = client.send_dm(handle, msg)

        if result["status"] == "sent":
            print("[OK]")
            save_sent_handle(handle)
            sent_handles.add(handle)
            count += 1
        else:
            print(f"[FAIL] ({result.get('error', 'unknown')})")

        # Randomized delay
        delay = random.uniform(cfg["dm_interval_min"], cfg["dm_interval_max"])
        if i < len(filtered) - 1 and count < cfg["daily_limit"]:
            print(f"      Waiting {delay:.0f}s...")
            time.sleep(delay)

    print(f"\n[OK] Done! Sent {count} messages.")


if __name__ == "__main__":
    main()
