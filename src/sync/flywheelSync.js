/**
 * 内容工作台同步模块
 * 负责将插件采集的数据同步到选题工作台
 */

import { normalizeServerUrl } from '../shared/utils.js';

const API_BASE_URL = 'https://lingganboom.fun';
const FLYWHEEL_STORAGE_KEY = 'flywheelConfig';

let cachedConfig = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30000;

async function readFlywheelStorage() {
  if (cachedConfig && (Date.now() - cachedAt) < CACHE_TTL_MS) return cachedConfig;
  if (!globalThis.chrome?.storage?.local) {
    return { serverUrl: normalizeServerUrl(API_BASE_URL), enabled: true, apiToken: '' };
  }
  const result = await chrome.storage.local.get(FLYWHEEL_STORAGE_KEY);
  const config = result?.[FLYWHEEL_STORAGE_KEY] || {};
  const hasEnabledFlag = Object.prototype.hasOwnProperty.call(config, 'enabled');
  cachedConfig = {
    serverUrl: normalizeServerUrl(config.serverUrl || API_BASE_URL),
    enabled: hasEnabledFlag ? config.enabled !== false : true,
    apiToken: String(config.apiToken || '').trim(),
    updatedAt: config.updatedAt || 0,
  };
  cachedAt = Date.now();
  return cachedConfig;
}

async function writeFlywheelStorage(config = {}) {
  const previous = await readFlywheelStorage();
  const hasServerUrl = Object.prototype.hasOwnProperty.call(config, 'serverUrl');
  const hasEnabledFlag = Object.prototype.hasOwnProperty.call(config, 'enabled');
  const hasApiToken = Object.prototype.hasOwnProperty.call(config, 'apiToken');
  const next = {
    serverUrl: normalizeServerUrl(
      hasServerUrl
        ? (config.serverUrl || API_BASE_URL)
        : (previous.serverUrl || API_BASE_URL),
    ),
    enabled: hasEnabledFlag ? config.enabled !== false : previous.enabled !== false,
    apiToken: hasApiToken ? String(config.apiToken || '').trim() : String(previous.apiToken || '').trim(),
    updatedAt: Date.now(),
  };
  cachedConfig = next;
  cachedAt = Date.now();
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({
      [FLYWHEEL_STORAGE_KEY]: next,
    });
  }
  return next;
}

// 监听 storage 变化，外部修改配置时立即清空缓存
if (globalThis.chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[FLYWHEEL_STORAGE_KEY]) {
      cachedConfig = null;
      cachedAt = 0;
    }
  });
}

async function resolveFlywheelBaseUrl(serverUrl = '') {
  if (serverUrl) return normalizeServerUrl(serverUrl);
  const config = await readFlywheelStorage();
  return normalizeServerUrl(config.serverUrl || API_BASE_URL);
}

