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

function fetchFile(repoCfg, repoKey, filePath, destDir, opts) {
  const dest = path.join(destDir, path.basename(filePath));
  if (opts.local) {
    const base = process.env[repoCfg.localEnv] || repoCfg.localDefault;
    fs.copyFileSync(path.join(base, filePath), dest);
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
    const entry = fetchFile(repoCfg, s.source.repo, s.source.entry, tmp, opts);
    for (const dep of s.source.deps || []) fetchFile(repoCfg, s.source.repo, dep, tmp, opts);

    let spec = bundle(entry);
    if (s.include !== 'all') spec = filterOperations(spec, s.include, s.exclude);
    spec = retargetServers(spec, s.servers || cfg[s.serversRef]);
    spec = ensureSecurity(spec, s.security);
    spec.info = { ...(spec.info || {}), title: s.title };

    const broken = findBrokenRefs(spec);
    if (broken.length) { console.error(`✗ ${s.output}: broken refs: ${broken.join(', ')}`); failures++; }

    const opCount = Object.values(spec.paths || {}).reduce((n, ops) => n + Object.keys(ops).filter((m) => HTTP_METHODS.includes(m)).length, 0);
    fs.writeFileSync(path.join(outDir, s.output), JSON.stringify(spec, null, 2) + '\n');
    console.log(`✓ ${s.output}: ${opCount} operations`);
  }
  if (failures) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
