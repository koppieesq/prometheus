"""The smallest prm python app: standard library plus one pinned package. Used by CI as a first-run check."""
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import six  # proves requirements.txt was installed into the image

DATA = os.environ.get("PRM_DATA_DIR", "/data")


def data_writable():
    path = os.path.join(DATA, ".write-test")
    try:
        with open(path, "w") as f:
            f.write("ok")
        os.remove(path)
        return True
    except OSError:
        return False


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = "\n".join([
            "python: ok",
            "deps: " + ("ok" if six.PY3 else "FAIL"),
            "data: " + ("ok" if data_writable() else "FAIL"),
            "secret: " + ("set" if os.environ.get("EXAMPLE_SECRET") else "unset"),
            "path: " + self.path,
            "",
        ]).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), Handler).serve_forever()
