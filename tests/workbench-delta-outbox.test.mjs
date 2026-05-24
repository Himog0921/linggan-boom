import test from 'node:test';
import assert from 'node:assert/strict';

import { createDeltaOutbox } from '../src/workbench/runtime/deltaOutbox.js';
import {
  WORKBENCH_EVENT_SOURCE,
  WORKBENCH_RECORD_TYPE,
  WORKBENCH_TASK_EVENT_TYPE,
} from '../src/workbench/protocol/schema.js';

function createMemoryOutboxStore() {
  const rows = new Map();
  return {
    rows,
    async enqueue(item) {
      if (rows.has(item.idempotencyKey)) return rows.get(item.idempotencyKey);
      const row = {
        id: item.idempotencyKey,
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: 0,
        createdAt: Date.now(),
        ...item,
      };
      rows.set(row.idempotencyKey, row);
      return row;
    },
    async recoverStaleInFlight({ now: nowMs = Date.now() } = {}) {
      let recovered = 0;
      for (const row of rows.values()) {
        if (row.status !== 'in_flight' || Number(row.nextAttemptAt || 0) > nowMs) continue;
        row.status = 'failed';
        row.errorMessage = 'in_flight_timeout';
        row.attemptCount += 1;
        row.nextAttemptAt = nowMs;
        row.updatedAt = nowMs;
        recovered += 1;
      }
      return recovered;
    },
    async listPending({ now: nowMs = Date.now() } = {}) {
      return [...rows.values()].filter((row) => (
        row.status === 'pending'
        || (row.status === 'failed' && Number(row.nextAttemptAt || 0) <= nowMs)
      ));
    },
    async markInFlight(ids) {
      for (const id of ids) {
        const row = rows.get(id);
        if (row) {
          row.status = 'in_flight';
          row.nextAttemptAt = Date.now() + 5 * 60 * 1000;
          row.updatedAt = Date.now();
        }
      }
    },
    async markAcked(keys) {
      for (const key of keys) {
        const row = rows.get(key);
        if (row) row.status = 'acked';
      }
    },
    async markDuplicate(keys) {
      for (const key of keys) {
        const row = rows.get(key);
        if (row) row.status = 'acked';
      }
    },
    async markRetry(keysOrIds, error) {
      for (const key of keysOrIds) {
        const row = rows.get(key);
        if (!row) continue;
        row.status = 'failed';
        row.errorMessage = String(error?.message || error || '');
        row.attemptCount += 1;
        row.nextAttemptAt = Date.now() + 1000;
      }
    },
  };
}

test('delta outbox dedupes idempotency keys and flushes one ingest envelope', async () => {
  const store = createMemoryOutboxStore();
  const envelopes = [];
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async (taskId, envelope) => {
      envelopes.push([taskId, envelope]);
      return {
        success: true,
        acceptedEventKeys: envelope.events.map((event) => event.idempotencyKey),
        acceptedRecordKeys: envelope.records.map((record) => record.idempotencyKey),
        duplicateKeys: [],
      };
    },
    executorInstanceId: 'plugin_1',
    autoFlush: false,
  });

  await outbox.enqueueEvent({
    taskId: 'task_1',
    pluginRunId: 'run_1',
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_PROGRESS,
    source: WORKBENCH_EVENT_SOURCE.PLUGIN,
    sequence: 1,
    payload: { message: '采到第 1 条' },
  });
  await outbox.enqueueEvent({
    taskId: 'task_1',
    pluginRunId: 'run_1',
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_PROGRESS,
    source: WORKBENCH_EVENT_SOURCE.PLUGIN,
    sequence: 1,
    payload: { message: '重复事件不会多写' },
  });

  assert.equal(store.rows.size, 1);

  const result = await outbox.flush();

  assert.equal(result.success, true);
  assert.equal(envelopes.length, 1);
  assert.equal(envelopes[0][0], 'task_1');
  assert.equal(envelopes[0][1].events.length, 1);
  assert.equal(envelopes[0][1].executorInstanceId, 'plugin_1');
  assert.equal([...store.rows.values()][0].status, 'acked');
});

