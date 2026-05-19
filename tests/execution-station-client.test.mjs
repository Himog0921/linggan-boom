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

test('execution station heartbeat respects server retry-after backpressure', async () => {
  const storageArea = createMemoryStorage({
    workbenchExecutionStation: {
      stationKey: 'station-key-1',
      stationId: 'station-1',
      stationToken: 'token-1',
      capabilities: ['xhs.authorSurfaceScan'],
    },
  });
  const client = createExecutionStationClient({
    storageArea,
    now: () => 1_000,
    resolveServerUrl: async () => 'http://localhost:3000',
    resolveAuthorization: async () => ({ authorizationToken: 'auth_token_1' }),
    fetchFn: async () => ({
      ok: false,
      status: 503,
      headers: {
        get(name) {
          return String(name || '').toLowerCase() === 'retry-after' ? '120' : null;
        },
      },
      async text() {
        return JSON.stringify({
          error: '执行设备通道正在保护数据库，请稍后重试。',
          code: 'plugin_protocol_backpressure',
          retryAfterSeconds: 120,
        });
      },
    }),
  });

  const heartbeat = await client.sendHeartbeat({
    status: 'online',
    capabilities: ['xhs.authorSurfaceScan'],
  });

  assert.equal(heartbeat.success, false);
  assert.equal(heartbeat.retryable, true);
  assert.equal(heartbeat.status, 503);
  assert.equal(heartbeat.reasonCode, 'plugin_protocol_backpressure');
  assert.equal(heartbeat.nextRetryAfterMs, 120_000);
  assert.equal(heartbeat.nextRetryAt, 121_000);
});

test('execution station client fetches VAPID public key and registers push subscription', async () => {
  const storageArea = createMemoryStorage({
    workbenchExecutionStation: {
      stationKey: 'station-key-1',
      stationId: 'station-1',
      stationToken: 'token-1',
    },
  });
  const requests = [];
  const client = createExecutionStationClient({
    storageArea,
    now: () => 2_000,
    resolveServerUrl: async () => 'http://localhost:3000',
    resolveAuthorization: async () => ({
      authorizationId: 'auth_1',
      authorizationToken: 'auth_token_1',
    }),
    fetchFn: async (url, options = {}) => {
      requests.push([url, options]);
      if (url.endsWith('/api/push/vapid-public-key')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { enabled: true, publicKey: 'AQIDBA' };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true };
        },
      };
    },
  });

  const key = await client.fetchVapidPublicKey();
  const registration = await client.registerPushSubscription({
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    },
    pluginVersion: '2.0.15',
    browserLabel: 'Chrome',
  });
  const stored = await client.getStoredStationIdentity();

  assert.deepEqual(key, { enabled: true, publicKey: 'AQIDBA' });
  assert.equal(registration.ok, true);
  assert.equal(requests[0][1].method, 'GET');
  assert.equal(requests[1][1].headers.Authorization, 'Bearer auth_token_1');
  assert.deepEqual(JSON.parse(requests[1][1].body), {
    stationId: 'station-1',
    stationToken: 'token-1',
    authorizationId: 'auth_1',
    pluginVersion: '2.0.15',
    browserLabel: 'Chrome',
    subscription: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/sub-1',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    },
  });
  assert.equal(stored.pushSubscriptionEndpoint, 'https://fcm.googleapis.com/fcm/send/sub-1');
  assert.equal(stored.pushSubscriptionRegisteredAt, 2_000);
});
