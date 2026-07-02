import {
  buildIngestEnvelope as buildCommitEnvelope,
  buildTaskEvent,
  buildTaskRecord,
} from '../protocol/deltaEnvelope.js';
import {
  WORKBENCH_EVENT_SOURCE,
  WORKBENCH_RECORD_TYPE,
  WORKBENCH_TASK_EVENT_TYPE,
} from '../protocol/schema.js';
import {
  createRecordPayloadValidationError,
  validateRecordPayload,
} from '../protocol/recordPayloadValidator.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeSequence(value, fallback = Date.now()) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
}

function createCursor(rows = []) {
  const maxSequence = rows.reduce((max, row) => Math.max(max, Number(row.sequence || 0)), 0);
  return maxSequence ? `local-outbox-seq-${maxSequence}` : '';
}

function groupRows(rows = []) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${normalizeText(row.taskId)}\u0000${normalizeText(row.pluginRunId)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return [...grouped.values()];
}

function extractAckKeys(response = {}) {
  return [
    ...(Array.isArray(response.acceptedEventKeys) ? response.acceptedEventKeys : []),
    ...(Array.isArray(response.acceptedRecordKeys) ? response.acceptedRecordKeys : []),
  ];
}

function rowToEvent(row = {}) {
  return normalizeObject(row.payload);
}

function rowToRecord(row = {}) {
  return normalizeObject(row.payload);
}

