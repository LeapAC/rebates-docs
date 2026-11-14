import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterOperations, retargetServers, ensureSecurity, findBrokenRefs, applyOperationTitles, applyOperationDescriptions, applySchemaDescriptions, findMissingSchemaDescriptions, applyStringReplacements, removeProperties, removeParameters, dropOneOfBranches, stripExtensions, applyTag, pruneUnusedComponents, applyPatches } from './sync-openapi.mjs';

const sample = () => ({
  openapi: '3.0.0',
  info: { title: 'x', version: '1' },
  paths: {
    '/a': { get: { operationId: 'getA' }, post: { operationId: 'postA' } },
    '/b': { post: { operationId: 'postB' } },
  },
  components: { schemas: { Foo: { type: 'object' } } },
});

test('filterOperations keeps only the allowlist', () => {
  const spec = filterOperations(sample(), [{ method: 'get', path: '/a' }], undefined);
  assert.deepEqual(Object.keys(spec.paths), ['/a']);
  assert.deepEqual(Object.keys(spec.paths['/a']), ['get']);
});

test('filterOperations drops excluded ops and empties paths', () => {
  const spec = filterOperations(sample(), undefined, [{ method: 'post', path: '/b' }]);
  assert.ok(!('/b' in spec.paths));
  assert.ok('/a' in spec.paths);
});

test('retargetServers overwrites servers', () => {
  const spec = retargetServers(sample(), [{ url: 'https://api.leap.energy' }]);
  assert.deepEqual(spec.servers, [{ url: 'https://api.leap.energy' }]);
});

test('ensureSecurity(bearer) adds scheme + top-level requirement', () => {
  const spec = ensureSecurity(sample(), 'bearer');
  assert.equal(spec.components.securitySchemes.BearerAuth.scheme, 'bearer');
  assert.deepEqual(spec.security, [{ BearerAuth: [] }]);
});

test('ensureSecurity canonicalizes: drops source scheme, strips redundant op-security, keeps public []', () => {
  const spec = {
    info: { title: 'x' },
    paths: {
      '/a': { post: { operationId: 'postA', security: [{ http: [] }] } },
      '/pub': { get: { operationId: 'getPub', security: [] } },
    },
    components: { securitySchemes: { http: { type: 'http', scheme: 'bearer' } } },
  };
  ensureSecurity(spec, 'bearer');
  assert.deepEqual(Object.keys(spec.components.securitySchemes), ['BearerAuth']);
  assert.ok(!('security' in spec.paths['/a'].post), 'redundant op security removed');
  assert.deepEqual(spec.paths['/pub'].get.security, [], 'explicit public security preserved');
  assert.deepEqual(spec.security, [{ BearerAuth: [] }]);
});

test('applyOperationTitles overrides op.summary from include titles', () => {
  const spec = sample();
  applyOperationTitles(spec, [{ method: 'get', path: '/a', title: 'Short A' }]);
  assert.equal(spec.paths['/a'].get.summary, 'Short A');
  assert.ok(!('summary' in spec.paths['/b'].post), 'untitled ops untouched');
});

test('applyOperationDescriptions overrides op.description from include, leaves others', () => {
  const spec = sample();
  spec.paths['/b'].post.description = 'original B';
  applyOperationDescriptions(spec, [{ method: 'get', path: '/a', description: 'Short A desc' }]);
  assert.equal(spec.paths['/a'].get.description, 'Short A desc');
  assert.equal(spec.paths['/b'].post.description, 'original B', 'ops without an override are untouched');
});

const schemaSample = () => ({
  info: { title: 'x' },
  paths: {},
  components: {
    schemas: {
      Req: { type: 'object', description: 'internal (TICKET-1 §2)', properties: { flag: { type: 'boolean', description: 'internal prose' }, other: { type: 'string', description: 'untouched' } } },
    },
  },
});

