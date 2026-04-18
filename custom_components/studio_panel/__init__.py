from __future__ import annotations

import json

import voluptuous as vol

from homeassistant.const import CONF_PASSWORD
from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_register_admin_service
from homeassistant.helpers.typing import ConfigType

from .const import (
    DOMAIN,
    SERVICE_RESET_SETTINGS,
    SERVICE_SET_PASSWORD,
    SERVICE_UPDATE_SETTINGS,
)
from .http import async_register_views
from .storage import SettingsStore

ATTR_CLEAR_PASSWORD = "clear_password"
ATTR_MERGE = "merge"
ATTR_SETTINGS_JSON = "settings_json"

SERVICE_SET_PASSWORD_SCHEMA = vol.Schema(
    vol.Any(
        {vol.Required(CONF_PASSWORD): cv.string, vol.Optional(ATTR_CLEAR_PASSWORD, default=False): bool},
        {vol.Optional(CONF_PASSWORD): cv.string, vol.Required(ATTR_CLEAR_PASSWORD): bool},
    )
)

SERVICE_UPDATE_SETTINGS_SCHEMA = vol.Schema(
    {
        vol.Required(ATTR_SETTINGS_JSON): cv.string,
        vol.Optional(ATTR_MERGE, default=True): bool,
    }
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    store = SettingsStore.create(hass)
    hass.data.setdefault(DOMAIN, {})["store"] = store

    if not hass.services.has_service(DOMAIN, SERVICE_SET_PASSWORD):

        async def async_handle_set_password(call) -> None:
            password = call.data.get(CONF_PASSWORD, "")
            clear_password = call.data.get(ATTR_CLEAR_PASSWORD, False)

            if clear_password and not password:
                await store.async_clear_password()
                return

            normalized_password = password.strip()
            if not normalized_password:
                raise vol.Invalid("password must not be empty unless clear_password is true")

            await store.async_set_password(normalized_password)

        async_register_admin_service(
            hass,
            DOMAIN,
            SERVICE_SET_PASSWORD,
            async_handle_set_password,
            schema=SERVICE_SET_PASSWORD_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_UPDATE_SETTINGS):

        async def async_handle_update_settings(call) -> None:
            raw_settings = call.data[ATTR_SETTINGS_JSON]
            merge_settings = call.data.get(ATTR_MERGE, True)

            try:
                parsed = json.loads(raw_settings)
            except json.JSONDecodeError as error:
                raise vol.Invalid(f"settings_json must be valid JSON: {error.msg}") from error

            if not isinstance(parsed, dict):
                raise vol.Invalid("settings_json must decode to a JSON object")

            if merge_settings:
                await store.async_update(parsed)
                return

            await store.async_save(parsed)

        async_register_admin_service(
            hass,
            DOMAIN,
            SERVICE_UPDATE_SETTINGS,
            async_handle_update_settings,
            schema=SERVICE_UPDATE_SETTINGS_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_RESET_SETTINGS):

        async def async_handle_reset_settings(call) -> None:
            del call
            await store.async_reset()

        async_register_admin_service(
            hass,
            DOMAIN,
            SERVICE_RESET_SETTINGS,
            async_handle_reset_settings,
        )

    async_register_views(hass, store)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.get(DOMAIN, {}).pop("store", None)

    if hass.services.has_service(DOMAIN, SERVICE_SET_PASSWORD):
        hass.services.async_remove(DOMAIN, SERVICE_SET_PASSWORD)

    if hass.services.has_service(DOMAIN, SERVICE_UPDATE_SETTINGS):
        hass.services.async_remove(DOMAIN, SERVICE_UPDATE_SETTINGS)

    if hass.services.has_service(DOMAIN, SERVICE_RESET_SETTINGS):
        hass.services.async_remove(DOMAIN, SERVICE_RESET_SETTINGS)

    return True
