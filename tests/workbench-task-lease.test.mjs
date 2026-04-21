import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskPoller } from '../src/workbench/runtime/taskPoller.js';
import {
  claimCollectionTaskLease,
  createTaskLeaseMemoryStore,
  createTaskLeaseIdleSnapshot,
  formatTaskLeaseIdleNotice,
  createTaskLeaseStorageStore,
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
            task: { id: 'task-lease-1', taskStrategy: 'author_patrol' },
            lease: {
              leaseToken: 'lease-token-1',
              expiresAt: '2026-04-17T12:05:00.000Z',
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
    capabilities: ['xhs.authorSurfaceScan'],
    platformAccounts: [{ platform: 'xhs', purpose: 'author_monitor', healthStatus: 'healthy' }],
    fetchFn,
    store,
  });
  const renewal = await renewCollectionTaskLease({
    serverUrl: 'http://localhost:3000',
    taskId: 'task-lease-1',
    stationId: 'station-1',
    stationToken: 'station-token',
    leaseToken: 'lease-token-1',
    status: 'running',
    fetchFn,
    store,
  });

  assert.equal(claim.task.id, 'task-lease-1');
  assert.equal((await store.read()).leaseToken, 'lease-token-1');
  assert.equal(renewal.expiresAt, '2026-04-17T12:10:00.000Z');
  assert.equal((await store.read()).expiresAt, '2026-04-17T12:10:00.000Z');
  assert.equal(requests.length, 2);
});

test('task lease client preserves claim reason and writes an idle snapshot', async () => {
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        task: null,
        fallbackToPending: false,
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
  assert.equal(claim.fallbackToPending, false);
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
    fallbackToPending: false,
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

test('task poller falls back to pending tasks when station is not paired yet', async () => {
  let fallbackCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({ task: null, fallbackToPending: true }),
    fetchPendingTasks: async () => [{
      id: 'manual-task-1',
      taskType: 'xhs.collectAuthor',
      platform: 'xhs',
    }],
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => {
      fallbackCalls += 1;
      return {
        success: true,
        accepted: true,
        taskId: 'manual-task-1',
        resultLookup: { externalTaskId: 'manual-task-1' },
      };
    },
  });

  const result = await poller.tick();

  assert.equal(result.accepted, true);
  assert.equal(fallbackCalls, 1);
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
