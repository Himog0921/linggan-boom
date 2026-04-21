import '../extensionPublicPath.js';
import { MSG } from '../shared/constants.js';
import {
  testConnection,
  getFlywheelConfig,
  saveFlywheelConfig,
  fetchPendingCollectionTasks,
  fetchTrackableCollectionTasks,
  patchCollectionTask,
  fetchCollectionTaskControlRequests,
  ingestCollectionTaskDelta,
} from '../sync/flywheelSync.js';
import { validateCapabilityCheck, validateTaskControl, validateTaskEnvelope } from '../workbench/protocol/validator.js';
import {
  WORKBENCH_EVENT_SOURCE,
  WORKBENCH_MESSAGE_TYPE,
  WORKBENCH_PROTOCOL_VERSION,
  WORKBENCH_RECORD_TYPE,
  WORKBENCH_TASK_EVENT_TYPE,
} from '../workbench/protocol/schema.js';
import { mapTaskEnvelopeToCapabilityCheck, mapTaskEnvelopeToInternalCommand } from '../workbench/runtime/taskEnvelopeMapper.js';
import { mapTaskControlToInternalCommand } from '../workbench/runtime/taskControlMapper.js';
import { createResultPackager } from '../workbench/runtime/resultPackager.js';
import { canDispatchTaskFromCapabilityReport } from '../workbench/runtime/capabilityCheck.js';
import { createExecutionStationClient } from '../workbench/runtime/executionStationClient.js';
import {
  claimCollectionTaskLease,
  createTaskLeaseStorageStore,
  renewCollectionTaskLease,
} from '../workbench/runtime/taskLeaseClient.js';
import {
  collectStationPlatformAccounts,
  MONITOR_STATION_CAPABILITIES,
} from '../workbench/runtime/executionStationRuntime.js';
import { createTaskPoller } from '../workbench/runtime/taskPoller.js';
import { scheduleWorkbenchTaskPollAlarm } from '../workbench/runtime/taskPollSchedule.js';
import { createTaskDeltaReporter } from '../workbench/runtime/taskDeltaReporter.js';
import { normalizeProgressEvent } from '../workbench/runtime/progressEvent.js';
import { navigateToTask, closeTab } from '../workbench/runtime/navigationOrchestrator.js';
import { getPersistentExecutorInstanceId } from '../workbench/runtime/executorIdentity.js';
import { collectionRunStore } from '../db/collectionRunStore.js';
import { workbenchOutboxStore } from '../db/workbenchOutboxStore.js';
import { accountStore } from '../db/accountStore.js';
import { selectAvailableAccount, injectCookiesForAccount } from '../workbench/runtime/cookieManager.js';
import { noteStore } from '../db/noteStore.js';
import { commentStore } from '../db/commentStore.js';
import { authorStore } from '../db/authorStore.js';
import { mediaAssetStore } from '../db/mediaAssetStore.js';
import { sendToTab as sendSharedToTab } from '../shared/messaging.js';
import { normalizeWorkbenchMessageResponse } from '../workbench/protocol/responseEnvelope.js';

// ========== 启动时清理残留规则 ==========
// 防止上次异常退出后 BLOCK_MEDIA 规则残留导致页面加载不出来
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
}).catch(() => {});

function dedupeCandidates(input = []) {
  const list = Array.isArray(input) ? input : [input];
  const seen = new Set();
  const normalized = [];
  for (const raw of list) {
    if (!raw) continue;
    const url = String(raw).trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
  }
  return normalized;
}

function sanitizeDownloadFilename(filename = '灵感爆爆爆/下载文件') {
  const normalized = String(filename || '灵感爆爆爆/下载文件')
    .replace(/[\\:*?"<>|]/g, '_')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .trim();
  return normalized || '灵感爆爆爆/下载文件';
}

function buildDownloadHeaders(customHeaders = []) {
  const list = Array.isArray(customHeaders) ? [...customHeaders] : [];
  if (list.length === 0) return [];
  const forbidden = new Set([
    'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method',
    'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive',
    'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-user', 'sec-fetch-dest',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'via',
  ]);
  const valid = [];
  for (const item of list) {
    const name = String(item?.name || '').trim();
    const value = String(item?.value || '');
    if (!name) continue;
    const lower = name.toLowerCase();
    if (forbidden.has(lower)) continue;
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) continue;
    valid.push({ name, value });
  }
  return valid;
}


function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchBinaryAsDataUrl(candidates = []) {
  const urls = dedupeCandidates(candidates);
  for (let i = 0; i < urls.length; i += 1) {
    const candidate = urls[i];
    try {
      const response = await fetch(candidate, { credentials: 'include' });
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (!buffer || buffer.byteLength <= 0) continue;
      const contentType = String(response.headers.get('content-type') || '').trim() || 'application/octet-stream';
      return {
        success: true,
        candidate,
        candidateIndex: i,
        contentType,
        dataUrl: `data:${contentType};base64,${arrayBufferToBase64(buffer)}`,
      };
    } catch {
      // try next candidate
    }
  }
  return { success: false };
}

function waitDownloadFinished(downloadId, timeoutMs = 180000) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve({ success: false, reason: 'timeout' });
    }, timeoutMs);

    const onChanged = (delta) => {
      if (done || delta.id !== downloadId || !delta.state) return;
      const state = delta.state.current;
      if (state !== 'complete' && state !== 'interrupted') return;
      done = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (state === 'complete') {
        resolve({ success: true, reason: 'complete' });
      } else {
        resolve({
          success: false,
          reason: delta.error?.current || 'interrupted',
        });
      }
    };

    chrome.downloads.onChanged.addListener(onChanged);
  });
}

const resultPackager = createResultPackager({
  collectionRunStore,
  noteStore,
  commentStore,
  authorStore,
  mediaAssetStore,
});
const workbenchTaskRegistry = new Map();
const navigatedTabs = new Map();
const WORKBENCH_TASK_POLL_ALARM = 'workbench-task-poll';
const WORKBENCH_STATION_HEARTBEAT_ALARM = 'workbench-station-heartbeat';
const INITIAL_WORKBENCH_TASK_POLL_MINUTES = 0.5;

let consecutiveEmptyPolls = 0;

