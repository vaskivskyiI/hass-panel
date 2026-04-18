#!/usr/bin/env bash

set -euo pipefail

TZ=$(cat /etc/timezone 2>/dev/null || echo UTC)

POD_NAME="studio-panel"
CONTAINER_NAME="studio-panel-ui"
IMAGE="localhost/studio-panel:latest"
PORT=8088

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATA_DIR="$HOME/podman_data/studio_panel"
CONFIG_DIR="$DATA_DIR/config"
RUNTIME_CONFIG="$CONFIG_DIR/runtime-config.json"
ENV_BACKUP="$CONFIG_DIR/.env.local.backup"
HA_PROXY_CONF="$CONFIG_DIR/ha-proxy-location.conf"

json_escape() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  printf '%s' "$value"
}

seed_runtime_config() {
  mkdir -p "$CONFIG_DIR"

  if [[ -f "$SCRIPT_DIR/.env.local" && ! -f "$ENV_BACKUP" ]]; then
    echo "📋 Copying existing .env.local into persistent storage..."
    cp "$SCRIPT_DIR/.env.local" "$ENV_BACKUP"
  fi

  if [[ -f "$RUNTIME_CONFIG" ]]; then
    return
  fi

  local ha_url=""
  local ha_token=""

  if [[ -f "$SCRIPT_DIR/.env.local" ]]; then
    while IFS='=' read -r key raw_value; do
      [[ -z "$key" || "$key" == \#* ]] && continue
      value=${raw_value#\"}
      value=${value%\"}

      case "$key" in
        VITE_HA_URL)
          ha_url="$value"
          ;;
        VITE_HA_TOKEN)
          ha_token="$value"
          ;;
      esac
    done < "$SCRIPT_DIR/.env.local"
  fi

  echo "🗂️ Initializing persistent runtime config..."
  cat > "$RUNTIME_CONFIG" <<EOF
{
  "haUrl": "$(json_escape "$ha_url")",
  "haToken": "$(json_escape "$ha_token")"
}
EOF
}

seed_runtime_config

build_ha_proxy_config() {
  local ha_url
  ha_url=$(grep -oP '"haUrl"\s*:\s*"\K[^"]*' "$RUNTIME_CONFIG" | tr -d '\n' || true)
  ha_url="${ha_url%/}"

  if [[ -z "$ha_url" ]]; then
    cat > "$HA_PROXY_CONF" <<'EOF'
location ^~ /ha/ {
  default_type application/json;
  return 502 '{"error":"runtime-config missing haUrl"}';
}
EOF
    return
  fi

  cat > "$HA_PROXY_CONF" <<EOF
location ^~ /ha/ {
  proxy_http_version 1.1;
  proxy_set_header X-Forwarded-For "";
  proxy_set_header X-Forwarded-Proto "";
  proxy_set_header X-Real-IP "";
  proxy_pass $ha_url/;
}
EOF
}

build_ha_proxy_config

mkdir -p "$CONFIG_DIR"

echo "🏗️ Building Studio Panel image..."
if [[ "${1:-}" == "update" ]]; then
  podman build --pull -t "$IMAGE" "$SCRIPT_DIR"
else
  podman build -t "$IMAGE" "$SCRIPT_DIR"
fi

if podman pod exists "$POD_NAME"; then
  echo "🧹 Cleaning up old pod..."
  podman pod stop "$POD_NAME"
  podman pod rm -f "$POD_NAME"
fi

echo "📦 Creating pod: $POD_NAME"
podman pod create -p "$PORT:8080" --name "$POD_NAME"

echo "🚀 Starting Studio Panel..."
podman run -d \
  --name "$CONTAINER_NAME" \
  --pod "$POD_NAME" \
  --restart=unless-stopped \
  -e TZ="$TZ" \
  -v "$RUNTIME_CONFIG:/usr/share/nginx/html/runtime-config.json:Z" \
  -v "$HA_PROXY_CONF:/etc/nginx/ha-proxy-location.conf:Z" \
  -v /etc/localtime:/etc/localtime:ro \
  "$IMAGE"

echo ""
echo "✅ Studio Panel is accessible at: http://localhost:$PORT"
echo "🗂️ Persistent config: $RUNTIME_CONFIG"