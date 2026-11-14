#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

const SECURITY_PRESETS = {
  bearer: {
    scheme: { BearerAuth: { type: 'http', scheme: 'bearer', description: 'Your Leap API key as a Bearer token. Send it in the `Authorization` header: `Authorization: Bearer <api-key>`.' } },
    requirement: [{ BearerAuth: [] }],
  },
  apikey: {
    scheme: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Your Leap API key. Send it in the `x-api-key` header: `x-api-key: leap_live_...`.' } },
    requirement: [{ ApiKeyAuth: [] }],
  },
};

export function filterOperations(spec, include, exclude) {
  const paths = spec.paths || {};
  if (Array.isArray(include)) {
    const allow = new Set(include.map((o) => `${o.method.toLowerCase()} ${o.path}`));
    const out = {};
    for (const [p, ops] of Object.entries(paths)) {
      for (const [m, op] of Object.entries(ops)) {
        if (!HTTP_METHODS.includes(m.toLowerCase())) continue;
        if (allow.has(`${m.toLowerCase()} ${p}`)) (out[p] ??= {})[m] = op;
      }
      if (out[p] && ops.parameters) out[p].parameters = ops.parameters;
    }
    spec.paths = out;
  } else if (Array.isArray(exclude)) {
    const deny = new Set(exclude.map((o) => `${o.method.toLowerCase()} ${o.path}`));
    for (const [p, ops] of Object.entries(paths)) {
      for (const m of Object.keys(ops)) {
        if (HTTP_METHODS.includes(m.toLowerCase()) && deny.has(`${m.toLowerCase()} ${p}`)) delete ops[m];
      }
      if (Object.keys(ops).filter((m) => HTTP_METHODS.includes(m.toLowerCase())).length === 0) delete paths[p];
    }
  }
  return spec;
}

export function retargetServers(spec, servers) {
  spec.servers = servers;
  return spec;
}

// Mintlify derives an endpoint page's URL slug, title, and nav label from the
// operation `summary`. Override it with a short title (from the include entry)
// for clean URLs like /incentives-lookups/look-up-incentives.
export function applyOperationTitles(spec, include) {
  if (!Array.isArray(include)) return spec;
  const titles = new Map(include.filter((o) => o.title).map((o) => [`${o.method.toLowerCase()} ${o.path}`, o.title]));
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    if (!ops || typeof ops !== 'object') continue;
    for (const [m, op] of Object.entries(ops)) {
      const t = titles.get(`${m.toLowerCase()} ${p}`);
      if (t && op && typeof op === 'object') op.summary = t;
    }
  }
  return spec;
}

// The source specs carry long, internal-facing operation descriptions (pipeline
// mechanics, org-scoping notes, auth boilerplate). Override them with the short,
// audience-appropriate `description` from the include entry so the docs read for
// partners, not maintainers. Descriptions without an override pass through
// untouched. Kept in config (not the source repos) so this stays a one-PR change
// and survives future re-syncs.
export function applyOperationDescriptions(spec, include) {
  if (!Array.isArray(include)) return spec;
  const descs = new Map(include.filter((o) => o.description != null).map((o) => [`${o.method.toLowerCase()} ${o.path}`, o.description]));
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    if (!ops || typeof ops !== 'object') continue;
    for (const [m, op] of Object.entries(ops)) {
      const d = descs.get(`${m.toLowerCase()} ${p}`);
      if (d != null && op && typeof op === 'object') op.description = d;
    }
  }
  return spec;
}

// Schema and property descriptions come through from the source specs written
// for maintainers — ticket references, storage internals, service names. Override
// the partner-visible ones from config, keyed `Schema` or `Schema.property`, so
// the rendered reference reads for partners and the wording survives re-syncs.
export function applySchemaDescriptions(spec, overrides) {
  if (!overrides) return spec;
  for (const [key, text] of Object.entries(overrides)) {
    const target = resolveSchemaTarget(spec, key);
    if (target) target.description = text;
  }
  return spec;
}

// An override that no longer matches means its internal source description is
// silently shipping instead. Surface those like a broken $ref: fail the run.
export function findMissingSchemaDescriptions(spec, overrides) {
  return Object.keys(overrides || {}).filter((key) => !resolveSchemaTarget(spec, key));
}