function isUrlLike(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isXhsDetailUrl(url = '') {
  return /^https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[^/?#]+/i.test(String(url || '').trim());
}

function isDouyinDetailUrl(url = '') {
  return /^https?:\/\/(?:www\.)?douyin\.com\/video\/[^/?#]+/i.test(String(url || '').trim());
}

function normalizeString(value = '') {
  return String(value || '').trim();
}

function extractXhsDetailIdFromUrl(url = '') {
  const raw = normalizeString(url);
  if (!raw) return '';
  const match = raw.match(
    /xiaohongshu\.com\/(?:(?:explore|discovery\/item)\/|user\/profile\/[^/?#]+\/)([^/?#]+)/i,
  );
  return normalizeString(match?.[1] || '').replace(/^xhs_/, '');
}

function extractDouyinDetailIdFromUrl(url = '') {
  const raw = normalizeString(url);
  if (!raw) return '';
  const match = raw.match(/douyin\.com\/video\/([^/?#]+)/i);
  return normalizeString(match?.[1] || '').replace(/^dy_/, '');
}

function extractDetailContentIdFromUrl(url = '') {
  return extractXhsDetailIdFromUrl(url) || extractDouyinDetailIdFromUrl(url);
}

function buildCanonicalXhsDetailUrl(noteId = '') {
  const normalizedNoteId = normalizeString(noteId).replace(/^xhs_/, '');
  return normalizedNoteId ? `https://www.xiaohongshu.com/explore/${normalizedNoteId}` : '';
}

function extractXhsProfileUserId(url = '') {
  const raw = normalizeString(url);
  if (!raw) return '';
  const match = raw.match(/xiaohongshu\.com\/user\/profile\/([^/?#]+)/i);
  return normalizeString(match?.[1] || '');
}

function buildCanonicalXhsProfileUrl(userId = '') {
  const normalizedUserId = normalizeString(userId);
  return normalizedUserId ? `https://www.xiaohongshu.com/user/profile/${normalizedUserId}` : '';
}

function isXhsProfileRelayDetailUrl(url = '') {
  return /^https?:\/\/(?:www\.)?xiaohongshu\.com\/user\/profile\/[^/?#]+\/[^/?#]+/i.test(normalizeString(url));
}

function getTaskStrategy(task = {}) {
  const payload = task?.payload && typeof task.payload === 'object' ? task.payload : {};
  return normalizeString(task?.taskStrategy || payload.taskStrategy || payload.monitorStrategy);
}

function isRecoverableConnectionError(error) {
  const message = String(error?.message || error || '');
  return /Could not establish connection|Receiving end does not exist|context invalidated|The message port closed|sendToTab timeout/i.test(message);
}

function isSignedXhsShareUrl(url = '') {
  const value = normalizeString(url);
  return Boolean(value && (/xsec_token=/i.test(value) || /xhslink\.com/i.test(value)));
}

function getTaskPlatformContentId(task = {}) {
  const payload = task?.payload && typeof task.payload === 'object' ? task.payload : {};
  return normalizeString(
    payload.platformContentId
      || payload.noteId
      || payload.contentId
      || extractDetailContentIdFromUrl(task.target),
  ).replace(/^(xhs_|dy_)/, '');
}

async function resolvePreferredTaskTarget(task = {}) {
  const platform = normalizeString(task.platform).toLowerCase();
  const target = normalizeString(task.target);
  const pageType = inferPageTypeFromTask(task);
  if (platform !== 'xhs' || pageType !== 'detail') return target;
  if (isSignedXhsShareUrl(target)) return target;
  if (shouldUseXhsProfileRelay(task)) {
    return buildCanonicalXhsProfileUrl(extractXhsProfileUserId(target)) || target;
  }

  const noteId = getTaskPlatformContentId(task);
  if (!noteId) return target;

  const existing = await noteStore.getById(noteId).catch(() => null);
  const candidates = [
    existing?.rawUrl,
    existing?.url,
    existing?.canonicalUrl,
    existing?.noteUrl,
    target,
  ];
  return candidates.find((candidate) => isSignedXhsShareUrl(candidate)) || buildCanonicalXhsDetailUrl(noteId) || target;
}

function inferPageTypeFromTask(task = {}) {
  const taskType = String(task.taskType || '').trim();
  const targetUrl = String(task.target || '').trim();
  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  const declaredTargetPageType = String(payload.targetPageType || '').trim();
  if (declaredTargetPageType === 'detail' || declaredTargetPageType === 'profile' || declaredTargetPageType === 'search') {
    return declaredTargetPageType;
  }
  if (taskType === 'douyin.singleComments' || taskType === 'douyin.commentImageDownload') {
    return 'detail';
  }
  if (taskType === 'xhs.collectAuthor' || taskType === 'douyin.collectAuthor') {
    return 'profile';
  }
  if (taskType === 'xhs.batchNotes' || taskType === 'douyin.batchNotes') {
    if (isXhsDetailUrl(targetUrl) || isDouyinDetailUrl(targetUrl)) {
      return 'detail';
    }
    if (/\/user\//i.test(targetUrl) || /\/user\/profile\//i.test(targetUrl)) {
      return 'profile';
    }
  }
  if (/\/user\//i.test(targetUrl) || /\/user\/profile\//i.test(targetUrl)) {
    return 'profile';
  }
  return 'search';
}

function shouldUseXhsProfileRelay(task = {}) {
  return (
    normalizeString(task?.platform).toLowerCase() === 'xhs'
    && normalizeString(task?.taskType) === 'xhs.batchNotes'
    && inferPageTypeFromTask(task) === 'detail'
    && getTaskStrategy(task) === 'detail_probe'
    && !isSignedXhsShareUrl(task?.target)
    && isXhsProfileRelayDetailUrl(task?.target)
  );
}

function inferDispatchPageTypeFromTask(task = {}) {
  if (shouldUseXhsProfileRelay(task)) {
    return 'profile';
  }
  return inferPageTypeFromTask(task);
}

function resolveRiskControlAccountId(activeTask = {}) {
  return String(activeTask?.accountId || '').trim();
}

function buildRiskControlActiveTaskPatch({ accountId = '', accountName = '', errorMessage = '' } = {}) {
  const normalizedAccountId = String(accountId || '').trim();
  const normalizedAccountName = String(accountName || '').trim();
  const message = String(
    errorMessage
    || (normalizedAccountId && normalizedAccountName
      ? `风控(300017)，已切换到账号"${normalizedAccountName}"，请恢复任务继续`
      : ''),
  ).trim();
  return {
    workbenchStatus: 'paused',
    accountId: normalizedAccountId,
    pendingAccountUsageId: normalizedAccountId,
    errorMessage: message,
  };
}

function normalizeWorkbenchTaskTarget(task = {}) {
  const targetUrl = String(task.target || '').trim();
  return {
    pageType: inferDispatchPageTypeFromTask(task),
    url: targetUrl,
  };
}

function buildBatchNotesDispatchMessage(msg = {}) {
  const { tabId: _tabId, ...forwarded } = msg || {};
  const externalTaskType = normalizeString(msg?.externalTaskMeta?.externalTaskType);
  const monitorMeta = msg?.monitorMeta || msg?.externalTaskMeta?.monitorMeta || null;
  const targetNoteId = normalizeString(msg?.targetNoteId || monitorMeta?.targetNoteId).replace(/^xhs_/, '');
  const isXhsRemoteDetail = externalTaskType === 'xhs.batchNotes' && String(msg?.mode || '').trim() === 'detail';

  if (isXhsRemoteDetail) {
    return {
      action: MSG.COLLECT_SINGLE_NOTE,
      triggerSource: forwarded.triggerSource,
      externalTaskMeta: forwarded.externalTaskMeta,
      monitorMeta,
      expectedNoteId: targetNoteId || undefined,
      asyncDispatch: true,
    };
  }

  return {
    ...forwarded,
    action: MSG.START_BATCH_NOTES,
    monitorMeta,
    targetNoteId: targetNoteId || undefined,
  };
}

function buildBatchCommentsDispatchMessage(msg = {}) {
  const { tabId: _tabId, ...forwarded } = msg || {};
  return {
    ...forwarded,
    action: MSG.START_BATCH_COMMENTS,
  };
}

function buildTaskEnvelopeFromCollectionTask(task = {}) {
  const payload = task.payload || {};
  const taskStrategy = String(task.taskStrategy || payload.taskStrategy || '').trim();
  return {
    type: 'task.envelope',
    protocolVersion: 'v1',
    taskId: String(task.id || '').trim(),
    taskType: String(task.taskType || '').trim(),
    platform: String(task.platform || '').trim(),
    taskStrategy,
    triggerSource: 'collection_task_poller',
    target: normalizeWorkbenchTaskTarget(task),
    payload: {
      ...payload,
      taskStrategy: payload.taskStrategy || taskStrategy || undefined,
    },
  };
}

export {
  buildBatchCommentsDispatchMessage,
  buildBatchNotesDispatchMessage,
  inferPageTypeFromTask,
  normalizeWorkbenchTaskTarget,
  resolveRiskControlAccountId,
  buildRiskControlActiveTaskPatch,
  resolvePreferredTaskTarget,
  scoreTaskTabCandidate,
  selectReachableTaskTab,
};

function normalizeWorkbenchTaskRegistryId(value = '') {
  return String(value || '').trim();
}

function getWorkbenchTaskContext(taskId = '') {
  const normalizedTaskId = normalizeWorkbenchTaskRegistryId(taskId);
  if (!normalizedTaskId) return null;

  const directMatch = workbenchTaskRegistry.get(normalizedTaskId);
  if (directMatch) return directMatch;

  for (const entry of workbenchTaskRegistry.values()) {
    if (!entry) continue;
    if (normalizeWorkbenchTaskRegistryId(entry.taskId) === normalizedTaskId) return entry;
    if (normalizeWorkbenchTaskRegistryId(entry.externalTaskId) === normalizedTaskId) return entry;
  }

  return null;
}

function setWorkbenchTaskContext(taskId = '', patch = {}) {
  const normalizedTaskId = normalizeWorkbenchTaskRegistryId(taskId);
  const normalizedExternalTaskId = normalizeWorkbenchTaskRegistryId(patch.externalTaskId || normalizedTaskId);
  const nextKey = normalizedExternalTaskId || normalizedTaskId;
  if (!nextKey) return null;

  const current = getWorkbenchTaskContext(nextKey) || getWorkbenchTaskContext(normalizedTaskId) || {};
  const currentKey = normalizeWorkbenchTaskRegistryId(current.externalTaskId || current.taskId);
  const next = {
    ...current,
    ...patch,
    taskId: normalizeWorkbenchTaskRegistryId(patch.taskId || current.taskId || normalizedTaskId || nextKey),
    externalTaskId: normalizeWorkbenchTaskRegistryId(
      patch.externalTaskId
      || current.externalTaskId
      || current.taskId
      || normalizedTaskId
      || nextKey,
    ),
    updatedAt: Number.isFinite(Number(patch.updatedAt)) ? Number(patch.updatedAt) : Date.now(),
  };

  if (currentKey && currentKey !== nextKey) {
    workbenchTaskRegistry.delete(currentKey);
  }
  workbenchTaskRegistry.set(nextKey, next);
  return next;
}

function clearWorkbenchTaskContext(taskId = '') {
  const normalizedTaskId = normalizeWorkbenchTaskRegistryId(taskId);
  if (!normalizedTaskId) return;
  if (workbenchTaskRegistry.delete(normalizedTaskId)) return;

  for (const [key, entry] of workbenchTaskRegistry.entries()) {
    if (normalizeWorkbenchTaskRegistryId(entry?.taskId) === normalizedTaskId) {
      workbenchTaskRegistry.delete(key);
      return;
    }
    if (normalizeWorkbenchTaskRegistryId(entry?.externalTaskId) === normalizedTaskId) {
      workbenchTaskRegistry.delete(key);
      return;
    }
  }
}

function getWorkbenchTaskTabId(taskId = '') {
  return getWorkbenchTaskContext(taskId)?.tabId || null;
}

function getPlatformTabQuery(task = {}) {
  return String(task.platform || '').trim() === 'douyin'
    ? ['https://www.douyin.com/*']
    : ['https://xiaohongshu.com/*', 'https://*.xiaohongshu.com/*', 'https://www.xiaohongshu.com/*'];
}

function scoreTaskTabCandidate(tab = {}, targetUrl = '') {
  const tabUrl = normalizeString(tab?.url);
  if (!tabUrl) return -1;
  if (targetUrl && tabUrl === targetUrl) return 100;
  if (targetUrl) {
    const targetContentId = extractDetailContentIdFromUrl(targetUrl);
    const tabContentId = extractDetailContentIdFromUrl(tabUrl);
    if (targetContentId && tabContentId && targetContentId === tabContentId) return 95;
  }
  if (targetUrl && tabUrl.startsWith(targetUrl)) return 90;
  if (targetUrl && targetUrl.startsWith(tabUrl)) return 80;
  if (tab.active) return 20;
  return 0;
}

async function selectReachableTaskTab(candidates = [], targetUrl = '', capabilityCheck = async () => ({ accepted: false })) {
  const rankedCandidates = [...(Array.isArray(candidates) ? candidates : [])]
    .filter((tab) => tab?.id)
    .sort((a, b) => scoreTaskTabCandidate(b, targetUrl) - scoreTaskTabCandidate(a, targetUrl));

  for (const tab of rankedCandidates) {
    try {
      const capability = await capabilityCheck(tab);
      if (capability?.accepted) {
        return tab;
      }
    } catch (error) {
      if (isRecoverableConnectionError(error)) {
        continue;
      }
      throw error;
    }
  }

  return null;
}

async function resolveTaskExecutionTabId(task = {}) {
  const taskId = String(task.id || '').trim();
  const cachedTabId = getWorkbenchTaskTabId(taskId);
  if (cachedTabId) return cachedTabId;

  const targetUrl = String(task.target || '').trim();
  if (!isUrlLike(targetUrl)) {
    return null;
  }

  const tabs = await chrome.tabs.query({ url: getPlatformTabQuery(task) });
  const mappedCapabilityTask = mapTaskEnvelopeToCapabilityCheck(buildTaskEnvelopeFromCollectionTask(task));
  const tab = await selectReachableTaskTab(tabs, targetUrl, async (candidate) => (
    bgHandlers[MSG.WORKBENCH_CAPABILITY_CHECK]({
      tabId: candidate.id,
      task: mappedCapabilityTask,
    }, {})
  ));
  if (tab?.id) {
    setWorkbenchTaskContext(taskId, {
      taskId,
      externalTaskId: taskId,
      tabId: tab.id,
      taskType: String(task.taskType || '').trim(),
      platform: String(task.platform || '').trim(),
    });
    return tab.id;
  }
  return null;
}

async function tryDownloadCandidate(url, filename, options = {}) {
  const {
    saveAs = false,
    conflictAction = 'uniquify',
    timeoutMs = 180000,
    headers = [],
    waitForCompletion = true,
  } = options;
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({
      url,
      filename,
      saveAs,
      conflictAction,
      headers,
    });
  } catch (err) {
    const msg = String(err?.message || err || '');
    // 兼容低版本 Chrome：不支持 headers 时自动降级
    if (!/headers|Unexpected property|Unsafe request header name/i.test(msg)) {
      throw err;
    }
    downloadId = await chrome.downloads.download({
      url,
      filename,
      saveAs,
      conflictAction,
    });
  }
  if (!downloadId && downloadId !== 0) {
    return { success: false, reason: 'download_id_empty' };
  }
  if (!waitForCompletion) {
    return { success: true, reason: 'queued', downloadId };
  }
  const result = await waitDownloadFinished(downloadId, timeoutMs);
  // 下载失败时自动清理浏览器下载栏中的失败条目，避免给用户看到多余的失败记录
  if (!result.success && downloadId) {
    try { await chrome.downloads.remove(downloadId); } catch {}
  }
  return { ...result, downloadId };
}

// ========== 消息路由 ==========

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = bgHandlers[message.action];
  if (handler) {
    Promise.resolve(handler(message, sender)).then((result) => {
      sendResponse(normalizeWorkbenchMessageResponse(message.action, result));
    }).catch(err => {
      sendResponse(normalizeWorkbenchMessageResponse(message.action, {
        success: false,
        error: err.message,
      }));
    });
    return true;
  }
});

function sendToTab(tabId, payload, options = {}) {
  return sendSharedToTab(tabId, payload, {
    timeoutMs: 10000,
    ...options,
  });
}

function getLatestWorkbenchRegistryEntry() {
  let latestEntry = null;
  for (const entry of workbenchTaskRegistry.values()) {
    if (!entry?.tabId) continue;
    if (!latestEntry || Number(entry.updatedAt || 0) > Number(latestEntry.updatedAt || 0)) {
      latestEntry = entry;
    }
  }
  return latestEntry;
}

function getTrackedWorkbenchControlTabId() {
  const activeTask = taskPoller?.getState?.().activeTask;
  const externalTaskId = String(activeTask?.externalTaskId || '').trim();
  if (externalTaskId) {
    const registryEntry = getWorkbenchTaskContext(externalTaskId);
    if (registryEntry?.tabId) return registryEntry.tabId;
  }
  return getLatestWorkbenchRegistryEntry()?.tabId || null;
}

function getActiveWorkbenchTaskForMessage(msg = {}, sender = {}) {
  const activeTask = taskPoller?.getState?.().activeTask || null;
  const externalTaskId = String(msg.externalTaskId || msg.taskId || '').trim();
  if (externalTaskId && activeTask?.externalTaskId === externalTaskId) return activeTask;
  if (externalTaskId && activeTask?.taskId === externalTaskId) return activeTask;
  const senderTabId = sender?.tab?.id;
  if (senderTabId) {
    for (const [registeredExternalTaskId, entry] of workbenchTaskRegistry.entries()) {
      if (entry?.tabId === senderTabId && activeTask?.externalTaskId === registeredExternalTaskId) {
        return activeTask;
      }
    }
  }
  return activeTask;
}

function getActivePluginRunId(activeTask = {}, msg = {}) {
  return String(msg.collectionRunId || activeTask?.pluginRunId || activeTask?.externalTaskId || activeTask?.taskId || '').trim();
}

function normalizeWorkbenchRecordType(value = '') {
  const normalized = String(value || '').trim();
  return Object.values(WORKBENCH_RECORD_TYPE).includes(normalized)
    ? normalized
    : WORKBENCH_RECORD_TYPE.NOTE;
}

function normalizeObjectRecord(value = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deriveExternalRecordId(recordType = WORKBENCH_RECORD_TYPE.NOTE, record = {}) {
  if (recordType === WORKBENCH_RECORD_TYPE.COMMENT) {
    return String(record.commentId || record.id || '').trim();
  }
  if (recordType === WORKBENCH_RECORD_TYPE.AUTHOR) {
    return String(record.authorId || record.userId || record.profileUrl || record.id || '').trim();
  }
  if (recordType === WORKBENCH_RECORD_TYPE.MEDIA) {
    return String(record.assetId || record.sourceUrl || record.localPath || record.id || '').trim();
  }
  return String(record.noteId || record.platformContentId || record.contentId || record.url || record.id || '').trim();
}

async function enqueueWorkbenchProgressEvent(message = {}, sender = {}) {
  const activeTask = getActiveWorkbenchTaskForMessage(message, sender);
  if (!activeTask) return;
  const progressEvent = normalizeProgressEvent(message.progressEvent || message);
  const pluginRunId = getActivePluginRunId(activeTask, message);
  if (!pluginRunId) return;
  await taskDeltaReporter.enqueueEvent({
    taskId: activeTask.taskId,
    pluginRunId,
    eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_PROGRESS,
    source: WORKBENCH_EVENT_SOURCE.CONTENT,
    sequence: progressEvent.heartbeatAt || Date.now(),
    payload: progressEvent,
    snapshot: {
      status: progressEvent.status,
      progress: progressEvent.total > 0
        ? Math.min(95, Math.round((progressEvent.current / progressEvent.total) * 100))
        : undefined,
      latestHeartbeatAt: new Date(progressEvent.heartbeatAt || Date.now()).toISOString(),
    },
  });
}

async function sendTaskControlToTab(preferredTabId, action) {
  const candidates = [];
  const normalizedPreferredTabId = Number.isFinite(Number(preferredTabId)) ? Number(preferredTabId) : null;
  if (normalizedPreferredTabId) {
    candidates.push(normalizedPreferredTabId);
  }
  const trackedTabId = getTrackedWorkbenchControlTabId();
  if (trackedTabId && !candidates.includes(trackedTabId)) {
    candidates.push(trackedTabId);
  }

  if (!candidates.length) {
    return { success: false, error: 'No tabId' };
  }

  let lastRecoverableError = '';
  for (const tabId of candidates) {
    const response = await sendToTab(tabId, { action }, { allowContextError: true });
    if (!response?.skipped) {
      return { success: true, tabId, response };
    }
    lastRecoverableError = String(response?.error || '').trim();
  }

  return {
    success: false,
    error: lastRecoverableError || 'no_control_target',
  };
}

async function clearBadge(tabId) {
  if (!tabId) return;
  await chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
}

async function handleRiskControl300017(activeTask) {
  const config = await getFlywheelConfig();
  const accountId = resolveRiskControlAccountId(activeTask);

  if (accountId) {
    await accountStore.markCooldown(accountId, 2 * 60 * 60 * 1000);
  }

  const nextAccount = await selectAvailableAccount('xhs');
  if (!nextAccount) {
    const errorMessage = '所有账号均已触发风控限制，请等待冷却或添加新账号';
    await patchCollectionTask(config, activeTask.taskId, {
      status: 'paused',
      errorMessage,
    });
    taskPoller?.updateActiveTask?.((current) => (
      current?.taskId === activeTask?.taskId
        ? {
            workbenchStatus: 'paused',
            pendingAccountUsageId: '',
            errorMessage,
          }
        : null
    ));
    return;
  }

  const result = await injectCookiesForAccount(nextAccount.cookieJson);
  if (!result.success) {
    const errorMessage = '切换账号 Cookie 注入失败';
    await patchCollectionTask(config, activeTask.taskId, {
      status: 'paused',
      errorMessage,
    });
    taskPoller?.updateActiveTask?.((current) => (
      current?.taskId === activeTask?.taskId
        ? {
            workbenchStatus: 'paused',
            pendingAccountUsageId: '',
            errorMessage,
          }
        : null
    ));
    return;
  }

  const activeTaskPatch = buildRiskControlActiveTaskPatch({
    accountId: nextAccount.accountId,
    accountName: nextAccount.name,
  });
  await patchCollectionTask(config, activeTask.taskId, {
    status: 'paused',
    errorMessage: activeTaskPatch.errorMessage,
  });
  taskPoller?.updateActiveTask?.((current) => (
    current?.taskId === activeTask?.taskId
      ? activeTaskPatch
      : null
  ));
}

const bgHandlers = {
  // 屏蔽媒体资源（批量采集加速）
  [MSG.BLOCK_MEDIA]: async () => {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [{
        id: 1,
        priority: 1,
        action: { type: 'block' },
        condition: {
          urlFilter: '*',
          resourceTypes: ['image', 'media'],
        },
      }],
      removeRuleIds: [1],
    });
    return { success: true };
  },

  // 恢复媒体资源
  [MSG.UNBLOCK_MEDIA]: async () => {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
    });
    return { success: true };
  },

  // 通过 Chrome Debugger 模拟 Esc 键（关闭笔记弹窗）
  [MSG.DISPATCH_ESC]: async (msg, sender) => {
    const tabId = sender.tab?.id || msg.tabId;
    if (!tabId) return { error: 'No tabId' };

    const target = { tabId };
    try {
      await chrome.debugger.attach(target, '1.3');
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
    } finally {
      await chrome.debugger.detach(target).catch(() => {});
    }
    return { success: true };
  },

  // 统一媒体下载能力：支持候选 URL 顺序重试 + 文件夹路径

  [MSG.FETCH_BINARY_AS_DATA_URL]: async (msg = {}) => {
    const candidates = dedupeCandidates(msg.candidates || msg.url || []);
    if (candidates.length === 0) {
      return { success: false, error: 'No candidate url' };
    }
    return fetchBinaryAsDataUrl(candidates);
  },

  [MSG.DOWNLOAD_MEDIA_FILE]: async (msg = {}, sender = {}) => {
    let candidates = dedupeCandidates(msg.candidates || msg.url || []);
    if (candidates.length === 0) {
      return { success: false, error: 'No candidate url' };
    }
    // 抖音 CDN 对多个候选会同时产生多条失败记录，且视频类通常第一个候选就是最佳质量
    const isDouyin = candidates.some((url) => /douyin/i.test(String(url || '')));
    if (isDouyin && candidates.length > 1) {
      candidates = candidates.slice(0, 1);
    }
    const filename = sanitizeDownloadFilename(msg.filename);
    const errors = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        const headers = buildDownloadHeaders(msg.headers || []);
        const result = await tryDownloadCandidate(candidate, filename, {
          saveAs: Boolean(msg.saveAs),
          conflictAction: msg.conflictAction || 'uniquify',
          timeoutMs: Number(msg.timeoutMs || 180000),
          headers,
          waitForCompletion: msg.waitForCompletion !== false,
        });
        if (result.success) {
          return {
            success: true,
            sourceUrl: candidate,
            candidateIndex: i,
            quality: i === 0 ? 'HD' : 'SD',
            downloadId: result.downloadId,
            filename,
            queued: result.reason === 'queued',
          };
        }
        errors.push(`${candidate} -> ${result.reason}`);
      } catch (err) {
        errors.push(`${candidate} -> ${String(err?.message || err)}`);
      }
    }

    return {
      success: false,
      error: 'all_candidates_failed',
      errors,
      filename,
    };
  },

  // 批量笔记采集（转发到 content script）
  [MSG.START_BATCH_NOTES]: async (msg, sender) => {
    const tabId = msg.tabId || sender.tab?.id;
    if (!tabId) return { error: 'No tabId' };
    chrome.action.setBadgeText({ text: '⏳', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#3498db', tabId });
    try {
      return await sendToTab(tabId, buildBatchNotesDispatchMessage(msg), {
        timeoutMs: msg?.asyncDispatch ? 12000 : 10000,
      });
    } catch (err) {
      await clearBadge(tabId);
      throw err;
    }
  },

  [MSG.STOP_BATCH_NOTES]: async (msg) => {
    const control = await sendTaskControlToTab(msg.tabId, MSG.STOP_BATCH_NOTES);
    if (!control?.success) {
      return { error: control?.error || 'No tabId' };
    }
    await clearBadge(control.tabId);
    return { success: true };
  },

  [MSG.PAUSE_BATCH_NOTES]: async (msg) => {
    const control = await sendTaskControlToTab(msg.tabId, MSG.PAUSE_BATCH_NOTES);
    if (!control?.success) {
      return { error: control?.error || 'No tabId' };
    }
    return { success: true };
  },

  [MSG.RESUME_BATCH_NOTES]: async (msg) => {
    const control = await sendTaskControlToTab(msg.tabId, MSG.RESUME_BATCH_NOTES);
    if (!control?.success) {
      return { error: control?.error || 'No tabId' };
    }
    return { success: true };
  },

  // 批量评论采集（转发到 content script）
  [MSG.START_BATCH_COMMENTS]: async (msg, sender) => {
    const tabId = msg.tabId || sender.tab?.id;
    if (!tabId) return { error: 'No tabId' };
    chrome.action.setBadgeText({ text: '评', tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId });
    try {
      return await sendToTab(tabId, buildBatchCommentsDispatchMessage(msg), {
        timeoutMs: msg?.asyncDispatch ? 12000 : 10000,
      });
    } catch (err) {
      await clearBadge(tabId);
      throw err;
    }
  },

  [MSG.STOP_BATCH_COMMENTS]: async (msg) => {
    const control = await sendTaskControlToTab(msg.tabId, MSG.STOP_BATCH_COMMENTS);
    if (!control?.success) {
      return { error: control?.error || 'No tabId' };
    }
    await clearBadge(control.tabId);
    return { success: true };
  },

  [MSG.PAUSE_BATCH_COMMENTS]: async (msg) => {
    const control = await sendTaskControlToTab(msg.tabId, MSG.PAUSE_BATCH_COMMENTS);
    if (!control?.success) {
      return { error: control?.error || 'No tabId' };
    }
    return { success: true };
  },

  [MSG.RESUME_BATCH_COMMENTS]: async (msg) => {
    const control = await sendTaskControlToTab(msg.tabId, MSG.RESUME_BATCH_COMMENTS);
    if (!control?.success) {
      return { error: control?.error || 'No tabId' };
    }
    return { success: true };
  },

  [MSG.TOGGLE_DASHBOARD]: async (msg) => {
    const control = await sendTaskControlToTab(msg.tabId, MSG.TOGGLE_DASHBOARD);
    if (!control?.success) {
      return { error: control?.error || 'No tabId' };
    }
    return { success: true };
  },

  // ========== 飞轮工作台同步 ==========

  [MSG.SYNC_TO_WORKBENCH]: async (msg) => {
    const { notes = [], comments = [], authors = [] } = msg;
    const totalItems = notes.length + comments.length + authors.length;
    if (totalItems === 0) {
      return { success: false, error: 'No items to sync' };
    }

    // 获取工作台配置
    const config = await getFlywheelConfig();
    const serverUrl = config?.serverUrl || 'http://localhost:3000';

    // 使用 Format B (plugin native format) 直接调用 API
    // 与 popup.js 的实现保持一致
    const url = serverUrl.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://');
    const resp = await fetch(`${url}/api/collect/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes, comments, authors }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: `Server returned ${resp.status}: ${text}` };
    }

    const data = await resp.json();
    return {
      success: true,
      imported: data.imported || 0,
      skipped: data.skipped || 0,
      meta: data.meta || {},
    };
  },

  [MSG.TEST_FLYWHEEL_CONNECTION]: async (msg) => {
    return testConnection(msg.serverUrl);
  },

  [MSG.GET_ACCOUNTS]: async () => {
    const accounts = await accountStore.getAll();
    return { success: true, accounts };
  },

  [MSG.ADD_ACCOUNT]: async (msg) => {
    const { name, cookieJson, platform, dailyQuotaLimit } = msg;
    try {
      const account = await accountStore.create({ name, cookieJson, platform, dailyQuotaLimit });
      return { success: true, account };
    } catch (error) {
      return { success: false, error: String(error?.message || error) };
    }
  },

  [MSG.REMOVE_ACCOUNT]: async (msg) => {
    await accountStore.remove(msg.accountId);
    return { success: true };
  },

  [MSG.UPDATE_ACCOUNT]: async (msg) => {
    const { accountId, ...patch } = msg;
    await accountStore.update(accountId, patch);
    return { success: true };
  },

  [MSG.GET_FLYWHEEL_CONFIG]: async () => {
    return getFlywheelConfig();
  },

  [MSG.SAVE_FLYWHEEL_CONFIG]: async (msg) => {
    await saveFlywheelConfig(msg.config);
    return { success: true };
  },

  [MSG.GET_EXECUTION_STATION_STATUS]: async () => {
    const identity = await executionStationClient.getStoredStationIdentity();
    const platformAccounts = await collectStationPlatformAccountsForIdentity(identity);
    return {
      success: true,
      registered: Boolean(identity?.stationId && identity?.stationToken),
      identity,
      capabilities: stationCapabilitiesForRole(normalizeStationRole(identity?.role)),
      platformAccounts,
    };
  },

  [MSG.REGISTER_EXECUTION_STATION]: async (msg = {}) => {
    const pairingCode = String(msg.pairingCode || '').trim();
    const serverUrl = String(msg.serverUrl || '').trim();
    if (serverUrl) {
      await saveFlywheelConfig({ serverUrl, enabled: true });
    }
    if (!pairingCode) {
      return { success: false, error: 'pairing_code_required' };
    }
    try {
      const identity = await executionStationClient.registerWithPairingCode({
        pairingCode,
        capabilities: stationCapabilitiesForRole(),
        pluginVersion: getPluginVersion(),
        browserLabel: String(msg.browserLabel || '').trim(),
      });
      const heartbeat = await sendExecutionStationHeartbeat('online');
      const platformAccounts = await collectStationPlatformAccountsForIdentity(identity);
      return {
        success: true,
        identity,
        heartbeat,
        platformAccounts,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error?.message || error || 'register_execution_station_failed'),
      };
    }
  },

  [MSG.SEND_EXECUTION_STATION_HEARTBEAT]: async () => sendExecutionStationHeartbeat('online'),

  // ========== Cookie 管理 ==========

  [MSG.GET_PLATFORM_COOKIES]: async () => {
    const platformConfig = {
      xhs: {
        domains: ['.xiaohongshu.com', 'xiaohongshu.com', 'www.xiaohongshu.com'],
        tabQueries: ['*://xiaohongshu.com/*', '*://*.xiaohongshu.com/*'],
        origin: 'https://www.xiaohongshu.com',
      },
      douyin: {
        domains: ['.douyin.com', 'www.douyin.com'],
        tabQueries: ['*://*.douyin.com/*'],
        origin: 'https://www.douyin.com',
      },
    };

    const collectUnique = (batch, seen, target) => {
      for (const c of batch) {
        const key = `${c.domain}|${c.name}`;
        if (!seen.has(key)) { seen.add(key); target.push(c); }
      }
    };

    const results = {};
    for (const [platform, config] of Object.entries(platformConfig)) {
      const seen = new Set();
      const allCookies = [];

      for (const domain of config.domains) {
        try {
          const batch = await chrome.cookies.getAll({ domain });
          collectUnique(batch, seen, allCookies);
        } catch {}
      }

      if (allCookies.length === 0) {
        try {
          const tabs = await chrome.tabs.query({ url: config.tabQueries });
          const activeTab = tabs.find(t => t.active) || tabs[0];
          if (activeTab?.id) {
            const response = await sendToTab(activeTab.id, {
              action: 'getDocumentCookie',
            }, { allowContextError: true, timeoutMs: 3000 });
            if (response?.cookieString) {
              const pairs = response.cookieString.split(';').map(s => s.trim()).filter(Boolean);
              for (const pair of pairs) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx < 0) continue;
                const name = pair.substring(0, eqIdx);
                const value = pair.substring(eqIdx + 1);
                const key = `${config.origin}|${name}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  allCookies.push({ name, value, domain: config.domains[0], path: '/', secure: true, httpOnly: false, sameSite: 'lax' });
                }
              }
            }
          }
        } catch {}
      }

      const cookieString = allCookies
        .filter(c => c.name && c.value)
        .map(c => `${c.name}=${c.value}`)
        .join('; ');
      results[platform] = {
        cookies: allCookies.map(c => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: c.secure, httpOnly: c.httpOnly || false, sameSite: c.sameSite || 'lax',
          ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
        })),
        cookieString,
        count: allCookies.length,
        capturedAt: new Date().toISOString(),
      };
    }
    await chrome.storage.local.set({ platformCookies: results });
    const success = Object.values(results).some((result) => Number(result?.count || 0) > 0);
    return { success, results };
  },

  [MSG.GET_STORED_PLATFORM_COOKIES]: async () => {
    const data = await chrome.storage.local.get('platformCookies');
    return { success: true, results: data.platformCookies || null };
  },

  [MSG.PROGRESS]: async (msg = {}, sender = {}) => {
    try {
      const progressEvent = normalizeProgressEvent(msg.progressEvent || msg);
      if (progressEvent.riskControlCode === '300017') {
        const activeTask = getActiveWorkbenchTaskForMessage(msg, sender);
        if (activeTask) {
          await handleRiskControl300017(activeTask);
        }
      }
      await enqueueWorkbenchProgressEvent(msg, sender);
    } catch (error) {
      console.warn('[灵感爆爆爆] 工作台进度增量写入失败:', error);
    }
    return { success: true };
  },

  [MSG.WORKBENCH_DELTA_FLUSH]: async () => {
    return taskDeltaReporter.flush();
  },

  [MSG.WORKBENCH_RECORD_DELTA]: async (msg = {}, sender = {}) => {
    const activeTask = getActiveWorkbenchTaskForMessage(msg, sender);
    if (!activeTask) {
      return { success: false, skipped: true, error: 'no_active_workbench_task' };
    }

    const recordType = normalizeWorkbenchRecordType(msg.recordType);
    const record = normalizeObjectRecord(msg.record || msg.payload);
    if (Object.keys(record).length === 0) {
      return { success: false, skipped: true, error: 'empty_record_payload' };
    }

    await taskDeltaReporter.enqueueRecord({
      taskId: activeTask.taskId,
      pluginRunId: getActivePluginRunId(activeTask, msg),
      recordType,
      externalRecordId: String(msg.externalRecordId || deriveExternalRecordId(recordType, record)).trim(),
      sequence: Number(msg.sequence || Date.now()),
      payload: record,
      collectedAt: String(msg.collectedAt || ''),
    });
    return { success: true };
  },

  [MSG.WORKBENCH_LOCAL_CONTROL_EVENT]: async (msg = {}, sender = {}) => {
    const activeTask = getActiveWorkbenchTaskForMessage(msg, sender);
    if (!activeTask) {
      return { success: false, skipped: true, error: 'no_active_workbench_task' };
    }
    const pluginRunId = getActivePluginRunId(activeTask, msg);
    const controlAction = String(msg.controlAction || '').trim();
    const status = String(msg.status || '').trim();
    const sequence = Date.now();
    const stateEventType = status === 'paused'
      ? WORKBENCH_TASK_EVENT_TYPE.TASK_PAUSED
      : status === 'running'
        ? WORKBENCH_TASK_EVENT_TYPE.TASK_RESUMED
        : status === 'stopped'
          ? WORKBENCH_TASK_EVENT_TYPE.TASK_STOPPED
          : WORKBENCH_TASK_EVENT_TYPE.TASK_STOPPING;

    await taskDeltaReporter.enqueueEvent({
      taskId: activeTask.taskId,
      pluginRunId,
      eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_CONTROL_APPLIED,
      source: WORKBENCH_EVENT_SOURCE.PLUGIN,
      sequence,
      payload: {
        origin: 'plugin_local',
        controlAction,
        status,
        message: String(msg.message || ''),
        occurredAt: msg.occurredAt || new Date(sequence).toISOString(),
      },
    });
    await taskDeltaReporter.enqueueEvent({
      taskId: activeTask.taskId,
      pluginRunId,
      eventType: stateEventType,
      source: WORKBENCH_EVENT_SOURCE.PLUGIN,
      sequence: sequence + 1,
      payload: {
        origin: 'plugin_local',
        controlAction,
        status,
        message: String(msg.message || ''),
        occurredAt: msg.occurredAt || new Date(sequence).toISOString(),
      },
      snapshot: {
        status,
        latestHeartbeatAt: new Date(sequence).toISOString(),
      },
    });
    return { success: true };
  },

  [MSG.WORKBENCH_CAPABILITY_CHECK]: async (msg = {}, sender = {}) => {
    const task = msg.task || {};
    const validation = validateCapabilityCheck(task);
    if (!validation.valid) {
      return {
        success: false,
        accepted: false,
        error: 'invalid_capability_check',
        validationErrors: validation.errors,
      };
    }

    const tabId = msg.tabId || sender.tab?.id;
    if (!tabId) {
      return { success: false, accepted: false, error: 'No tabId' };
    }

    const response = await sendToTab(tabId, { action: MSG.GET_PAGE_CONTEXT }, {
      allowContextError: false,
      timeoutMs: 4000,
    });
    const report = response?.context || null;
    const decision = canDispatchTaskFromCapabilityReport(report, task.taskType, task.target);
    return {
      success: true,
      accepted: decision.accepted,
      report,
      reasonCode: decision.reasonCode,
      reasonMessage: decision.reasonMessage,
    };
  },

  [MSG.WORKBENCH_DISPATCH_TASK]: async (msg = {}, sender = {}) => {
    const task = msg.task || {};
    const validation = validateTaskEnvelope(task);
    if (!validation.valid) {
      return {
        success: false,
        accepted: false,
        error: 'invalid_task_envelope',
        validationErrors: validation.errors,
      };
    }

    const tabId = msg.tabId || sender.tab?.id;
    if (!tabId) {
      return { success: false, accepted: false, error: 'No tabId' };
    }

    const capabilityResponse = await bgHandlers[MSG.WORKBENCH_CAPABILITY_CHECK]({
      task: mapTaskEnvelopeToCapabilityCheck(task),
      tabId,
    }, sender);
    if (!capabilityResponse?.accepted) {
      return capabilityResponse;
    }

    const internalCommand = mapTaskEnvelopeToInternalCommand(task, { tabId });
    let dispatchResponse = null;
    if (internalCommand.dispatchTarget === 'background') {
      dispatchResponse = await bgHandlers[internalCommand.action]({
        ...internalCommand.payload,
        tabId,
      }, sender);
    } else {
      dispatchResponse = await sendToTab(tabId, {
        action: internalCommand.action,
        ...internalCommand.payload,
      }, {
        timeoutMs: internalCommand.payload?.asyncDispatch ? 12000 : 10000,
      });
    }

    if (dispatchResponse?.accepted === false || dispatchResponse?.success === false) {
      return {
        success: false,
        accepted: false,
        error: String(dispatchResponse?.error || 'dispatch_not_accepted'),
        dispatchAction: internalCommand.action,
        dispatchTarget: internalCommand.dispatchTarget,
        capabilityReport: capabilityResponse.report,
      };
    }

    const collectionRunId = normalizeString(
      dispatchResponse?.collectionRunId || dispatchResponse?.resultLookup?.collectionRunId,
    );
    setWorkbenchTaskContext(internalCommand.taskMeta.externalTaskId, {
      taskId: internalCommand.taskMeta.externalTaskId,
      externalTaskId: internalCommand.taskMeta.externalTaskId,
      collectionRunId,
      tabId,
      taskType: internalCommand.taskMeta.externalTaskType,
      platform: String(task.platform || '').trim(),
      updatedAt: Date.now(),
    });

    return {
      success: true,
      accepted: true,
      taskId: internalCommand.taskMeta.externalTaskId,
      taskType: internalCommand.taskMeta.externalTaskType,
      dispatchAction: internalCommand.action,
      dispatchTarget: internalCommand.dispatchTarget,
      capabilityReport: capabilityResponse.report,
      pending: Boolean(dispatchResponse?.pending),
      collectionRunId: collectionRunId || undefined,
      resultLookup: {
        externalTaskId: internalCommand.taskMeta.externalTaskId,
        collectionRunId: collectionRunId || undefined,
      },
    };
  },

  [MSG.WORKBENCH_TASK_CONTROL]: async (msg = {}, sender = {}) => {
    const taskControl = msg.taskControl || {};
    const validation = validateTaskControl(taskControl);
    if (!validation.valid) {
      return {
        success: false,
        accepted: false,
        error: 'invalid_task_control',
        validationErrors: validation.errors,
      };
    }

    const tabId = msg.tabId || sender.tab?.id;
    if (!tabId) {
      return { success: false, accepted: false, error: 'No tabId' };
    }

    const internalCommand = mapTaskControlToInternalCommand(taskControl, { tabId });
    if (internalCommand.dispatchTarget === 'background') {
      await bgHandlers[internalCommand.action]({
        ...internalCommand.payload,
        tabId,
      }, sender);
    } else {
      await sendToTab(tabId, {
        action: internalCommand.action,
        ...internalCommand.payload,
      }, { allowContextError: true });
    }

    return {
      success: true,
      accepted: true,
      taskId: internalCommand.taskMeta.externalTaskId,
      taskType: internalCommand.taskMeta.externalTaskType,
      controlAction: internalCommand.taskMeta.controlAction,
      dispatchAction: internalCommand.action,
    };
  },

  [MSG.WORKBENCH_GET_RESULT_PACKAGE]: async (msg = {}) => {
    const externalTaskId = String(msg.externalTaskId || '').trim();
    const registryCollectionRunId = String(
      msg.collectionRunId
      || getWorkbenchTaskContext(externalTaskId)?.collectionRunId
      || '',
    ).trim();
    const collectionRunId = registryCollectionRunId;
    if (!collectionRunId && !externalTaskId) {
      return { success: false, error: 'collectionRunId or externalTaskId required' };
    }
    const tabId = msg.tabId || getWorkbenchTaskTabId(externalTaskId);
    if (tabId) {
      try {
        const response = await sendToTab(tabId, {
          action: MSG.WORKBENCH_GET_RESULT_PACKAGE,
          collectionRunId,
          externalTaskId,
        }, {
          allowContextError: false,
          timeoutMs: 4000,
        });
        return response;
      } catch (error) {
        const errMsg = String(error?.message || error || 'tab_result_lookup_failed');
        console.warn('[灵感爆爆爆] getResultPackage sendToTab 失败，回退到本地读取:', errMsg);
        if (/Could not establish connection|Receiving end does not exist/i.test(errMsg)) {
          chrome.tabs.update(tabId, { active: true }).catch(() => {});
        }
        // fallthrough to local packager
      }
    }
    try {
      const result = collectionRunId
        ? await resultPackager.packageByCollectionRunId(collectionRunId)
        : await resultPackager.packageByExternalTaskId(externalTaskId);
      return {
        success: true,
        result,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error?.message || error || 'result_lookup_failed'),
      };
    }
  },
};

