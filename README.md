# NM Studio Panel

Touch-first Home Assistant control panel for wall-mounted tablets and phones. The UI is optimized for large hit targets, fast one-tap actions, and an installable PWA workflow.

## Configure Home Assistant

You can provide the API settings in two ways:

1. **In the UI**
   - Enter the Home Assistant URL and Long-Lived Access Token in the Connection section.
   - These values are written to the container-mounted runtime config and are not stored in the browser.

2. **Via environment variables**
   - Create a file named `.env.local` in the project root with:

```
VITE_HA_URL=https://homeassistant.local:8123
VITE_HA_TOKEN=YOUR_LONG_LIVED_ACCESS_TOKEN
VITE_HA_PROXY=true
```

`VITE_HA_PROXY=true` enables the Vite development proxy to avoid CORS errors. It is only for local development.

In production, the panel reads connection settings from the container-mounted runtime config file, not from browser storage.

## Server-side settings storage (custom integration)

This project includes a Home Assistant custom integration in [custom_components/studio_panel](custom_components/studio_panel). It exposes an authenticated endpoint:

```
GET /api/studio_panel/settings
PUT /api/studio_panel/settings
```

It also registers a Home Assistant admin service for password recovery and rotation:

```
studio_panel.set_password
studio_panel.update_settings
studio_panel.reset_settings
```

### Install the integration

1. Install this repository via HACS (custom repository).
2. In Home Assistant, go to Settings → Devices & Services → Add Integration → Studio Panel.
3. Restart Home Assistant if prompted.

### Reset or change the settings password from Home Assistant

Preferred UI path:

1. Open Settings → Devices & Services.
2. Open the Studio Panel integration.
3. Select Configure.
4. Choose either `Set new password` or `Clear password`.

Alternative admin service path:

Use Developer Tools → Actions, select `studio_panel.set_password`, then either:

- Set `password` to a new value to replace the current settings password.
- Set `clear_password` to `true` to remove the saved password entirely. The next time you open Settings in the panel, it will prompt you to create a new one.

Example service data to set a new password:

```yaml
password: new-tablet-password
```

Example service data to clear the password:

```yaml
clear_password: true
```

To update other saved panel settings from Home Assistant, use `studio_panel.update_settings` with a JSON object. Example:

```yaml
settings_json: '{"customCategories":["Lighting","Climate"],"headerEntities":{"temperatureEntityId":"sensor.room_temperature","humidityEntityId":"sensor.room_humidity","doorContactEntityId":"binary_sensor.front_door","doorActionEntityId":"button.open_door"}}'
merge: true
```

To clear all saved Home Assistant-side panel settings, run `studio_panel.reset_settings`.

## Persistence model

- Home Assistant stores panel settings, including password hash, visible entities, categories, ordering, header configuration, inline text, scene buttons, and per-entity display options.
- The frontend container stores only the Home Assistant connection URL and token in `$HOME/podman_data/studio_panel/config/runtime-config.json`.
- The browser does not persist Studio Panel configuration between restarts.

When you update the Connection section in the panel UI and press `Save & connect`, the container rewrites its mounted `runtime-config.json` and reloads the local HA proxy config.

## Run with Podman

Use the included launcher script, patterned after the scripts in `/home/smart/podman`:

```
./studio-panel.sh
```

This script:

- Builds the production image in Podman.
- Creates a persistent config directory at `$HOME/podman_data/studio_panel/config`.
- Copies the current `.env.local` into persistent storage on first run.
- Seeds `$HOME/podman_data/studio_panel/config/runtime-config.json` from the currently available Home Assistant URL and token.
- Starts the panel at `http://localhost:8088`.

To rebuild from fresh upstream container images:

```
./studio-panel.sh update
```

After the first run, update the persistent runtime config instead of editing the container image:

```
$HOME/podman_data/studio_panel/config/runtime-config.json
```

Expected format:

```json
{
   "haUrl": "https://homeassistant.local:8123",
   "haToken": "YOUR_LONG_LIVED_ACCESS_TOKEN"
}
```

## PWA installation

The frontend now ships as an installable PWA.

- Open the panel in Chrome, Edge, or another compatible browser.
- Use the in-app `Install app` button or the browser install prompt.
- On mounted devices, run the app in standalone mode for a clean, full-screen control surface.

## Development build in Podman

Install dependencies and build without host installs:

```
podman run --rm -it -v $PWD:/work -w /work node:20-bullseye npm install
podman run --rm -it -v $PWD:/work -w /work node:20-bullseye npm run build
```

## Troubleshooting “Failed to fetch”

- Ensure the Home Assistant URL is reachable from the tablet and uses the correct scheme (http/https).
- For local development, set `VITE_HA_PROXY=true` in `.env.local` to avoid CORS.
- For the Podman production container, enable CORS in Home Assistant or serve Home Assistant and the panel from compatible origins.

## Production build

```
podman run --rm -it -v $PWD:/work -w /work node:20-bullseye npm run build
```
