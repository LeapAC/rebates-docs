# Maintaining the API Reference

The API-reference specs in `api-reference/specs/*.json` are **generated** from the
upstream services (`global-connect-service`, `incentives-service`). Do not edit
them by hand — edit the config and re-run the sync.

## Refresh the specs

Regenerate from local sibling checkouts (the supported path):

```bash
npm ci

GCS_REPO=/path/to/global-connect-service \
INCENTIVES_REPO=/path/to/incentives-service \
npm run sync:openapi -- --local
```

> **Why `--local`?** `global-connect-service` lives on GitLab (not GitHub), so the
> `gh`-based remote fetch (`npm run sync:openapi` with no flags) can't reach it, and
> `incentives-service`'s default branch is `develop`, not `main`. Until the fetcher
> learns GitLab + per-repo refs, regenerate from local checkouts on the branch you
> want to publish (typically each repo's default branch).

The script (`scripts/sync-openapi.mjs`, config `scripts/openapi-sources.json`) for
each output spec:

1. **fetches** the source OpenAPI file (+ any `$ref` dependencies),
2. **bundles** cross-file `$ref`s inline with Redocly → a self-contained spec,
3. **curates** operations to the partner-facing `include` allowlist,
4. **retitles** each operation (short `summary` → clean Mintlify URL slug),
   optionally **overrides** its `description` (short, partner-facing prose in place
   of the internal source description), and normalizes each spec to one `tag`
   (→ clean URL prefix),
5. **pins** `servers` (prod + staging) and **injects** the correct auth scheme
   (Bearer for GCS, `x-api-key` for Applications),
6. **prunes** components no longer reachable from the kept operations,
7. **validates** that every `$ref` resolves (fails the run on a broken ref).

## Add / remove a documented endpoint

1. Edit the `include` list for the relevant spec in `scripts/openapi-sources.json`
   (add `{ "method", "path", "title" }`, plus an optional `"description"` to
   override the source prose), then re-run the sync.
2. Add the matching `"METHOD /path"` string to that group's `pages` in `docs.json`.

## Edit an endpoint's title or description

Endpoint titles (nav label + URL slug) and descriptions are curated in
`scripts/openapi-sources.json`, not in the source specs — so they survive re-syncs
and stay partner-facing. Set `title` / `description` on the operation's `include`
entry and re-run the sync. Leave `description` off to pass the source prose through
unchanged.

## Verify locally

```bash
npm run test:sync            # unit-tests the transform functions
GCS_REPO=... INCENTIVES_REPO=... npm run sync:openapi -- --local
npx mint dev --port 3333     # http://localhost:3333
npx mint broken-links        # (pre-existing failures in essentials/ + incentive-aggregator-api.md are unrelated)
```

On an API endpoint page, confirm the method+path header shows **Try it**, the
right panel has cURL/response samples, request/response schemas expand, and the
auth matches the section (Bearer for Incentives, `x-api-key` for Applications).

## Sections & sources

| Section | Source repo · file | Auth |
|---|---|---|
| Incentives | global-connect-service · `incentives.yaml` (+ `common-schemas.yaml`) | Bearer |
| Applications | incentives-service · `applications/openapi.json` | `x-api-key` |
