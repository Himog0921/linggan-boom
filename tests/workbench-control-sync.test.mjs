import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFlywheelConfig,
  fetchCollectionTaskControlRequests,
  ingestCollectionTaskDelta,
  mergeFlywheelAuthorization,
} from '../src/sync/flywheelSync.js';
import { createTaskPoller } from '../src/workbench/runtime/taskPoller.js';
import { REMOTE_TASK_CONTROL_ACTION, WORKBENCH_TASK_EVENT_TYPE } from '../src/workbench/protocol/schema.js';

function claimTask(tasksOrTask) {
  return async () => {
    const task = Array.isArray(tasksOrTask) ? tasksOrTask[0] : tasksOrTask;
    return { task: task || null };
  };
}

test('workbench task polling defaults on for the deployed workbench unless explicitly disabled', async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = undefined;

  try {
    const config = await getFlywheelConfig();

    assert.equal(config.serverUrl, 'https://lingganboom.fun');
    assert.equal(config.enabled, true);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test('ingest client posts task delta to singular ingest endpoint', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify({
      success: true,
      acceptedEventKeys: ['event_1'],
      acceptedRecordKeys: [],
      duplicateKeys: [],
    }), { status: 200 });
  };

  try {
    const result = await ingestCollectionTaskDelta(
      { serverUrl: 'http://workbench.test/' },
      'task_1',
      { taskId: 'task_1', events: [{ idempotencyKey: 'event_1' }], records: [] },
    );

    assert.equal(result.success, true);
    assert.equal(calls[0][0], 'http://workbench.test/api/collection-tasks/task_1/ingest');
    assert.equal(calls[0][1].method, 'POST');
    assert.equal(JSON.parse(calls[0][1].body).taskId, 'task_1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workbench API config prefers the active plugin authorization token over stale stored api token', async () => {
  const config = mergeFlywheelAuthorization(
    {
      serverUrl: 'https://workbench.example',
      enabled: true,
      apiToken: 'stale-token',
    },
    {
      authorizationToken: 'active-token',
    },
  );

  assert.equal(config.serverUrl, 'https://workbench.example');
  assert.equal(config.enabled, true);
  assert.equal(config.apiToken, 'active-token');
});

test('control request client uses control-requests endpoint and treats 404 as no controls', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return new Response('not found', { status: 404 });
  };

  try {
    const result = await fetchCollectionTaskControlRequests(
      { serverUrl: 'http://workbench.test' },
      'task_1',
      { executorInstanceId: 'plugin_1', after: 'cursor_1' },
    );

    assert.deepEqual(result, { success: true, controls: [], nextCursor: '' });
    assert.equal(
      calls[0][0],
      'http://workbench.test/api/collection-tasks/task_1/control-requests?executorInstanceId=plugin_1&after=cursor_1',
    );
    assert.equal(calls[0][1].method, 'GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ingest client classifies retryable and terminal HTTP failures', async () => {
  const originalFetch = globalThis.fetch;
  const statuses = [503, 422];
  globalThis.fetch = async () => {
    const status = statuses.shift();
    return new Response(JSON.stringify({ error: `HTTP ${status}` }), { status });
  };

  try {
    await assert.rejects(
      () => ingestCollectionTaskDelta({ serverUrl: 'http://workbench.test' }, 'task_1', { taskId: 'task_1' }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.retryable, true);
        return true;
      },
    );

    await assert.rejects(
      () => ingestCollectionTaskDelta({ serverUrl: 'http://workbench.test' }, 'task_1', { taskId: 'task_1' }),
      (error) => {
        assert.equal(error.status, 422);
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('task poller applies workbench pause control and emits applied plus paused events', async () => {
  const controlsApplied = [];
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([{ id: 'task_1', taskType: 'xhs.batchNotes', platform: 'xhs' }]),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_1',
      resultLookup: { externalTaskId: 'task_1' },
    }),
    getExecutorInstanceId: () => 'plugin_1',
    fetchControlRequests: async () => ({
      success: true,
      controls: [{
        controlRequestId: 'ctrl_pause_1',
        taskId: 'task_1',
        taskType: 'xhs.batchNotes',
        action: REMOTE_TASK_CONTROL_ACTION.PAUSE,
        cursor: 'cursor_pause_1',
      }],
      nextCursor: 'cursor_pause_1',
    }),
    applyTaskControl: async (control) => {
      controlsApplied.push(control);
      return { success: true, accepted: true };
    },
    enqueueEvent: async (event) => {
      events.push(event);
    },
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_1',
        status: 'paused',
        resultSummary: {},
        records: { notes: [], comments: [], authors: [], mediaAssets: [] },
      },
    }),
  });

  await poller.tick();
  await poller.tick();

  assert.equal(controlsApplied.length, 1);
  assert.equal(controlsApplied[0].action, REMOTE_TASK_CONTROL_ACTION.PAUSE);
  assert.deepEqual(
    events
      .map((event) => event.eventType)
      .filter((eventType) => eventType !== WORKBENCH_TASK_EVENT_TYPE.TASK_CLAIMED),
    [
      WORKBENCH_TASK_EVENT_TYPE.TASK_CONTROL_REQUESTED,
      WORKBENCH_TASK_EVENT_TYPE.TASK_CONTROL_APPLIED,
      WORKBENCH_TASK_EVENT_TYPE.TASK_PAUSED,
      WORKBENCH_TASK_EVENT_TYPE.TASK_PAUSED,
    ],
  );
  assert.equal(poller.getState().activeTask.controlCursor, 'cursor_pause_1');
});

test('task poller maps workbench delete control to local stop semantics', async () => {
  const controlsApplied = [];
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([{ id: 'task_2', taskType: 'douyin.batchComments', platform: 'douyin' }]),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_2',
      resultLookup: { externalTaskId: 'task_2' },
    }),
    getExecutorInstanceId: () => 'plugin_1',
    fetchControlRequests: async () => ({
      success: true,
      controls: [{
        controlRequestId: 'ctrl_delete_1',
        taskId: 'task_2',
        taskType: 'douyin.batchComments',
        action: REMOTE_TASK_CONTROL_ACTION.DELETE,
        cursor: 'cursor_delete_1',
      }],
      nextCursor: 'cursor_delete_1',
    }),
    applyTaskControl: async (control) => {
      controlsApplied.push(control);
      return { success: true, accepted: true };
    },
    enqueueEvent: async (event) => {
      events.push(event);
    },
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_2',
        status: 'stopping',
        resultSummary: {},
        records: { notes: [], comments: [], authors: [], mediaAssets: [] },
      },
    }),
  });

  await poller.tick();
  await poller.tick();

  assert.equal(controlsApplied[0].action, REMOTE_TASK_CONTROL_ACTION.STOP);
  const stoppingEvent = events.find((event) => event.eventType === WORKBENCH_TASK_EVENT_TYPE.TASK_STOPPING);
  assert.equal(stoppingEvent.payload.deleteRequested, true);
});
