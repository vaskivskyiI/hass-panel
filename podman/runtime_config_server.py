from __future__ import annotations

import json
import os
import subprocess
import tempfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


RUNTIME_CONFIG_PATH = Path(
    os.environ.get("STUDIO_PANEL_RUNTIME_CONFIG", "/usr/share/nginx/html/runtime-config.json")
)
HA_PROXY_CONFIG_PATH = Path(
    os.environ.get("STUDIO_PANEL_HA_PROXY_CONFIG", "/etc/nginx/ha-proxy-location.conf")
)
LISTEN_HOST = os.environ.get("STUDIO_PANEL_RUNTIME_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("STUDIO_PANEL_RUNTIME_PORT", "8090"))


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, dir=path.parent) as temp_file:
                temp_file.write(content)
                temp_name = temp_file.name
    os.replace(temp_name, path)


def _read_runtime_config() -> dict[str, str]:
    if not RUNTIME_CONFIG_PATH.exists():
        return {"haUrl": "", "haToken": ""}

    try:
        parsed = json.loads(RUNTIME_CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"haUrl": "", "haToken": ""}

    return {
        "haUrl": parsed.get("haUrl", "") if isinstance(parsed.get("haUrl"), str) else "",
        "haToken": parsed.get("haToken", "") if isinstance(parsed.get("haToken"), str) else "",
    }


def _validate_ha_url(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = urlparse(normalized)

    if not normalized:
        raise ValueError("haUrl must not be empty")
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("haUrl must be a valid http or https URL")

    return normalized


def _build_proxy_config(ha_url: str) -> str:
    if not ha_url:
        return (
            "location ^~ /ha/ {\n"
            "  default_type application/json;\n"
            "  return 502 '{\"error\":\"runtime-config missing haUrl\"}';\n"
            "}\n"
        )

    return (
        "location ^~ /ha/ {\n"
        "  proxy_http_version 1.1;\n"
        "  proxy_set_header X-Forwarded-For \"\";\n"
        "  proxy_set_header X-Forwarded-Proto \"\";\n"
        "  proxy_set_header X-Real-IP \"\";\n"
        f"  proxy_pass {ha_url}/;\n"
        "}\n"
    )


def _save_runtime_config(payload: dict[str, str]) -> None:
    ha_url = _validate_ha_url(payload.get("haUrl", ""))
    ha_token = payload.get("haToken", "").strip()

    if not ha_token:
        raise ValueError("haToken must not be empty")

    runtime_json = json.dumps({"haUrl": ha_url, "haToken": ha_token}, indent=2) + "\n"
    proxy_config = _build_proxy_config(ha_url)

    _atomic_write(RUNTIME_CONFIG_PATH, runtime_json)
    _atomic_write(HA_PROXY_CONFIG_PATH, proxy_config)
    subprocess.run(["nginx", "-s", "reload"], check=True)


class RuntimeConfigHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict[str, str], status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_error(self, message: str, status: HTTPStatus) -> None:
        self._send_json({"error": message}, status)

    def do_GET(self) -> None:
        if self.path != "/runtime-config":
            self._send_error("not found", HTTPStatus.NOT_FOUND)
            return

        self._send_json(_read_runtime_config())

    def do_PUT(self) -> None:
        if self.path != "/runtime-config":
            self._send_error("not found", HTTPStatus.NOT_FOUND)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length)

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_error("invalid JSON body", HTTPStatus.BAD_REQUEST)
            return

        if not isinstance(payload, dict):
            self._send_error("invalid JSON body", HTTPStatus.BAD_REQUEST)
            return

        try:
            _save_runtime_config(payload)
        except ValueError as error:
            self._send_error(str(error), HTTPStatus.BAD_REQUEST)
            return
        except subprocess.CalledProcessError:
            self._send_error("nginx reload failed", HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        self._send_json(_read_runtime_config())

    def log_message(self, format: str, *args) -> None:
        return


if __name__ == "__main__":
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), RuntimeConfigHandler)
    server.serve_forever()