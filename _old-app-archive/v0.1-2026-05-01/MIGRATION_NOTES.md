# Studio Panel Legacy Frontend Archive

Archived on 2026-05-01.

This folder preserves the pre-rewrite frontend implementation and its related assets before the new control-only UI replaced it.

Included here:
- `frontend/src/` - original React/Vite frontend source
- `public/` - original frontend-facing public assets
- `README.md`, `package.json`, `vite.config.ts`, `index.html` - original frontend build context

Kept active at repository root:
- `custom_components/studio_panel/` - Home Assistant integration and settings API
- `podman/` - runtime config server and container nginx
- `Containerfile` and `studio-panel.sh` - deployment pipeline

Rollback outline:
1. Replace active frontend files from this archive.
2. Rebuild with `npm run build`.
3. Rebuild and restart the Podman container.
