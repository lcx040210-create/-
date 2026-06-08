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
        # Format: "queryHash/OperationName"
        "SearchTimeline": "AIdc203rPpK_k_2KWSdm7g/SearchTimeline",
        "UserByScreenName": "IGgvgiOx4QZndDHuD3x9TQ/UserByScreenName",
        "Followers": "_orfRBQae57vylFPH0Huhg/Followers",
        "Following": "F42cDX8PDFxkbjjq6JrM2w/Following",
        "UserTweets": "36rb3Xj3iJ64Q-9wKDjCcQ/UserTweets",
    }

    def __init__(self, cookies_file: str = "cookies.txt"):
        self.cookies_file = Path(cookies_file)
        self.client = httpx.Client(
            timeout=30,
            follow_redirects=True,
            verify=False,  # Allow self-signed certs (some proxies/VPNs)

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
                    # Strip any stray newlines from cookie values
                    cookies[name] = value.strip().replace("\n", "").replace("\r", "")

        # Set cookies on the client (use client.cookies for proper encoding)
        for name, value in cookies.items():
            self.client.cookies.set(name, value, domain=".x.com")

        # Verify auth_token exists
        if "auth_token" not in cookies:
            raise ValueError(
                "auth_token cookie not found. Make sure you're logged into x.com "
                "before exporting cookies."
            )

        print(f"[+] Loaded {len(cookies)} cookies (auth_token present)")

    def _fetch_query_ids(self):
        """Auto-extract latest GraphQL query IDs from X's homepage JS bundles."""
        try:
            resp = self.client.get(f"{self.BASE_URL}/home")
            # Extract chunk IDs from homepage HTML
            hash_map = dict(re.findall(r'(\d+):\"([0-9a-f]{7})\"', resp.text))
            name_map = dict(re.findall(r'(\d+):\"([^\"]+?)\"', resp.text))
            name_map = {k: v for k, v in name_map.items() if not re.match(r'^[0-9a-f]{7}$', v)}

            # Fetch the main JS bundle
            for chunk_id, hash_val in list(hash_map.items())[:3]:
                name = name_map.get(chunk_id, chunk_id)
                url = f"https://abs.twimg.com/responsive-web/client-web/{name}.{hash_val}a.js"
                try:
                    js = self.client.get(url).text
                    # Find queryId-operationName pairs
                    pairs = re.findall(
                        r'queryId:\"([^\"]+)\".*?operationName:\"([^\"]+)\"',
                        js, re.DOTALL
                    )
                    for qid, op in pairs:
                        if op in ("SearchTimeline", "UserByScreenName", "Followers", "Following"):
                            self.QUERIES[op] = f"{qid}/{op}"
                            print(f"[+] Found query: {op} = {qid}")
                    if pairs:
                        break
                except Exception:
                    continue

            if "SearchTimeline" not in self.QUERIES:
                # Try alternate pattern
                for chunk_id, hash_val in list(hash_map.items())[:3]:
                    name = name_map.get(chunk_id, chunk_id)
                    url = f"https://abs.twimg.com/responsive-web/client-web/{name}.{hash_val}a.js"
                    try:
                        js = self.client.get(url).text
                        pairs = re.findall(
                            r'operationName:\"([^\"]+)\".*?queryId:\"([^\"]+)\"',
                            js, re.DOTALL
                        )
                        for op, qid in pairs:
                            if op in ("SearchTimeline", "UserByScreenName"):
                                self.QUERIES[op] = f"{qid}/{op}"
                                print(f"[+] Found query (alt): {op} = {qid}")
                        if pairs:
                            break
                    except Exception:
                        continue
        except Exception as e:
            print(f"[!] Could not auto-fetch query IDs: {e}")

    def _init_csrf(self):
        self._fetch_query_ids()
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

    def _api_get(self, path: str, params: dict = None):
        """Make an API request to X's internal/rest API."""
        url = f"{self.BASE_URL}{path}" if path.startswith("/") else path
        resp = self.client.get(url, params=params or {})
        resp.raise_for_status()
        return resp.json()

    def _api_post(self, path: str, data: dict = None):
        """Make a POST request to X's API."""
        url = f"{self.BASE_URL}{path}" if path.startswith("/") else path
        resp = self.client.post(url, data=data or {},
                               headers={"Content-Type": "application/x-www-form-urlencoded"})
        resp.raise_for_status()
        return resp.json()

    # ── Search ──────────────────────────────────────────────

    def search_users(self, keyword: str, count: int = 50, cursor: str = None):
        """
        Search for users by keyword.
        Tries GraphQL first, falls back to REST typeahead API.
        """
        # Try GraphQL first (richer data)
        if "SearchTimeline" in self.QUERIES:
            try:
                return self._search_users_graphql(keyword, count, cursor)
            except Exception as e:
                print(f"  GraphQL search failed ({e}), trying REST...")

        # Fallback to REST typeahead
        return self._search_users_rest(keyword, count)

    def _search_users_graphql(self, keyword: str, count: int, cursor: str = None):
        """Search using GraphQL SearchTimeline endpoint."""
        entry = self.QUERIES["SearchTimeline"]
        query_id, op_name = entry.split("/", 1)

        variables = {
            "rawQuery": keyword,
            "count": min(count, 50),
            "querySource": "typed_query",
            "product": "People",
        }
        if cursor:
            variables["cursor"] = cursor

        params = {"variables": json.dumps(variables)}
        resp = self.client.get(
            f"{self.API_URL}/graphql/{query_id}/{op_name}",
            params=params,
        )
        resp.raise_for_status()
        data = resp.json()

        instructions = (
            data.get("data", {})
            .get("search_by_raw_query", {})
            .get("search_timeline", {})
            .get("timeline", {})
            .get("instructions", [])
        )

        users = []
        next_cursor = None
        for instruction in instructions:
            if instruction.get("type") != "TimelineAddEntries":
                continue
            for entry in instruction.get("entries", []):
                eid = entry.get("entryId", "")
                if eid.startswith("cursor-bottom"):
                    next_cursor = entry.get("content", {}).get("value")
                    continue
                content = entry.get("content", {})
                item = content.get("itemContent", {})
                user_result = item.get("user_results", {}).get("result", {})
                if not user_result:
                    user_result = content.get("userResult", {}).get("result", {})
                if not user_result or not user_result.get("legacy"):
                    continue
                legacy = user_result["legacy"]
                users.append({
                    "id": user_result.get("rest_id"),
                    "handle": legacy.get("screen_name"),
                    "name": legacy.get("name"),
                    "bio": legacy.get("description"),
                    "followers": legacy.get("followers_count", 0),
                    "following": legacy.get("friends_count", 0),
                    "tweets": legacy.get("statuses_count", 0),
                    "avatar": (legacy.get("profile_image_url_https") or "").replace("_normal", ""),
                    "verified": legacy.get("verified", False),
                    "created_at": legacy.get("created_at"),
                    "protected": legacy.get("protected", False),
                })

        return users, next_cursor

    def _search_users_rest(self, keyword: str, count: int):
        """Search using REST typeahead API (fallback)."""
        params = {"q": keyword, "count": min(count, 50), "src": "search_box"}
        data = self._api_get("/i/api/1.1/search/typeahead.json", params)
        users = [
            {
                "id": e.get("id_str"),
                "handle": e.get("screen_name"),
                "name": e.get("name"),
                "bio": e.get("description", ""),
                "followers": e.get("followers_count", 0),
                "following": e.get("friends_count", 0),
                "tweets": 0,
                "avatar": (e.get("profile_image_url_https") or "").replace("_normal", ""),
                "verified": e.get("verified", False),
                "created_at": e.get("created_at"),
                "protected": e.get("protected", False),
            }
            for e in data.get("users", [])
        ]
        return users, None

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
        Send a direct message using X's REST API.
        Tries both new2.json and new.json endpoints.
        """
        # Try the modern endpoint first
        try:
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
        except Exception:
            pass

        # Fallback: legacy endpoint
        try:
            resp = self.client.post(
                "https://api.x.com/1.1/direct_messages/new.json",
                data={
                    "text": text,
                    "screen_name": handle,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if resp.status_code == 200:
                return {"status": "sent", "handle": handle}
        except Exception:
            pass

        return {
            "status": "failed",
            "handle": handle,
            "error": "Could not send DM (endpoints unavailable)",
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