async function fetchFlywheel(path, options = {}) {
  const {
    serverUrl = '',
    apiToken,
    timeoutMs = 10000,
    method = 'GET',
    headers = {},
    body,
  } = options;
  const baseUrl = await resolveFlywheelBaseUrl(serverUrl);
  const config = await readFlywheelStorage();
  const resolvedToken = typeof apiToken === 'string'
    ? String(apiToken || '').trim()
    : String(config?.apiToken || '').trim();
  const requestHeaders = {
    ...headers,
  };
  if (resolvedToken) {
    requestHeaders.Authorization = `Bearer ${resolvedToken}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response;
}

export function mergeFlywheelAuthorization(config = {}, authorization = {}) {
  const authorizationToken = firstText(
    authorization?.authorizationToken
    || authorization?.apiToken
    || authorization?.token,
  );
  const authorizationStatus = firstText(
    authorization?.status
    || authorization?.authorizationStatus,
  ).toLowerCase();
  const authorizationUsable = Boolean(authorizationToken)
    && !['revoked', 'expired', 'suspended', 'disabled'].includes(authorizationStatus);

  return {
    ...config,
    apiToken: authorizationUsable
      ? authorizationToken
      : firstText(config?.apiToken),
  };
}

function firstText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function pickMediaUrlFromArray(value) {
  if (!Array.isArray(value)) return '';

  for (const item of value) {
    const direct = firstText(item);
    if (direct) return direct;

    const nestedArray = pickMediaUrlFromArray(item);
    if (nestedArray) return nestedArray;

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = firstText(item.urlDefault)
        || firstText(item.url)
        || firstText(item.src);
      if (nested) return nested;
    }
  }

  return '';
}

function pickCoverUrl(record = {}) {
  return firstText(record.coverImage)
    || firstText(record.cover)
    || firstText(record.coverImg)
    || firstText(record.coverUrl)
    || firstText(record.thumbnail)
    || pickMediaUrlFromArray(record.images)
    || pickMediaUrlFromArray(record.imageCandidates);
}

function canUploadCoverUrl(url = '') {
  return /^https?:\/\//i.test(String(url || ''));
}

function platformContentIdFrom(record = {}) {
  return firstText(record.platformContentId)
    || firstText(record.noteId)
    || firstText(record.videoId)
    || firstText(record.awemeId)
    || firstText(record.contentId).replace(/^xhs_/, '');
}

function replaceFirstMediaUrl(value, publicUrl) {
  if (!Array.isArray(value) || value.length === 0) return [publicUrl];
  const [first, ...rest] = value;
  if (typeof first === 'string') return [publicUrl, ...rest];
  if (Array.isArray(first)) return [[publicUrl], ...rest];
  if (first && typeof first === 'object') return [{ ...first, url: publicUrl }, ...rest];
  return [publicUrl, ...rest];
}

async function fetchImageBlob(sourceUrl) {
  const response = await fetch(sourceUrl, {
    credentials: 'include',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    throw createHttpError(`cover_fetch_failed: HTTP ${response.status}`, {
      status: response.status,
      retryable: isRetryableStatus(response.status),
    });
  }
  const blob = await response.blob();
  if (!blob || Number(blob.size || 0) <= 0) {
    throw createHttpError('cover_fetch_failed: empty_blob', { retryable: false });
  }
  const type = String(blob.type || response.headers?.get?.('content-type') || '').toLowerCase();
  if (type && !type.startsWith('image/')) {
    throw createHttpError(`cover_fetch_failed: ${type}`, { retryable: false });
  }
  return blob;
}

function filenameForCover(record = {}, sourceUrl = '', mimeType = '') {
  const cleanUrl = String(sourceUrl || '').split('?')[0].split('#')[0];
  const urlExt = cleanUrl.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  const mimeExt = String(mimeType || '').split('/')[1]?.replace('jpeg', 'jpg');
  const ext = (urlExt || mimeExt || 'jpg').toLowerCase();
  const id = platformContentIdFrom(record) || Date.now();
  return `cover-${id}.${ext}`;
}

function formDataSet(formData, key, value) {
  const text = firstText(value);
  if (text) formData.set(key, text);
}

export async function uploadCoverMediaAsset(config = {}, record = {}) {
  const sourceUrl = pickCoverUrl(record);
  if (!canUploadCoverUrl(sourceUrl)) {
    return { success: false, skipped: true, reason: 'missing_cover_url' };
  }

  const imageBlob = await fetchImageBlob(sourceUrl);
  const formData = new FormData();
  formData.set('file', imageBlob, filenameForCover(record, sourceUrl, imageBlob.type));
  formDataSet(formData, 'sourceUrl', sourceUrl);
  formDataSet(formData, 'platform', record.platform || config.platform);
  formDataSet(formData, 'platformContentId', platformContentIdFrom(record));

  const response = await fetchFlywheel('/api/media-assets/cover', {
    serverUrl: config?.serverUrl || '',
    apiToken: config?.apiToken,
    method: 'POST',
    body: formData,
    timeoutMs: 30000,
  });
  if (!response.ok) {
    await throwForWorkbenchHttpError(response, 'upload_cover_failed');
  }

  const data = await response.json().catch(() => ({}));
  const publicUrl = firstText(data?.asset?.publicUrl) || firstText(data?.publicUrl);
  if (!publicUrl) {
    throw createHttpError('upload_cover_failed: missing_public_url', { retryable: true });
  }
  return {
    success: true,
    publicUrl,
    asset: data.asset || null,
    sourceUrl,
  };
}

export async function prepareRecordWithStableCover(config = {}, record = {}) {
  const sourceUrl = pickCoverUrl(record);
  if (!canUploadCoverUrl(sourceUrl) || firstText(record.coverStorageProvider)) {
    return record;
  }

  try {
    const upload = await uploadCoverMediaAsset(config, record);
    if (!upload.success || !upload.publicUrl) return record;
    return {
      ...record,
      sourceCoverUrl: firstText(record.sourceCoverUrl) || upload.sourceUrl,
      originalCoverUrl: firstText(record.originalCoverUrl) || upload.sourceUrl,
      coverImage: upload.publicUrl,
      cover: upload.publicUrl,
      coverImg: upload.publicUrl,
      coverUrl: upload.publicUrl,
      thumbnail: firstText(record.thumbnail) ? upload.publicUrl : record.thumbnail,
      images: replaceFirstMediaUrl(record.images, upload.publicUrl),
      coverMediaAssetId: firstText(upload.asset?.id),
      coverStorageProvider: firstText(upload.asset?.storageProvider) || 'vercel_blob',
    };
  } catch (error) {
    return {
      ...record,
      coverAssetUploadStatus: 'failed',
      coverAssetUploadError: String(error?.message || error || 'upload_cover_failed').slice(0, 240),
    };
  }
}

export async function prepareNotesWithStableCovers(config = {}, notes = []) {
  const list = Array.isArray(notes) ? notes : [];
  const prepared = [];
  for (const note of list) {
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
      prepared.push(note);
      continue;
    }
    prepared.push(await prepareRecordWithStableCover(config, note));
  }
  return prepared;
}

function createHttpError(message, { status = 0, bodyText = '', retryable = false } = {}) {
  const error = new Error(message);
  error.status = status;
  error.bodyText = bodyText;
  error.retryable = Boolean(retryable);
  return error;
}

function isRetryableStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status));
}

async function readErrorBody(response) {
  return response.text().catch(() => '');
}

async function throwForWorkbenchHttpError(response, fallbackMessage = 'workbench_request_failed') {
  const bodyText = await readErrorBody(response);
  let retryable = isRetryableStatus(response.status);
  try {
    const body = JSON.parse(bodyText || '{}');
    if (typeof body.retryable === 'boolean') retryable = body.retryable;
  } catch {
    // keep status-based classification
  }
  throw createHttpError(bodyText || `${fallbackMessage}: HTTP ${response.status}`, {
    status: response.status,
    bodyText,
    retryable,
  });
}

function normalizeSource(s) {
  const rawData = s.rawData || s;
  const qualityReason = s?.qualityReason ?? rawData?.qualityReason;
  return {
    platform: s.platform || 'xhs',
    platformId: s.noteId || s.platformId || s.id,
    url: s.url,
    title: s.title,
    bodyText: s.content || s.bodyText || s.desc,
    coverUrl: s.coverImage || s.coverUrl,
    likes: s.metrics?.likes || s.likes,
    collects: s.metrics?.collects || s.collects,
    comments: s.metrics?.comments || s.comments,
    shares: s.metrics?.shares || s.shares,
    authorId: s.author?.id || s.authorId,
    authorName: s.author?.name || s.authorName,
    dataQuality: String(s?.dataQuality ?? rawData?.dataQuality ?? '').trim(),
    qualityReason: qualityReason == null ? '' : String(qualityReason),
    sourceTier: String(s?.sourceTier ?? rawData?.sourceTier ?? '').trim(),
    collectionRunId: String(s?.collectionRunId ?? rawData?.collectionRunId ?? '').trim(),
    rawData,
    commentsData: s.comments || s.commentsData,
  };
}

async function sendBatch(batchSources, tag, operator) {
  const config = await readFlywheelStorage();
  const preparedSources = await prepareNotesWithStableCovers(config, batchSources);
  const response = await fetchFlywheel('/api/collect/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sources: preparedSources.map(normalizeSource),
      tag,
      operator,
      timestamp: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * 同步采集的数据到内容工作台
 * @param {Array} sources - 采集的笔记数据
 * @param {string} tag - 标签：direct_import | evaluate | analysis_only
 * @param {string} operator - 操作人
 * @returns {Promise<{success: boolean, imported?: number, skipped?: number, error?: string}>}
 */
export async function syncToFlywheel(sources, tag = 'evaluate', operator = 'anonymous') {
  const BATCH_SIZE = 50;
  const total = sources.length;

  if (total === 0) {
    return { success: true, imported: 0, skipped: 0, details: [] };
  }

  let imported = 0;
  let skipped = 0;
  const details = [];
  const batchErrors = [];
  let successfulBatchCount = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = sources.slice(i, i + BATCH_SIZE);
    try {
      const result = await sendBatch(batch, tag, operator);
      successfulBatchCount += 1;
      imported += Number(result.imported) || 0;
      skipped += Number(result.skipped) || 0;
      if (Array.isArray(result.sources)) {
        details.push(...result.sources);
      }
    } catch (error) {
      console.error(`Sync batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error);
      batchErrors.push(error.message);
    }
  }

  if (batchErrors.length > 0) {
    if (successfulBatchCount > 0) {
      return {
        success: true,
        imported,
        skipped,
        details,
        error: batchErrors.join('; '),
        partial: true,
      };
    }
    return {
      success: false,
      imported,
      skipped,
      details,
      error: batchErrors.join('; '),
      partial: successfulBatchCount > 0,
    };
  }

  return {
    success: true,
    imported,
    skipped,
    details,
  };
}