export function createDeltaOutbox({
  store,
  commitDelta,
  executorInstanceId = '',
  getExecutorInstanceId = null,
  getTaskExecutionContext = null,
  prepareRecordPayload = null,
  batchLimit = 250,
  autoFlush = true,
} = {}) {
  const state = {
    flushing: false,
    scheduled: false,
    currentFlush: null,
  };

  async function runFlush() {
    if (!store || typeof store.listPending !== 'function' || typeof commitDelta !== 'function') {
      return { success: true, skipped: true, reason: 'missing_dependencies' };
    }
    state.flushing = true;
    try {
      const nowMs = Date.now();
      await store.recoverStaleInFlight?.({ limit: batchLimit, now: nowMs });
      const rows = await store.listPending({ limit: batchLimit, now: nowMs });
      if (!rows.length) return { success: true, idle: true };

      let success = true;
      let sent = 0;
      for (const group of groupRows(rows)) {
        const ids = group.map((row) => normalizeText(row.id || row.idempotencyKey)).filter(Boolean);
        await store.markInFlight?.(ids);
        const first = group[0] || {};
        const resolvedExecutorInstanceId = typeof getExecutorInstanceId === 'function'
          ? normalizeText(await getExecutorInstanceId())
          : normalizeText(executorInstanceId);
        const executionContext = typeof getTaskExecutionContext === 'function'
          ? normalizeObject(await getTaskExecutionContext(first.taskId))
          : {};
        const leaseEpoch = Number(executionContext.leaseEpoch);
        const envelope = buildCommitEnvelope({
          taskId: first.taskId,
          pluginRunId: first.pluginRunId,
          executorInstanceId: resolvedExecutorInstanceId,
          cursor: createCursor(group),
          events: group.filter((row) => row.kind === 'event').map(rowToEvent),
          records: group.filter((row) => row.kind === 'record').map(rowToRecord),
          snapshot: group.find((row) => row.snapshot)?.snapshot || null,
          attemptId: executionContext.attemptId,
          leaseToken: executionContext.leaseToken,
          leaseEpoch: Number.isFinite(leaseEpoch) ? leaseEpoch : undefined,
          pageFingerprint: executionContext.pageFingerprint,
          executionContext,
        });
        try {
          const response = await commitDelta(first.taskId, envelope);
          const ackedKeys = extractAckKeys(response);
          const duplicateKeys = Array.isArray(response?.duplicateKeys) ? response.duplicateKeys : [];
          if (ackedKeys.length) await store.markAcked?.(ackedKeys);
          if (duplicateKeys.length) await store.markDuplicate?.(duplicateKeys);

          const knownKeys = new Set([...ackedKeys, ...duplicateKeys]);
          const unclassified = group
            .map((row) => row.idempotencyKey)
            .filter((key) => key && !knownKeys.has(key));
          if (unclassified.length && response?.success) {
            await store.markAcked?.(unclassified);
          }
          sent += group.length;
        } catch (error) {
          success = false;
          if (error?.retryable === false && typeof store.markTerminal === 'function') {
            await store.markTerminal(group.map((row) => row.idempotencyKey || row.id), error);
          } else {
            await store.markRetry?.(group.map((row) => row.idempotencyKey || row.id), error);
          }
        }
      }
      return { success, sent };
    } finally {
      state.flushing = false;
      state.currentFlush = null;
      if (state.scheduled) {
        state.scheduled = false;
        queueMicrotask(() => {
          void flush();
        });
      }
    }
  }

  async function flush() {
    if (state.currentFlush) {
      state.scheduled = true;
      return state.currentFlush;
    }
    const flushPromise = runFlush();
    state.currentFlush = flushPromise;
    try {
      return await flushPromise;
    } finally {
      if (state.currentFlush === flushPromise) {
        state.currentFlush = null;
      }
    }
  }

  async function enqueueRow(row, { deferFlush = false } = {}) {
    if (!store || typeof store.enqueue !== 'function') {
      return null;
    }
    const stored = await store.enqueue(row);
    if (autoFlush && !deferFlush) {
      queueMicrotask(() => {
        void flush();
      });
    }
    return stored;
  }

  async function enqueueEvent({
    taskId = '',
    pluginRunId = '',
    eventType = WORKBENCH_TASK_EVENT_TYPE.TASK_HEARTBEAT,
    source = WORKBENCH_EVENT_SOURCE.PLUGIN,
    sequence = Date.now(),
    payload = {},
    controlRequestId = '',
    snapshot = null,
    occurredAt = '',
    attemptId = '',
    leaseId = '',
    stationId = '',
    accountId = '',
    platform = '',
  } = {}) {
    const normalizedSequence = normalizeSequence(sequence);
    const event = buildTaskEvent({
      taskId,
      pluginRunId,
      eventType,
      source,
      sequence: normalizedSequence,
      payload,
      controlRequestId,
      occurredAt,
      attemptId,
      leaseId,
      stationId,
      accountId,
      platform,
    });
    return enqueueRow({
      taskId,
      pluginRunId,
      idempotencyKey: event.idempotencyKey,
      kind: 'event',
      sequence: normalizedSequence,
      payload: event,
      snapshot,
    });
  }

  async function enqueueRecord({
    taskId = '',
    pluginRunId = '',
    recordType = WORKBENCH_RECORD_TYPE.NOTE,
    externalRecordId = '',
    sequence = Date.now(),
    payload = {},
    collectedAt = '',
    snapshot = null,
  } = {}, { deferFlush = false } = {}) {
    const normalizedSequence = normalizeSequence(sequence);
    const preparedPayload = typeof prepareRecordPayload === 'function'
      ? await prepareRecordPayload({
        taskId,
        pluginRunId,
        recordType,
        externalRecordId,
        payload,
      })
      : payload;
    const validation = validateRecordPayload(recordType, preparedPayload);
    if (!validation.valid) {
      throw createRecordPayloadValidationError({ recordType, validation });
    }
    const record = buildTaskRecord({
      taskId,
      pluginRunId,
      recordType,
      externalRecordId,
      sequence: normalizedSequence,
      payload: preparedPayload,
      collectedAt,
    });
    return enqueueRow({
      taskId,
      pluginRunId,
      idempotencyKey: record.idempotencyKey,
      kind: 'record',
      sequence: normalizedSequence,
      payload: record,
      snapshot,
    }, { deferFlush });
  }

  async function enqueueRecords(records = []) {
    const list = Array.isArray(records) ? records : [records];
    const results = [];
    for (const record of list) {
      results.push(await enqueueRecord(record, { deferFlush: true }));
    }
    if (autoFlush && results.length > 0) {
      queueMicrotask(() => {
        void flush();
      });
    }
    return results;
  }

  return {
    enqueueEvent,
    enqueueRecord,
    enqueueRecords,
    flush,
  };
}
