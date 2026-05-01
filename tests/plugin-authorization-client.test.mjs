import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertActivePluginAuthorization,
  createPluginAuthorizationClient,
  getPluginAuthorizationBlockedMessage,
  hasActivePluginAuthorization,
} from '../src/workbench/runtime/pluginAuthorization.js';

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
    async remove(key) {
      delete values[key];
    },
  };
}

test('plugin authorization client exchanges authorization code and stores active authorization', async () => {
  const storageArea = createMemoryStorage();
  const requests = [];
  const client = createPluginAuthorizationClient({
    storageArea,
    randomUUID: () => 'device-1',
    resolveServerUrl: async () => 'http://localhost:3000',
    fetchFn: async (url, options = {}) => {
      requests.push([url, options]);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            authorizationId: 'auth_1',
            authorizationToken: 'auth_token_1',
            status: 'active',
            teamName: '内容团队',
            memberName: '测试同学',
            expiresAt: '2026-05-01T00:00:00.000Z',
          };
        },
      };
    },
  });

  const authorization = await client.authorizeWithCode({
    authorizationCode: 'AUTH-001',
    pluginVersion: '2.0.0',
    browserLabel: 'Chrome',
  });

  assert.equal(authorization.authorizationId, 'auth_1');
  assert.equal(authorization.authorizationToken, 'auth_token_1');
  assert.equal(authorization.deviceId, 'device-1');
  assert.equal(authorization.teamName, '内容团队');
  assert.equal(hasActivePluginAuthorization(authorization), true);
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0][1].body).authorizationCode, 'AUTH-001');
  assert.equal(JSON.parse(requests[0][1].body).deviceId, 'device-1');
});

test('plugin authorization guard throws a user-facing error when authorization is missing', async () => {
  const storageArea = createMemoryStorage();

  await assert.rejects(
    () => assertActivePluginAuthorization({ storageArea }),
    (error) => {
      assert.equal(error.code, 'plugin_authorization_required');
      assert.equal(
        error.message,
        '当前浏览器还没有插件授权。请先去内容工作台设置生成授权码，再回到插件激活。',
      );
      return true;
    },
  );

  assert.equal(
    getPluginAuthorizationBlockedMessage({ status: 'revoked' }),
    '插件授权已被撤销，请联系管理员重新授权。',
  );
});
