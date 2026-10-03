"""TANAW IoT HTTPS receiver.

Accepts JSON readings POSTed by ESP32 stations and stores them in SQLite.
Uses only the Python standard library, so no extra install is needed.

Expected request:
    POST /ingest
    Content-Type: application/json
    Authorization: Bearer <token>   (optional; required if TANAW_STATION_TOKEN set)

    {
      "station_id": "river-marikina-bridge-01",
      "station_type": "river",
      "temp_c": 31.4,
      "humidity_pct": 78.0,
      "water_raw": 1820,
      "water_percent": 61,
      "status": "NORMAL"
    }

Run (self-signed cert for local dev):
    python iot/server/receiver.py --gen-cert
    python iot/server/receiver.py --host 0.0.0.0 --port 8443

Set a shared secret to require auth (must match STATION_TOKEN in firmware):
    set TANAW_STATION_TOKEN=mysecret        # Windows
    export TANAW_STATION_TOKEN=mysecret     # Linux/macOS
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import ssl
import subprocess
import sys
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_DB = HERE / "readings.db"
DEFAULT_CERT = HERE / "server.crt"
DEFAULT_KEY = HERE / "server.key"

REQUIRED_FIELDS = ("station_id", "station_type")
MAX_BODY_BYTES = 8192


def init_db(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS station_readings (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id    TEXT NOT NULL,
            station_type  TEXT,
            reading_at    TEXT NOT NULL,
            temp_c        REAL,
            humidity_pct  REAL,
            water_raw     INTEGER,
            water_percent INTEGER,
            status        TEXT
        )
        """
    )
    conn.commit()
    return conn


def store_reading(conn: sqlite3.Connection, payload: dict) -> None:
    conn.execute(
        """
        INSERT INTO station_readings
            (station_id, station_type, reading_at, temp_c, humidity_pct,
             water_raw, water_percent, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            payload.get("station_id"),
            payload.get("station_type"),
            datetime.now(UTC).isoformat(),
            payload.get("temp_c"),
            payload.get("humidity_pct"),
            payload.get("water_raw"),
            payload.get("water_percent"),
            payload.get("status"),
        ),
    )
    conn.commit()


class Handler(BaseHTTPRequestHandler):
    # Injected by the server factory below.
    conn: sqlite3.Connection
    token: str

    def _reply(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not self.token:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {self.token}"

    def do_GET(self):  # noqa: N802 (stdlib naming)
        if self.path == "/health":
            self._reply(200, {"ok": True})
        else:
            self._reply(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802 (stdlib naming)
        if self.path != "/ingest":
            self._reply(404, {"error": "not found"})
            return

        if not self._authorized():
            self._reply(401, {"error": "unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._reply(400, {"error": "bad content-length"})
            return

        if length <= 0 or length > MAX_BODY_BYTES:
            self._reply(413, {"error": "body missing or too large"})
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._reply(400, {"error": "invalid json"})
            return

        if not isinstance(payload, dict):
            self._reply(400, {"error": "expected a json object"})
            return

        missing = [f for f in REQUIRED_FIELDS if not payload.get(f)]
        if missing:
            self._reply(422, {"error": f"missing fields: {', '.join(missing)}"})
            return

        store_reading(self.conn, payload)
        print(
            f"[{datetime.now(UTC).isoformat()}] stored reading "
            f"from {payload.get('station_id')}: "
            f"temp={payload.get('temp_c')} water%={payload.get('water_percent')} "
            f"status={payload.get('status')}"
        )
        self._reply(201, {"ok": True})

    def log_message(self, fmt, *args):  # keep the console focused on readings
        return


def make_handler(conn: sqlite3.Connection, token: str):
    return type("BoundHandler", (Handler,), {"conn": conn, "token": token})


def gen_self_signed_cert(cert_path: Path, key_path: Path) -> None:
    """Generate a self-signed cert for local dev.

    Prefers openssl; falls back to the `cryptography` package if openssl is not
    on PATH (common on Windows).
    """
    cmd = [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        str(key_path),
        "-out",
        str(cert_path),
        "-days",
        "365",
        "-subj",
        "/CN=tanaw-iot-dev",
    ]
    try:
        subprocess.run(cmd, check=True)
        print(f"Wrote {cert_path} and {key_path} (openssl)")
        return
    except FileNotFoundError:
        pass  # fall through to the Python-based generator
    except subprocess.CalledProcessError as exc:
        sys.exit(f"openssl failed: {exc}")

    try:
        _gen_cert_cryptography(cert_path, key_path)
    except ImportError:
        sys.exit(
            "openssl not found and the 'cryptography' package is not installed. "
            "Install one of them, or provide --cert/--key manually."
        )
    print(f"Wrote {cert_path} and {key_path} (cryptography)")


def _gen_cert_cryptography(cert_path: Path, key_path: Path) -> None:
    """Self-signed cert via the cryptography package (dev only)."""
    from datetime import timedelta

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "tanaw-iot-dev")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
        .sign(key, hashes.SHA256())
    )

    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TANAW IoT HTTPS receiver.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8443)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--cert", type=Path, default=DEFAULT_CERT)
    parser.add_argument("--key", type=Path, default=DEFAULT_KEY)
    parser.add_argument(
        "--gen-cert",
        action="store_true",
        help="Generate a self-signed cert/key (dev only) and exit.",
    )
    args = parser.parse_args(argv)

    if args.gen_cert:
        gen_self_signed_cert(args.cert, args.key)
        return 0

    if not args.cert.exists() or not args.key.exists():
        print(
            f"Missing cert/key ({args.cert}, {args.key}). "
            "Run with --gen-cert first, or pass --cert/--key.",
            file=sys.stderr,
        )
        return 1

    token = os.environ.get("TANAW_STATION_TOKEN", "")
    conn = init_db(args.db)

    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_ctx.load_cert_chain(certfile=str(args.cert), keyfile=str(args.key))

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(conn, token))
    httpd.socket = ssl_ctx.wrap_socket(httpd.socket, server_side=True)

    auth_note = "token required" if token else "no auth (set TANAW_STATION_TOKEN to require)"
    print(f"TANAW receiver on https://{args.host}:{args.port}/ingest  ({auth_note})")
    print(f"Storing readings in {args.db}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        httpd.server_close()
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