export async function testConnection(serverUrl = '') {
  try {
    const response = await fetchFlywheel('/api/collect/status', {
      serverUrl,
      timeoutMs: 5000,
    });
    return {
      success: response.ok,
      status: response.status,
    };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || error || '连接失败'),
    };
  }
}

export async function getFlywheelConfig() {
  return readFlywheelStorage();
}

export async function saveFlywheelConfig(config = {}) {
  return writeFlywheelStorage(config);
}

export async function fetchCollectionTasks(config = {}, query = {}) {
  const params = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });
  const path = params.toString()
    ? `/api/collection-tasks?${params.toString()}`
    : '/api/collection-tasks';
  const response = await fetchFlywheel(path, {
    serverUrl: config?.serverUrl || '',
    timeoutMs: 10000,
  });
  if (!response.ok) {
    const error = await response.text().catch(() => '');
    throw new Error(error || `HTTP ${response.status}`);
  }
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data?.tasks) ? data.tasks : [];
}

export async function fetchTrackableCollectionTasks(
  config = {},
  {
    limit = 5,
    statuses = ['dispatched', 'running', 'paused'],
  } = {},
) {
  const uniqueStatuses = [...new Set(statuses)];
  if (!uniqueStatuses.length) return [];

  const groups = await Promise.all(
    uniqueStatuses.map((status) => fetchCollectionTasks(config, { status, limit }).catch(() => [])),
  );

  const deduped = new Map();
  for (const list of groups) {
    for (const task of Array.isArray(list) ? list : []) {
      const id = String(task?.id || '').trim();
      if (!id || deduped.has(id)) continue;
      deduped.set(id, task);
    }
  }

  return [...deduped.values()]
    .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())
    .slice(0, limit);
}

