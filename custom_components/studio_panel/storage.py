from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION


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
        await self.store.async_save(data)
