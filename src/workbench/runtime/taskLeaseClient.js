import { normalizeServerUrl } from '../../shared/utils.js';

const DEFAULT_SERVER_URL = 'http://localhost:3000';
const DEFAULT_LEASE_STORAGE_KEY = 'workbenchActiveTaskLease';

function normalizeString(value = '') {
  return String(value || '').trim();
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function extractIdleClaimReason(claim = {}) {
  const rawReason = claim?.reason && typeof claim.reason === 'object' && !Array.isArray(claim.reason)
    ? { ...claim.reason }
    : null;
  const code = normalizeString(claim?.idleReasonCode || claim?.reasonCode || rawReason?.code || '');
  const message = normalizeString(claim?.idleReasonMessage || claim?.reasonMessage || rawReason?.message || '');
  const nextPollAfterMs = toFiniteNumber(claim?.nextPollAfterMs, 0);
  const reason = rawReason || (code || message ? { code, message } : null);

  return {
    code,
    message,
    nextPollAfterMs,
    reason,
  };
}

export function createTaskLeaseIdleSnapshot(claim = {}) {
  const { code, message, nextPollAfterMs, reason } = extractIdleClaimReason(claim);
  if (!code && !message && !reason) return null;
  return {
    taskId: '',
    leaseToken: '',
    expiresAt: '',
    idleReasonCode: code,
    idleReasonMessage: message,
    nextPollAfterMs,
    reason,
    fallbackToPending: Boolean(claim?.fallbackToPending),
  };
}

export function formatTaskLeaseIdleNotice(snapshot = {}) {
  const code = normalizeString(snapshot?.idleReasonCode || snapshot?.reason?.code || '');
  const message = normalizeString(snapshot?.idleReasonMessage || snapshot?.reason?.message || '');
  const nextPollAfterMs = toFiniteNumber(snapshot?.nextPollAfterMs, 0);
  const detail = message || code;
  if (!detail) return null;

  let text = `最近一次不接单原因：${detail}`;
  if (message && code && message !== code) {
    text += `（${code}）`;
  }
  if (nextPollAfterMs > 0) {
    text += `，约 ${Math.ceil(nextPollAfterMs / 1000)} 秒后重试`;
  }

  return {
    message: text,
    type: 'warning',
    visible: true,
  };
}

async function readErrorText(response) {
  if (!response?.text) return '';
  return response.text().catch(() => '');
}

async function postJson({ serverUrl = '', path = '', body = {}, fetchFn = globalThis.fetch?.bind(globalThis) }) {
  if (typeof fetchFn !== 'function') throw new Error('fetch unavailable');
  const response = await fetchFn(`${normalizeServerUrl(serverUrl, DEFAULT_SERVER_URL)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await readErrorText(response);
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

export function createTaskLeaseMemoryStore(initial = null) {
  let lease = initial ? { ...initial } : null;
  return {
    async read() {
      return lease ? { ...lease } : null;
    },
    async write(next) {
      lease = next ? { ...next } : null;
      return lease;
    },
    async clear() {
      lease = null;
    },
  };
}

export function createTaskLeaseStorageStore({
  storageArea = globalThis.chrome?.storage?.local,
  storageKey = DEFAULT_LEASE_STORAGE_KEY,
} = {}) {
  return {
    async read() {
      if (!storageArea?.get) return null;
      const data = await storageArea.get(storageKey);
      const lease = data?.[storageKey] || null;
      return lease ? { ...lease } : null;
    },
    async write(next) {
      if (!storageArea?.set) return next ? { ...next } : null;
      const lease = next ? { ...next } : null;
      await storageArea.set({ [storageKey]: lease });
      return lease;
    },
    async clear() {
      if (storageArea?.remove) {
        await storageArea.remove(storageKey);
        return;
      }
      if (storageArea?.set) {
        await storageArea.set({ [storageKey]: null });
      }
    },
  };
}

export async function claimCollectionTaskLease({
  serverUrl = '',
  stationId = '',
  stationToken = '',
  capabilities = [],
  platformAccounts = [],
  fetchFn,
  store = null,
} = {}) {
  const data = await postJson({
    serverUrl,
    path: '/api/collection-tasks/claim',
    fetchFn,
    body: {
      stationId: normalizeString(stationId),
      stationToken: normalizeString(stationToken),
      capabilities: toStringArray(capabilities),
      platformAccounts: Array.isArray(platformAccounts) ? platformAccounts : [],
    },
  });

  if (data?.task && data?.lease && store?.write) {
    await store.write({
      taskId: normalizeString(data.task.id),
      leaseToken: normalizeString(data.lease.leaseToken),
      expiresAt: normalizeString(data.lease.expiresAt),
    });
  } else if (store?.write) {
    const idleSnapshot = createTaskLeaseIdleSnapshot(data);
    if (idleSnapshot) {
      await store.write(idleSnapshot);
    } else if (store?.clear) {
      await store.clear();
    }
  }

  return data;
}

export async function renewCollectionTaskLease({
  serverUrl = '',
  taskId = '',
  stationId = '',
  stationToken = '',
  leaseToken = '',
  status = 'running',
  fetchFn,
  store = null,
} = {}) {
  const normalizedTaskId = normalizeString(taskId);
  const data = await postJson({
    serverUrl,
    path: `/api/collection-tasks/${encodeURIComponent(normalizedTaskId)}/lease`,
    fetchFn,
    body: {
      stationId: normalizeString(stationId),
      stationToken: normalizeString(stationToken),
      leaseToken: normalizeString(leaseToken),
      status: normalizeString(status) || 'running',
    },
  });

  if (store?.write && data?.expiresAt) {
    await store.write({
      taskId: normalizedTaskId,
      leaseToken: normalizeString(leaseToken),
      expiresAt: normalizeString(data.expiresAt),
    });
  }

  return data;
}
