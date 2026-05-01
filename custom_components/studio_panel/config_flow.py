from __future__ import annotations

import json

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_PASSWORD
from homeassistant.core import HomeAssistant
from homeassistant.core import callback
from homeassistant.helpers.selector import TextSelector, TextSelectorConfig, TextSelectorType

from .const import DOMAIN
from .storage import SettingsStore


class StudioPanelConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry):
        return StudioPanelOptionsFlow()

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title="Studio Panel", data={})

        return self.async_show_form(step_id="user")


class StudioPanelOptionsFlow(config_entries.OptionsFlow):
    @property
    def _store(self) -> SettingsStore:
        domain_data = self.hass.data.setdefault(DOMAIN, {})
        store = domain_data.get("store")
        if store is None:
            store = SettingsStore.create(self.hass)
            domain_data["store"] = store
        return store

    async def async_step_init(self, user_input=None):
        return self.async_show_menu(
            step_id="init",
            menu_options=["set_password", "clear_password", "edit_settings", "reset_settings"],
        )

    async def async_step_set_password(self, user_input=None):
        errors = {}

        if user_input is not None:
            password = user_input[CONF_PASSWORD].strip()
            if not password:
                errors["base"] = "password_required"
            else:
                await self._store.async_set_password(password)
                return self.async_create_entry(title="", data={})

        return self.async_show_form(
            step_id="set_password",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PASSWORD): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_clear_password(self, user_input=None):
        if user_input is not None:
            await self._store.async_clear_password()
            return self.async_create_entry(title="", data={})

        return self.async_show_form(
            step_id="clear_password",
            data_schema=vol.Schema({}),
        )

    async def async_step_edit_settings(self, user_input=None):
        errors = {}

        if user_input is not None:
            raw_settings = user_input["settings_json"]
            try:
                parsed = json.loads(raw_settings)
            except json.JSONDecodeError:
                errors["base"] = "invalid_json"
            else:
                if not isinstance(parsed, dict):
                    errors["base"] = "invalid_json"
                else:
                    await self._store.async_save(parsed)
                    return self.async_create_entry(title="", data={})

        existing_settings = await self._store.async_load()

        return self.async_show_form(
            step_id="edit_settings",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        "settings_json",
                        default=json.dumps(existing_settings, indent=2, sort_keys=True),
                    ): TextSelector(TextSelectorConfig(multiline=True, type=TextSelectorType.TEXT))
                }
            ),
            errors=errors,
        )

    async def async_step_reset_settings(self, user_input=None):
        if user_input is not None:
            await self._store.async_reset()
            return self.async_create_entry(title="", data={})

        return self.async_show_form(
            step_id="reset_settings",
            data_schema=vol.Schema({}),
        )


async def async_setup_entry(hass: HomeAssistant, entry: config_entries.ConfigEntry) -> bool:
    return True