// Some source prose can't be reached by name: inline `example` values, response
// and parameter descriptions, a clause inside an otherwise-good paragraph.
// Rewrite those by literal substring — used to keep storage-vendor hostnames,
// database constraint names and other maintainer-facing detail out of the
// rendered reference. Returns the rules that matched nothing, split by whether
// the rule is marked `required`.
export function applyStringReplacements(spec, replacements) {
  const unused = new Set((replacements || []).map((r) => r.from));
  const requiredRules = new Set((replacements || []).filter((r) => r.required).map((r) => r.from));
  if (!replacements?.length) return { spec, unused: [], missingRequired: [] };
  const rewrite = (node) => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) node[k] = rewrite(v);
      return node;
    }
    if (typeof node === 'string') {
      let out = node;
      for (const { from, to } of replacements) {
        if (out.includes(from)) { unused.delete(from); out = out.split(from).join(to); }
      }
      return out;
    }
    return node;
  };
  const out = rewrite(spec);
  return { spec: out, unused: [...unused], missingRequired: [...unused].filter((f) => requiredRules.has(f)) };
}

// Retired and maintainer-only fields survive in the source specs long after they
// stop working — a legacy identifier kept on the wire for compatibility, a
// storage-lineage column, a free-form `metadata` bag. Publishing them invites
// partners to integrate against something that is dead or private, so drop them
// from the generated spec entirely. Keyed `Schema.property`; also strips the
// property from that schema's `required`. Returns the keys that matched nothing
// (the upstream field is already gone — drop the config entry).
export function removeProperties(spec, keys) {
  const unmatched = [];
  for (const key of keys || []) {
    const [name, prop] = key.split('.');
    const schema = spec.components?.schemas?.[name];
    if (!prop || !schema?.properties || !(prop in schema.properties)) { unmatched.push(key); continue; }
    delete schema.properties[prop];
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((r) => r !== prop);
      if (schema.required.length === 0) delete schema.required;
    }
  }
  return unmatched;
}

// Some operations take selectors that only Leap staff may use, such as an
// organization picker on an admin lane. Partners cannot send them, so drop the
// parameter from every operation that lists it. Keyed by the component name in
// `#/components/parameters`; pruning then removes the unused component.
// Returns the names no operation referenced (the parameter is gone upstream).
export function removeParameters(spec, names) {
  const wanted = new Set(names || []);
  const hit = new Set();
  for (const ops of Object.values(spec.paths || {})) {
    if (!ops || typeof ops !== 'object') continue;
    for (const [m, op] of Object.entries(ops)) {
      const lists = m === 'parameters' ? [ops] : HTTP_METHODS.includes(m.toLowerCase()) && op && typeof op === 'object' ? [op] : [];
      for (const holder of lists) {
        if (!Array.isArray(holder.parameters)) continue;
        holder.parameters = holder.parameters.filter((param) => {
          const name = typeof param?.$ref === 'string' && param.$ref.startsWith('#/components/parameters/') ? param.$ref.slice('#/components/parameters/'.length) : undefined;
          if (name && wanted.has(name)) { hit.add(name); return false; }
          return true;
        });
        if (holder.parameters.length === 0) delete holder.parameters;
      }
    }
  }
  return [...wanted].filter((n) => !hit.has(n));
}

// A request body can accept a second, staff-only shape through `oneOf`. Drop the
// branches that point at the named schemas so partners see only the shape they
// can send, and collapse a `oneOf` or `anyOf` left with one branch into that
// branch. Returns the schema names no branch referenced.
export function dropOneOfBranches(spec, names) {
  const wanted = new Set(names || []);
  const hit = new Set();
  const branchName = (b) => (typeof b?.$ref === 'string' && b.$ref.startsWith('#/components/schemas/') ? b.$ref.slice('#/components/schemas/'.length) : undefined);
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const key of ['oneOf', 'anyOf']) {
      if (!Array.isArray(node[key])) continue;
      const before = node[key].length;
      node[key] = node[key].filter((b) => {
        const n = branchName(b);
        if (n && wanted.has(n)) { hit.add(n); return false; }
        return true;
      });
      // Only reshape a list this step trimmed: a source `oneOf` with one branch
      // (the OAS 3.0 nullable idiom) stays as the source wrote it.
      if (node[key].length === before) continue;
      if (node[key].length === 0) delete node[key];
      else if (node[key].length === 1) {
        const [only] = node[key];
        delete node[key];
        Object.assign(node, only);
      }
    }
    Object.values(node).forEach(walk);
  };
  if (wanted.size) walk(spec.paths);
  return [...wanted].filter((n) => !hit.has(n));
}

