from __future__ import annotations

import json
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult

from .const import DOMAIN


class StudioPanelConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None) -> FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")

        if user_input is not None:
            return self.async_create_entry(title="Studio Panel", data={})

        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    def async_get_options_flow(config_entry):
        return StudioPanelOptionsFlow(config_entry)


class StudioPanelOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self._entry = config_entry

    @property
    def _store(self):
        return self.hass.data.get(DOMAIN, {}).get(self._entry.entry_id)

    async def async_step_init(self, user_input=None):
        return await self.async_step_menu()

    async def async_step_menu(self, user_input=None):
        return self.async_show_menu(
            step_id="menu",
            menu_options=[
                "set_password",
                "clear_password",
                "edit_settings",
                "reset_settings",
            ],
        )

    async def async_step_set_password(self, user_input=None):
        errors: dict[str, str] = {}

        if user_input is not None:
            password = str(user_input.get("password", "")).strip()
            if len(password) < 4:
                errors["password"] = "password_too_short"
            else:
                await self._store.async_set_password(password)
                return await self.async_step_menu()

        return self.async_show_form(
            step_id="set_password",
            data_schema=vol.Schema({vol.Required("password"): str}),
            errors=errors,
        )

    async def async_step_clear_password(self, user_input=None):
        await self._store.async_clear_password()
        return await self.async_step_menu()

    async def async_step_edit_settings(self, user_input=None):
        errors: dict[str, str] = {}
        current = await self._store.async_load()

        if user_input is not None:
            raw = str(user_input.get("settings_json", ""))
            try:
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    errors["settings_json"] = "invalid_json"
                else:
                    await self._store.async_save(payload)
                    return await self.async_step_menu()
            except json.JSONDecodeError:
                errors["settings_json"] = "invalid_json"

        return self.async_show_form(
            step_id="edit_settings",
            data_schema=vol.Schema(
                {vol.Required("settings_json", default=json.dumps(current, indent=2)): str}
            ),
            errors=errors,
        )

    async def async_step_reset_settings(self, user_input=None):
        await self._store.async_reset()
        return await self.async_step_menu()
