from __future__ import annotations

from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .http import async_register_views
from .storage import SettingsStore


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    if DOMAIN not in config:
        return True

    store = SettingsStore.create(hass)
    hass.data.setdefault(DOMAIN, {})["store"] = store
    async_register_views(hass, store)
    return True