test('applySchemaDescriptions overrides schema- and property-level descriptions', () => {
  const spec = applySchemaDescriptions(schemaSample(), { Req: 'partner prose', 'Req.flag': 'partner flag prose' });
  assert.equal(spec.components.schemas.Req.description, 'partner prose');
  assert.equal(spec.components.schemas.Req.properties.flag.description, 'partner flag prose');
  assert.equal(spec.components.schemas.Req.properties.other.description, 'untouched', 'properties without an override are left alone');
});

test('findMissingSchemaDescriptions reports overrides that no longer match', () => {
  const spec = schemaSample();
  assert.deepEqual(findMissingSchemaDescriptions(spec, { Req: 'a', 'Req.flag': 'b' }), []);
  assert.deepEqual(findMissingSchemaDescriptions(spec, { 'Req.renamed': 'a', Gone: 'b' }), ['Req.renamed', 'Gone']);
});

test('applyStringReplacements rewrites nested example strings and reports unused rules', () => {
  const spec = { paths: { '/a': { get: { responses: { 200: { schema: { properties: { url: { example: 'https://vendor.example/x/file.pdf' } } } } } } } } };
  const { spec: out, unused } = applyStringReplacements(spec, [
    { from: 'https://vendor.example/x/', to: 'https://<storage-host>/' },
    { from: 'not-present', to: 'x' },
  ]);
  assert.equal(out.paths['/a'].get.responses[200].schema.properties.url.example, 'https://<storage-host>/file.pdf');
  assert.deepEqual(unused, ['not-present']);
});

test('applyStringReplacements reports a required rule that matched nothing', () => {
  const spec = { components: { responses: { Conflict: { description: 'the constraint uc_customer_partner_address makes it unique' } } } };
  const { spec: out, missingRequired } = applyStringReplacements(spec, [
    { from: 'the constraint uc_customer_partner_address makes it unique', to: 'one address belongs to one customer', required: true },
    { from: 'reworded upstream', to: 'x', required: true },
    { from: 'also gone', to: 'y' },
  ]);
  assert.equal(out.components.responses.Conflict.description, 'one address belongs to one customer');
  assert.deepEqual(missingRequired, ['reworded upstream'], 'only required rules are reported as failures');
});

test('removeProperties drops the property and its required entry, reporting unmatched keys', () => {
  const spec = {
    components: {
      schemas: {
        DeviceRef: { type: 'object', required: ['device_id', 'device_source_id'], properties: { device_id: { type: 'string' }, device_source_id: { type: 'integer' } } },
        Program: { type: 'object', required: ['metadata'], properties: { metadata: { type: 'object' } } },
      },
    },
  };
  const unmatched = removeProperties(spec, ['DeviceRef.device_source_id', 'Program.metadata', 'DeviceRef.already_gone', 'Missing.thing']);
  assert.deepEqual(Object.keys(spec.components.schemas.DeviceRef.properties), ['device_id']);
  assert.deepEqual(spec.components.schemas.DeviceRef.required, ['device_id']);
  assert.ok(!('required' in spec.components.schemas.Program), 'an emptied required list is dropped');
  assert.deepEqual(unmatched, ['DeviceRef.already_gone', 'Missing.thing']);
});

test('applyTag normalizes every operation to a single tag', () => {
  const spec = applyTag(sample(), 'my-tag');
  assert.deepEqual(spec.paths['/a'].get.tags, ['my-tag']);
  assert.deepEqual(spec.paths['/b'].post.tags, ['my-tag']);
  assert.deepEqual(spec.tags, [{ name: 'my-tag' }]);
});

