import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskPoller } from '../src/workbench/runtime/taskPoller.js';
import {
  claimCollectionTaskLease,
  createTaskLeaseMemoryStore,
  createTaskLeaseIdleSnapshot,
  formatTaskLeaseIdleNotice,
  createTaskLeaseStorageStore,
  reconcileExecutionStationLease,
  renewCollectionTaskLease,
} from '../src/workbench/runtime/taskLeaseClient.js';

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

test('task lease client claims and renews through workbench lease endpoints', async () => {
  const requests = [];
  const fetchFn = async (url, options = {}) => {
    requests.push([url, options]);
    if (url.endsWith('/api/collection-tasks/claim')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            task: {
              id: 'task-lease-1',
              taskStrategy: 'author_patrol',
              leaseEpoch: 3,
            },
            lease: {
              leaseToken: 'lease-token-1',
              expiresAt: '2026-04-17T12:05:00.000Z',
            },
            attempt: {
              attemptId: 'attempt-1',
              attemptNumber: 2,
            },
          };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { success: true, expiresAt: '2026-04-17T12:10:00.000Z' };
      },
    };
  };
  const store = createTaskLeaseMemoryStore();

  const claim = await claimCollectionTaskLease({
    serverUrl: 'http://localhost:3000',
    stationId: 'station-1',
    stationToken: 'station-token',
    authorizationId: 'auth_1',
    authorizationToken: 'auth_token_1',
    capabilities: ['xhs.authorSurfaceScan'],
    platformAccounts: [{ platform: 'xhs', purpose: 'author_monitor', healthStatus: 'healthy' }],
    fetchFn,
    store,
  });
  const claimedLease = await store.read();
  const renewal = await renewCollectionTaskLease({
    serverUrl: 'http://localhost:3000',
    taskId: 'task-lease-1',
    stationId: 'station-1',
    stationToken: 'station-token',
    leaseToken: claimedLease.leaseToken,
    attemptId: claimedLease.attemptId,
    attemptNumber: claimedLease.attemptNumber,
    leaseEpoch: claimedLease.leaseEpoch,
    authorizationId: 'auth_1',
    authorizationToken: 'auth_token_1',
    status: 'running',
    fetchFn,
    store,
  });

  assert.equal(claim.task.id, 'task-lease-1');
  assert.equal((await store.read()).leaseToken, 'lease-token-1');
  assert.equal((await store.read()).attemptId, 'attempt-1');
  assert.equal((await store.read()).attemptNumber, 2);
  assert.equal((await store.read()).leaseEpoch, 3);
  assert.equal(renewal.expiresAt, '2026-04-17T12:10:00.000Z');
  assert.equal((await store.read()).expiresAt, '2026-04-17T12:10:00.000Z');
  assert.equal(requests.length, 2);
  assert.equal(requests[0][1].headers.Authorization, 'Bearer auth_token_1');
  assert.equal(JSON.parse(requests[0][1].body).authorizationId, 'auth_1');
  assert.equal(requests[1][1].headers.Authorization, 'Bearer auth_token_1');
  assert.equal(JSON.parse(requests[1][1].body).authorizationId, 'auth_1');
  assert.equal(JSON.parse(requests[1][1].body).attemptId, 'attempt-1');
  assert.equal(JSON.parse(requests[1][1].body).attemptNumber, 2);
  assert.equal(JSON.parse(requests[1][1].body).leaseEpoch, 3);
});

test('task lease client exposes renewal conflict status', async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 409,
    async text() {
      return JSON.stringify({ error: 'Task lease is held by another station' });
    },
  });

  await assert.rejects(
    () => renewCollectionTaskLease({
      serverUrl: 'http://localhost:3000',
      taskId: 'task-lease-conflict',
      stationId: 'station-1',
      stationToken: 'station-token',
      leaseToken: 'stale-lease-token',
      authorizationId: 'auth_1',
      authorizationToken: 'auth_token_1',
      fetchFn,
    }),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.retryable, false);
      assert.match(error.message, /another station/);
      return true;
    },
  );
});

