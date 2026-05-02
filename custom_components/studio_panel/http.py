from __future__ import annotations

from typing import Any

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback

from .storage import SettingsStore


class StudioPanelSettingsView(HomeAssistantView):
    url = "/api/studio_panel/settings"
    name = "api:studio_panel:settings"
    requires_auth = True

    def __init__(self, store: SettingsStore) -> None:
        self._store = store

    async def get(self, request):
        settings = await self._store.async_load()
        return self.json(settings)

    async def put(self, request):
        payload: dict[str, Any] = await request.json()
        saved = await self._store.async_save(payload)
        return self.json({"status": "ok", "settings": saved})


class StudioPanelEntitiesView(HomeAssistantView):
    url = "/api/studio_panel/entities"
    name = "api:studio_panel:entities"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def get(self, request):
        entities = [
            {
                "entity_id": state.entity_id,
                "state": state.state,
                "attributes": dict(state.attributes),
            }
            for state in self.hass.states.async_all()
        ]
        return self.json(entities)


@callback
def async_register_views(hass: HomeAssistant, store: SettingsStore) -> None:
    hass.http.register_view(StudioPanelSettingsView(store))
    hass.http.register_view(StudioPanelEntitiesView(hass))