function shouldPollWorkbenchTasks(config = {}) {
  return Boolean(String(config?.serverUrl || '').trim()) && config?.enabled !== false;
}

function getPluginVersion() {
  try {
    return chrome.runtime?.getManifest?.()?.version || '';
  } catch {
    return '';
  }
}

const executionStationClient = createExecutionStationClient({
  storageArea: chrome.storage?.local,
  resolveServerUrl: async () => {
    const config = await getFlywheelConfig();
    return config?.serverUrl || '';
  },
});
const taskLeaseStore = createTaskLeaseStorageStore({
  storageArea: chrome.storage?.local,
});

function normalizeStationRole(value = '') {
  return String(value || '').trim() === 'manual' ? 'manual' : 'monitor';
}

function stationCapabilitiesForRole() {
  return MONITOR_STATION_CAPABILITIES;
}

async function collectStationPlatformAccountsForIdentity(identity = null) {
  const role = normalizeStationRole(identity?.role);
  return collectStationPlatformAccounts(accountStore, { purpose: role });
}

async function sendExecutionStationHeartbeat(status = 'online') {
  const config = await getFlywheelConfig();
  if (!shouldPollWorkbenchTasks(config)) {
    return { success: false, retryable: false, reason: 'workbench_not_configured' };
  }
  const identity = await executionStationClient.getStoredStationIdentity();
  const platformAccounts = await collectStationPlatformAccountsForIdentity(identity);
  return executionStationClient.sendHeartbeat({
    status,
    capabilities: stationCapabilitiesForRole(normalizeStationRole(identity?.role)),
    pluginVersion: getPluginVersion(),
    platformAccounts,
  });
}

