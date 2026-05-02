from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .http import async_register_views
from .storage import SettingsStore


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = SettingsStore.create(hass)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = store
    async_register_views(hass, store)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    if DOMAIN in hass.data and entry.entry_id in hass.data[DOMAIN]:
        hass.data[DOMAIN].pop(entry.entry_id)
    return True
