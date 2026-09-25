import argparse
import functools
import http.server
import pathlib
import socket
import socketserver
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser


# Hosts the /api/proxy relay is allowed to fetch. Card search and card images
# only — never anything that could be pointed at a local network service.
PROXY_ALLOWED_HOSTS = frozenset({
    "chub.ai",
    "www.chub.ai",
    "api.chub.ai",
    "gateway.chub.ai",
    "ro.chub.ai",
    "characterhub.org",
    "www.characterhub.org",
    "avatars.charhub.io",
    "image.chub.ai",
})

PROXY_MAX_BYTES = 12 * 1024 * 1024
PROXY_TIMEOUT = 25
PROXY_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def ipv6_localhost_taken(port):
    """True when another process already listens on ::1:<port>."""
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
    try:
        s.bind(("::1", port))
        return False
    except OSError:
        return True
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files plus a read-only, allowlisted relay for card imports."""

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/proxy":
            self.serve_proxy()
            return
        super().do_GET()

    def serve_proxy(self):
        parsed = urllib.parse.urlparse(self.path)
        target = urllib.parse.parse_qs(parsed.query, keep_blank_values=True).get("url", [""])[0]
        if not target:
            return self.proxy_error(400, "Missing ?url= parameter.")

        try:
            url = urllib.parse.urlsplit(target)
        except ValueError:
            return self.proxy_error(400, "Malformed url.")

        if url.scheme != "https":
            return self.proxy_error(400, "Only https targets are proxied.")
        host = (url.hostname or "").lower()
        if host not in PROXY_ALLOWED_HOSTS:
            return self.proxy_error(403, f"Host not allowed: {host or '?'}")

        req = urllib.request.Request(target, headers={
            "User-Agent": PROXY_USER_AGENT,
            "Accept": "*/*",
        })
        try:
            with urllib.request.urlopen(req, timeout=PROXY_TIMEOUT) as res:
                body = res.read(PROXY_MAX_BYTES + 1)
                if len(body) > PROXY_MAX_BYTES:
                    return self.proxy_error(502, "Response too large to relay.")
                ctype = res.headers.get("Content-Type", "application/octet-stream")
                self.send_response(res.status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            # Pass the upstream status through so the app can tell 403/404/429 apart.
            try:
                detail = e.read(2048).decode("utf-8", "replace")
            except Exception:
                detail = ""
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "text/plain") if e.headers else "text/plain")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write((detail or e.reason or "").encode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self.proxy_error(502, f"Upstream request failed: {e}")

    def proxy_error(self, code, message):
        body = message.encode("utf-8", "replace")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        # The app is local-first: never let a proxy answer poison the page cache.
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description="Serve index.html over HTTP.")
    parser.add_argument("-p", "--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open the browser")
    parser.add_argument("--no-proxy", action="store_true", help="Disable the /api/proxy relay for online card imports")
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parent
    index = root / "index.html"
    if not index.exists():
        raise SystemExit(f"index.html not found in {root}")

    handler = functools.partial(Handler, directory=str(root))
    socketserver.TCPServer.allow_reuse_address = True

    # Other apps (XAMPP PHP, AI engines, old servers) often occupy a port on
    # IPv6 localhost, which the browser reaches before our IPv4 server.
    # Skip any port that is taken on IPv4 OR IPv6.
    httpd = None
    port = args.port
    for _ in range(20):
        occupied = ipv6_localhost_taken(port)
        if not occupied:
            try:
                httpd = socketserver.ThreadingTCPServer((args.host, port), handler)
                break
            except OSError as e:
                print(f"Port {port} unavailable ({e}). Trying {port + 1}…", flush=True)
                port += 1
                continue
        if occupied:
            print(f"Port {port} is already used by another local server (likely on localhost IPv6). Trying {port + 1}…", flush=True)
            port += 1
    if httpd is None:
        raise SystemExit("No free port found.")

    with httpd:
        # Use 127.0.0.1 on purpose: "localhost" on Windows resolves to ::1
        # first, which would hit any IPv6 server squatting on the same port.
        url = f"http://127.0.0.1:{port}/index.html"
        print(f"Serving {root} at {url}", flush=True)
        print("Files:", ", ".join(sorted(p.name for p in root.iterdir() if p.is_file())), flush=True)
        if args.no_proxy:
            print("Card relay: disabled (/api/proxy is 404).", flush=True)
        else:
            print(f"Card relay: http://127.0.0.1:{port}/api/proxy  (paste this into Settings if card sites are blocked)", flush=True)
        print("Press Ctrl+C to stop.", flush=True)
        if not args.no_browser:
            try:
                threading.Timer(0.5, lambda: webbrowser.open(url, new=2)).start()
            except Exception:
                pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