test('task lease client exposes server backpressure retry delay', async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 503,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'retry-after' ? '60' : null;
      },
    },
    async text() {
      return JSON.stringify({
        error: '执行设备通道正在保护数据库，请稍后重试。',
        code: 'plugin_protocol_backpressure',
        retryAfterSeconds: 60,
      });
    },
  });

  await assert.rejects(
    () => claimCollectionTaskLease({
      serverUrl: 'http://localhost:3000',
      stationId: 'station-1',
      stationToken: 'station-token',
      authorizationToken: 'auth_token_1',
      fetchFn,
    }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      assert.equal(error.reasonCode, 'plugin_protocol_backpressure');
      assert.equal(error.nextPollAfterMs, 60_000);
      assert.match(error.message, /保护数据库/);
      return true;
    },
  );
});

test('task lease client preserves claim reason and writes an idle snapshot', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        task: null,
        reason: {
          code: 'no_available_account',
          message: '没有可用账号',
        },
        nextPollAfterMs: 45000,
      };
    },
  });
  const store = createTaskLeaseMemoryStore();

  const claim = await claimCollectionTaskLease({
    serverUrl: 'http://localhost:3000',
    stationId: 'station-1',
    stationToken: 'station-token',
    capabilities: ['xhs.authorSurfaceScan'],
    platformAccounts: [],
    fetchFn,
    store,
  });

  assert.deepEqual(claim.reason, {
    code: 'no_available_account',
    message: '没有可用账号',
  });
  assert.equal(claim.nextPollAfterMs, 45000);
  assert.deepEqual(await store.read(), {
    taskId: '',
    leaseToken: '',
    expiresAt: '',
    idleReasonCode: 'no_available_account',
    idleReasonMessage: '没有可用账号',
    nextPollAfterMs: 45000,
    reason: {
      code: 'no_available_account',
      message: '没有可用账号',
    },
  });
  assert.deepEqual(createTaskLeaseIdleSnapshot(claim), await store.read());
  assert.deepEqual(
    formatTaskLeaseIdleNotice(await store.read()),
    {
      message: '最近一次不接单原因：没有可用账号（no_available_account），约 45 秒后重试',
      type: 'warning',
      visible: true,
    },
  );
});

test('task lease client reconciles a server lease into local storage', async () => {
  const requests = [];
  const fetchFn = async (url, options = {}) => {
    requests.push([url, options]);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          action: 'resume',
          task: { id: 'task-reconcile-1' },
          lease: {
            taskId: 'task-reconcile-1',
            leaseToken: 'lease-reconcile-1',
            expiresAt: '2026-05-10T01:05:00.000Z',
          },
        };
      },
    };
  };
  const store = createTaskLeaseMemoryStore({
    taskId: 'local-task',
    leaseToken: 'local-token',
  });

  const result = await reconcileExecutionStationLease({
    serverUrl: 'http://localhost:3000',
    stationId: 'station-1',
    stationToken: 'station-token',
    authorizationId: 'auth_1',
    authorizationToken: 'auth_token_1',
    localLease: { taskId: 'local-task', leaseToken: 'local-token' },
    capabilities: ['xhs.authorSurfaceScan'],
    platformAccounts: [{ platform: 'xhs', purpose: 'author_monitor', healthStatus: 'healthy' }],
    pluginVersion: '2.0.7',
    fetchFn,
    store,
  });

  assert.equal(result.action, 'resume');
  assert.equal(result.lease.leaseToken, 'lease-reconcile-1');
  assert.deepEqual(await store.read(), {
    taskId: 'task-reconcile-1',
    leaseToken: 'lease-reconcile-1',
    expiresAt: '2026-05-10T01:05:00.000Z',
  });
  assert.equal(requests[0][0], 'http://localhost:3000/api/execution-stations/reconcile');
  assert.equal(requests[0][1].headers.Authorization, 'Bearer auth_token_1');
  const body = JSON.parse(requests[0][1].body);
  assert.equal(body.stationId, 'station-1');
  assert.equal(body.localLease.leaseToken, 'local-token');
  assert.equal(body.pluginVersion, '2.0.7');
});

