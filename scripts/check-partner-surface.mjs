#!/usr/bin/env node
// Fails when the committed site exposes anything outside the partner surface:
// a spec operation or field the config does not allow, a sidebar entry that
// points outside it, or a page that names a staff-only route, an internal
// permission, or a real partner. The rules live in `partnerSurface` in
// `openapi-sources.json`; `sync-openapi.mjs` applies the same rules before it
// writes a spec. Run it with `npm run check:surface`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNavViolations, findSurfaceViolations, findTextViolations, loadForbiddenTokens } from './sync-openapi.mjs';

// Mintlify does not publish these, so their prose is free to name internals.
const UNPUBLISHED_DIRS = new Set(['.git', '.github', '.claude', 'node_modules']);

export function listPages(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!UNPUBLISHED_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (/\.mdx?$/.test(entry.name) && entry.name !== 'README.md') {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out.sort();
}

export function checkSite(root, cfg, tokens = loadForbiddenTokens(root)) {
  const surface = { ...cfg.partnerSurface, forbiddenTokens: tokens };
  const specsDir = path.join(root, cfg.specsDir);
  const out = [];
  const specs = {};
  for (const s of cfg.specs) {
    const file = path.join(specsDir, s.output);
    if (!fs.existsSync(file)) { out.push(`${s.output}: configured but not committed`); continue; }
    specs[s.output] = JSON.parse(fs.readFileSync(file, 'utf8'));
    out.push(...findSurfaceViolations(specs[s.output], surface, s.output));
  }
  for (const name of fs.readdirSync(specsDir)) {
    if (name.endsWith('.json') && !(name in specs)) out.push(`${cfg.specsDir}/${name}: no spec in openapi-sources.json writes it, so nothing checks it`);
  }
  const docsText = fs.readFileSync(path.join(root, 'docs.json'), 'utf8');
  out.push(...findNavViolations(JSON.parse(docsText), surface, specs, cfg.specsDir));
  // The `openapi` lines name the spec files, whose `gcs-` prefix predates this
  // check; findNavViolations already pins them to configured specs.
  docsText.split('\n').forEach((line, i) => {
    if (!/^\s*"openapi":/.test(line)) out.push(...findTextViolations(line, surface, 'pages', `docs.json:${i + 1}`));
  });
  for (const page of listPages(root)) {
    const rel = path.relative(root, page);
    fs.readFileSync(page, 'utf8').split('\n').forEach((line, i) => {
      out.push(...findTextViolations(line, surface, 'pages', `${rel}:${i + 1}`));
    });
  }
  return out;
}

function main() {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const cfgPath = process.env.SYNC_OPENAPI_CONFIG || path.join(root, 'scripts', 'openapi-sources.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const tokens = loadForbiddenTokens(root);
  if (!tokens.length) console.warn('! no forbidden partner tokens loaded: set PARTNER_SURFACE_FORBIDDEN_TOKENS or write .partner-tokens. Partner names go unchecked.');
  const violations = checkSite(root, cfg, tokens);
  if (violations.length) {
    console.error(`✗ ${violations.length} partner surface violation(s):\n  ${violations.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ partner surface: ${cfg.partnerSurface.operations.length} operations allowed, specs, navigation and pages clean`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
