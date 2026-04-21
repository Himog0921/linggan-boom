import {
  buildIngestEnvelope,
  buildTaskEvent,
  buildTaskRecord,
} from '../protocol/deltaEnvelope.js';
import {
  WORKBENCH_EVENT_SOURCE,
  WORKBENCH_RECORD_TYPE,
  WORKBENCH_TASK_EVENT_TYPE,
} from '../protocol/schema.js';

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
  ingestDelta,
  executorInstanceId = '',
  getExecutorInstanceId = null,
  batchLimit = 10,
  autoFlush = true,
} = {}) {
  const state = {
    flushing: false,
    scheduled: false,
  };

  async function flush() {
    if (!store || typeof store.listPending !== 'function' || typeof ingestDelta !== 'function') {
      return { success: true, skipped: true, reason: 'missing_dependencies' };
    }
    if (state.flushing) {
      state.scheduled = true;
      return { success: true, skipped: true, reason: 'flush_in_flight' };
    }
    state.flushing = true;
    try {
      const rows = await store.listPending({ limit: batchLimit, now: Date.now() });
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
        const envelope = buildIngestEnvelope({
          taskId: first.taskId,
          pluginRunId: first.pluginRunId,
          executorInstanceId: resolvedExecutorInstanceId,
          cursor: createCursor(group),
          events: group.filter((row) => row.kind === 'event').map(rowToEvent),
          records: group.filter((row) => row.kind === 'record').map(rowToRecord),
          snapshot: group.find((row) => row.snapshot)?.snapshot || null,
        });
        try {
          const response = await ingestDelta(first.taskId, envelope);
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
      if (state.scheduled) {
        state.scheduled = false;
        queueMicrotask(() => {
          void flush();
        });
      }
    }
  }

  async function enqueueRow(row) {
    if (!store || typeof store.enqueue !== 'function') {
      return null;
    }
    const stored = await store.enqueue(row);
    if (autoFlush) {
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
  } = {}) {
    const normalizedSequence = normalizeSequence(sequence);
    const record = buildTaskRecord({
      taskId,
      pluginRunId,
      recordType,
      externalRecordId,
      sequence: normalizedSequence,
      payload,
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
    });
  }

  async function enqueueRecords(records = []) {
    const list = Array.isArray(records) ? records : [records];
    const results = [];
    for (const record of list) {
      results.push(await enqueueRecord(record));
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
