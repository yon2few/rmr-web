#!/usr/bin/env python3
"""Local static + /api/thread proxy. Production uses the Netlify function."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, urlencode, quote
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import json
import os
import sys

ROOT = Path(__file__).resolve().parent
UA = "ArTReader-RMR/1.0 (https://artreader.art/rmr)"
PORT = 8777


def parse_input(url: str):
    raw = (url or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        return urlparse(raw)
    except ValueError:
        return None


def is_reddit_host(host: str) -> bool:
    host = (host or "").lower()
    return host == "reddit.com" or host.endswith(".reddit.com") or host == "redd.it" or host.endswith(".redd.it")


def is_thread(url: str) -> bool:
    u = parse_input(url)
    if not u:
        return False
    host = (u.hostname or "").lower()
    path = u.path or ""
    if host == "redd.it" or host.endswith(".redd.it"):
        return bool(path.strip("/"))
    if not is_reddit_host(host):
        return False
    return "/comments/" in path or "/s/" in path


def normalize(url: str) -> str:
    u = parse_input(url)
    if not u:
        raise ValueError("Invalid Reddit URL")
    host = (u.hostname or "").lower()
    path = (u.path or "").rstrip("/")
    if host == "redd.it" or host.endswith(".redd.it"):
        post_id = path.strip("/")
        return f"https://www.reddit.com/comments/{post_id}"
    if host in ("old.reddit.com", "sh.reddit.com", "new.reddit.com", "reddit.com"):
        host = "www.reddit.com"
    return f"https://{host}{path}"


def thread_id(url: str) -> str:
    u = parse_input(url)
    if not u:
        return ""
    host = (u.hostname or "").lower()
    parts = [p for p in (u.path or "").split("/") if p]
    if host == "redd.it" or host.endswith(".redd.it"):
        return parts[0] if parts else ""
    if "comments" in parts:
        i = parts.index("comments")
        if i + 1 < len(parts):
            return parts[i + 1]
    return ""


SHARE_EXPAND_URL = os.environ.get(
    "REDDIT_URL_TO_JSON_SERVICE_URL",
    "https://reddit-url-to-json-service-375541022505.us-central1.run.app",
).rstrip("/")
BROWSER_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)


def comments_url_from_text(text: str) -> str:
    match = re.search(
        r"https?://(?:www\.|old\.)?reddit\.com/(?:r/[^/]+/|u(?:ser)?/[^/]+/)?comments/([A-Za-z0-9]+)",
        text or "",
        re.I,
    )
    if not match:
        return ""
    sub = re.search(r"reddit\.com/r/([^/]+)/comments/", text or "", re.I)
    if sub:
        return f"https://www.reddit.com/r/{sub.group(1)}/comments/{match.group(1)}"
    return f"https://www.reddit.com/comments/{match.group(1)}"


def expand_via_oauth_service(url: str) -> str:
    api = f"{SHARE_EXPAND_URL}/expand?url={quote(url, safe='')}"
    status, payload = fetch_json(api)
    found = comments_url_from_text((payload or {}).get("commentsUrl") or "")
    if found:
        return found
    detail = (payload or {}).get("error") or f"HTTP {status}"
    raise RuntimeError(f"OAuth expand failed ({detail}).")


def fetch_oauth_thread(url: str, sort: str):
    api = (
        f"{SHARE_EXPAND_URL}/thread?url={quote(url, safe='')}"
        f"&sort={quote(sort, safe='')}"
    )
    status, payload = fetch_json(api)
    if status == 200 and has_post(payload):
        return payload
    detail = (payload or {}).get("error") if isinstance(payload, dict) else None
    raise RuntimeError(detail or f"OAuth thread failed (HTTP {status}).")


def expand_via_reddit_redirect(url: str) -> str:
    parsed = parse_input(url)
    share_path = parsed.path if parsed else ""
    for host in ("www.reddit.com", "old.reddit.com"):
        target = f"https://{host}{share_path}"
        req = Request(target, headers={"Accept": "text/html", "User-Agent": BROWSER_UA}, method="GET")
        try:
            with urlopen(req, timeout=15) as res:
                found = comments_url_from_text(res.geturl())
                if found:
                    return found
        except HTTPError as err:
            loc = err.headers.get("Location") if err.headers else None
            if loc:
                loc = loc if loc.startswith("http") else f"https://{host}{loc}"
                found = comments_url_from_text(loc)
                if found:
                    return found
        except (URLError, TimeoutError):
            continue
    raise RuntimeError("Reddit did not return a /comments/ URL for that share link.")


def follow_share(url: str) -> str:
    errors = []
    try:
        return expand_via_oauth_service(url)
    except Exception as err:
        errors.append(str(err))
    try:
        return expand_via_reddit_redirect(url)
    except Exception as err:
        errors.append(str(err))
    raise RuntimeError(
        "Could not expand that Reddit share link ("
        + "; ".join(errors)
        + "). Open it once and paste the /comments/ URL from the address bar."
    )


def to_json_url(thread_url: str, sort: str, host: str) -> str:
    u = urlparse(thread_url)
    path = (u.path or "").rstrip("/")
    if not path.endswith(".json"):
        path = f"{path}.json"
    reddit_sort = "confidence" if sort == "best" else sort
    return f"https://{host}{path}?sort={reddit_sort}&raw_json=1"


def fetch_json(url: str):
    req = Request(url, headers={"Accept": "application/json", "User-Agent": UA})
    try:
        with urlopen(req, timeout=20) as res:
            return res.status, json.loads(res.read().decode("utf-8"))
    except HTTPError as err:
        return err.code, None
    except (URLError, TimeoutError, json.JSONDecodeError, UnicodeDecodeError):
        return 502, None


def has_post(payload) -> bool:
    try:
        return bool(payload[0]["data"]["children"][0]["data"]["id"])
    except (TypeError, KeyError, IndexError):
        return False


def rebuild_listing(post, comments):
    by_name = {}
    roots = []
    for comment in comments:
        cid = comment.get("id")
        if not cid:
            continue
        by_name[f"t1_{cid}"] = {
            "kind": "t1",
            "data": {
                "author": comment.get("author"),
                "body": comment.get("body"),
                "id": cid,
                "parent_id": comment.get("parent_id"),
                "score": comment.get("score"),
                "replies": {"kind": "Listing", "data": {"children": []}},
            },
        }
    for comment in comments:
        cid = comment.get("id")
        node = by_name.get(f"t1_{cid}")
        if not node:
            continue
        parent = comment.get("parent_id") or ""
        if parent.startswith("t3_"):
            roots.append(node)
        elif parent in by_name:
            by_name[parent]["data"]["replies"]["data"]["children"].append(node)
        else:
            roots.append(node)
    return [
        {"kind": "Listing", "data": {"children": [{"kind": "t3", "data": post}]}},
        {"kind": "Listing", "data": {"children": roots}},
    ]


def fetch_reddit(thread_url: str, sort: str):
    for host in ("www.reddit.com", "old.reddit.com"):
        status, payload = fetch_json(to_json_url(thread_url, sort, host))
        if status == 200 and has_post(payload):
            return payload
        if status not in (429, 403):
            break
    return None


def fetch_pullpush(thread_url: str, sort: str):
    post_id = thread_id(thread_url)
    if not post_id:
        return None
    if sort == "old":
        order = {"sort": "asc", "sort_type": "created_utc"}
    elif sort == "new":
        order = {"sort": "desc", "sort_type": "created_utc"}
    else:
        order = {"sort": "desc", "sort_type": "score"}
    post_qs = urlencode({"ids": post_id})
    comment_qs = urlencode({
        "link_id": f"t3_{post_id}",
        "size": 100,
        "sort": order["sort"],
        "sort_type": order["sort_type"],
    })
    _, post_payload = fetch_json(f"https://api.pullpush.io/reddit/search/submission/?{post_qs}")
    _, comment_payload = fetch_json(f"https://api.pullpush.io/reddit/search/comment/?{comment_qs}")
    posts = (post_payload or {}).get("data") or []
    if not posts or not posts[0].get("id"):
        return None
    comments = (comment_payload or {}).get("data") or []
    return rebuild_listing(posts[0], comments)


def fetch_arctic(thread_url: str):
    post_id = thread_id(thread_url)
    if not post_id:
        return None
    _, post_payload = fetch_json(
        f"https://arctic-shift.photon-reddit.com/api/posts/ids?ids={quote(post_id, safe='')}"
    )
    _, comment_payload = fetch_json(
        f"https://arctic-shift.photon-reddit.com/api/comments/search?link_id={quote(post_id, safe='')}&limit=100"
    )
    posts = (post_payload or {}).get("data") or []
    if not posts or not posts[0].get("id"):
        return None
    comments = (comment_payload or {}).get("data") or []
    return rebuild_listing(posts[0], comments)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/api/thread", "/rmr/api/thread"):
            return self.handle_thread(parsed)
        return super().do_GET()

    def handle_thread(self, parsed):
        qs = parse_qs(parsed.query)
        raw = (qs.get("url") or [""])[0].strip()
        sort = (qs.get("sort") or ["best"])[0].strip() or "best"
        if not raw or not is_thread(raw):
            return self.json(400, {"error": "Pass a reddit.com, redd.it, or /s/ thread link as ?url="})
        parsed = parse_input(raw)
        try:
            thread = follow_share(raw) if parsed and "/s/" in (parsed.path or "") else normalize(raw)
        except Exception as err:
            return self.json(502, {"error": str(err)})
        if not thread_id(thread):
            return self.json(502, {
                "error": "Could not expand that Reddit share link. Open it once and paste the /comments/ URL from the address bar."
            })
        try:
            payload = fetch_oauth_thread(raw, sort)
        except Exception:
            try:
                payload = fetch_reddit(thread, sort) or fetch_pullpush(thread, sort) or fetch_arctic(thread)
            except Exception as err:
                return self.json(502, {"error": str(err)})
        if not payload:
            return self.json(502, {"error": "Could not load that Reddit thread."})
        return self.json(200, payload)

    def json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"RMR web http://127.0.0.1:{port}/")
    server.serve_forever()
