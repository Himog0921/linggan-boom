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

function createHttpError(message, { status = 0, retryable = false } = {}) {
  const error = new Error(message);
  error.status = status;
  error.retryable = Boolean(retryable);
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
      throw createHttpError(text || `HTTP ${response.status}`, {
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
        error: String(error?.message || error || 'heartbeat_failed'),
        nextRetryAt: now() + 30_000,
      };
    }
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
  };
}
