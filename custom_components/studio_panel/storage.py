from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import ALLOWED_SETTINGS_KEYS, DEFAULT_SETTINGS, STORAGE_KEY, STORAGE_VERSION


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(k): str(v) for k, v in value.items() if isinstance(v, str)}


def _bool_map(value: Any) -> dict[str, bool]:
    if not isinstance(value, dict):
        return {}
    return {str(k): bool(v) for k, v in value.items() if isinstance(v, bool)}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str)]


def _string_list_map(value: Any) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    return {str(k): _string_list(v) for k, v in value.items()}


def _card_width_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, str] = {}
    for k, v in value.items():
        if v in ("single", "double"):
            out[str(k)] = str(v)
    return out


def _scene_buttons(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        scene_id = item.get("id")
        label = item.get("label")
        if isinstance(scene_id, str) and isinstance(label, str):
            out.append({"id": scene_id, "label": label})
    return out


def _header_entities(value: Any) -> dict[str, str]:
    base = deepcopy(DEFAULT_SETTINGS["headerEntities"])
    if not isinstance(value, dict):
        return base
    for k in base:
        raw = value.get(k)
        if isinstance(raw, str):
            base[k] = raw
    return base


def _global_settings(value: Any) -> dict[str, Any]:
    base = deepcopy(DEFAULT_SETTINGS["globalSettings"])
    if not isinstance(value, dict):
        return base
    if isinstance(value.get("title"), str):
        base["title"] = value["title"]
    if isinstance(value.get("subtitle"), str):
        base["subtitle"] = value["subtitle"]
    if isinstance(value.get("accentColor"), str):
        base["accentColor"] = value["accentColor"]
    base["hiddenEntities"] = _string_list(value.get("hiddenEntities"))
    base["featuredEntities"] = _string_list(value.get("featuredEntities"))
    return base


def _profiles(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    out: dict[str, Any] = {}
    for key, item in value.items():
        if not isinstance(item, dict):
            continue
        out[str(key)] = {
            "label": item.get("label") if isinstance(item.get("label"), str) else str(key),
            "hiddenEntities": _string_list(item.get("hiddenEntities")),
            "categoryMap": _string_map(item.get("categoryMap")),
            "nameOverrides": _string_map(item.get("nameOverrides")),
            "actionTileIds": _string_list(item.get("actionTileIds")),
        }
    return out


def _action_tiles(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        tile_id = item.get("id")
        label = item.get("label")
        target = item.get("target")
        action_type = item.get("actionType")
        if not all(isinstance(v, str) and v for v in (tile_id, label, target)):
            continue
        if action_type not in ("url", "app", "route"):
            action_type = "url"
        out.append(
            {
                "id": tile_id,
                "label": label,
                "icon": item.get("icon") if isinstance(item.get("icon"), str) else "",
                "actionType": action_type,
                "target": target,
                "confirmMessage": item.get("confirmMessage")
                if isinstance(item.get("confirmMessage"), str)
                else None,
                "profiles": _string_list(item.get("profiles")),
            }
        )
    return out


def _migrate_legacy(data: dict[str, Any]) -> dict[str, Any]:
    migrated = dict(data)
    # Legacy key aliases from previous versions.
    if "enabled_entities" in migrated and "enabledEntities" not in migrated:
        migrated["enabledEntities"] = migrated["enabled_entities"]
    if "entity_order" in migrated and "entityOrder" not in migrated:
        migrated["entityOrder"] = migrated["entity_order"]
    return migrated


def _sanitize_settings(data: dict[str, Any]) -> dict[str, Any]:
    source = _migrate_legacy(data)
    merged = deepcopy(DEFAULT_SETTINGS)
    merged["enabledEntities"] = _string_list(source.get("enabledEntities"))
    merged["entityOrder"] = _string_list(source.get("entityOrder"))
    merged["nameOverrides"] = _string_map(source.get("nameOverrides"))
    merged["categoryMap"] = _string_map(source.get("categoryMap"))
    merged["cardWidths"] = _card_width_map(source.get("cardWidths"))
    merged["showIcons"] = _bool_map(source.get("showIcons"))
    merged["customCategories"] = _string_list(source.get("customCategories"))
    merged["categoryPinHashes"] = _string_map(source.get("categoryPinHashes"))
    merged["categoryTopText"] = _string_map(source.get("categoryTopText"))
    merged["categoryBottomText"] = _string_map(source.get("categoryBottomText"))
    merged["categoryTopEntities"] = _string_list_map(source.get("categoryTopEntities"))
    merged["categoryBottomEntities"] = _string_list_map(source.get("categoryBottomEntities"))
    merged["sceneButtons"] = _scene_buttons(source.get("sceneButtons"))
    merged["passwordHash"] = (
        source.get("passwordHash") if isinstance(source.get("passwordHash"), str) else ""
    )
    merged["headerEntities"] = _header_entities(source.get("headerEntities"))
    merged["globalSettings"] = _global_settings(source.get("globalSettings"))
    merged["profiles"] = _profiles(source.get("profiles"))
    merged["deviceProfiles"] = _string_map(source.get("deviceProfiles"))
    merged["actionTiles"] = _action_tiles(source.get("actionTiles"))
    return {k: merged[k] for k in ALLOWED_SETTINGS_KEYS}


@dataclass
class SettingsStore:
    hass: HomeAssistant
    store: Store[dict[str, Any]]

    @classmethod
    def create(cls, hass: HomeAssistant) -> "SettingsStore":
        return cls(hass=hass, store=Store(hass, STORAGE_VERSION, STORAGE_KEY))

    async def async_load(self) -> dict[str, Any]:
        data = await self.store.async_load()
        if not data:
            return deepcopy(DEFAULT_SETTINGS)
        sanitized = _sanitize_settings(data)
        if sanitized != data:
            await self.store.async_save(sanitized)
        return sanitized

    async def async_save(self, data: dict[str, Any]) -> dict[str, Any]:
        sanitized = _sanitize_settings(data)
        await self.store.async_save(sanitized)
        return sanitized

    async def async_patch(self, patch: dict[str, Any]) -> dict[str, Any]:
        current = await self.async_load()
        current.update(_sanitize_settings(patch))
        return await self.async_save(current)