test('pruneUnusedComponents keeps reachable (incl. transitive + discriminator), drops orphans', () => {
  const spec = {
    info: { title: 'x' },
    paths: {
      '/a': { get: { responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Used' } } } } } } },
    },
    components: {
      schemas: {
        Used: { type: 'object', properties: { child: { $ref: '#/components/schemas/Transitive' } }, discriminator: { mapping: { x: '#/components/schemas/Mapped' } } },
        Transitive: { type: 'string' },
        Mapped: { type: 'object' },
        Orphan: { type: 'object' },
      },
      securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer' } },
    },
  };
  pruneUnusedComponents(spec);
  const kept = Object.keys(spec.components.schemas).sort();
  assert.deepEqual(kept, ['Mapped', 'Transitive', 'Used'], 'orphan removed; transitive + discriminator-mapped kept');
  assert.ok(spec.components.securitySchemes.BearerAuth, 'securitySchemes always kept');
});

test('findBrokenRefs flags unresolved local refs only', () => {
  const spec = sample();
  spec.paths['/a'].get.responses = { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } };
  spec.paths['/b'].post.responses = { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Foo' } } } } };
  assert.deepEqual(findBrokenRefs(spec), ['#/components/schemas/Missing']);
});

test('removeParameters drops component parameter refs from operations and path items, reporting unmatched names', () => {
  const spec = {
    paths: {
      '/a': {
        parameters: [{ $ref: '#/components/parameters/Org' }],
        get: { parameters: [{ $ref: '#/components/parameters/RefId' }, { $ref: '#/components/parameters/Org' }, { name: 'inline', in: 'query' }] },
        post: { parameters: [{ $ref: '#/components/parameters/Org' }] },
      },
    },
    components: { parameters: { RefId: { name: 'refId', in: 'query' }, Org: { name: 'organization_id', in: 'query' } } },
  };
  const unmatched = removeParameters(spec, ['Org', 'Gone']);
  assert.deepEqual(spec.paths['/a'].get.parameters, [{ $ref: '#/components/parameters/RefId' }, { name: 'inline', in: 'query' }]);
  assert.ok(!('parameters' in spec.paths['/a'].post), 'an emptied list is dropped');
  assert.ok(!('parameters' in spec.paths['/a']), 'path-level parameters are filtered too');
  assert.deepEqual(unmatched, ['Gone']);
  pruneUnusedComponents(spec);
  assert.deepEqual(Object.keys(spec.components.parameters), ['RefId'], 'the removed component is pruned');
});

test('dropOneOfBranches removes named branches and collapses a single survivor', () => {
  const spec = {
    paths: {
      '/f': {
        post: {
          requestBody: { content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/Native' }, { $ref: '#/components/schemas/Legacy' }] } } } },
          responses: { 200: { content: { 'application/json': { schema: { anyOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }, { $ref: '#/components/schemas/Legacy' }] } } } } },
        },
      },
    },
    components: { schemas: { Native: { type: 'object' }, Legacy: { type: 'object' }, A: {}, B: {} } },
  };
  const unmatched = dropOneOfBranches(spec, ['Legacy', 'Missing']);
  assert.deepEqual(spec.paths['/f'].post.requestBody.content['application/json'].schema, { $ref: '#/components/schemas/Native' });
  assert.deepEqual(spec.paths['/f'].post.responses[200].content['application/json'].schema.anyOf.map((b) => b.$ref), ['#/components/schemas/A', '#/components/schemas/B']);
  assert.deepEqual(unmatched, ['Missing']);
  pruneUnusedComponents(spec);
  assert.ok(!('Legacy' in spec.components.schemas), 'the dropped branch schema is pruned');
});

test('stripExtensions deletes the named vendor keys at any depth and reports unmatched names', () => {
  const spec = {
    paths: { '/f': { post: { 'x-leap-permission': 'INTERNAL', 'x-keep': 1, requestBody: { content: { 'application/json': { schema: { 'x-legacy-alpha': true, type: 'object' } } } } } } },
    components: { schemas: { A: { 'x-legacy-alpha': true, properties: { b: { type: 'string' } } } } },
  };
  const unmatched = stripExtensions(spec, ['x-leap-permission', 'x-legacy-alpha', 'x-gone']);
  assert.ok(!('x-leap-permission' in spec.paths['/f'].post));
  assert.equal(spec.paths['/f'].post['x-keep'], 1, 'unlisted extensions stay');
  assert.deepEqual(spec.paths['/f'].post.requestBody.content['application/json'].schema, { type: 'object' });
  assert.ok(!('x-legacy-alpha' in spec.components.schemas.A));
  assert.deepEqual(unmatched, ['x-gone']);
});

test('dropOneOfBranches leaves untouched single-branch lists alone and removes an emptied list', () => {
  const spec = {
    paths: {
      '/g': {
        get: {
          responses: {
            200: { content: { 'application/json': { schema: { properties: { n: { nullable: true, oneOf: [{ $ref: '#/components/schemas/Kept' }] } } } } } },
            400: { content: { 'application/json': { schema: { anyOf: [{ $ref: '#/components/schemas/Legacy' }] } } } },
          },
        },
      },
    },
  };
  dropOneOfBranches(spec, ['Legacy']);
  assert.deepEqual(spec.paths['/g'].get.responses[200].content['application/json'].schema.properties.n, { nullable: true, oneOf: [{ $ref: '#/components/schemas/Kept' }] });
  assert.deepEqual(spec.paths['/g'].get.responses[400].content['application/json'].schema, {});
});

test('applyPatches adds, replaces, and removes at escaped pointers, guarded by test', () => {
  const spec = {
    paths: { '/beta/x': { get: { parameters: [{ $ref: '#/components/parameters/A' }], responses: { 200: {}, 401: { description: 'never sent' } } } } },
    components: { schemas: { S: { properties: { kind: { type: 'string', enum: ['a', 'b'] }, ids: { type: 'array' } } } } },
  };
  const failures = applyPatches(spec, [
    { op: 'test', pointer: '/components/schemas/S/properties/kind/enum', value: ['a', 'b'] },
    { op: 'replace', pointer: '/components/schemas/S/properties/kind/enum', value: ['a', 'b', 'c'] },
    { op: 'add', pointer: '/components/schemas/S/properties/ids/nullable', value: true },
    { op: 'remove', pointer: '/paths/~1beta~1x/get/responses/401' },
    { op: 'replace', pointer: '/paths/~1beta~1x/get/parameters/0', value: { name: 'refId', in: 'query', required: true } },
    { op: 'add', pointer: '/paths/~1beta~1x/get/parameters/-', value: { name: 'limit', in: 'query' } },
  ]);
  assert.deepEqual(failures, []);
  assert.deepEqual(spec.components.schemas.S.properties.kind.enum, ['a', 'b', 'c']);
  assert.equal(spec.components.schemas.S.properties.ids.nullable, true);
  assert.ok(!('401' in spec.paths['/beta/x'].get.responses));
  assert.deepEqual(spec.paths['/beta/x'].get.parameters.map((p) => p.name), ['refId', 'limit']);
});

test('applyPatches reports each kind of failure', () => {
  const fresh = () => ({ components: { schemas: { S: { properties: { kind: { enum: ['a', 'b', 'c'] } } } } } });
  const one = (patch) => applyPatches(fresh(), [patch]);
  assert.match(one({ op: 'test', pointer: '/components/schemas/S/properties/kind/enum', value: ['a', 'b'] })[0], /value changed upstream/);
  assert.match(one({ op: 'replace', pointer: '/components/schemas/Gone/properties/x', value: 1 })[0], /path not found/);
  assert.match(one({ op: 'remove', pointer: '/components/schemas/S/properties/missing' })[0], /path not found/);
  assert.match(one({ op: 'move', pointer: '/components/schemas/S' })[0], /unknown op/);
  assert.match(one({ op: 'add', pointer: 'components/schemas/S/x', value: 1 })[0], /pointer must start with/);
  assert.match(one({ op: 'add', pointer: '', value: 1 })[0], /document root/);
  assert.match(one({ op: 'add', pointer: '/components/schemas/S/properties/kind/enum/9', value: 'z' })[0], /bad array index/);
});

test('applyPatches stops at a failed test, so a later op leaves the changed node alone', () => {
  const spec = { components: { schemas: { S: { properties: { kind: { enum: ['a', 'b', 'c'] } } } } } };
  const failures = applyPatches(spec, [
    { op: 'test', pointer: '/components/schemas/S/properties/kind/enum', value: ['a', 'b'] },
    { op: 'replace', pointer: '/components/schemas/S/properties/kind/enum', value: ['a', 'b', 'x'] },
    { op: 'add', pointer: '/components/schemas/S/properties/extra', value: 1 },
  ]);
  assert.deepEqual(spec.components.schemas.S.properties.kind.enum, ['a', 'b', 'c'], 'the upstream value survives');
  assert.ok(!('extra' in spec.components.schemas.S.properties));
  assert.equal(failures.length, 3);
  assert.match(failures[1], /skipped after an earlier failure/);
  assert.match(failures[2], /skipped after an earlier failure/);
});

test('applyPatches add refuses to overwrite an existing key and copies its value', () => {
  const upstream = { type: 'object', description: 'defined upstream' };
  const spec = { components: { schemas: { ApiKeyError: upstream } } };
  const failures = applyPatches(spec, [{ op: 'add', pointer: '/components/schemas/ApiKeyError', value: { type: 'string' } }]);
  assert.match(failures[0], /key already exists/);
  assert.equal(spec.components.schemas.ApiKeyError, upstream);
  const value = { keep: 1 };
  assert.deepEqual(applyPatches(spec, [{ op: 'add', pointer: '/components/schemas/Copy', value }]), []);
  value.keep = 2;
  assert.deepEqual(spec.components.schemas.Copy, { keep: 1 }, 'patch values are copied, not shared');
});

test('applyPatches unescapes ~0 and ~1 and tests an array element', () => {
  const spec = { paths: { '/a~b/c': { get: { tags: ['x', 'y'] } } } };
  const failures = applyPatches(spec, [
    { op: 'test', pointer: '/paths/~1a~0b~1c/get/tags/1', value: 'y' },
    { op: 'replace', pointer: '/paths/~1a~0b~1c/get/tags/1', value: 'z' },
  ]);
  assert.deepEqual(failures, []);
  assert.deepEqual(spec.paths['/a~b/c'].get.tags, ['x', 'z']);
});

// The sync bundles with Redocly through npx. Skip the end-to-end run when no
// local copy resolves, rather than fail on a machine without network access.
const redoclyLocal = spawnSync('npx', ['--no-install', 'redocly', '--version'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'ignore' }).status === 0;

test('sync exits 1 and leaves the output unwritten when a patch fails', { skip: redoclyLocal ? false : 'no local @redocly/cli; run npm install' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-patch-'));
  try {
    const repo = path.join(root, 'repo');
    const out = path.join(root, 'specs');
    fs.mkdirSync(repo);
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(repo, 'api.yaml'), [
      'openapi: 3.0.1',
      'info: { title: t, version: "1" }',
      'paths:',
      '  /x:',
      '    get:',
      '      responses:',
      "        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/S' } } } }",
      'components:',
      '  schemas:',
      '    S: { type: object, properties: { kind: { type: string, enum: [a, b, c] } } }',
      '',
    ].join('\n'));
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('init', '-q');
    git('add', 'api.yaml');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'seed');
    const committed = '{ "committed": true }\n';
    fs.writeFileSync(path.join(out, 'x.json'), committed);
    const cfg = {
      specsDir: out,
      repos: { 'test/repo': { localEnv: 'SYNC_TEST_REPO_UNSET', localDefault: repo } },
      specs: [{
        output: 'x.json', title: 'x', servers: [{ url: 'https://example.com' }], security: 'bearer',
        source: { repo: 'test/repo', ref: 'HEAD', entry: 'api.yaml', deps: [] },
        include: [{ method: 'get', path: '/x' }],
        patches: [
          { op: 'test', pointer: '/components/schemas/S/properties/kind/enum', value: ['a', 'b'] },
          { op: 'replace', pointer: '/components/schemas/S/properties/kind/enum', value: ['a', 'b', 'x'] },
        ],
      }],
    };
    const cfgPath = path.join(root, 'sources.json');
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    const script = fileURLToPath(new URL('./sync-openapi.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [script, '--local'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, SYNC_OPENAPI_CONFIG: cfgPath },
      encoding: 'utf8',
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /patches failed/);
    assert.match(run.stderr, /x\.json: not written/);
    assert.equal(fs.readFileSync(path.join(out, 'x.json'), 'utf8'), committed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
