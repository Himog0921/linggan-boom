import test from 'node:test';
import assert from 'node:assert/strict';

import { createExecutionStationClient } from '../src/workbench/runtime/executionStationClient.js';

function createMemoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(key) {
      return { [key]: values[key] };
    },
    async set(next) {
      Object.assign(values, next);
    },
  };
}

test('execution station client stores registration identity and keeps it after heartbeat failure', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const client = createExecutionStationClient({
    storageArea,
    randomUUID: () => 'station-key-1',
    resolveServerUrl: async () => 'http://localhost:3000',
    resolveAuthorization: async () => ({
      authorizationId: 'auth_1',
      authorizationToken: 'auth_token_1',
    }),
    fetchFn: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/api/execution-stations/register')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              stationId: 'station-1',
              stationToken: 'token-1',
              displayName: '小红书监控 01',
            };
          },
        };
      }
      return {
        ok: false,
        status: 503,
        async text() {
          return 'temporary outage';
        },
      };
    },
  });

  const registration = await client.registerWithPairingCode({
    pairingCode: '123456',
    capabilities: ['xhs.authorSurfaceScan'],
    pluginVersion: '1.0.0',
  });
  const heartbeat = await client.sendHeartbeat({
    status: 'online',
    capabilities: ['xhs.authorSurfaceScan'],
    platformAccounts: [{ platform: 'xhs', healthStatus: 'healthy', purpose: 'author_monitor' }],
  });
  const stored = await client.getStoredStationIdentity();

  assert.equal(registration.stationId, 'station-1');
  assert.equal(heartbeat.success, false);
  assert.equal(heartbeat.retryable, true);
  assert.equal(stored.stationId, 'station-1');
  assert.equal(stored.stationToken, 'token-1');
  assert.equal(stored.stationKey, 'station-key-1');
  assert.equal(requests.length, 2);
  assert.equal(requests[0][1].headers.Authorization, 'Bearer auth_token_1');
  assert.equal(JSON.parse(requests[0][1].body).authorizationId, 'auth_1');
  assert.equal(requests[1][1].headers.Authorization, 'Bearer auth_token_1');
  assert.equal(JSON.parse(requests[1][1].body).authorizationId, 'auth_1');
});
