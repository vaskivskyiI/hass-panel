# Studio Panel System Status

## Purpose

Studio Panel is a fast, touch-first web frontend for Home Assistant driven smart spaces. The frontend is optimized for wall panels, tablets, and phones. Administrative changes are intentionally kept out of the panel UI and are expected to be managed through Home Assistant itself.

## Implementation Status

| Area | Status | Notes |
| --- | --- | --- |
| Legacy backup archive | Complete | Previous frontend copied to `_old-app-archive/v0.1-2026-05-01/`. |
| New frontend shell | Complete | New glass/ambient control UI is live in `src/`. |
| Runtime connection storage | Complete | Connection data is still stored via `/internal/runtime-config`. |
| Home Assistant settings compatibility | Complete | Backend settings allowlist now accepts new profile and launcher fields. |
| Generic entity control surface | Complete | New UI supports domain-specific controls for climate, covers, locks, media, fans, vacuums, buttons, scenes, scripts, and generic toggles. |
| Global and per-device profiles | Complete | URL `profile` and generated device id are both supported. |
| Custom links and app launchers | Complete | `actionTiles` support URLs, app schemes, and internal routes with optional confirmation. |
| Automatic update flow | Complete | Service worker registration now uses a quiet reload strategy. |
| External nginx reference config | Complete | See `podman/external-nginx.conf.example`. |
| Advanced light color controls | Not started | Current rewrite focuses on fast generic control coverage first. |
| Websocket-based HA live sync | Not started | Polling remains active at 3 seconds. |

## Architecture Overview

### Frontend
- React 19 + TypeScript + Vite.
- New UI is control-only and reads operational rules from Home Assistant.
- Routing is lightweight and path-based: `/`, `/category/:name`, `/links`, `/connection`.
- Device-specific behavior is resolved from:
  1. URL profile key (`?profile=name`)
  2. Stable local device id (`localStorage` key `studio-panel-device-id`)
  3. Global defaults

### Home Assistant Integration
- Integration path: `custom_components/studio_panel/`
- Settings endpoint:
  - `GET /api/studio_panel/settings`
  - `PUT /api/studio_panel/settings`
- Admin services remain in Home Assistant:
  - `studio_panel.set_password`
  - `studio_panel.update_settings`
  - `studio_panel.reset_settings`

### Container and Runtime Config
- Runtime config server path: `podman/runtime_config_server.py`
- Persistent runtime config file: `$HOME/podman_data/studio_panel/config/runtime-config.json`
- Launcher script: `./studio-panel.sh`
- Frontend writes only HA URL and token through the runtime config server.

## Settings Contract

### Legacy fields still supported
- `enabledEntities`
- `nameOverrides`
- `categoryMap`
- `entityOrder`
- `customCategories`
- `sceneButtons`
- `headerEntities`
- Other legacy settings keys remain accepted by the backend for compatibility.

### New fields
- `globalSettings`
  - `title`
  - `subtitle`
  - `accentColor`
  - `hiddenEntities`
  - `featuredEntities`
- `profiles`
  - `label`
  - `hiddenEntities`
  - `categoryMap`
  - `nameOverrides`
  - `actionTileIds`
- `deviceProfiles`
  - map of generated device id to profile key
- `actionTiles`
  - `id`
  - `label`
  - `icon`
  - `actionType`: `url`, `app`, `route`
  - `target`
  - `confirmMessage`
  - `profiles`

## Feature Matrix

| Feature | Source of truth | Runtime behavior |
| --- | --- | --- |
| Entity visibility | HA settings | Global plus profile-specific hides are applied client-side. |
| Category mapping | HA settings | Profile mapping overrides global mapping. |
| Name overrides | HA settings | Profile override wins over global label. |
| Action tiles | HA settings | Filtered per profile and opened directly by the client. |
| Connection config | Runtime config server | Stored outside browser settings in mounted container storage. |
| Update behavior | Service worker | Quiet reload after update activation and idle time. |

## Deployment Topology

1. External nginx optionally fronts the panel.
2. Container nginx serves static assets and proxies `/internal/runtime-config`.
3. Container nginx or external nginx proxies Home Assistant API requests.
4. Frontend loads runtime config, then fetches Home Assistant states and server-side panel settings.

## Verification Log

### 2026-05-01
- Archived old frontend into `_old-app-archive/v0.1-2026-05-01/`.
- Installed dependencies with Podman Node 20 container.
- Verified production build with:
  - `podman run --rm -v "$PWD:/work" -w /work node:20-bullseye npm run build`
- Build result: success.

## Known Gaps and Risks

- Light controls currently use generic toggle behavior; the previous advanced RGB and kelvin editor has not been reintroduced yet.
- Entity updates still rely on polling rather than Home Assistant websocket subscriptions.
- Profile administration is service-driven in Home Assistant; there is no dedicated HA config panel UI yet.
- Generated device id is stored locally in the browser to support per-device profile binding.

## Rollback

1. Restore archived frontend files from `_old-app-archive/v0.1-2026-05-01/`.
2. Rebuild the frontend.
3. Rebuild and restart the container.
4. Keep the backend integration and runtime config server unchanged.

## Change History

### 2026-05-01
- Archived legacy frontend.
- Replaced the UI with a new control-only shell.
- Added profile-aware visibility and launcher support.
- Enabled automatic quiet reload updates.
- Added external nginx reference configuration.
