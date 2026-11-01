"""No-cache static dev server (browsers otherwise keep serving stale ES modules).
Usage: python tools/serve.py [port] [root]   (defaults: 8100, repo root)"""
import functools, http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8100
root = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
http.server.ThreadingHTTPServer(('', port), functools.partial(Handler, directory=root)).serve_forever()
