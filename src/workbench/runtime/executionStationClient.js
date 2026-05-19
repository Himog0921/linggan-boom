import { normalizeServerUrl } from '../../shared/utils.js';

const STORAGE_KEY = 'workbenchExecutionStation';
const DEFAULT_SERVER_URL = 'https://lingganboom.fun';

function normalizeString(value = '') {
  return String(value || '').trim();
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

async function readStorage(storageArea, key) {
  if (!storageArea?.get) return {};
  const result = await storageArea.get(key);
  return result?.[key] || {};
}

async function writeStorage(storageArea, key, value) {
  if (!storageArea?.set) return value;
  await storageArea.set({ [key]: value });
  return value;
}

async function readErrorText(response) {
  if (!response?.text) return '';
  return response.text().catch(() => '');
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function errorMessageFromResponseText(text = '', fallback = '') {
  const body = normalizeString(text);
  if (!body) return fallback;
  const parsed = parseErrorBody(body);
  const message = normalizeString(parsed?.error || parsed?.message);
  return message || body;
}

function createHttpError(message, { status = 0, retryable = false, reasonCode = '', retryAfterMs = 0 } = {}) {
  const error = new Error(message);
  error.status = status;
  error.retryable = Boolean(retryable);
  error.reasonCode = normalizeString(reasonCode);
  error.retryAfterMs = toFiniteNumber(retryAfterMs, 0);
  return error;
}

function isRetryableStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

export function createExecutionStationClient({
  storageArea = globalThis.chrome?.storage?.local,
  fetchFn = globalThis.fetch?.bind(globalThis),
  resolveServerUrl = async () => DEFAULT_SERVER_URL,
  resolveAuthorization = async () => ({}),
  randomUUID = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
  now = () => Date.now(),
} = {}) {
  async function getStoredStationIdentity() {
    return readStorage(storageArea, STORAGE_KEY);
  }

  async function saveStationIdentity(identity = {}) {
    const existing = await getStoredStationIdentity();
    const next = {
      ...existing,
      ...identity,
      updatedAt: now(),
    };
    return writeStorage(storageArea, STORAGE_KEY, next);
  }

  async function ensureStationKey() {
    const existing = await getStoredStationIdentity();
    const stationKey = normalizeString(existing.stationKey) || normalizeString(randomUUID());
    if (stationKey !== existing.stationKey) {
      await saveStationIdentity({ stationKey });
    }
    return stationKey;
  }

  async function postJson(path, body = {}) {
    if (typeof fetchFn !== 'function') {
      throw createHttpError('fetch unavailable', { retryable: true });
    }
    const baseUrl = normalizeServerUrl(await resolveServerUrl(), DEFAULT_SERVER_URL);
    const authorization = await resolveAuthorization();
    const authorizationToken = normalizeString(
      authorization?.authorizationToken
      || authorization?.apiToken
      || authorization?.token,
    );
    const headers = { 'Content-Type': 'application/json' };
    if (authorizationToken) {
      headers.Authorization = `Bearer ${authorizationToken}`;
    }
    const response = await fetchFn(`${baseUrl}${path}`, {
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
        retryable: isRetryableStatus(response.status),
        reasonCode: parsed?.code || parsed?.reasonCode || '',
        retryAfterMs: headerRetryAfterMs || bodyRetryAfterMs,
      });
    }
    return response.json().catch(() => ({}));
  }

  async function getJson(path) {
    if (typeof fetchFn !== 'function') {
      throw createHttpError('fetch unavailable', { retryable: true });
    }
    const baseUrl = normalizeServerUrl(await resolveServerUrl(), DEFAULT_SERVER_URL);
    const response = await fetchFn(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      const text = await readErrorText(response);
      throw createHttpError(errorMessageFromResponseText(text, `HTTP ${response.status}`), {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      });
    }
    return response.json().catch(() => ({}));
  }

  async function registerWithPairingCode({
    pairingCode = '',
    capabilities = [],
    pluginVersion = '',
    browserLabel = '',
  } = {}) {
    const stationKey = await ensureStationKey();
    const authorization = await resolveAuthorization();
    const data = await postJson('/api/execution-stations/register', {
      pairingCode: normalizeString(pairingCode),
      authorizationId: normalizeString(authorization?.authorizationId),
      stationKey,
      pluginVersion: normalizeString(pluginVersion),
      browserLabel: normalizeString(browserLabel),
      capabilities: toStringArray(capabilities),
    });
    const identity = await saveStationIdentity({
      stationId: normalizeString(data.stationId),
      stationToken: normalizeString(data.stationToken),
      displayName: normalizeString(data.displayName),
      role: normalizeString(data.role),
      stationKey,
      capabilities: toStringArray(capabilities),
      pairedAt: now(),
    });
    return identity;
  }

  async function sendHeartbeat({
    status = 'online',
    capabilities = [],
    pluginVersion = '',
    platformAccounts = [],
  } = {}) {
    const identity = await getStoredStationIdentity();
    const authorization = await resolveAuthorization();
    const stationId = normalizeString(identity.stationId);
    const stationToken = normalizeString(identity.stationToken);
    if (!stationId || !stationToken) {
      return { success: false, retryable: false, reason: 'station_not_registered' };
    }

    try {
      const data = await postJson('/api/execution-stations/heartbeat', {
        stationId,
        stationToken,
        authorizationId: normalizeString(authorization?.authorizationId),
        status: normalizeString(status) || 'online',
        pluginVersion: normalizeString(pluginVersion),
        capabilities: toStringArray(capabilities.length ? capabilities : identity.capabilities),
        platformAccounts: Array.isArray(platformAccounts) ? platformAccounts : [],
      });
      await saveStationIdentity({
        stationId,
        stationToken,
        role: normalizeString(data?.station?.role) || normalizeString(identity.role),
        lastHeartbeatAt: now(),
        capabilities: toStringArray(capabilities.length ? capabilities : identity.capabilities),
      });
      return { success: true, ...data };
    } catch (error) {
      return {
        success: false,
        retryable: error?.retryable !== false,
        status: Number(error?.status || 0),
        reasonCode: normalizeString(error?.reasonCode || ''),
        error: String(error?.message || error || 'heartbeat_failed'),
        nextRetryAfterMs: toFiniteNumber(error?.retryAfterMs, 0) || 30_000,
        nextRetryAt: now() + (toFiniteNumber(error?.retryAfterMs, 0) || 30_000),
      };
    }
  }

  async function fetchVapidPublicKey() {
    try {
      return await getJson('/api/push/vapid-public-key');
    } catch (error) {
      return {
        enabled: false,
        error: String(error?.message || error || 'vapid_public_key_failed'),
      };
    }
  }

  async function registerPushSubscription({
    subscription = null,
    pluginVersion = '',
    browserLabel = '',
  } = {}) {
    const identity = await getStoredStationIdentity();
    const authorization = await resolveAuthorization();
    const stationId = normalizeString(identity.stationId);
    const stationToken = normalizeString(identity.stationToken);
    if (!stationId || !stationToken) {
      return { ok: false, skipped: true, reason: 'station_not_registered' };
    }

    const data = await postJson('/api/execution-stations/push-subscription', {
      stationId,
      stationToken,
      authorizationId: normalizeString(authorization?.authorizationId),
      pluginVersion: normalizeString(pluginVersion),
      browserLabel: normalizeString(browserLabel),
      subscription,
    });
    await saveStationIdentity({
      pushSubscriptionEndpoint: normalizeString(subscription?.endpoint),
      pushSubscriptionRegisteredAt: now(),
    });
    return { ok: true, ...data };
  }

  async function clearStationIdentity({ preserveStationKey = true } = {}) {
    const existing = await getStoredStationIdentity();
    if (!preserveStationKey || !normalizeString(existing.stationKey)) {
      if (storageArea?.remove) {
        await storageArea.remove(STORAGE_KEY);
        return {};
      }
      return writeStorage(storageArea, STORAGE_KEY, {});
    }
    return writeStorage(storageArea, STORAGE_KEY, {
      stationKey: normalizeString(existing.stationKey),
      updatedAt: now(),
      clearedAt: now(),
    });
  }

  return {
    getStoredStationIdentity,
    saveStationIdentity,
    clearStationIdentity,
    registerWithPairingCode,
    sendHeartbeat,
    fetchVapidPublicKey,
    registerPushSubscription,
  };
}
