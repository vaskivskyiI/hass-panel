from __future__ import annotations

from collections import deque
from contextvars import ContextVar
from datetime import datetime, timezone
import os
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .models import RuntimeConfig
from .storage import RUNTIME_PATH, SETTINGS_PATH, read_json, write_json

DEFAULT_SETTINGS: dict[str, Any] = {
    "enabledEntities": [],
    "entityOrder": [],
    "nameOverrides": {},
    "categoryMap": {},
    "cardWidths": {},
    "showIcons": {},
    "customCategories": [],
    "categoryPinHashes": {},
    "categoryTopText": {},
    "categoryBottomText": {},
    "categoryTopEntities": {},
    "categoryBottomEntities": {},
    "sceneButtons": [],
    "passwordHash": "",
    "headerEntities": {
        "temperatureEntityId": "",
        "humidityEntityId": "",
        "doorContactEntityId": "",
        "doorActionEntityId": "",
    },
    "globalSettings": {
        "title": "Studio Panel",
        "subtitle": "Control center",
        "accentColor": "#3fa9f5",
        "hiddenEntities": [],
        "featuredEntities": [],
    },
    "profiles": {},
    "deviceProfiles": {},
    "actionTiles": [],
}

ADMIN_TOKEN = os.getenv("PANEL_ADMIN_TOKEN", "").strip()
_request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")
_telemetry: deque[dict[str, Any]] = deque(maxlen=120)


app = FastAPI(title="studio-panel-backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def with_request_id(payload: dict[str, Any], request_id: str) -> dict[str, Any]:
    out = dict(payload)
    out["requestId"] = request_id
    return out


def record_telemetry(level: str, message: str, request: Request | None = None) -> None:
    _telemetry.appendleft(
        {
            "time": now_iso(),
            "level": level,
            "requestId": _request_id_ctx.get(),
            "method": request.method if request else "",
            "path": str(request.url.path) if request else "",
            "message": message,
        }
    )


def require_admin(request: Request) -> None:
    if not ADMIN_TOKEN:
        return
    provided = request.headers.get("X-Studio-Token", "")
    if provided != ADMIN_TOKEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = str(uuid4())
    _request_id_ctx.set(request_id)
    try:
        response = await call_next(request)
    except Exception as exc:  # noqa: BLE001
        record_telemetry("error", f"Unhandled error: {exc}", request)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "Unexpected server error",
                    "requestId": request_id,
                }
            },
        )

    response.headers["X-Request-Id"] = request_id
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    record_telemetry("warning", str(exc.detail), request)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": "HTTP_ERROR",
                "message": str(exc.detail),
                "requestId": _request_id_ctx.get(),
            }
        },
    )


@app.on_event("startup")
async def startup_seed_runtime() -> None:
    if RUNTIME_PATH.exists():
        return
    seeded = {
        "haUrl": os.getenv("HA_URL", "").strip(),
        "haToken": os.getenv("HA_TOKEN", "").strip(),
    }
    write_json(RUNTIME_PATH, seeded)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return with_request_id({"status": "ok"}, _request_id_ctx.get())


@app.get("/api/runtime-config")
async def get_runtime_config() -> dict[str, str]:
    payload = read_json(RUNTIME_PATH, {"haUrl": "", "haToken": ""})
    return with_request_id(payload, _request_id_ctx.get())


@app.put("/api/runtime-config")
async def put_runtime_config(payload: RuntimeConfig, request: Request) -> dict[str, str]:
    require_admin(request)
    data = {"haUrl": payload.haUrl.strip(), "haToken": payload.haToken.strip()}
    write_json(RUNTIME_PATH, data)
    return with_request_id({"status": "ok"}, _request_id_ctx.get())


@app.get("/api/settings")
async def get_settings() -> dict[str, Any]:
    payload = read_json(SETTINGS_PATH, DEFAULT_SETTINGS)
    return with_request_id(payload, _request_id_ctx.get())


@app.put("/api/settings")
async def put_settings(payload: dict[str, Any], request: Request) -> dict[str, Any]:
    require_admin(request)
    write_json(SETTINGS_PATH, payload)
    return with_request_id({"status": "ok"}, _request_id_ctx.get())


@app.get("/api/entities")
async def get_entities() -> list[dict[str, Any]]:
    runtime = read_json(RUNTIME_PATH, {"haUrl": "", "haToken": ""})
    ha_url = str(runtime.get("haUrl", "")).rstrip("/")
    token = str(runtime.get("haToken", ""))
    if not ha_url or not token:
        raise HTTPException(status_code=400, detail="Runtime configuration is missing")

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            f"{ha_url}/api/states",
            headers={"Authorization": f"Bearer {token}"},
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    payload = response.json()
    return payload if isinstance(payload, list) else []


@app.post("/api/service/{domain}/{service}")
async def call_service(
    domain: str, service: str, payload: dict[str, Any], request: Request
) -> dict[str, str]:
    runtime = read_json(RUNTIME_PATH, {"haUrl": "", "haToken": ""})
    ha_url = str(runtime.get("haUrl", "")).rstrip("/")
    token = str(runtime.get("haToken", ""))
    if not ha_url or not token:
        raise HTTPException(status_code=400, detail="Runtime configuration is missing")

    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            f"{ha_url}/api/services/{domain}/{service}",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)

    return with_request_id({"status": "ok"}, _request_id_ctx.get())


@app.get("/api/telemetry")
async def get_telemetry(request: Request) -> dict[str, Any]:
    require_admin(request)
    return with_request_id({"items": list(_telemetry)}, _request_id_ctx.get())


DIST_DIR = Path("/app/frontend/dist")
if DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(DIST_DIR / "assets")), name="assets")


@app.get("/{full_path:path}")
async def spa(full_path: str):
    index = DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    raise HTTPException(status_code=404, detail="Frontend build is missing")
