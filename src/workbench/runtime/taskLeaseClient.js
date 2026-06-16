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

function toOptionalInteger(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : undefined;
}

function normalizeLeaseSnapshot({
  task = null,
  lease = null,
  attempt = null,
  fallback = null,
} = {}) {
  const taskId = normalizeString(lease?.taskId || task?.id || fallback?.taskId);
  const leaseToken = normalizeString(lease?.leaseToken || fallback?.leaseToken);
  const expiresAt = normalizeString(lease?.expiresAt || fallback?.expiresAt);
  const attemptId = normalizeString(
    lease?.attemptId
    || attempt?.attemptId
    || task?.currentAttemptId
    || fallback?.attemptId,
  );
  const attemptNumber = toOptionalInteger(
    lease?.attemptNumber
    ?? attempt?.attemptNumber
    ?? task?.attemptCount
    ?? fallback?.attemptNumber,
  );
  const leaseEpoch = toOptionalInteger(
    lease?.leaseEpoch
    ?? task?.leaseEpoch
    ?? fallback?.leaseEpoch,
  );
  const snapshot = {
    taskId,
    leaseToken,
    expiresAt,
  };
  if (attemptId) snapshot.attemptId = attemptId;
  if (attemptNumber !== undefined) snapshot.attemptNumber = attemptNumber;
  if (leaseEpoch !== undefined) snapshot.leaseEpoch = leaseEpoch;
  return snapshot;
}

function addLeaseAttemptFields(body = {}, lease = {}) {
  const attemptId = normalizeString(lease?.attemptId);
  const leaseEpoch = toOptionalInteger(lease?.leaseEpoch);
  const attemptNumber = toOptionalInteger(lease?.attemptNumber);
  if (attemptId) body.attemptId = attemptId;
  if (leaseEpoch !== undefined) body.leaseEpoch = leaseEpoch;
  if (attemptNumber !== undefined) body.attemptNumber = attemptNumber;
  return body;
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

function isDispatchEnvelope(data = {}) {
  return Boolean(
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && (
      Object.prototype.hasOwnProperty.call(data, 'heartbeat')
      || Object.prototype.hasOwnProperty.call(data, 'reconcile')
      || Object.prototype.hasOwnProperty.call(data, 'claim')
    )
  );
}

function normalizeDispatchClaimResponse(data = {}) {
  if (!isDispatchEnvelope(data)) return data;
  if (data?.claim) {
    return {
      ...data.claim,
      dispatch: data,
      heartbeat: data.heartbeat || null,
      reconcile: data.reconcile || null,
    };
  }

  const reconcile = data?.reconcile || null;
  const action = normalizeString(reconcile?.action || '');
  if (action === 'resume') {
    return {
      task: null,
      lease: null,
      resumeLease: normalizeLeaseSnapshot({
        task: reconcile?.task,
        lease: reconcile?.lease || reconcile?.serverLease,
      }),
      reason: {
        code: 'server_task_resume_required',
        message: '服务端已有执行中任务，先恢复本地任务后再继续。',
      },
      nextPollAfterMs: 1000,
      dispatch: data,
      heartbeat: data.heartbeat || null,
      reconcile,
    };
  }

  return {
    task: null,
    reason: {
      code: action === 'clear_local' ? 'server_cleared_local_task' : 'no_pending_task',
      message: action === 'clear_local'
        ? '服务端没有当前任务，本地任务状态已清理。'
        : '当前没有可领取任务。',
    },
    nextPollAfterMs: 0,
    dispatch: data,
    heartbeat: data.heartbeat || null,
    reconcile,
  };
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
  pluginVersion = '',
  fetchFn,
  store = null,
} = {}) {
  const localLease = typeof store?.read === 'function' ? await store.read() : null;
  const rawData = await postJson({
    serverUrl,
    path: '/api/execution-stations/dispatch',
    fetchFn,
    authorizationToken,
    body: {
      authorizationId: normalizeString(authorizationId),
      pluginAuthorizationId: normalizeString(authorizationId),
      stationId: normalizeString(stationId),
      stationToken: normalizeString(stationToken),
      status: 'online',
      capabilities: toStringArray(capabilities),
      platformAccounts: Array.isArray(platformAccounts) ? platformAccounts : [],
      pluginVersion: normalizeString(pluginVersion),
      localLease: localLease && typeof localLease === 'object'
        ? normalizeLeaseSnapshot({ fallback: localLease })
        : null,
    },
  });
  const data = normalizeDispatchClaimResponse(rawData);

  if (data?.task && data?.lease && store?.write) {
    await store.write(normalizeLeaseSnapshot({
      task: data.task,
      lease: data.lease,
      attempt: data.attempt,
    }));
  } else if (data?.resumeLease?.taskId && data?.resumeLease?.leaseToken && store?.write) {
    await store.write(data.resumeLease);
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
  attemptId = '',
  leaseEpoch,
  attemptNumber,
  fetchFn,
  store = null,
} = {}) {
  const normalizedTaskId = normalizeString(taskId);
  const leaseAuth = normalizeLeaseSnapshot({
    fallback: {
      taskId: normalizedTaskId,
      leaseToken,
      attemptId,
      leaseEpoch,
      attemptNumber,
    },
  });
  const data = await postJson({
    serverUrl,
    path: `/api/collection-tasks/${encodeURIComponent(normalizedTaskId)}/lease`,
    fetchFn,
    authorizationToken,
    body: addLeaseAttemptFields({
      authorizationId: normalizeString(authorizationId),
      stationId: normalizeString(stationId),
      stationToken: normalizeString(stationToken),
      leaseToken: normalizeString(leaseToken),
      status: normalizeString(status) || 'running',
    }, leaseAuth),
  });

  if (store?.write && data?.expiresAt) {
    await store.write(normalizeLeaseSnapshot({
      lease: data,
      fallback: {
        ...leaseAuth,
        expiresAt: data.expiresAt,
      },
    }));
  }

  return data;
}