test('task lease client clears local lease when reconcile says idle', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { action: 'clear_local' };
    },
  });
  const store = createTaskLeaseMemoryStore({
    taskId: 'stale-task',
    leaseToken: 'stale-token',
  });

  const result = await reconcileExecutionStationLease({
    serverUrl: 'http://localhost:3000',
    stationId: 'station-1',
    stationToken: 'station-token',
    localLease: { taskId: 'stale-task', leaseToken: 'stale-token' },
    fetchFn,
    store,
  });

  assert.equal(result.action, 'clear_local');
  assert.equal(await store.read(), null);
});

test('task lease client skips reconcile when the service endpoint is not deployed yet', async () => {
  const fetchFn = async () => ({
    ok: false,
    status: 404,
    async text() {
      return 'not found';
    },
  });

  const result = await reconcileExecutionStationLease({
    serverUrl: 'http://localhost:3000',
    stationId: 'station-1',
    stationToken: 'station-token',
    fetchFn,
  });

  assert.equal(result.success, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'reconcile_unavailable');
});

test('task lease client falls back to the short station reconcile path', async () => {
  const paths = [];
  const fetchFn = async (url) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/api/execution-stations/reconcile')) {
      return {
        ok: false,
        status: 404,
        async text() {
          return 'not found';
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { action: 'idle' };
      },
    };
  };

  const result = await reconcileExecutionStationLease({
    serverUrl: 'http://localhost:3000',
    stationId: 'station-1',
    stationToken: 'station-token',
    fetchFn,
  });

  assert.equal(result.action, 'idle');
  assert.deepEqual(paths, ['/api/execution-stations/reconcile', '/api/station/reconcile']);
});

test('task poller keeps one active lease and does not claim another task while running', async () => {
  let claimCalls = 0;
  const renewals = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => {
      claimCalls += 1;
      return {
        task: {
          id: 'task-lease-2',
          taskType: 'xhs.collectAuthor',
          platform: 'xhs',
          taskStrategy: 'author_patrol',
        },
        lease: {
          leaseToken: 'lease-token-2',
          expiresAt: '2026-04-17T12:05:00.000Z',
        },
      };
    },
    renewTaskLease: async (taskId, lease) => {
      renewals.push([taskId, lease.leaseToken]);
      return { success: true, expiresAt: '2026-04-17T12:10:00.000Z' };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task-lease-2',
      resultLookup: { externalTaskId: 'task-lease-2' },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run-lease-2',
        status: 'running',
        resultSummary: { itemsPlanned: 10, itemsSucceeded: 1, failedItems: 0 },
        records: { notes: [], comments: [], authors: [], mediaAssets: [] },
      },
    }),
  });

  const first = await poller.tick();
  const second = await poller.tick();

  assert.equal(first.accepted, true);
  assert.equal(second.status, 'running');
  assert.equal(claimCalls, 1);
  assert.deepEqual(renewals, [['task-lease-2', 'lease-token-2']]);
  assert.equal(poller.getState().activeLease.leaseToken, 'lease-token-2');
});

test('task poller stays idle when station is not paired yet', async () => {
  let dispatchCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: null,
      reason: {
        code: 'station_not_registered',
        message: '请先绑定执行设备',
      },
      nextPollAfterMs: 30000,
    }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => {
      dispatchCalls += 1;
      throw new Error('dispatch should not run without a leased task');
    },
  });

  const result = await poller.tick();

  assert.deepEqual(result, {
    success: true,
    idle: true,
    nextPollAfterMs: 30000,
    idleReasonCode: 'station_not_registered',
    idleReasonMessage: '请先绑定执行设备',
    reason: {
      code: 'station_not_registered',
      message: '请先绑定执行设备',
    },
  });
  assert.equal(dispatchCalls, 0);
  assert.equal(poller.getState().activeLease, null);
});

test('task lease storage store survives service worker memory loss', async () => {
  const storageArea = createMemoryStorage();
  const store = createTaskLeaseStorageStore({ storageArea, storageKey: 'lease' });

  await store.write({
    taskId: 'task-storage-1',
    leaseToken: 'lease-storage-token',
    expiresAt: '2026-04-17T12:05:00.000Z',
  });

  assert.equal((await store.read()).leaseToken, 'lease-storage-token');
  await store.clear();
  assert.equal(await store.read(), null);
});