export async function patchCollectionTask(config = {}, taskId = '', patch = {}) {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) {
    throw new Error('taskId required');
  }
  const response = await fetchFlywheel(`/api/collection-tasks/${encodeURIComponent(normalizedTaskId)}`, {
    serverUrl: config?.serverUrl || '',
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch || {}),
    timeoutMs: 10000,
  });
  if (!response.ok) {
    const error = await response.text().catch(() => '');
    throw new Error(error || `HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

export async function ingestCollectionTaskDelta(config = {}, taskId = '', envelope = {}) {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) {
    throw new Error('taskId required');
  }
  try {
    const response = await fetchFlywheel(`/api/collection-tasks/${encodeURIComponent(normalizedTaskId)}/ingest`, {
      serverUrl: config?.serverUrl || '',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(envelope || {}),
      timeoutMs: 10000,
    });
    if (!response.ok) {
      await throwForWorkbenchHttpError(response, 'ingest_delta_failed');
    }
    return response.json().catch(() => ({ success: true }));
  } catch (error) {
    if (typeof error?.retryable === 'boolean') throw error;
    throw createHttpError(String(error?.message || error || 'ingest_delta_failed'), {
      status: Number(error?.status || 0),
      bodyText: String(error?.bodyText || ''),
      retryable: true,
    });
  }
}

export async function fetchCollectionTaskControlRequests(
  config = {},
  taskId = '',
  { executorInstanceId = '', after = '' } = {},
) {
  const normalizedTaskId = String(taskId || '').trim();
  if (!normalizedTaskId) {
    throw new Error('taskId required');
  }
  const params = new URLSearchParams();
  if (executorInstanceId) params.set('executorInstanceId', String(executorInstanceId));
  if (after) params.set('after', String(after));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  try {
    const response = await fetchFlywheel(
      `/api/collection-tasks/${encodeURIComponent(normalizedTaskId)}/control-requests${suffix}`,
      {
        serverUrl: config?.serverUrl || '',
        method: 'GET',
        timeoutMs: 10000,
      },
    );
    if (response.status === 404) {
      return { success: true, controls: [], nextCursor: '' };
    }
    if (!response.ok) {
      await throwForWorkbenchHttpError(response, 'fetch_control_requests_failed');
    }
    const data = await response.json().catch(() => ({}));
    return {
      success: data?.success !== false,
      controls: Array.isArray(data?.controls) ? data.controls : [],
      nextCursor: String(data?.nextCursor || ''),
    };
  } catch (error) {
    if (typeof error?.retryable === 'boolean') throw error;
    throw createHttpError(String(error?.message || error || 'fetch_control_requests_failed'), {
      status: Number(error?.status || 0),
      bodyText: String(error?.bodyText || ''),
      retryable: true,
    });
  }
}

/**
 * 检查工作台连接状态
 * @returns {Promise<boolean>}
 */
export async function checkFlywheelConnection() {
  try {
    const response = await fetchFlywheel('/api/topics?stats=true');
    return response.ok;
  } catch {
    return false;
  }
}
