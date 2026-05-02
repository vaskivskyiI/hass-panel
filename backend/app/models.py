from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class RuntimeConfig(BaseModel):
    haUrl: str
    haToken: str


class PanelSettingsPayload(BaseModel):
    payload: dict[str, Any]