export async function reconcileExecutionStationLease({
  serverUrl = '',
  stationId = '',
  stationToken = '',
  authorizationId = '',
  authorizationToken = '',
  localLease = null,
  capabilities = [],
  platformAccounts = [],
  pluginVersion = '',
  fetchFn,
  store = null,
} = {}) {
  const normalizedLocalLease = localLease && typeof localLease === 'object'
    ? {
        ...normalizeLeaseSnapshot({ fallback: localLease }),
      }
    : null;

  const body = {
    authorizationId: normalizeString(authorizationId),
    pluginAuthorizationId: normalizeString(authorizationId),
    stationId: normalizeString(stationId),
    stationToken: normalizeString(stationToken),
    localLease: normalizedLocalLease,
    capabilities: toStringArray(capabilities),
    platformAccounts: Array.isArray(platformAccounts) ? platformAccounts : [],
    pluginVersion: normalizeString(pluginVersion),
  };

  let data;
  let lastMissingError = null;
  for (const path of ['/api/execution-stations/reconcile', '/api/station/reconcile']) {
    try {
      data = await postJson({
        serverUrl,
        path,
        fetchFn,
        authorizationToken,
        body,
      });
      break;
    } catch (error) {
      if ([404, 405].includes(Number(error?.status || 0))) {
        lastMissingError = error;
        continue;
      }
      throw error;
    }
  }
  if (!data) {
    void lastMissingError;
    return { success: false, skipped: true, reason: 'reconcile_unavailable' };
  }

  const action = normalizeString(data?.action || data?.status || '');
  const serverLease = data?.lease || data?.serverLease || null;
  const normalizedServerLease = normalizeLeaseSnapshot({
    task: data?.task,
    lease: serverLease || data,
    attempt: data?.attempt,
    fallback: {
      taskId: data?.taskId,
      leaseToken: data?.leaseToken,
      expiresAt: data?.expiresAt,
      attemptId: data?.attemptId,
      leaseEpoch: data?.leaseEpoch,
    },
  });
  const taskId = normalizeString(normalizedServerLease.taskId);
  const leaseToken = normalizeString(normalizedServerLease.leaseToken);

  if (store?.write && taskId && leaseToken) {
    await store.write(normalizedServerLease);
  } else if (
    store?.clear &&
    ['clear_local', 'idle', 'release', 'released', 'expired'].includes(action)
  ) {
    await store.clear();
  }

  return {
    success: true,
    ...data,
    action,
    lease: taskId && leaseToken
      ? normalizedServerLease
      : null,
  };
}
