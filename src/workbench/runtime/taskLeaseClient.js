import { normalizeServerUrl } from '../../shared/utils.js';

const DEFAULT_SERVER_URL = 'https://lingganboom.fun';
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

function parseRetryAfterHeader(value = '') {
  const normalized = normalizeString(value);
  if (!normalized) return 0;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  const parsedDate = new Date(normalized).getTime();
  if (Number.isFinite(parsedDate)) return Math.max(0, parsedDate - Date.now());
  return 0;
}

function parseErrorBody(text = '') {
  try {
    const parsed = JSON.parse(normalizeString(text));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function isRetryableStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

function errorMessageFromResponseText(text = '', fallback = '') {
  const body = normalizeString(text);
  if (!body) return fallback;
  try {
    const parsed = JSON.parse(body);
    const message = normalizeString(parsed?.error || parsed?.message);
    return message || body;
  } catch {
    return body;
  }
}

function createHttpError(message, { status = 0, reasonCode = '', nextPollAfterMs = 0 } = {}) {
  const error = new Error(message);
  error.status = Number(status || 0);
  error.retryable = isRetryableStatus(status);
  error.reasonCode = normalizeString(reasonCode);
  error.nextPollAfterMs = toFiniteNumber(nextPollAfterMs, 0);
  return error;
}

async function postJson({
  serverUrl = '',
  path = '',
  body = {},
  fetchFn = globalThis.fetch?.bind(globalThis),
  authorizationToken = '',
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch unavailable');
  const headers = { 'Content-Type': 'application/json' };
  const normalizedAuthorizationToken = normalizeString(authorizationToken);
  if (normalizedAuthorizationToken) {
    headers.Authorization = `Bearer ${normalizedAuthorizationToken}`;
  }
  const response = await fetchFn(`${normalizeServerUrl(serverUrl, DEFAULT_SERVER_URL)}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await readErrorText(response);
    const parsed = parseErrorBody(text);
    const headerRetryAfterMs = parseRetryAfterHeader(response.headers?.get?.('Retry-After'));
    const bodyRetryAfterMs = toFiniteNumber(parsed?.retryAfterMs, 0)
      || toFiniteNumber(parsed?.retryAfterSeconds, 0) * 1000;
    throw createHttpError(errorMessageFromResponseText(text, `HTTP ${response.status}`), {
      status: response.status,
      reasonCode: parsed?.code || parsed?.reasonCode || '',
      nextPollAfterMs: headerRetryAfterMs || bodyRetryAfterMs,
    });
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
  authorizationId = '',
  authorizationToken = '',
  capabilities = [],
  platformAccounts = [],
  fetchFn,
  store = null,
} = {}) {
  const data = await postJson({
    serverUrl,
    path: '/api/collection-tasks/claim',
    fetchFn,
    authorizationToken,
    body: {
      authorizationId: normalizeString(authorizationId),
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
  authorizationId = '',
  authorizationToken = '',
  status = 'running',
  fetchFn,
  store = null,
} = {}) {
  const normalizedTaskId = normalizeString(taskId);
  const data = await postJson({
    serverUrl,
    path: `/api/collection-tasks/${encodeURIComponent(normalizedTaskId)}/lease`,
    fetchFn,
    authorizationToken,
    body: {
      authorizationId: normalizeString(authorizationId),
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
