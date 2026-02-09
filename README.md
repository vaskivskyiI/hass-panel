# NM Studio Panel

Premium tablet-friendly control panel for Home Assistant devices (lights, radiators, AC, switches, and other devices). Designed for a fast, dark, minimal studio environment.

## Configure Home Assistant

You can provide the API settings in two ways:

1. **In the UI (recommended for tablet use)**
   - Enter the Home Assistant URL and Long-Lived Access Token in the Connection section.
   - These values are stored locally in the browser on the tablet.

2. **Via environment variables**
   - Create a file named `.env.local` in the project root with:

```
VITE_HA_URL=https://homeassistant.local:8123
VITE_HA_TOKEN=YOUR_LONG_LIVED_ACCESS_TOKEN
VITE_HA_PROXY=true
```

`VITE_HA_PROXY=true` enables a dev proxy to avoid CORS errors. In production builds you must allow CORS on Home Assistant or serve the panel from the same origin.

## Server-side settings storage (custom integration)

This project includes a Home Assistant custom integration in [custom_components/studio_panel](custom_components/studio_panel). It exposes an authenticated endpoint:

```
GET /api/studio_panel/settings
PUT /api/studio_panel/settings
```

### Install the integration

1. Copy the folder custom_components/studio_panel into your Home Assistant config/custom_components directory.
2. Add the following to your configuration.yaml:

```
studio_panel:
```

3. Restart Home Assistant.

## Run with Podman (no host installs)

Install dependencies and start the dev server using a container:

```
podman run --rm -it -v $PWD:/work -w /work node:20-bullseye npm install
podman run --rm -it -v $PWD:/work -w /work -p 5173:5173 node:20-bullseye npm run dev -- --host
```

## Troubleshooting “Failed to fetch”

- Ensure the Home Assistant URL is reachable from the tablet and uses the correct scheme (http/https).
- For local development, set `VITE_HA_PROXY=true` in `.env.local` to avoid CORS.
- For production, enable CORS in Home Assistant or host the panel on the same origin.

## Production build

```
podman run --rm -it -v $PWD:/work -w /work node:20-bullseye npm run build
```