// Source specs carry vendor extensions for their own tooling, such as the
// permission a route checks or a marker for vendored operations. Mintlify ignores
// them, but they ship in the published JSON. Delete the named `x-` keys anywhere
// in the spec. Returns the names that matched nothing.
export function stripExtensions(spec, names) {
  const wanted = new Set(names || []);
  const hit = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (wanted.has(key)) { hit.add(key); delete node[key]; } else walk(node[key]);
    }
  };
  if (wanted.size) walk(spec);
  return [...wanted].filter((n) => !hit.has(n));
}

// Some corrections are structural rather than textual: a property the source
// types too narrowly, a parameter the route requires but the source marks
// optional, a response the gateway never lets the route send. `patches` applies
// a small RFC 6902 subset (`test`, `add`, `replace`, `remove`) at RFC 6901
// pointers, in order. `test` guards a patch: when the source changes under it,
// the run fails instead of silently patching the wrong node, so drop the patch
// once the source is fixed. Returns one message per patch that failed.
export function applyPatches(spec, patches) {
  const failures = [];
  for (const [i, patch] of (patches || []).entries()) {
    const { op, pointer } = patch || {};
    const label = `patch ${i} (${op} ${pointer})`;
    if (typeof pointer !== 'string' || (pointer !== '' && !pointer.startsWith('/'))) { failures.push(`${label}: pointer must start with /`); continue; }
    const tokens = pointer === '' ? [] : pointer.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (tokens.length === 0) { failures.push(`${label}: cannot patch the document root`); continue; }
    let parent = spec;
    let missing = false;
    for (const t of tokens.slice(0, -1)) {
      const next = Array.isArray(parent) ? parent[Number(t)] : parent?.[t];
      if (next === null || typeof next !== 'object') { missing = true; break; }
      parent = next;
    }
    if (missing) { failures.push(`${label}: path not found`); continue; }
    const last = tokens[tokens.length - 1];
    const isArray = Array.isArray(parent);
    const index = isArray ? (last === '-' ? parent.length : Number(last)) : undefined;
    if (isArray && !(Number.isInteger(index) && index >= 0)) { failures.push(`${label}: bad array index`); continue; }
    const exists = isArray ? index < parent.length : Object.prototype.hasOwnProperty.call(parent, last);
    if (op === 'test') {
      const actual = isArray ? parent[index] : parent[last];
      if (!exists || JSON.stringify(actual) !== JSON.stringify(patch.value)) failures.push(`${label}: value changed upstream`);
    } else if (op === 'add') {
      if (isArray) {
        if (index > parent.length) { failures.push(`${label}: bad array index`); continue; }
        parent.splice(index, 0, structuredClone(patch.value));
      } else parent[last] = structuredClone(patch.value);
    } else if (op === 'replace') {
      if (!exists) { failures.push(`${label}: path not found`); continue; }
      if (isArray) parent[index] = structuredClone(patch.value); else parent[last] = structuredClone(patch.value);
    } else if (op === 'remove') {
      if (!exists) { failures.push(`${label}: path not found`); continue; }
      if (isArray) parent.splice(index, 1); else delete parent[last];
    } else failures.push(`${label}: unknown op`);
  }
  return failures;
}

function resolveSchemaTarget(spec, key) {
  const [name, prop] = key.split('.');
  const schema = spec.components?.schemas?.[name];
  if (!schema) return undefined;
  const target = prop ? schema.properties?.[prop] : schema;
  return target && typeof target === 'object' ? target : undefined;
}

// Mintlify derives an endpoint page's URL path prefix from the operation `tag`.
// Normalize every operation to one tag so a section's URLs share a clean prefix.
export function applyTag(spec, tag) {
  if (!tag) return spec;
  for (const ops of Object.values(spec.paths || {})) {
    if (!ops || typeof ops !== 'object') continue;
    for (const [m, op] of Object.entries(ops)) {
      if (HTTP_METHODS.includes(m.toLowerCase()) && op && typeof op === 'object') op.tags = [tag];
    }
  }
  spec.tags = [{ name: tag }];
  return spec;
}

