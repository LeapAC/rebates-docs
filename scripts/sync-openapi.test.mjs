import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterOperations, retargetServers, ensureSecurity, findBrokenRefs, applyOperationTitles, applyOperationDescriptions, applySchemaDescriptions, findMissingSchemaDescriptions, applySchemaExtensions, findMissingSchemaExtensions, applyStringReplacements, applyTag, pruneUnusedComponents } from './sync-openapi.mjs';

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

test('applySchemaExtensions merges x- markers without disturbing the declared type', () => {
  const spec = applySchemaExtensions(schemaSample(), {
    Req: { 'x-leap-migration': 'device-id-uuid' },
    'Req.flag': { 'x-leap-migration': 'device-id-uuid' },
  });
  assert.equal(spec.components.schemas.Req['x-leap-migration'], 'device-id-uuid');
  assert.equal(spec.components.schemas.Req.properties.flag['x-leap-migration'], 'device-id-uuid');
  assert.equal(spec.components.schemas.Req.properties.flag.type, 'boolean', 'declared type untouched');
  assert.equal(spec.components.schemas.Req.properties.flag.description, 'internal prose', 'description untouched');
  assert.ok(!('x-leap-migration' in spec.components.schemas.Req.properties.other), 'properties without a marker are left alone');
});

test('applySchemaExtensions refuses non-x- keys rather than rewriting the schema', () => {
  assert.throws(
    () => applySchemaExtensions(schemaSample(), { 'Req.flag': { type: 'string' } }),
    /only x- keys allowed/,
  );
});

test('findMissingSchemaExtensions reports markers that no longer match', () => {
  const spec = schemaSample();
  assert.deepEqual(findMissingSchemaExtensions(spec, { 'Req.flag': { 'x-a': 1 } }), []);
  assert.deepEqual(findMissingSchemaExtensions(spec, { 'Req.renamed': { 'x-a': 1 }, Gone: { 'x-a': 1 } }), ['Req.renamed', 'Gone']);
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