const taskDeltaReporter = createTaskDeltaReporter({
  store: workbenchOutboxStore,
  ingestCollectionTaskDelta,
  getFlywheelConfig,
  shouldPollWorkbenchTasks,
  getExecutorInstanceId: getPersistentExecutorInstanceId,
});

const taskPoller = createTaskPoller({
  beforeDispatch: async (task) => {
    const platform = String(task.platform || '').trim();
    if (platform !== 'xhs') return { shouldPause: false };
    const account = await selectAvailableAccount(platform);
    if (!account) {
      return { shouldPause: true, reason: 'no_available_account' };
    }
    const result = await injectCookiesForAccount(account.cookieJson);
    if (!result.success) {
      return { shouldPause: true, reason: 'cookie_injection_failed' };
    }
    return { shouldPause: false, accountId: account.accountId };
  },
  afterDispatchSuccess: async (task, preCheck = {}) => {
    const platform = String(task?.platform || '').trim();
    const accountId = String(preCheck?.accountId || '').trim();
    if (platform !== 'xhs' || !accountId) return;
    await accountStore.updateUsage(accountId);
  },
  consumePendingAccountUsage: async (accountId) => {
    const normalizedAccountId = String(accountId || '').trim();
    if (!normalizedAccountId) return;
    await accountStore.updateUsage(normalizedAccountId);
  },
  fetchPendingTasks: async () => {
    const config = await getFlywheelConfig();
    if (!shouldPollWorkbenchTasks(config)) return [];
    return fetchPendingCollectionTasks(config, { limit: 5 });
  },
  fetchTrackableTasks: async () => {
    const config = await getFlywheelConfig();
    if (!shouldPollWorkbenchTasks(config)) return [];
    return fetchTrackableCollectionTasks(config, { limit: 5 });
  },
  claimTaskLease: async () => {
    const config = await getFlywheelConfig();
    if (!shouldPollWorkbenchTasks(config)) return { task: null, nextPollAfterMs: 0 };
    const identity = await executionStationClient.getStoredStationIdentity();
    if (!identity?.stationId || !identity?.stationToken) {
      return { task: null, fallbackToPending: true };
    }
    const role = normalizeStationRole(identity?.role);
    const platformAccounts = await collectStationPlatformAccountsForIdentity(identity);
    return claimCollectionTaskLease({
      serverUrl: config.serverUrl,
      stationId: identity.stationId,
      stationToken: identity.stationToken,
      capabilities: stationCapabilitiesForRole(role),
      platformAccounts,
      store: taskLeaseStore,
    });
  },
  renewTaskLease: async (taskId, lease = {}, options = {}) => {
    const config = await getFlywheelConfig();
    const identity = await executionStationClient.getStoredStationIdentity();
    if (!shouldPollWorkbenchTasks(config) || !identity?.stationId || !identity?.stationToken) {
      return { success: false, skipped: true, reason: 'station_not_registered' };
    }
    return renewCollectionTaskLease({
      serverUrl: config.serverUrl,
      taskId,
      stationId: identity.stationId,
      stationToken: identity.stationToken,
      leaseToken: lease.leaseToken,
      status: options?.status || 'running',
      store: taskLeaseStore,
    });
  },
  readTaskLease: () => taskLeaseStore.read(),
  clearTaskLease: () => taskLeaseStore.clear(),
  patchTask: async (taskId, patch) => {
    const config = await getFlywheelConfig();
    if (!shouldPollWorkbenchTasks(config)) return null;
    return patchCollectionTask(config, taskId, patch);
  },
  fetchControlRequests: async (taskId, options) => {
    const config = await getFlywheelConfig();
    if (!shouldPollWorkbenchTasks(config)) return { success: true, controls: [], nextCursor: '' };
    return fetchCollectionTaskControlRequests(config, taskId, options);
  },
  applyTaskControl: async (control = {}) => {
    const taskId = String(control.taskId || '').trim();
    const tabId = getWorkbenchTaskTabId(taskId)
      || getTrackedWorkbenchControlTabId();
    return bgHandlers[MSG.WORKBENCH_TASK_CONTROL]({
      tabId,
      taskControl: {
        type: WORKBENCH_MESSAGE_TYPE.TASK_CONTROL,
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        taskId,
        taskType: String(control.taskType || '').trim(),
        action: String(control.action || '').trim(),
      },
    }, {});
  },
  enqueueEvent: async (event) => taskDeltaReporter.enqueueEvent(event),
  enqueueRecords: async (records) => taskDeltaReporter.enqueueRecords(records),
  flushDeltas: async () => taskDeltaReporter.flush(),
  getExecutorInstanceId: getPersistentExecutorInstanceId,
  capabilityCheck: async (task) => {
    const preferredTarget = await resolvePreferredTaskTarget(task);
    const preparedTask = preferredTarget && preferredTarget !== String(task?.target || '').trim()
      ? { ...task, target: preferredTarget }
      : task;

    const tabId = await resolveTaskExecutionTabId(preparedTask);
    if (tabId) {
      return bgHandlers[MSG.WORKBENCH_CAPABILITY_CHECK]({
        tabId,
        task: mapTaskEnvelopeToCapabilityCheck(buildTaskEnvelopeFromCollectionTask(preparedTask)),
      }, {});
    }

    const taskType = String(preparedTask.taskType || '').trim();
    const target = String(preparedTask.target || '').trim();
    const taskId = String(preparedTask.id || '').trim();
    const navResult = await navigateToTask(taskType, target, preparedTask.payload || {});
    if (!navResult.tabId) {
      return { success: false, accepted: false, error: navResult.error || 'no_matching_tab' };
    }

    setWorkbenchTaskContext(taskId, {
      taskId,
      externalTaskId: taskId,
      tabId: navResult.tabId,
      taskType,
      platform: String(task.platform || '').trim(),
    });
    navigatedTabs.set(taskId, navResult.tabId);

    const result = await bgHandlers[MSG.WORKBENCH_CAPABILITY_CHECK]({
      tabId: navResult.tabId,
      task: mapTaskEnvelopeToCapabilityCheck(buildTaskEnvelopeFromCollectionTask(preparedTask)),
    }, {});

    if (!result?.accepted) {
      await closeTab(navResult.tabId);
      navigatedTabs.delete(taskId);
      clearWorkbenchTaskContext(taskId);
    }

    return result;
  },
  dispatchTask: async (task) => {
    const preferredTarget = await resolvePreferredTaskTarget(task);
    const preparedTask = preferredTarget && preferredTarget !== String(task?.target || '').trim()
      ? { ...task, target: preferredTarget }
      : task;
    const tabId = await resolveTaskExecutionTabId(preparedTask);
    if (!tabId) {
      return { success: false, accepted: false, error: 'no_matching_tab' };
    }
    const response = await bgHandlers[MSG.WORKBENCH_DISPATCH_TASK]({
      tabId,
      task: buildTaskEnvelopeFromCollectionTask(preparedTask),
    }, {});
    return response;
  },
  getResultPackage: async (lookup = {}) => {
    const normalizedLookup = lookup && typeof lookup === 'object'
      ? lookup
      : { externalTaskId: lookup };
    return bgHandlers[MSG.WORKBENCH_GET_RESULT_PACKAGE](normalizedLookup);
  },
});

