# Maintaining the API Reference

The API-reference specs in `api-reference/specs/*.json` are **generated** from the
upstream service (`global-connect-service`). Do not edit
them by hand — edit the config and re-run the sync.

## Every Markdown file in this repo is a public page

Mintlify publishes every `.md` and `.mdx` file it finds. `docs.json` navigation
controls the sidebar, not what is reachable: a file left out of the nav is still
served at `docs.incentives.leap.energy/<path-without-extension>`, and Google can
index it. This file used to sit at the repo root, which published it, along with
`CLAUDE.md` and its "Internal Implementation Details (Do Not Expose)" section.

Two directories are excluded from the build, verified by request against a local
`mint dev`: **`.github/`** and **`.claude/`**. A `README.md` is skipped anywhere.
Nothing else is: other dot-directories, `.txt` files and files absent from the
nav are all served, and a `docs.json` redirect does not shadow a generated page.

So: **maintainer-facing prose goes in `.github/` (this file) or `.claude/`
(agent instructions), never at the repo root.** Before adding any Markdown file
outside those two directories, assume a partner will read it. After deploying,
`curl -o /dev/null -w '%{http_code}' https://docs.incentives.leap.energy/<name>`
should return 404 for anything maintainer-facing.

## Refresh the specs

Regenerate from local sibling checkouts (the supported path):

```bash
npm ci

git -C /path/to/global-connect-service fetch origin

GCS_REPO=/path/to/global-connect-service \
npm run sync:openapi -- --local
```

> **Why `--local`?** `global-connect-service` lives on GitLab (not GitHub), so the
> `gh`-based remote fetch (`npm run sync:openapi` with no flags) can't reach it.

Each spec pins the ref it reads in `openapi-sources.json` (`source.ref`:
`origin/main` for `global-connect-service`). If your clone's `origin` remote is
unreachable, fetch `main` into `refs/remotes/origin/main` from a remote that
works, so `git show origin/main:` reads the current files. The script reads the
file out of that ref with `git show`, not out of the working tree, so a run does
not depend on which branch either clone is sitting on, and two people running the
sync get the same output. That is also why the `git fetch` above matters: `git
show` only reads what is already local, and the run fails naming the repo when
the ref is stale or missing. Drop `source.ref` for a spec to read the checkout as
it stands, which is how you preview an unmerged branch.

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
   (Bearer for every section),
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

## Rewrite prose the overrides can't reach

Inline `example` strings, response descriptions and parameter descriptions live
throughout the source paths and can't be addressed by name. `replacements` on a
spec rewrites them by literal substring — used to keep storage-vendor hostnames,
database constraint names and other maintainer-facing detail out of the rendered
reference:

```json
"replacements": [
  { "from": "https://your-project.supabase.co/storage/v1/object/sign/attachments/", "to": "https://<storage-host>/attachments/" },
  { "from": "`uc_customer_partner_address` makes one address reachable by", "to": "Leap holds one customer per address per partner, so", "required": true }
]
```

A rule that matches nothing warns (the source may have been fixed) but doesn't
fail. Set `"required": true` when the rule exists to redact something, not to
polish it: a required rule that stops matching **fails the run**, because an
upstream reword would otherwise ship the original text silently. Match on enough
of the sentence to be unambiguous, and keep the source's line breaks (`\n` plus
the indent) when the source block preserved them.

These are workarounds for source-spec problems — prefer fixing the source repo
and dropping the rule.

## Drop a field from the published spec

`removeProperties` deletes a property from a schema (and from that schema's
`required`) before the prune step, so a schema only that property referenced goes
with it:

```json
"removeProperties": ["CustomerDeviceRef.device_source_id", "DeviceResponse.source_id"]
```

Use it for four cases, and say which one applies in the PR:

- **Retired.** The field is still on the wire but no longer works.
  `device_source_id` is the standing example: REA-970 cut catalog identity over
  to UUIDs, and `WireDeviceRefResolver` now rejects any request carrying it with
  422 `INVALID_DEVICE_ID`. Publishing it invites an integration against a field
  that always fails.
- **Lineage or internal state.** `LegacyCustomer.is_test` marks Leap's own seeded rows,
  and means nothing to a partner. The device equivalents are gone from the source
  now: GCS !1835 split `PartnerDeviceResponse` off `DeviceResponse`, so the
  lineage ids and the msrp provenance fields are removed upstream rather than
  here.
- **Internal.** `LegacyApplication.recaptcha_token` is the Connect web form's bot
  token, on a schema a partner reads. The `verification_*` and
  `uncollected_requirements` columns on the same schema are Leap's own processing
  state, and `LegacyCustomer.ssn` and `tax_id` are accepted on a write but never
  stored, so a read always returns null.
- **True of the endpoint, wrong for this audience.** `LegacyApplication` types
  the applications of `GET /beta/incentives/applications`, which staff and
  partner lanes both answer. The partner lane strips `organization_id`; the staff
  lanes return it, and Connect and the operator portal read it. The same goes
  for the staff customer view (`organization`, `customer`, `customer_devices`,
  `applications`) on `LegacyApplicationSearchResponse`: a partner reads
  `results`. The properties are correct in the source spec, so **do not** try to
  fix them upstream. incentives-service#566 attempted that for the alpha spec and
  was closed. Curate them here, where the published reference documents the
  partner lane.

Removing a field here changes the **documentation**, not the API: the service
still returns it. That distinction cuts both ways. When the field is private, fix
it in the service and treat the removal here as keeping the docs from advertising
it in the meantime — GCS !1835 is the worked example. When the field is
legitimate for another caller of the same route, the removal here is the whole
fix, and a source-side change would break that caller.

## Drop a staff-only parameter or request shape

