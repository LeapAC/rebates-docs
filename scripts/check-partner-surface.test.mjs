import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNavViolations, findSurfaceViolations, findTextViolations, loadForbiddenTokens } from './sync-openapi.mjs';
import { checkSite, listPages } from './check-partner-surface.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const config = () => JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'openapi-sources.json'), 'utf8'));
const surface = () => config().partnerSurface;

const partnerSpec = () => ({
  openapi: '3.0.0',
  paths: {
    '/beta/incentives/applications/{id}': {
      get: {
        description: 'Read one application.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/App' } } } } },
      },
    },
  },
  components: { schemas: { App: { type: 'object', properties: { id: { type: 'integer' }, status: { type: 'string' } } } } },
});

test('a spec of partner operations and fields passes', () => {
  assert.deepEqual(findSurfaceViolations(partnerSpec(), surface(), 't'), []);
});

test('a route outside the allowlist fails, staff routes and the removed alias included', () => {
  for (const [method, p] of [['get', '/beta/incentives/applications/admin'], ['post', '/beta/incentives/applications/status'], ['get', '/beta/incentives/legacy-alpha/applications'], ['post', '/v1.1/global-connect/internal/incentives/fields'], ['get', '/beta/incentives/applications/customer-utility-credentials']]) {
    const spec = partnerSpec();
    spec.paths[p] = { [method]: { responses: {} } };
    const out = findSurfaceViolations(spec, surface(), 't');
    assert.ok(out.some((v) => v.includes(`${method.toUpperCase()} ${p} is not on the partner surface`)), `${method} ${p}: ${out}`);
  }
});

test('a stripped field, a staff parameter and internal prose each fail', () => {
  const spec = partnerSpec();
  spec.components.schemas.App.properties.dismissal_reason = { type: 'string' };
  spec.paths['/beta/incentives/applications/{id}'].get.parameters.push({ name: 'dryRun', in: 'query', schema: { type: 'boolean' } });
  spec.paths['/beta/incentives/applications/{id}'].get.description = 'Needs MANAGE_WIDGETS (REA-0000).';
  const out = findSurfaceViolations(spec, surface(), 't').join('\n');
  assert.match(out, /properties\/dismissal_reason is a non-partner field/);
  assert.match(out, /non-partner parameter \(dryRun\)/);
  assert.match(out, /"MANAGE_WIDGETS"/);
  assert.match(out, /"REA-0000"/);
});

test('keys, case variants, callbacks and webhooks fail too', () => {
  const spec = partnerSpec();
  const get = spec.paths['/beta/incentives/applications/{id}'].get;
  get.parameters.push({ name: 'X-Force-Status', in: 'header', schema: { type: 'boolean' } });
  get.responses[200].content['application/json'].examples = { MANAGE_WIDGETS: { value: { DryRun: true } } };
  get.callbacks = { onEvent: {} };
  spec.webhooks = { 'some.event': {} };
  const out = findSurfaceViolations(spec, surface(), 't').join('\n');
  assert.match(out, /non-partner parameter \(X-Force-Status\)/);
  assert.match(out, /MANAGE_WIDGETS \(key\)|"MANAGE_WIDGETS"/);
  assert.match(out, /"DryRun"/);
  assert.match(out, /callbacks are not on the partner surface/);
  assert.match(out, /top-level webhooks/);
});

test('a forbidden token fails without the token in the message', () => {
  const s = { ...surface(), forbiddenTokens: ['acmeexample'] };
  const spec = partnerSpec();
  spec.components.schemas.App.properties.status.example = 'AcmeExample order';
  const out = findSurfaceViolations(spec, s, 't');
  assert.equal(out.length, 1, out.join('\n'));
  assert.match(out[0], /properties\/status\/example: names a real partner/);
  assert.doesNotMatch(out[0], /acmeexample/i);
  assert.equal(findTextViolations('AcmeExampleCorp sells chargers', s, 'pages', 'p').length, 0, 'whole tokens only');
});

test('forbidden tokens load from the environment and the gitignored file, never the config', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
  try {
    fs.writeFileSync(path.join(dir, '.partner-tokens'), 'AcmeOne\nacmetwo, acmethree\n');
    assert.deepEqual(loadForbiddenTokens(dir, { PARTNER_SURFACE_FORBIDDEN_TOKENS: 'AcmeZero' }).sort(), ['acmeone', 'acmethree', 'acmetwo', 'acmezero']);
    assert.deepEqual(loadForbiddenTokens(fs.mkdtempSync(path.join(os.tmpdir(), 'none-')), {}), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(!('forbiddenTokens' in surface()) && !('forbiddenTokenHashes' in surface()));
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.partner-tokens$/m);
});

