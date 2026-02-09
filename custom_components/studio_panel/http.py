from __future__ import annotations

from typing import Any

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN
from .storage import SettingsStore


class StudioPanelSettingsView(HomeAssistantView):
    url = "/api/studio_panel/settings"
    name = "api:studio_panel:settings"
    requires_auth = True

    def __init__(self, store: SettingsStore) -> None:
        self._store = store

    async def get(self, request):
        data = await self._store.async_load()
        return self.json(data)

    async def put(self, request):
        payload: dict[str, Any] = await request.json()
        await self._store.async_save(payload)
        return self.json({"status": "ok"})


@callback
def async_register_views(hass: HomeAssistant, store: SettingsStore) -> None:
    hass.http.register_view(StudioPanelSettingsView(store))
