#!/usr/bin/env bash
set -euo pipefail

IMAGE="localhost/studio-panel:latest"
CONTAINER="studio-panel"
DATA_DIR="${HOME}/podman_data/studio_panel/data"

mkdir -p "${DATA_DIR}"

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

cmd="${1:-update}"

if [[ "${cmd}" == "build" || "${cmd}" == "update" ]]; then
  podman build -t "${IMAGE}" -f Containerfile .
fi

if [[ "${cmd}" == "run" || "${cmd}" == "update" ]]; then
  for name in "${CONTAINER}" "studio-panel-ui"; do
    if podman ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
      podman rm -f "${name}" >/dev/null
    fi
  done

  podman run -d \
    --name "${CONTAINER}" \
    -p 8088:8088 \
    -v "${DATA_DIR}:/data" \
    -e "HA_URL=${HA_URL:-}" \
    -e "HA_TOKEN=${HA_TOKEN:-}" \
    -e "PANEL_ADMIN_TOKEN=${PANEL_ADMIN_TOKEN:-}" \
    "${IMAGE}"

  echo "Studio Panel running on http://localhost:8088"
  echo "Persistent data: ${DATA_DIR}"
fi