test('delta outbox resolves executor identity at flush time', async () => {
  const store = createMemoryOutboxStore();
  const envelopes = [];
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async (taskId, envelope) => {
      envelopes.push([taskId, envelope]);
      return {
        success: true,
        acceptedEventKeys: envelope.events.map((event) => event.idempotencyKey),
        acceptedRecordKeys: [],
        duplicateKeys: [],
      };
    },
    executorInstanceId: 'startup_random_id',
    getExecutorInstanceId: async () => 'persisted_executor_id',
    autoFlush: false,
  });

  await outbox.enqueueEvent({
    taskId: 'task_1',
    pluginRunId: 'run_1',
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_PROGRESS,
    source: WORKBENCH_EVENT_SOURCE.PLUGIN,
    sequence: 3,
    payload: { message: 'flush uses persistent id' },
  });

  await outbox.flush();

  assert.equal(envelopes[0][1].executorInstanceId, 'persisted_executor_id');
});

test('delta outbox attaches lease credentials and page fingerprint to ingest envelope', async () => {
  const store = createMemoryOutboxStore();
  const envelopes = [];
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async (taskId, envelope) => {
      envelopes.push([taskId, envelope]);
      return {
        success: true,
        acceptedEventKeys: envelope.events.map((event) => event.idempotencyKey),
        acceptedRecordKeys: [],
        duplicateKeys: [],
      };
    },
    getTaskExecutionContext: async (taskId) => ({
      attemptId: `attempt-${taskId}`,
      leaseToken: `lease-${taskId}`,
      leaseEpoch: 4,
      pageFingerprint: {
        platform: 'xhs',
        pageType: 'detail',
        contentId: 'note_1',
      },
    }),
    executorInstanceId: 'plugin_1',
    autoFlush: false,
  });

  await outbox.enqueueEvent({
    taskId: 'task_1',
    pluginRunId: 'run_1',
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_PROGRESS,
    source: WORKBENCH_EVENT_SOURCE.PLUGIN,
    sequence: 3,
    payload: { message: 'flush uses execution truth' },
  });

  await outbox.flush();

  assert.equal(envelopes[0][1].attemptId, 'attempt-task_1');
  assert.equal(envelopes[0][1].leaseToken, 'lease-task_1');
  assert.equal(envelopes[0][1].leaseEpoch, 4);
  assert.deepEqual(envelopes[0][1].pageFingerprint, {
    platform: 'xhs',
    pageType: 'detail',
    contentId: 'note_1',
  });
});

test('delta outbox preserves explicit event execution identity fields', async () => {
  const store = createMemoryOutboxStore();
  const envelopes = [];
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async (taskId, envelope) => {
      envelopes.push([taskId, envelope]);
      return {
        success: true,
        acceptedEventKeys: envelope.events.map((event) => event.idempotencyKey),
        acceptedRecordKeys: [],
        duplicateKeys: [],
      };
    },
    autoFlush: false,
  });

  await outbox.enqueueEvent({
    taskId: 'task_release_identity',
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_RELEASED,
    sequence: 5,
    attemptId: 'attempt-release-1',
    leaseId: 'lease-release-1',
    stationId: 'station-release-1',
    accountId: 'account-release-1',
    platform: 'xhs',
    payload: { reasonCode: 'page_context_unavailable' },
  });

  await outbox.flush();

  const event = envelopes[0][1].events[0];
  assert.equal(event.attemptId, 'attempt-release-1');
  assert.equal(event.leaseId, 'lease-release-1');
  assert.equal(event.stationId, 'station-release-1');
  assert.equal(event.accountId, 'account-release-1');
  assert.equal(event.platform, 'xhs');
});

