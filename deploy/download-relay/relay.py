"""Read-only installer relay. Run behind HTTPS nginx; no credentials or arbitrary URLs."""
import base64
import http.server
import re
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request

MAX_BYTES = 2 * 1024**3
SLOTS = threading.BoundedSemaphore(12)
RULES = {
    "downloads.claude.ai": ("/claude-code-releases/", "/releases/"),
    "claude.ai": ("/api/desktop/",),
    "api.github.com": ("/repos/openai/codex/releases/",),
    "github.com": ("/openai/codex/releases/download/",),
    "release-assets.githubusercontent.com": ("/github-production-release-asset/",),
    "persistent.oaistatic.com": ("/codex-app-prod/",),
    "formulae.brew.sh": ("/api/cask/claude.json",),
}

def allowed(url):
    try:
        p = urllib.parse.urlsplit(url)
        return (p.scheme == "https" and p.port in (None, 443) and not p.username
                and not p.password and not p.fragment and len(url) <= 8192
                and ".." not in urllib.parse.unquote(p.path).split("/")
                and "\\" not in urllib.parse.unquote(p.path)
                and any(p.path.startswith(prefix) for prefix in RULES.get(p.hostname, ())))
    except ValueError:
        return False

class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not allowed(newurl):
            raise urllib.error.HTTPError(newurl, 403, "Upstream redirect is not allowed", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200); self.send_header("Content-Length", "2"); self.end_headers(); self.wfile.write(b"ok"); return
        parsed = urllib.parse.urlsplit(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if parsed.path != "/fetch" or set(params) != {"url"} or len(params["url"]) != 1:
            self.send_error(404); return
        try:
            value = params["url"][0]
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,11000}", value): raise ValueError()
            url = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)).decode("utf-8")
            if not allowed(url): raise ValueError()
        except (ValueError, UnicodeError):
            self.send_error(400, "Unsupported installer resource"); return
        if not SLOTS.acquire(blocking=False):
            self.send_error(503, "Relay busy"); return
        started = False
        try:
            headers = {"User-Agent": "ourzai-installer-relay/1", "Accept-Encoding": "identity"}
            range_value = self.headers.get("Range")
            if range_value:
                if not re.fullmatch(r"bytes=\d+-\d*", range_value):
                    self.send_error(400); return
                headers["Range"] = range_value
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), Redirects())
            with opener.open(urllib.request.Request(url, headers=headers), timeout=25) as response:
                length = response.headers.get("Content-Length")
                if length and int(length) > MAX_BYTES:
                    self.send_error(413); return
                self.send_response(response.status)
                for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"):
                    if response.headers.get(key): self.send_header(key, response.headers[key])
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Connection", "close")
                self.end_headers(); started = True
                total = 0
                while chunk := response.read(128 * 1024):
                    total += len(chunk)
                    if total > MAX_BYTES: break
                    self.wfile.write(chunk)
        except urllib.error.HTTPError as error:
            if not started: self.send_error(error.code if error.code in (403,404,410,416,429) else 502, "Upstream unavailable")
        except (OSError, ValueError, TimeoutError):
            if not started: self.send_error(502, "Upstream unavailable")
        finally:
            self.close_connection = True
            SLOTS.release()

    def log_message(self, fmt, *args):
        # Do not log query strings, upstream signed URLs, or client identifiers.
        pass

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def get_request(self):
        client, address = super().get_request(); client.settimeout(30); return client, address

if __name__ == "__main__":
    Server(("127.0.0.1", 18942), Handler).serve_forever()
