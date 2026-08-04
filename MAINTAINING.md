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

## Edit a schema or property description

Source schemas carry maintainer-facing prose — ticket references, storage
internals, service names — that must not reach partners. Override it with
`schemaDescriptions` on the spec, keyed `"Schema"` or `"Schema.property"`:

```json
"schemaDescriptions": {
  "EligibilityRequest.create_application": "Create the Connect application records …"
}
```

The sync **fails** if a key stops matching after an upstream rename — otherwise the
internal description would silently ship in its place. When that happens, re-point
the key (or drop it if the property is gone).

## Rewrite example values

Inline `example` strings live throughout the source paths and can't be addressed by
name. `replacements` on a spec rewrites them by literal substring — used to keep
storage-vendor hostnames out of the rendered samples:

```json
"replacements": [
  { "from": "https://your-project.supabase.co/storage/v1/object/sign/attachments/", "to": "https://<storage-host>/attachments/" }
]
```

A rule that matches nothing warns (the source may have been fixed) but doesn't fail.
These are workarounds for source-spec problems — prefer fixing the source repo and
dropping the rule.

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
| Programs | global-connect-service · `programs.yaml` (+ `common-schemas.yaml`) | Bearer |
| Devices | global-connect-service · `programs.yaml` (+ `common-schemas.yaml`) | Bearer |

Programs and Devices read the same source file into two output specs, because a
`docs.json` nav group binds to exactly one `openapi` file.

## What stays unpublished, and why

`programs.yaml` carries far more than the seven operations the Programs and Devices
sections publish. Publish an operation only after checking the permission its
handler requires. Partner API keys carry `LOOKUP_INCENTIVES`; they do not carry
`MANAGE_INCENTIVE_DATA`, so an operation gated on the latter returns 403 for a
partner today.

Four cases worth naming, because they've all been raised before:

- `GET /beta/incentives/devices` (the catalog list) sits next to the published
  search endpoint and looks publishable. It is not: `DeviceAdminApiServiceImpl`
  gates it on `MANAGE_INCENTIVE_DATA`, and unlike the programs reads there is no
  product decision to open it up. Device search is the partner-facing read.
- Every programs **write** stays hidden: `POST`/`PUT` on programs, the requirement
  assignment routes, the incentive tier writes, the approved-device upsert, the
  component routes and the partner data preference routes. Only the three reads
  listed in the Programs section ship.
- `GET /programs/{program_id}/requirements` and `GET /programs/{program_id}/incentive-tiers`
  were published briefly in this repo, then removed. Sean reviewed the rendered
  docs and ruled that neither operation suits a public partner audience. Treat
  this as a product decision, not an oversight or a permission gap like the cases
  above. Don't re-add either route as a perceived coverage gap without checking
  back on the decision first.
- The standalone requirements catalog (`/beta/incentives/requirements`) was never
  published either. It returns the same field-level detail as the program-scoped
  requirements route above: `ProgramRequirementsResponse`, whose
  `field_groups[].fields[]` carry key, type, label, description, placeholder,
  required, owner, options, validation rules, and template ids. The audience
  question is the same one already answered there.

### The Programs section is documented ahead of its permission

Sean asked for the programs reads to be documented even though every one of them
calls `requireManageIncentiveData`, so a partner key gets 403 today. REA-1080
tracks the `READ_INCENTIVES_DATA` permission that makes them callable. Do not
publish this section to production before that permission ships.

REA-1080 also has to decide a data question, not only a permission one:
`JooqProgramRepository.findAll` puts no partner or source filter on the query, and
partner offers are program rows (`source = PARTNER_OFFER`, with a `partner_id`
column). So `GET /beta/incentives/programs` returns every partner's offer rows to
every caller. `ProgramResponse` drops `partner_id` and the offer-scoping arrays at
the mapper (`ProgramConversions.kt`), but `label`, `description` and the free-form
`metadata` object survive, and `IncentivesPipelineRunner.brandingFor` reads offer
branding out of `metadata`. Filtering `PARTNER_OFFER` rows down to the caller's own
belongs in the permission work, not in this repo.

An earlier note here said the device catalog search endpoint would ship behind a
paid wrapper and should stay unpublished. That decision was reversed in REA-1078:
search is published, along with read and write on saved devices.
