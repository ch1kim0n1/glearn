# GLearn v0.5.0 — Production Hardening

**Date:** 2026-05-18
**Migration:** 0.1.0 → 0.5.0

## What's New

### Container hardening
- `Dockerfile` now drops privileges via `chown -R node:node /app` + `USER node`.
- `HEALTHCHECK` directive calls `http://localhost:3005/health/live` via `node -e`
  with explicit `.on('error', ...)` handling so connection failures during
  boot count as unhealthy rather than crashing the probe.
- `docker-compose.yml` services (`glearn`, `gbrain`) declare
  `mem_limit: 512m`, `mem_reservation: 256m`, `cpus: 1.0`.

### HTTP security headers
- `src/core/public-health-server.ts` now sets a helmet-equivalent header set
  on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000;
  includeSubDomains`, `Content-Security-Policy: default-src 'none';
  frame-ancestors 'none'`, `Cache-Control: no-store`.

### Test-coverage enforcement
- `jest.config.js` declares `coverageThreshold`:
  - `src/core/**/*.ts`: 85% lines/statements/functions, 75% branches
  - global: 70% lines/statements/functions, 60% branches
- `npm run test:coverage` now fails when core modules drop below the floor.

### Static security analysis
- `eslint-plugin-security@^3.0.1` added as a dev dependency.

### Version
- `package.json` `version` field bumped from `0.1.0` → `0.5.0`.

## Migration from 0.1.0

No breaking API changes. Wire format for MCP tools, CLI commands, and SQLite
schema is unchanged.

Operational notes:
1. **Re-build the image.** `USER node` requires the filesystem to be chowned
   at build time. Run `docker compose build --no-cache`.
2. **Volume permissions.** If you mount host directories into `/app/data`,
   they must be readable & writable by uid `node` (1000 in `node:20-alpine`).
   Named volumes (the default) are handled automatically.
3. **HSTS.** `Strict-Transport-Security` is now sent on every response. Strip
   at a dev proxy if it interferes with non-TLS local development.

## Verification

```bash
docker compose build
docker compose up -d
docker inspect glearn --format '{{.Config.User}}'         # → node
docker inspect glearn --format '{{.State.Health.Status}}' # → healthy
curl -sI http://localhost:3005/health/live | \
  grep -iE 'x-content-type|x-frame|referrer|strict-transport|content-security'
npm run test:coverage   # threshold gate active
```

## Known Limitations
- `npm audit` is not recorded as part of this release. Run
  `npm audit --omit=dev` before publishing external artifacts.
- `eslint-plugin-security` is installed but not yet wired into the ESLint
  config. Follow-up: add `'plugin:security/recommended'` to `extends`.
