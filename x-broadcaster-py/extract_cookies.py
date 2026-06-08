"""
Extract X cookies from Chrome using CDP (Chrome DevTools Protocol).
Launches Chrome with remote debugging, navigates to x.com,
waits for manual login, then extracts auth cookies.

Does NOT require admin privileges.
Does NOT read from Chrome's database.
"""

import subprocess
import json
import time
import os
import sys
from pathlib import Path
import http.client

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
if not os.path.exists(CHROME_PATH):
    CHROME_PATH = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not os.path.exists(CHROME_PATH):
    CHROME_PATH = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")


def find_chrome():
    """Find Chrome executable."""
    paths = [
        CHROME_PATH,
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in paths:
        if os.path.exists(p):
            return p
    return None


def launch_chrome():
    """Launch Chrome with remote debugging enabled."""
    chrome = find_chrome()
    if not chrome:
        print("❌ Chrome not found. Please install Chrome.")
        sys.exit(1)

    print(f"Launching Chrome with remote debugging...")
    print(f"  Chrome: {chrome}")

    # Kill any existing debug instance
    subprocess.run(["taskkill", "/F", "/IM", "chrome.exe"],
                   capture_output=True, shell=True)
    time.sleep(1)

    # Launch Chrome with remote debugging
    subprocess.Popen([
        chrome,
        "--remote-debugging-port=9222",
        "--user-data-dir=" + os.path.join(os.environ["TEMP"], "chrome_debug_profile"),
        "https://x.com",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    print("  Chrome launched. Waiting for it to start...")
    time.sleep(3)


def get_cdp_target():
    """Get the CDP websocket URL for the x.com tab."""
    conn = http.client.HTTPConnection("localhost", 9222)
    conn.request("GET", "/json")
    resp = conn.getresponse()
    data = json.loads(resp.read().decode())

    for page in data:
        if page.get("type") == "page" and "x.com" in page.get("url", ""):
            return page["id"], page["webSocketDebuggerUrl"]

    # Just return the first page
    for page in data:
        if page.get("type") == "page":
            return page["id"], page["webSocketDebuggerUrl"]

    return None, None


def extract_cookies_via_cdp():
    """Extract cookies using CDP Network.getCookies."""
    import websocket  # pip install websocket-client

    page_id, ws_url = get_cdp_target()
    if not ws_url:
        print("❌ Could not find x.com tab. Is Chrome running with --remote-debugging-port?")
        return None

    ws = websocket.create_connection(ws_url)

    def send_cmd(method, params=None):
        msg_id = int(time.time() * 1000)
        msg = {"id": msg_id, "method": method, "params": params or {}}
        ws.send(json.dumps(msg))
        # Read response
        response = ws.recv()
        return json.loads(response)

    # Get cookies for x.com
    result = send_cmd("Network.getCookies", {"urls": ["https://x.com"]})
    cookies = result.get("result", {}).get("cookies", [])

    ws.close()
    return cookies


def main():
    print("=" * 50)
    print("  X Cookies Extractor (CDP)")
    print("=" * 50)

    launch_chrome()

    print("\n📋 Chrome opened with x.com.")
    print("   If you're not logged in, please log in now.")
    input("   Press ENTER when you're logged into x.com...")

    try:
        cookies = extract_cookies_via_cdp()
    except ImportError:
        print("\n❌ Need websocket-client: pip install websocket-client")
        sys.exit(1)

    if not cookies:
        print("\n❌ Could not extract cookies.")
        print("   Try manual method:")
        print("   1. On x.com, F12 → Console")
        print("   2. Type: document.cookie")
        print("   3. Copy output → save as cookies.txt")
        sys.exit(1)

    # Write cookies in Netscape format
    lines = ["# Netscape HTTP Cookie File\n"]
    for c in cookies:
        domain = c.get("domain", ".x.com")
        name = c.get("name", "")
        value = c.get("value", "")
        path = c.get("path", "/")
        secure = "TRUE" if c.get("secure") else "FALSE"
        expires = c.get("expires", 0)
        if isinstance(expires, float):
            expires = int(expires)
        lines.append(f"{domain}\tTRUE\t{path}\t{secure}\t{expires}\t{name}\t{value}\n")

    Path("cookies.txt").write_text("".join(lines), encoding="utf-8")
    print(f"\n✅ Extracted {len(cookies)} cookies → cookies.txt")

    # Show auth status
    auth_token = next((c for c in cookies if c["name"] == "auth_token"), None)
    if auth_token:
        print("   auth_token: PRESENT ✓")
    else:
        print("   ⚠ auth_token NOT found — are you logged into x.com?")

    print("\nDone! Now run: python main.py")


if __name__ == "__main__":
    main()
