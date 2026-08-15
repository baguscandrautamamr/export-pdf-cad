"""Vercel Python Serverless Function: loads.json -> xlsx + dxf + pdf.

Exists because Vercel's Node.js runtime has no python3, so the Next route
/api/generate cannot spawn the builders there. That route stays the front door
(it holds the NextAuth session check) and calls this function over HTTP.

Path is /api/build, deliberately not /api/generate, so it never collides with
the Next App Router route of that name.

Contract (identical to what the Next route returns to the browser):
    POST { "loads": <loads.json> }
      -> 200 { "summary": [...], "files": [{name, mime, base64}] }
      -> 4xx/5xx { "error": "..." }

The builders are imported rather than shelled out to: one process, no argv, and
python/ stays the single source of the engineering code.
"""
import base64
import hmac
import json
import os
import pathlib
import shutil
import sys
import tempfile
from http.server import BaseHTTPRequestHandler

# python/ is bundled next to this file by the includeFiles rule in vercel.json.
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))

MIME = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".dxf": "image/vnd.dxf",
    ".pdf": "application/pdf",
}
MAX_BODY = 8 * 1024 * 1024

# Vercel caps a function's *response* at ~4.5 MB, the same way it caps the
# request. Base64 inflates by a third, and the PDF preview is by far the biggest
# of the three files, so a large panel can cross the line and be rejected by the
# platform with an HTML error page rather than anything written here. Staying
# under a slightly lower ceiling leaves room for the JSON envelope and for the
# Node route re-serialising all of this on its way to the browser.
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class ResponseTooLarge(Exception):
    """Deliverables that will not fit in one response. Distinct from ValueError,
    which here always means a rejected loads.json and answers 400."""


def run(loads):
    """Build every deliverable in a temp dir and read it back as base64."""
    import build_dxf
    import build_xlsx
    from panel_core import load_config

    tmp = tempfile.mkdtemp(prefix="panel-")
    try:
        cfg_path = os.path.join(tmp, "loads.json")
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(loads, f)

        # load_config() applies the system defaults; both builders need a config
        # that has been through it, and it must run once so they agree.
        cfg = load_config(cfg_path)

        summary = []
        _, line = build_xlsx.make(cfg, tmp)
        summary.append(line)
        build_dxf.make(cfg, tmp)

        files = []
        for name in sorted(os.listdir(tmp)):
            ext = os.path.splitext(name)[1].lower()
            if name == "loads.json" or ext not in MIME:
                continue
            with open(os.path.join(tmp, name), "rb") as f:
                files.append({
                    "name": name,
                    "mime": MIME[ext],
                    "base64": base64.b64encode(f.read()).decode("ascii"),
                })
        files = fit_response(files, summary)  # may append a note to summary
        return summary, files
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def fit_response(files, summary):
    """Drop the PDF preview when the payload would exceed the platform's limit.

    The xlsx and the dxf are the deliverables; the PDF is a convenience view of
    the dxf that any CAD viewer can reproduce. So when all three will not fit,
    sending two is much better than sending an error - the engineer still gets
    the schedule and the drawing, and the summary says what was left out and
    why. Only if the remaining files still do not fit does this give up, and it
    says so with the actual sizes rather than letting the platform answer with
    an HTML error page the browser cannot parse.
    """
    total = sum(len(f["base64"]) for f in files)
    if total <= MAX_RESPONSE_BYTES:
        return files

    kept = [f for f in files if not f["name"].lower().endswith(".pdf")]
    dropped = total - sum(len(f["base64"]) for f in kept)
    if kept and dropped and sum(len(f["base64"]) for f in kept) <= MAX_RESPONSE_BYTES:
        summary.append(
            f"Preview PDF ({dropped / 1024 / 1024:.1f} MB) tidak disertakan: total "
            f"balasan {total / 1024 / 1024:.1f} MB melebihi batas "
            f"{MAX_RESPONSE_BYTES / 1024 / 1024:.1f} MB. Buka berkas DXF-nya untuk "
            f"melihat gambar yang sama."
        )
        return kept

    raise ResponseTooLarge(
        f"Berkas hasil terlalu besar untuk dikirim balik "
        f"({total / 1024 / 1024:.1f} MB, batas {MAX_RESPONSE_BYTES / 1024 / 1024:.1f} MB). "
        f"Panel sebesar ini sebaiknya dipecah menjadi beberapa panel."
    )


class handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # This function is publicly reachable, so it authenticates the caller
        # itself; the browser never talks to it directly.
        secret = os.environ.get("INTERNAL_API_SECRET")
        if not secret:
            return self._send(500, {"error": "INTERNAL_API_SECRET belum diset"})
        # compare_digest, not !=: a plain comparison returns as soon as two
        # bytes differ, which leaks the length of the matching prefix.
        provided = self.headers.get("x-internal-secret") or ""
        if not hmac.compare_digest(provided, secret):
            return self._send(401, {"error": "Unauthorized"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send(400, {"error": "Content-Length tidak valid"})
        if length <= 0:
            return self._send(400, {"error": "Body kosong"})
        if length > MAX_BODY:
            return self._send(413, {"error": "Body terlalu besar"})

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            loads = payload.get("loads")
        except (ValueError, UnicodeDecodeError) as exc:
            return self._send(400, {"error": f"Body JSON tidak valid: {exc}"})

        if not isinstance(loads, dict):
            return self._send(400, {"error": "field 'loads' tidak ada"})

        # Field-level validation lives in panel_core.validate_loads(), which
        # load_config() calls inside run(); it raises ValueError listing every
        # problem at once. Catching it here is what makes a bad row a 400 with
        # an explanation instead of a 500 with a KeyError in it.
        try:
            summary, files = run(loads)
        except ValueError as exc:
            return self._send(400, {"error": str(exc)})
        except ResponseTooLarge as exc:
            return self._send(413, {"error": str(exc)})
        except Exception as exc:  # noqa: BLE001 - report, don't crash the lambda
            return self._send(500, {"error": f"Generate gagal: {type(exc).__name__}: {exc}"})

        if not files:
            return self._send(500, {"error": "Tidak ada berkas yang dihasilkan"})
        return self._send(200, {"summary": summary, "files": files})