test('delta outbox prepares record payloads before storing them', async () => {
  const store = createMemoryOutboxStore();
  const envelopes = [];
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async (taskId, envelope) => {
      envelopes.push([taskId, envelope]);
      return {
        success: true,
        acceptedEventKeys: [],
        acceptedRecordKeys: envelope.records.map((record) => record.idempotencyKey),
        duplicateKeys: [],
      };
    },
    prepareRecordPayload: async ({ payload }) => ({
      ...payload,
      coverUrl: 'https://blob.example.com/stable-cover.webp',
    }),
    executorInstanceId: 'plugin_1',
    autoFlush: false,
  });

  await outbox.enqueueRecord({
    taskId: 'task_1',
    pluginRunId: 'run_1',
    recordType: 'note',
    externalRecordId: 'note_1',
    sequence: 4,
    payload: {
      noteId: 'note_1',
      coverUrl: 'https://sns-img.example.com/cover.webp',
    },
  });

  const queued = [...store.rows.values()][0];
  assert.equal(queued.payload.payload.coverUrl, 'https://blob.example.com/stable-cover.webp');

  await outbox.flush();

  assert.equal(envelopes[0][1].records[0].payload.coverUrl, 'https://blob.example.com/stable-cover.webp');
});

test('delta outbox rejects invalid extractor records before they enter the queue', async () => {
  const store = createMemoryOutboxStore();
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async () => ({ success: true }),
    autoFlush: false,
  });

  await assert.rejects(
    outbox.enqueueRecord({
      taskId: 'task_1',
      pluginRunId: 'run_1',
      recordType: WORKBENCH_RECORD_TYPE.COMMENT,
      externalRecordId: 'comment_1',
      payload: {
        commentId: 'comment_1',
        text: '没有父级作品',
      },
    }),
    (error) => {
      assert.equal(error.retryable, false);
      assert.equal(error.code, 'missing_comment_parent');
      assert.equal(error.observability.recordType, WORKBENCH_RECORD_TYPE.COMMENT);
      assert.equal(error.observability.schemaValidationFailureCount, 1);
      return true;
    },
  );
  assert.equal(store.rows.size, 0);
});

test('delta outbox schedules retry on network failure then accepts duplicate ack', async () => {
  const store = createMemoryOutboxStore();
  let calls = 0;
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async (taskId, envelope) => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('network down');
        error.retryable = true;
        throw error;
      }
      return {
        success: true,
        acceptedEventKeys: [],
        acceptedRecordKeys: [],
        duplicateKeys: envelope.events.map((event) => event.idempotencyKey),
      };
    },
    executorInstanceId: 'plugin_1',
    autoFlush: false,
  });

  await outbox.enqueueEvent({
    taskId: 'task_1',
    pluginRunId: 'run_1',
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_HEARTBEAT,
    source: WORKBENCH_EVENT_SOURCE.PLUGIN,
    sequence: 2,
    payload: { status: 'running' },
  });

  const first = await outbox.flush();
  const rowAfterFailure = [...store.rows.values()][0];
  assert.equal(first.success, false);
  assert.equal(rowAfterFailure.status, 'failed');
  assert.equal(rowAfterFailure.attemptCount, 1);
  assert.ok(rowAfterFailure.nextAttemptAt > Date.now());

  rowAfterFailure.nextAttemptAt = 0;
  const second = await outbox.flush();

  assert.equal(second.success, true);
  assert.equal(calls, 2);
  assert.equal(rowAfterFailure.status, 'acked');
});

test('delta outbox recovers stale in-flight rows before flushing', async () => {
  const store = createMemoryOutboxStore();
  let calls = 0;
  const outbox = createDeltaOutbox({
    store,
    ingestDelta: async (taskId, envelope) => {
      calls += 1;
      return {
        success: true,
        acceptedEventKeys: envelope.events.map((event) => event.idempotencyKey),
        acceptedRecordKeys: [],
        duplicateKeys: [],
      };
    },
    executorInstanceId: 'plugin_1',
    autoFlush: false,
  });

  await outbox.enqueueEvent({
    taskId: 'task_1',
    pluginRunId: 'run_1',
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_PROGRESS,
    source: WORKBENCH_EVENT_SOURCE.PLUGIN,
    sequence: 5,
    payload: { message: 'stale in-flight should retry' },
  });

  const row = [...store.rows.values()][0];
  row.status = 'in_flight';
  row.nextAttemptAt = Date.now() - 1;

  const result = await outbox.flush();

  assert.equal(result.success, true);
  assert.equal(calls, 1);
  assert.equal(row.status, 'acked');
  assert.equal(row.attemptCount, 1);
});