async function runWorkbenchTaskPollTick() {
  const prevActiveTask = taskPoller?.getState?.()?.activeTask;
  try {
    const result = await taskPoller.tick();
    await taskDeltaReporter.flush();

    if (result?.idle) {
      consecutiveEmptyPolls++;
    } else {
      consecutiveEmptyPolls = 0;
    }

    scheduleWorkbenchTaskPollAlarm({
      alarmsApi: chrome.alarms,
      alarmName: WORKBENCH_TASK_POLL_ALARM,
      result,
      consecutiveEmptyPolls,
    });
  } catch (error) {
    console.error('[灵感爆爆爆] workbench task poll tick failed', error);
  }

  const currentActiveTask = taskPoller?.getState?.()?.activeTask;
  if (prevActiveTask && !currentActiveTask) {
    const registryTaskId = String(prevActiveTask.externalTaskId || prevActiveTask.taskId || '').trim();
    const navigationTaskId = String(prevActiveTask.taskId || registryTaskId).trim();
    clearWorkbenchTaskContext(registryTaskId);
    const navigatedTabId = navigatedTabs.get(navigationTaskId);
    if (navigatedTabId) {
      await closeTab(navigatedTabId);
      navigatedTabs.delete(navigationTaskId);
    }
  }
}

async function runExecutionStationHeartbeatTick() {
  try {
    await sendExecutionStationHeartbeat('online');
  } catch (error) {
    console.warn('[灵感爆爆爆] execution station heartbeat failed', error);
    return;
  }
  await runWorkbenchTaskPollTick();
}

