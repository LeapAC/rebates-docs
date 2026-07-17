import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterOperations, retargetServers, ensureSecurity, findBrokenRefs } from './sync-openapi.mjs';

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

test('findBrokenRefs flags unresolved local refs only', () => {
  const spec = sample();
  spec.paths['/a'].get.responses = { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Missing' } } } } };
  spec.paths['/b'].post.responses = { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Foo' } } } } };
  assert.deepEqual(findBrokenRefs(spec), ['#/components/schemas/Missing']);
});
