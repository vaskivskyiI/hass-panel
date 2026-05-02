# Studio Panel Refactor (vNext)

This repository was rebuilt from scratch in three layers:

1. Home Assistant component (`custom_components/studio_panel`)
2. Dashboard backend (`backend/`)
3. Modern frontend (`frontend/`)

## Architecture

- **Home Assistant component**
  - Stores all dashboard settings in HA storage
  - Exposes API endpoints:
    - `GET/PUT /api/studio_panel/settings`
    - `GET /api/studio_panel/entities`

- **Backend (FastAPI)**
  - Persists runtime config and settings on disk (`/data`)
  - Proxies entity list and service calls to Home Assistant
  - Exposes API endpoints:
    - `GET /api/health`
    - `GET/PUT /api/runtime-config`
    - `GET/PUT /api/settings`
    - `GET /api/entities`
    - `POST /api/service/{domain}/{service}`

- **Frontend (React + Vite)**
  - Dashboard mode and Manage mode
  - Manage mode supports visual entity selection and save without manual JSON editing

## Run with Podman

```bash
./studio-panel.sh update
```

App will be available at `http://localhost:8088`.

## Environment

Configure `.env.local` in project root:

- `HA_URL`: Home Assistant base URL
- `HA_TOKEN`: Home Assistant long-lived access token
- `PANEL_ADMIN_TOKEN` (optional): required in frontend Manage view for protected save operations

`studio-panel.sh` passes these values into the container and backend seeds runtime config from env on first start.

## Advanced GUI

Manage mode includes full GUI management for:

- entity visibility and drag/drop order
- category mapping and custom categories
- scene button editor
- action tile editor
- profile editor
- header entity selectors
- runtime connection settings

No manual JSON editing is required for dashboard configuration.

## Home Assistant component updates from GitHub

The custom component is in `custom_components/studio_panel/`.

To update in HA:

1. Pull latest from GitHub into your deployment source.
2. Copy `custom_components/studio_panel/` into HA config `custom_components/`.
3. Restart Home Assistant.

## HTTPS and external nginx

Use your external nginx to route `https://studio.krigo.cc/` to `http://127.0.0.1:8088`.

## Home Assistant custom component

Copy `custom_components/studio_panel/` into your HA config `custom_components` folder and restart Home Assistant.