// ========== 采集完成时清除 badge ==========

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === MSG.COLLECT_DONE && sender.tab?.id) {
    chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
  }
});

if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name === WORKBENCH_TASK_POLL_ALARM) {
      void runWorkbenchTaskPollTick();
      return;
    }
    if (alarm?.name === WORKBENCH_STATION_HEARTBEAT_ALARM) {
      void runExecutionStationHeartbeatTick();
      return;
    }
    if (alarm?.name === 'daily-quota-reset') {
      void accountStore.resetDailyQuota();
      return;
    }
  });
}

chrome.runtime.onStartup?.addListener(() => {
  chrome.alarms?.create(WORKBENCH_TASK_POLL_ALARM, { periodInMinutes: INITIAL_WORKBENCH_TASK_POLL_MINUTES });
  chrome.alarms?.create(WORKBENCH_STATION_HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void runWorkbenchTaskPollTick();
  void runExecutionStationHeartbeatTick();
});

chrome.runtime.onInstalled?.addListener(() => {
  chrome.alarms?.create(WORKBENCH_TASK_POLL_ALARM, { periodInMinutes: INITIAL_WORKBENCH_TASK_POLL_MINUTES });
  chrome.alarms?.create(WORKBENCH_STATION_HEARTBEAT_ALARM, { periodInMinutes: 1 });
  void taskDeltaReporter.flush();
  void runExecutionStationHeartbeatTick();
});

chrome.alarms?.create(WORKBENCH_TASK_POLL_ALARM, { periodInMinutes: INITIAL_WORKBENCH_TASK_POLL_MINUTES });
chrome.alarms?.create(WORKBENCH_STATION_HEARTBEAT_ALARM, { periodInMinutes: 1 });
void runWorkbenchTaskPollTick();
void runExecutionStationHeartbeatTick();

// 每日配额清零（每小时检查一次日期变化）
chrome.alarms?.create('daily-quota-reset', { periodInMinutes: 60 });

console.log('[灵感爆爆爆] Background Service Worker 已启动');
