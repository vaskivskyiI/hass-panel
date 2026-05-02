DOMAIN = "studio_panel"
STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.settings"

DEFAULT_SETTINGS = {
    "enabledEntities": [],
    "entityOrder": [],
    "nameOverrides": {},
    "categoryMap": {},
    "cardWidths": {},
    "showIcons": {},
    "titleModes": {},
    "stateLabels": {},
    "customCategories": [],
    "categoryPinHashes": {},
    "categoryIcons": {},
    "categoryDisplayModes": {},
    "categoryParents": {},
    "categoryTopText": {},
    "categoryBottomText": {},
    "categoryTopEntities": {},
    "categoryBottomEntities": {},
    "sceneButtons": [],
    "passwordHash": "",
    "headerEntities": {
        "temperatureEntityId": "",
        "humidityEntityId": "",
        "doorContactEntityId": "",
        "doorActionEntityId": "",
    },
    "globalSettings": {
        "title": "Studio Panel",
        "subtitle": "Control center",
        "accentColor": "#3fa9f5",
        "hiddenEntities": [],
        "featuredEntities": [],
    },
    "profiles": {},
    "deviceProfiles": {},
    "actionTiles": [],
}

ALLOWED_SETTINGS_KEYS = set(DEFAULT_SETTINGS.keys())