test('an MDX escape does not hide a forbidden name on a page', () => {
  assert.equal(findTextViolations('Needs MANAGE\\_WIDGETS', surface(), 'pages', 'p').length, 1);
});

test('a $ref value and a schema name are not prose', () => {
  const spec = partnerSpec();
  spec.components.schemas.LegacyApp = { type: 'object' };
  spec.paths['/beta/incentives/applications/{id}'].get.responses[404] = { $ref: '#/components/responses/LegacyNotFound' };
  assert.deepEqual(findSurfaceViolations(spec, surface(), 't'), []);
});

test('a config without partnerSurface fails closed', () => {
  assert.match(findSurfaceViolations(partnerSpec(), undefined, 't')[0], /no partnerSurface/);
});

test('page rules skip spec-only patterns', () => {
  assert.equal(findTextViolations('Decision (D6) applies.', surface(), 'pages', 'p').length, 0);
  assert.equal(findTextViolations('Decision (D6) applies.', surface(), 'specs', 'p').length, 1);
  assert.equal(findTextViolations('Register with POST /v1.1/webhooks.', surface(), 'pages', 'p').length, 0);
  assert.equal(findTextViolations('Call /beta/incentives/applications/admin.', surface(), 'pages', 'p').length, 1);
});

test('the sidebar must match the published partner operations', () => {
  const specs = { 'a.json': partnerSpec() };
  const nav = (pages) => ({ navigation: { groups: [{ group: 'A', openapi: 'api-reference/specs/a.json', pages }] } });
  assert.deepEqual(findNavViolations(nav(['GET /beta/incentives/applications/{id}']), surface(), specs), []);
  const extra = findNavViolations(nav(['GET /beta/incentives/applications/{id}', 'GET /beta/incentives/applications/admin']), surface(), specs);
  assert.ok(extra.some((v) => v.includes('applications/admin is not on the partner surface')), extra.join('\n'));
  const missing = findNavViolations(nav([]), surface(), specs);
  assert.ok(missing.some((v) => v.includes('published but has no sidebar entry')), missing.join('\n'));
  const stray = findNavViolations({ navigation: { groups: [{ group: 'B', openapi: 'api-reference/specs/b.json', pages: ['GET /beta/incentives/applications/{id}'] }] } }, surface(), specs);
  assert.ok(stray.some((v) => v.includes('which no configured spec writes')), stray.join('\n'));
  const prefixed = findNavViolations(nav(['GET /beta/incentives/applications/{id}', 'import/x/openapi.json GET /webhook-config']), surface(), specs);
  assert.ok(prefixed.some((v) => v.includes('import/x/openapi.json, which no configured spec writes')), prefixed.join('\n'));
  assert.ok(prefixed.some((v) => v.includes('GET /webhook-config is not on the partner surface')), prefixed.join('\n'));
  const arrays = findNavViolations({ navigation: { groups: [{ group: 'C', openapi: ['api-reference/specs/a.json', 'https://example.com/a.json'], pages: ['GET /beta/incentives/applications/{id}'] }] } }, surface(), specs);
  assert.equal(arrays.length, 1, arrays.join('\n'));
});

test('pages exclude the unpublished directories and READMEs', () => {
  const pages = listPages(root).map((p) => path.relative(root, p));
  assert.ok(pages.includes('quickstart.mdx'));
  assert.ok(pages.every((p) => !p.startsWith('.github') && !p.startsWith('.claude') && !p.startsWith('node_modules') && path.basename(p) !== 'README.md'), pages.join(', '));
});

test('the committed site exposes only the partner surface', () => {
  assert.deepEqual(checkSite(root, config()), []);
});

test('a forbidden token on a committed page or in docs.json fails the site check', () => {
  const out = checkSite(root, config(), ['quickstart']).join('\n');
  assert.match(out, /docs\.json:\d+: names a real partner/);
});

test('the check command exits 0 on the committed site', () => {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-partner-surface.mjs')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /partner surface: 21 operations allowed/);
});
