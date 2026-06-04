import test from 'node:test';
import assert from 'node:assert/strict';

import { applyPackagedInstallBootstrap } from '../src/workbench/runtime/pluginInstallBootstrap.js';

test('packaged install bootstrap authorizes the plugin and binds an execution station once', async () => {
  const calls = [];
  const authorizationClient = {
    async getStoredAuthorization() {
      return {};
    },
    async authorizeWithCode(input) {
      calls.push(['authorize', input]);
      return {
        authorizationId: 'auth_1',
        authorizationToken: 'auth_token_1',
        status: 'active',
      };
    },
  };
  const stationClient = {
    async getStoredStationIdentity() {
      return {};
    },
    async registerWithPairingCode(input) {
      calls.push(['register', input]);
      return {
        stationId: 'station-1',
        stationToken: 'station-token-1',
        displayName: '程烈的执行设备',
      };
    },
  };

  const result = await applyPackagedInstallBootstrap({
    readConfig: async () => ({
      schemaVersion: 1,
      serverUrl: 'https://lingganboom.fun',
      authorizationCode: 'LGBOOM-AUTO',
      pairingCode: '123456',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    authorizationClient,
    stationClient,
    saveFlywheelConfig: async (config) => calls.push(['config', config]),
    stationCapabilities: ['xhs.authorSurfaceScan'],
    pluginVersion: '2.0.1',
    browserLabel: 'Chrome',
  });

  assert.equal(result.applied, true);
  assert.deepEqual(calls, [
    ['config', { serverUrl: 'https://lingganboom.fun', enabled: true }],
    ['authorize', {
      authorizationCode: 'LGBOOM-AUTO',
      pluginVersion: '2.0.1',
      browserLabel: 'Chrome',
    }],
    ['config', {
      enabled: true,
      apiToken: 'auth_token_1',
      dataToken: '',
      dataTokenExpiresAt: '',
      dataWorkspaceId: '',
      dataUserEmail: '',
      dataUserName: '',
    }],
    ['register', {
      pairingCode: '123456',
      capabilities: ['xhs.authorSurfaceScan'],
      pluginVersion: '2.0.1',
      browserLabel: 'Chrome',
    }],
  ]);
});

test('packaged install bootstrap skips when authorization and station already exist', async () => {
  const result = await applyPackagedInstallBootstrap({
    readConfig: async () => ({
      schemaVersion: 1,
      serverUrl: 'https://lingganboom.fun',
      authorizationCode: 'LGBOOM-AUTO',
      pairingCode: '123456',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    authorizationClient: {
      async getStoredAuthorization() {
        return { authorizationToken: 'auth-token', status: 'active' };
      },
    },
    stationClient: {
      async getStoredStationIdentity() {
        return { stationId: 'station-1', stationToken: 'station-token-1' };
      },
    },
  });

  assert.deepEqual(result, { applied: false, reason: 'already_configured' });
});

test('packaged install bootstrap preserves existing authorization when only station identity is missing', async () => {
  const calls = [];
  const result = await applyPackagedInstallBootstrap({
    readConfig: async () => ({
      schemaVersion: 1,
      serverUrl: 'https://lingganboom.fun',
      authorizationCode: 'LGBOOM-NEW',
      pairingCode: '654321',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    authorizationClient: {
      async getStoredAuthorization() {
        return {
          authorizationId: 'old-auth',
          authorizationToken: 'old-token',
          status: 'active',
        };
      },
      async authorizeWithCode(input) {
        calls.push(['authorize', input]);
        return {
          authorizationId: 'new-auth',
          authorizationToken: 'new-token',
          status: 'active',
        };
      },
    },
    stationClient: {
      async getStoredStationIdentity() {
        return {};
      },
      async registerWithPairingCode(input) {
        calls.push(['register', input]);
        return {
          stationId: 'station-2',
          stationToken: 'station-token-2',
        };
      },
    },
    saveFlywheelConfig: async (config) => calls.push(['config', config]),
    stationCapabilities: ['xhs.noteDetailProbe'],
    pluginVersion: '2.0.2',
    browserLabel: 'Chrome',
  });

  assert.equal(result.applied, true);
  assert.equal(result.authorization.authorizationId, 'old-auth');
  assert.deepEqual(calls, [
    ['config', { serverUrl: 'https://lingganboom.fun', enabled: true }],
    ['register', {
      pairingCode: '654321',
      capabilities: ['xhs.noteDetailProbe'],
      pluginVersion: '2.0.2',
      browserLabel: 'Chrome',
    }],
  ]);
});
