import {
  WORKBENCH_EVENT_SOURCE,
  WORKBENCH_PROTOCOL_VERSION,
} from './schema.js';

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

function nowIso() {
  return new Date().toISOString();
}

export function createEventIdempotencyKey({
  taskId = '',
  pluginRunId = '',
  eventType = '',
  controlRequestId = '',
  sequence = 0,
} = {}) {
  return [
    normalizeText(taskId),
    normalizeText(pluginRunId),
    'event',
    normalizeText(eventType),
    normalizeText(controlRequestId) || normalizeSequence(sequence, 0),
  ].join(':');
}

export function createRecordIdempotencyKey({
  taskId = '',
  pluginRunId = '',
  recordType = '',
  externalRecordId = '',
  sequence = 0,
} = {}) {
  return [
    normalizeText(taskId),
    normalizeText(pluginRunId),
    'record',
    normalizeText(recordType),
    normalizeText(externalRecordId) || normalizeSequence(sequence, 0),
  ].join(':');
}

export function buildTaskEvent({
  taskId = '',
  pluginRunId = '',
  eventType = '',
  source = WORKBENCH_EVENT_SOURCE.PLUGIN,
  sequence = 0,
  payload = {},
  controlRequestId = '',
  occurredAt = '',
  idempotencyKey = '',
} = {}) {
  const normalizedSequence = normalizeSequence(sequence, Date.now());
  const event = {
    idempotencyKey: normalizeText(idempotencyKey) || createEventIdempotencyKey({
      taskId,
      pluginRunId,
      eventType,
      controlRequestId,
      sequence: normalizedSequence,
    }),
    eventType: normalizeText(eventType),
    source: normalizeText(source) || WORKBENCH_EVENT_SOURCE.PLUGIN,
    occurredAt: normalizeText(occurredAt) || nowIso(),
    sequence: normalizedSequence,
    payload: normalizeObject(payload),
  };
  const normalizedControlRequestId = normalizeText(controlRequestId);
  if (normalizedControlRequestId) event.controlRequestId = normalizedControlRequestId;
  return event;
}

export function buildTaskRecord({
  taskId = '',
  pluginRunId = '',
  recordType = '',
  externalRecordId = '',
  sequence = 0,
  payload = {},
  collectedAt = '',
  idempotencyKey = '',
} = {}) {
  const normalizedSequence = normalizeSequence(sequence, Date.now());
  return {
    idempotencyKey: normalizeText(idempotencyKey) || createRecordIdempotencyKey({
      taskId,
      pluginRunId,
      recordType,
      externalRecordId,
      sequence: normalizedSequence,
    }),
    recordType: normalizeText(recordType),
    externalRecordId: normalizeText(externalRecordId),
    sequence: normalizedSequence,
    collectedAt: normalizeText(collectedAt) || nowIso(),
    payload: normalizeObject(payload),
  };
}

export function buildIngestEnvelope({
  taskId = '',
  pluginRunId = '',
  executorInstanceId = '',
  cursor = '',
  events = [],
  records = [],
  snapshot = null,
} = {}) {
  const envelope = {
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    taskId: normalizeText(taskId),
    pluginRunId: normalizeText(pluginRunId),
    executorInstanceId: normalizeText(executorInstanceId),
    cursor: normalizeText(cursor),
    events: Array.isArray(events) ? events : [],
    records: Array.isArray(records) ? records : [],
  };
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    envelope.snapshot = snapshot;
  }
  return envelope;
}

