# Maintaining the API Reference

The API-reference specs in `api-reference/specs/*.json` are **generated** from the
upstream services (`global-connect-service`, `incentives-service`). Do not edit
them by hand — edit the config and re-run the sync.

## Refresh the specs

```bash
npm ci

# Fetch each source spec from its repo's main branch (requires `gh` auth):
npm run sync:openapi

# …or read from local sibling checkouts (faster while iterating):
GCS_REPO=/path/to/global-connect-service \
INCENTIVES_REPO=/path/to/incentives-service \
npm run sync:openapi -- --local
```

The script (`scripts/sync-openapi.mjs`, config `scripts/openapi-sources.json`) for
each output spec:

1. **fetches** the source OpenAPI file (+ any `$ref` dependencies),
2. **bundles** cross-file `$ref`s inline with Redocly → a self-contained spec,
3. **curates** operations to the partner-facing `include` allowlist,
4. **retitles** each operation (short `summary` → clean Mintlify URL slug) and
   normalizes each spec to one `tag` (→ clean URL prefix),
5. **pins** `servers` (prod + staging) and **injects** the correct auth scheme
   (Bearer for GCS, `x-api-key` for Applications),
6. **prunes** components no longer reachable from the kept operations,
7. **validates** that every `$ref` resolves (fails the run on a broken ref).

## Add / remove a documented endpoint

1. Edit the `include` list for the relevant spec in `scripts/openapi-sources.json`
   (add `{ "method", "path", "title" }`), then `npm run sync:openapi`.
2. Add the matching `"METHOD /path"` string to that group's `pages` in `docs.json`.

## Verify locally

```bash
npm run test:sync            # unit-tests the transform functions
npm run sync:openapi -- --local
npx mint dev --port 3333     # http://localhost:3333
npx mint broken-links        # (4 pre-existing failures in essentials/ + incentive-aggregator-api.md are unrelated)
```

On an API endpoint page, confirm the method+path header shows **Try it**, the
right panel has cURL/response samples, request/response schemas expand, and the
auth matches the section (Bearer for GCS sections, `x-api-key` for Applications).

## Sections & sources

| Section | Source repo · file | Auth |
|---|---|---|
| Incentives Lookups | global-connect-service · `incentives.yaml` | Bearer |
| Reports | global-connect-service · `reports.yaml` | Bearer |
| Programs | global-connect-service · `programs.yaml` | Bearer |
| Devices | global-connect-service · `programs.yaml` | Bearer |
| Applications | incentives-service · `applications/openapi.json` | `x-api-key` |
