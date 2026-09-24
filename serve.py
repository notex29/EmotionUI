import argparse
import functools
import http.server
import pathlib
import socket
import socketserver
import threading
import webbrowser


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


def main():
    parser = argparse.ArgumentParser(description="Serve index.html over HTTP.")
    parser.add_argument("-p", "--port", type=int, default=8000, help="Port to listen on (default: 8000)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open the browser")
    args = parser.parse_args()

    root = pathlib.Path(__file__).resolve().parent
    index = root / "index.html"
    if not index.exists():
        raise SystemExit(f"index.html not found in {root}")

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
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