export function ensureSecurity(spec, presetName) {
  const preset = SECURITY_PRESETS[presetName];
  if (!preset) throw new Error(`Unknown security preset: ${presetName}`);
  spec.components ??= {};
  // Single-auth partner spec: the canonical scheme is the only one. This drops
  // any source scheme (e.g. GCS's `http`) so the committed spec is consistent.
  spec.components.securitySchemes = { ...preset.scheme };
  // Strip per-operation `security` that referenced the source scheme(s); every
  // op then inherits the top-level requirement. Preserve explicit public (`[]`).
  for (const ops of Object.values(spec.paths || {})) {
    if (!ops || typeof ops !== 'object') continue;
    for (const op of Object.values(ops)) {
      if (op && typeof op === 'object' && Array.isArray(op.security) && op.security.length > 0) {
        delete op.security;
      }
    }
  }
  spec.security = preset.requirement;
  return spec;
}

// Collect every component pointer ("#/components/...") that appears as a string
// value anywhere in `obj` — catches `$ref` plus discriminator mappings and any
// other string-embedded reference (conservative: over-collecting is safe here).
function collectComponentRefs(obj) {
  const out = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      for (const v of Object.values(n)) {
        if (typeof v === 'string' && v.startsWith('#/components/')) out.push(v);
        else walk(v);
      }
    }
  };
  walk(obj);
  return out;
}

// Remove components not transitively reachable from the (already-filtered)
// operations or the top-level security. securitySchemes are always kept (they
// are referenced by name in `security`, not via $ref).
export function pruneUnusedComponents(spec) {
  const comps = spec.components;
  if (!comps || typeof comps !== 'object') return spec;
  const resolve = (ref) => {
    const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur = spec;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
      else return undefined;
    }
    return cur;
  };
  const reachable = new Set();
  const queue = collectComponentRefs({ paths: spec.paths, security: spec.security });
  while (queue.length) {
    const ref = queue.pop();
    if (reachable.has(ref)) continue;
    reachable.add(ref);
    const target = resolve(ref);
    if (target !== undefined) for (const r of collectComponentRefs(target)) if (!reachable.has(r)) queue.push(r);
  }
  for (const [type, group] of Object.entries(comps)) {
    if (type === 'securitySchemes' || !group || typeof group !== 'object') continue;
    for (const name of Object.keys(group)) {
      if (!reachable.has(`#/components/${type}/${name}`)) delete group[name];
    }
    if (Object.keys(group).length === 0) delete comps[type];
  }
  return spec;
}

export function findBrokenRefs(spec) {
  const broken = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) {
          const parts = v.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
          let cur = spec, ok = true;
          for (const part of parts) {
            if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
            else { ok = false; break; }
          }
          if (!ok) broken.push(v);
        } else walk(v);
      }
    }
  };
  walk(spec);
  return [...new Set(broken)];
}

// ---- I/O (not unit-tested; exercised by a real run) ----

function fetchFile(repoCfg, repoKey, filePath, destDir, opts, ref) {
  const dest = path.join(destDir, path.basename(filePath));
  if (opts.local) {
    const base = process.env[repoCfg.localEnv] || repoCfg.localDefault;
    if (ref) {
      // Read the file out of a pinned ref instead of the checkout, so a run does
      // not depend on which branch the local clone happens to sit on. Fetch the
      // repo first — `git show` reads only what is already local.
      let raw;
      try {
        raw = execFileSync('git', ['-C', base, 'show', `${ref}:${filePath}`], { maxBuffer: 1 << 26 });
      } catch {
        throw new Error(`cannot read ${filePath} at ${ref} in ${base} — run \`git -C ${base} fetch origin\` first`);
      }
      fs.writeFileSync(dest, raw);
    } else {
      fs.copyFileSync(path.join(base, filePath), dest);
    }
  } else {
    const raw = execFileSync('gh', ['api', `repos/${repoKey}/contents/${filePath}?ref=${opts.ref}`, '-H', 'Accept: application/vnd.github.raw'], { maxBuffer: 1 << 26 });
    fs.writeFileSync(dest, raw);
  }
  return dest;
}

