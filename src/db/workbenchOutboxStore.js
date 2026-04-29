import db from './index.js';

function now() {
  return Date.now();
}

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function retryDelayMs(attemptCount = 0) {
  const attempt = Math.max(1, Number(attemptCount || 0));
  if (attempt <= 1) return 1000;
  if (attempt === 2) return 2000;
  if (attempt === 3) return 5000;
  if (attempt === 4) return 15000;
  return 60000;
}

function normalizeOutboxRow(item = {}) {
  const idempotencyKey = normalizeText(item.idempotencyKey || item.id);
  return {
    id: normalizeText(item.id || idempotencyKey),
    taskId: normalizeText(item.taskId),
    pluginRunId: normalizeText(item.pluginRunId),
    idempotencyKey,
    kind: normalizeText(item.kind),
    status: normalizeText(item.status || 'pending') || 'pending',
    payload: normalizeObject(item.payload),
    snapshot: item.snapshot && typeof item.snapshot === 'object' && !Array.isArray(item.snapshot)
      ? item.snapshot
      : null,
    sequence: Number.isFinite(Number(item.sequence)) ? Math.floor(Number(item.sequence)) : 0,
    attemptCount: Number.isFinite(Number(item.attemptCount)) ? Math.floor(Number(item.attemptCount)) : 0,
    nextAttemptAt: Number.isFinite(Number(item.nextAttemptAt)) ? Number(item.nextAttemptAt) : 0,
    errorMessage: normalizeText(item.errorMessage),
    createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : now(),
    updatedAt: now(),
  };
}

async function getByKey(idempotencyKey = '') {
  const key = normalizeText(idempotencyKey);
  if (!key) return null;
  return db.workbenchOutbox.where('idempotencyKey').equals(key).first();
}

export const workbenchOutboxStore = {
  async enqueue(item = {}) {
    const row = normalizeOutboxRow(item);
    if (!row.idempotencyKey || !row.taskId || !row.pluginRunId || !row.kind) {
      throw new Error('invalid_workbench_outbox_item');
    }
    try {
      await db.workbenchOutbox.put(row);
      return row;
    } catch (error) {
      if (error?.name === 'ConstraintError' || /constraint/i.test(String(error?.message || error))) {
        const existing = await getByKey(row.idempotencyKey);
        return existing || row;
      }
      throw error;
    }
  },

  async listPending({ limit = 10, now: nowMs = now() } = {}) {
    const maxLimit = Math.max(1, Number(limit || 10));
    const pending = await db.workbenchOutbox
      .where('[status+nextAttemptAt+createdAt]')
      .between(['pending', Dexie.minKey, Dexie.minKey], ['pending', nowMs, Dexie.maxKey])
      .limit(maxLimit)
      .toArray();
    const failed = await db.workbenchOutbox
      .where('[status+nextAttemptAt+createdAt]')
      .between(['failed', Dexie.minKey, Dexie.minKey], ['failed', nowMs, Dexie.maxKey])
      .limit(maxLimit)
      .toArray();
    return pending
      .concat(failed)
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .slice(0, maxLimit);
  },

  async markInFlight(ids = []) {
    const nowMs = now();
    await Promise.all((Array.isArray(ids) ? ids : [ids]).map(async (id) => {
      const key = normalizeText(id);
      if (!key) return;
      await db.workbenchOutbox.update(key, { status: 'in_flight', updatedAt: nowMs });
    }));
  },

  async markAcked(keys = []) {
    const nowMs = now();
    await Promise.all((Array.isArray(keys) ? keys : [keys]).map(async (key) => {
      const row = await getByKey(key);
      if (!row) return;
      await db.workbenchOutbox.update(row.id, { status: 'acked', updatedAt: nowMs, errorMessage: '' });
    }));
  },

  async markDuplicate(keys = []) {
    return this.markAcked(keys);
  },

  async markRetry(keysOrIds = [], error = null) {
    const nowMs = now();
    await Promise.all((Array.isArray(keysOrIds) ? keysOrIds : [keysOrIds]).map(async (keyOrId) => {
      const key = normalizeText(keyOrId);
      if (!key) return;
      const row = await getByKey(key) || await db.workbenchOutbox.get(key);
      if (!row) return;
      const attemptCount = Number(row.attemptCount || 0) + 1;
      await db.workbenchOutbox.update(row.id, {
        status: 'failed',
        attemptCount,
        errorMessage: normalizeText(error?.message || error || 'upload_failed'),
        nextAttemptAt: nowMs + retryDelayMs(attemptCount),
        updatedAt: nowMs,
      });
    }));
  },

  async markTerminal(keysOrIds = [], error = null) {
    const nowMs = now();
    await Promise.all((Array.isArray(keysOrIds) ? keysOrIds : [keysOrIds]).map(async (keyOrId) => {
      const key = normalizeText(keyOrId);
      if (!key) return;
      const row = await getByKey(key) || await db.workbenchOutbox.get(key);
      if (!row) return;
      await db.workbenchOutbox.update(row.id, {
        status: 'failed_terminal',
        errorMessage: normalizeText(error?.message || error || 'terminal_upload_failed'),
        updatedAt: nowMs,
      });
    }));
  },

  async getLastSequence(taskId = '', pluginRunId = '') {
    const rows = await db.workbenchOutbox
      .where('taskId')
      .equals(normalizeText(taskId))
      .toArray();
    return rows
      .filter((row) => normalizeText(row.pluginRunId) === normalizeText(pluginRunId))
      .reduce((max, row) => Math.max(max, Number(row.sequence || 0)), 0);
  },
};