Two more curation steps cover the beta Applications routes, which GCS serves to
Leap staff and partners alike:

- `removeParameters` drops a component parameter from every operation that lists
  it, keyed by its name under `#/components/parameters`. The Applications specs
  drop `LegacyOrganizationId` and `LegacyCompany`, the staff organization
  selectors.
- `dropOneOfBranches` removes `oneOf` or `anyOf` branches that point at the named
  schemas, and collapses a single survivor into its parent. The Fields spec drops
  `LegacyFieldsRequest`, the staff body of `POST /beta/incentives/fields`, so the
  page shows only the `program_identifiers` body partners send.

Both **fail the run** when a name matches nothing, like a required replacement.

## Rewrite a section's blurb

`description` on a spec replaces `info.description`, which is the prose Mintlify
shows above a section's endpoints. The source blurbs are written for maintainers:
the Incentives one named the internal header partner identity is derived from and
explained the IDOR it would open if that were accepted from the client. Set the
spec's `description` to partner-facing prose; leave it off to pass the source
through.

## Verify locally

```bash
npm run test:sync            # unit-tests the transform functions
GCS_REPO=... npm run sync:openapi -- --local
npx mint dev --port 3333     # http://localhost:3333
npx mint broken-links        # expect zero
```

On an API endpoint page, confirm the method+path header shows **Try it**, the
right panel has cURL/response samples, request/response schemas expand, and the
auth shows Bearer.

## Sections & sources

| Section | Source repo · file | Auth |
|---|---|---|
| Incentives | global-connect-service · `incentives.yaml` (+ `common-schemas.yaml`) | Bearer |
| Applications | global-connect-service · `applications.yaml` | Bearer |
| Applications › Attachments | global-connect-service · `applications-attachments.yaml` | Bearer |
| Applications › Requirements | global-connect-service · `programs.yaml` (+ `common-schemas.yaml`) | Bearer |
| Programs | global-connect-service · `programs.yaml` (+ `common-schemas.yaml`) | Bearer |
| Devices | global-connect-service · `programs.yaml` (+ `common-schemas.yaml`) | Bearer |

Programs and Devices read the same source file into two output specs, because a
`docs.json` nav group binds to exactly one `openapi` file. For the same reason the
Applications section uses three specs: its Attachments and Requirements subgroups
each carry their own `openapi`. The Incentives spec also needs `calc-engine.yaml`
in `deps`, because `incentives.yaml` references it.

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

### The Applications section: published ahead of the partner lane

The Applications section documents the beta routes as partners will call them:
a key with the **Manage applications** permission (`MANAGE_APPLICATIONS`), scoped
to its own organization. On GCS `main` at 4a77a055 that lane is not open yet:

- `MANAGE_APPLICATIONS` is marked internal in service-protocols, so
  identity-service refuses to grant it to a key outside Leap's organization.
- The read, write, attachment and legacy Fields controllers call
  `requireApplicationsStaff`, which refuses any caller `ApplicationsAccess`
  scopes to one partner. Only the organization-lane service code
  (`LegacyCaller.Partner`) is in place.
- `APPLICATIONS_GATE_LEAP_CHECK_ENFORCED` is `"false"` in staging and production,
  so a non-Leap key holding `MANAGE_INCENTIVE_DATA` is admitted as staff and reads
  across partners.

A partner key gets 403 on every Applications route today. `POST
/beta/incentives/fields` with the `program_identifiers` body is the exception: it
takes `READ_INCENTIVES_DATA` and is already partner-scoped.

Excluded on purpose, so don't re-add them as coverage gaps: every
`/beta/incentives/legacy-alpha/*` alias (deprecated), the staff refId `PATCH
/beta/incentives/applications`, `POST …/status` and `POST …/utility-change`, the
backfill importer `POST …/admin/imports`, the seven Wallet hub routes under
`/beta/incentives/hub`, and Connect's own server routes
(`PATCH /beta/incentives/devices/customer-devices/{id}`, the customer utility
credential routes, `POST /beta/incentives/customers/share/init` and
`/beta/incentives/utility-authorizations*`).

### The Programs section: permission shipped, response shape still moving

REA-1080 has landed on `main`. The three published programs reads now call
`requireReadIncentivesData`, which accepts `READ_INCENTIVES_DATA` **or**
`MANAGE_INCENTIVE_DATA`, so a partner key carrying the new read permission can
call them. Two things still gate publishing this section to production: whether
partner keys are actually provisioned with `READ_INCENTIVES_DATA`, and whether
the GCS revision carrying it is deployed, since GCS production deploys are
manual and `main` reaching production is not automatic.

REA-1080 also had a data question, not only a permission one:
`JooqProgramRepository.findAll` puts no partner or source filter on the query, and
partner offers are program rows (`source = PARTNER_OFFER`, with a `partner_id`
column). So `GET /beta/incentives/programs` returns every partner's offer rows to
every caller. `label`, `description`, `program_type`, `eiaids` and
`device_category` are all readable, so a caller can see that another partner runs
an offer and read its name and description. Filtering `PARTNER_OFFER` rows down to
the caller's own belongs in the service, not in this repo.

The read shape is `ProgramResponse`, the same 23-field record the writes return.
REA-1082 (GitLab MR 1628, **still a draft** as of 2026-08-15) would split reads
from writes and trim the read to eight fields. This repo documented that trimmed
shape before it merged, which put the published spec ahead of the service; the
2026-08-15 resync put it back on what `main` actually returns, minus `metadata`
and the superseded singular `eiaid`, which are dropped through
`removeProperties`. If MR 1628 merges, re-run the sync and the shape follows.

An earlier note here said the device catalog search endpoint would ship behind a
paid wrapper and should stay unpublished. That decision was reversed in REA-1078:
search is published, along with read and write on saved devices.