function bundle(entryPath) {
  const tmpOut = `${entryPath}.bundled.json`;
  execFileSync('npx', ['--yes', '@redocly/cli', 'bundle', entryPath, '-o', tmpOut], { stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(fs.readFileSync(tmpOut, 'utf8'));
}

function main() {
  const opts = { local: process.argv.includes('--local'), ref: 'main' };
  const cfg = JSON.parse(fs.readFileSync(new URL('./openapi-sources.json', import.meta.url), 'utf8'));
  const outDir = path.resolve(cfg.specsDir);
  fs.mkdirSync(outDir, { recursive: true });
  let failures = 0;

  for (const s of cfg.specs) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oas-'));
    const repoCfg = cfg.repos[s.source.repo];
    const entry = fetchFile(repoCfg, s.source.repo, s.source.entry, tmp, opts, s.source.ref);
    for (const dep of s.source.deps || []) fetchFile(repoCfg, s.source.repo, dep, tmp, opts, s.source.ref);

    let spec = bundle(entry);
    if (s.include !== 'all') spec = filterOperations(spec, s.include, s.exclude);
    spec = applyOperationTitles(spec, s.include);
    spec = applyOperationDescriptions(spec, s.include);
    if (s.tag) spec = applyTag(spec, s.tag);
    spec = retargetServers(spec, s.servers || cfg[s.serversRef]);
    spec = ensureSecurity(spec, s.security);
    // Before pruning, so a schema that only the removed property referenced goes
    // with it.
    const unremoved = removeProperties(spec, s.removeProperties);
    const unremovedParams = removeParameters(spec, s.removeParameters);
    const undroppedBranches = dropOneOfBranches(spec, s.dropOneOfBranches);
    const unstripped = stripExtensions(spec, s.stripExtensions);
    // After the removals and before pruning, so a patch can drop the last
    // reference to a component and the prune step takes the component with it.
    const patchFailures = applyPatches(spec, s.patches);
    spec = pruneUnusedComponents(spec);
    // After pruning, so overrides are only required for schemas that ship.
    const missing = findMissingSchemaDescriptions(spec, s.schemaDescriptions);
    spec = applySchemaDescriptions(spec, s.schemaDescriptions);
    const replaced = applyStringReplacements(spec, s.replacements);
    spec = replaced.spec;
    const optionalUnused = replaced.unused.filter((f) => !replaced.missingRequired.includes(f));
    if (optionalUnused.length) console.warn(`  ! ${s.output}: replacements matched nothing (source may be fixed): ${optionalUnused.join(', ')}`);
    if (unremovedParams.length) { console.error(`✗ ${s.output}: removeParameters matched no operation: ${unremovedParams.join(', ')}`); failures++; }
    if (unstripped.length) { console.error(`✗ ${s.output}: stripExtensions matched no key: ${unstripped.join(', ')}`); failures++; }
    if (undroppedBranches.length) { console.error(`✗ ${s.output}: dropOneOfBranches matched no branch: ${undroppedBranches.join(', ')}`); failures++; }
    if (patchFailures.length) { console.error(`✗ ${s.output}: patches failed: ${patchFailures.join('; ')}`); failures++; }
    if (unremoved.length) console.warn(`  ! ${s.output}: removeProperties matched nothing (field already gone upstream): ${unremoved.join(', ')}`);
    spec.info = { ...(spec.info || {}), title: s.title, ...(s.description ? { description: s.description } : {}) };

    const broken = findBrokenRefs(spec);
    if (broken.length) { console.error(`✗ ${s.output}: broken refs: ${broken.join(', ')}`); failures++; }
    if (missing.length) { console.error(`✗ ${s.output}: schemaDescriptions no longer match: ${missing.join(', ')}`); failures++; }
    if (replaced.missingRequired.length) { console.error(`✗ ${s.output}: required replacements matched nothing: ${replaced.missingRequired.join(', ')}`); failures++; }

    const opCount = Object.values(spec.paths || {}).reduce((n, ops) => n + Object.keys(ops).filter((m) => HTTP_METHODS.includes(m)).length, 0);
    fs.writeFileSync(path.join(outDir, s.output), JSON.stringify(spec, null, 2) + '\n');
    console.log(`✓ ${s.output}: ${opCount} operations`);
  }
  if (failures) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
