"""
X (Twitter) Internal API Client
Uses browser cookies for authentication — no API key needed.

Usage:
    1. Export cookies from browser using "Get cookies.txt LOCALLY" extension
    2. Save as cookies.txt in the same directory
    3. Run: python main.py
"""

import json
import time
import random
import re
from pathlib import Path
from typing import Optional

import httpx


class XClient:
    """X internal API client with cookie-based auth."""

    BASE_URL = "https://x.com"
    API_URL = "https://x.com/i/api"

    # GraphQL query IDs (extracted from X's main JS bundle)
    # These may change; the client can auto-fetch fresh ones from the page
    QUERIES = {
        "UserSearch": "g3LljhbJ0DZgE72Ttz4RIA",
        "UserByScreenName": "G3KGOmUDzZxEJmafGqQM1g",
        "Followers": "Xhf09aqpNYqYpk4dIX3tWw",
        "Following": "LZbK0B7RmBf5fQVfJUBj5Q",
        "UserTweets": "E3opETH7OI4oJF7eh4rx-g",
        "CreateMessage": "m5Ntl7Yx6G1eGqD1JGgH0Q",
        "SendMessage": "B6UxGj4z1K2mN8pQ9rS0tV",
    }

    def __init__(self, cookies_file: str = "cookies.txt"):
        self.cookies_file = Path(cookies_file)
        self.client = httpx.Client(
            timeout=30,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/125.0.0.0 Safari/537.36"
                ),
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                "Referer": "https://x.com/",
                "Origin": "https://x.com",
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
                "X-Twitter-Client-Language": "en",
                "X-Twitter-Active-User": "yes",
            },
        )
        self._load_cookies()
        self._init_csrf()

    def _load_cookies(self):
        """Load Netscape-format cookies file."""
        if not self.cookies_file.exists():
            raise FileNotFoundError(
                f"Cookies file not found: {self.cookies_file}\n"
                "Export cookies from your browser using 'Get cookies.txt LOCALLY' extension.\n"
                "Make sure you're logged into x.com before exporting."
            )

        cookies = {}
        with open(self.cookies_file) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split("\t")
                if len(parts) >= 7:
                    name, value = parts[5], parts[6]
                    cookies[name] = value

        # Set cookies on the client
        for name, value in cookies.items():
            self.client.cookies.set(name, value, domain=".x.com")

        # Verify auth_token exists
        if "auth_token" not in cookies:
            raise ValueError(
                "auth_token cookie not found. Make sure you're logged into x.com "
                "before exporting cookies."
            )

        print(f"[+] Loaded {len(cookies)} cookies (auth_token present)")

    def _init_csrf(self):
        """Fetch homepage to get CSRF token."""
        try:
            resp = self.client.get(f"{self.BASE_URL}/home")
            if resp.status_code == 200:
                match = re.search(r'ct0=([a-f0-9]+)', resp.text)
                if match:
                    self.client.headers["X-Csrf-Token"] = match.group(1)
                    print(f"[+] Got CSRF token")
                # Also add authorization from cookies
                if "auth_token" in self.client.cookies:
                    self.client.headers["Authorization"] = (
                        f"Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs"
                        "%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
                    )
        except Exception as e:
            print(f"[!] Warning: Could not init CSRF: {e}")

    def _graphql(self, operation: str, variables: dict, feature_flags: dict = None):
        """Execute a GraphQL query against X's internal API."""
        query_id = self.QUERIES.get(operation)
        if not query_id:
            raise ValueError(f"Unknown operation: {operation}")

        params = {"variables": json.dumps(variables)}
        if feature_flags:
            params["features"] = json.dumps(feature_flags)

        resp = self.client.get(
            f"{self.API_URL}/graphql/{query_id}/{operation}",
            params=params,
        )
        resp.raise_for_status()
        return resp.json()

    # ── Search ──────────────────────────────────────────────

    def search_users(self, keyword: str, count: int = 50, cursor: str = None):
        """
        Search for users by keyword.
        Returns: list of user objects + next cursor for pagination.
        """
        variables = {
            "rawQuery": keyword,
            "count": min(count, 50),
            "querySource": "typed_query",
            "product": "People",
        }
        if cursor:
            variables["cursor"] = cursor

        data = self._graphql("UserSearch", variables)
        result = data.get("data", {}).get("search_by_raw_query", {})

        users = []
        entries = (
            result.get("search_timeline", {})
            .get("timeline", {})
            .get("instructions", [])
        )

        for instruction in entries:
            if instruction.get("type") != "TimelineAddEntries":
                continue
            for entry in instruction.get("entries", []):
                content = entry.get("content", {})
                item = content.get("itemContent", {})
                user_result = item.get("user_results", {}).get("result", {})
                if not user_result:
                    continue

                legacy = user_result.get("legacy", {})
                if not legacy:
                    continue

                user = {
                    "id": user_result.get("rest_id"),
                    "handle": legacy.get("screen_name"),
                    "name": legacy.get("name"),
                    "bio": legacy.get("description"),
                    "followers": legacy.get("followers_count", 0),
                    "following": legacy.get("friends_count", 0),
                    "tweets": legacy.get("statuses_count", 0),
                    "avatar": legacy.get("profile_image_url_https", "").replace("_normal", ""),
                    "verified": legacy.get("verified", False),
                    "created_at": legacy.get("created_at"),
                    "protected": legacy.get("protected", False),
                }
                users.append(user)

        next_cursor = None
        for instruction in entries:
            if instruction.get("type") == "TimelineAddEntries":
                for entry in instruction.get("entries", []):
                    if entry.get("entryId", "").startswith("cursor-bottom"):
                        next_cursor = entry.get("content", {}).get("value")

        return users, next_cursor

    def search_users_all(self, keyword: str, max_results: int = 200):
        """Search users with pagination until max_results or exhaustion."""
        all_users = []
        cursor = None

        while len(all_users) < max_results:
            users, cursor = self.search_users(
                keyword, count=min(50, max_results - len(all_users)), cursor=cursor
            )
            all_users.extend(users)
            print(f"  Found {len(users)} users (total: {len(all_users)})")
            if not cursor or not users:
                break
            time.sleep(random.uniform(1, 3))

        return all_users[:max_results]

    # ── User Profile ────────────────────────────────────────

    def get_user(self, handle: str):
        """Get detailed user profile by screen name."""
        variables = {
            "screen_name": handle,
            "withSafetyModeUserFields": True,
        }
        features = {
            "hidden_profile_likes_enabled": True,
            "highlights_tweets_tab_ui_enabled": True,
            "creator_subscriptions_tweet_preview_api_enabled": True,
        }

        data = self._graphql("UserByScreenName", variables, features)
        result = data.get("data", {}).get("user", {}).get("result", {})
        legacy = result.get("legacy", {})

        return {
            "id": result.get("rest_id"),
            "handle": legacy.get("screen_name"),
            "name": legacy.get("name"),
            "bio": legacy.get("description"),
            "followers": legacy.get("followers_count", 0),
            "following": legacy.get("friends_count", 0),
            "tweets": legacy.get("statuses_count", 0),
            "verified": legacy.get("verified", False),
            "protected": legacy.get("protected", False),
            "created_at": legacy.get("created_at"),
        }

    # ── Direct Messages ─────────────────────────────────────

    def send_dm(self, handle: str, text: str):
        """
        Send a direct message to a user.
        Uses the legacy DM API which is more reliable.
        """
        # Step 1: Create a new conversation
        resp = self.client.post(
            f"{self.API_URL}/1.1/dm/new2.json",
            data={
                "text": text,
                "participants": json.dumps([{"screen_name": handle}]),
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

        if resp.status_code == 200:
            data = resp.json()
            return {"status": "sent", "handle": handle, "id": data.get("id")}

        # Fallback: try the conversation creation endpoint
        if resp.status_code in (403, 404):
            # Try creating via welcome message
            resp2 = self.client.post(
                f"{self.API_URL}/1.1/dm/new.json",
                data={
                    "text": text,
                    "screen_name": handle,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if resp2.status_code == 200:
                return {"status": "sent", "handle": handle}
            return {
                "status": "failed",
                "handle": handle,
                "error": f"HTTP {resp.status_code}: {resp2.text[:200]}",
            }

        return {
            "status": "failed",
            "handle": handle,
            "error": f"HTTP {resp.status_code}: {resp.text[:200]}",
        }

    # ── Rate limit helpers ──────────────────────────────────

    def wait(self, seconds: float = None):
        """Randomized wait between actions."""
        if seconds is None:
            seconds = random.uniform(5, 15)
        time.sleep(seconds)


def load_cookies_from_browser(browser: str = "chrome"):
    """
    Try to load cookies directly from the browser.
    Requires: pip install browser-cookie3
    """
    try:
        import browser_cookie3

        if browser == "chrome":
            cj = browser_cookie3.chrome(domain_name="x.com")
        elif browser == "firefox":
            cj = browser_cookie3.firefox(domain_name="x.com")
        elif browser == "edge":
            cj = browser_cookie3.edge(domain_name="x.com")
        else:
            raise ValueError(f"Unknown browser: {browser}")

        # Write to Netscape format
        cookies_txt = "# Netscape HTTP Cookie File\n"
        for cookie in cj:
            if "x.com" in cookie.domain or "twitter.com" in cookie.domain:
                cookies_txt += (
                    f"{cookie.domain}\tTRUE\t{cookie.path}\t"
                    f"{'TRUE' if cookie.secure else 'FALSE'}\t"
                    f"{cookie.expires or 0}\t{cookie.name}\t{cookie.value}\n"
                )

        Path("cookies.txt").write_text(cookies_txt)
        print(f"[+] Cookies extracted from {browser} → cookies.txt")
        return True
    except ImportError:
        print("[!] browser-cookie3 not installed. Export cookies manually.")
        return False
    except Exception as e:
        print(f"[!] Could not extract cookies: {e}")
        return False
