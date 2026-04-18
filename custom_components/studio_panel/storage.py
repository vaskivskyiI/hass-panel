from __future__ import annotations

from dataclasses import dataclass
import hashlib
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import ALLOWED_SETTINGS_KEYS, STORAGE_KEY, STORAGE_VERSION


def _sanitize_settings(data: dict[str, Any]) -> dict[str, Any]:
    return {key: data[key] for key in ALLOWED_SETTINGS_KEYS if key in data}


@dataclass
class SettingsStore:
    hass: HomeAssistant
    store: Store[dict[str, Any]]

    @classmethod
    def create(cls, hass: HomeAssistant) -> "SettingsStore":
        return cls(hass=hass, store=Store(hass, STORAGE_VERSION, STORAGE_KEY))

    async def async_load(self) -> dict[str, Any]:
        data = await self.store.async_load()
        return data or {}

    async def async_save(self, data: dict[str, Any]) -> None:
        await self.store.async_save(_sanitize_settings(data))

    async def async_update(self, patch: dict[str, Any]) -> None:
        data = await self.async_load()
        data.update(_sanitize_settings(patch))
        await self.async_save(data)

    async def async_reset(self) -> None:
        await self.store.async_save({})

    async def async_set_password(self, password: str) -> None:
        await self.async_update(
            {"passwordHash": hashlib.sha256(password.encode("utf-8")).hexdigest()}
        )

    async def async_clear_password(self) -> None:
        await self.async_update({"passwordHash": ""})
