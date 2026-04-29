import {
  REMOTE_TASK_CONTROL_ACTION,
  WORKBENCH_EVENT_SOURCE,
  WORKBENCH_RECORD_TYPE,
  WORKBENCH_TASK_EVENT_TYPE,
} from '../protocol/schema.js';
import { createTaskLeaseIdleSnapshot } from './taskLeaseClient.js';

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try {
    return structuredClone(obj);
  } catch {
    return JSON.parse(JSON.stringify(obj));
  }
}

function buildStartupPatch({ pluginRunId = '', activeExecutor = '' } = {}) {
  const normalizedRunId = String(pluginRunId || '').trim();
  return {
    status: normalizedRunId ? 'running' : 'dispatched',
    progress: normalizedRunId ? 10 : 5,
    pluginRunId: normalizedRunId || null,
    activeExecutor: String(activeExecutor || '').trim() || null,
    latestHeartbeatAt: new Date().toISOString(),
    errorMessage: null,
  };
}

const TRACKED_TASK_STALE_MS = 10 * 60 * 1000;
const DISPATCH_STARTUP_TIMEOUT_MS = 45 * 1000;

function isRecoverableConnectionError(error) {
  const msg = String(error?.message || error || '');
  return /Could not establish connection|Receiving end does not exist|context invalidated|The message port closed|sendToTab timeout/i.test(msg);
}

function isMonitorTask(task = {}) {
  const source = String(task?.source || '').trim();
  const strategy = String(task?.taskStrategy || task?.payload?.taskStrategy || '').trim();
  return (
    source === 'monitor' ||
    Boolean(task?.payload?.monitorId) ||
    strategy === 'author_baseline' ||
    strategy === 'author_patrol' ||
    strategy === 'keyword_patrol' ||
    strategy === 'detail_probe' ||
    strategy === 'deep_collect'
  );
}

function recoverableConnectionStatusForTask(task = {}) {
  return isMonitorTask(task)
    ? {
        status: 'failed',
        progress: 100,
        eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_FAILED,
        message: '页面连接中断，本轮监控已结束，后续会自动重试',
      }
    : {
        status: 'paused',
        progress: 5,
        eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_PAUSED,
        message: '页面连接中断，已自动暂停，请点击恢复继续',
      };
}

function parseTimestamp(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTrackableTaskStale(task = {}, now = Date.now()) {
  const activeExecutor = String(task?.activeExecutor || task?.executorInstanceId || '').trim();
  const latestHeartbeatAt = parseTimestamp(task?.latestHeartbeatAt);
  if (latestHeartbeatAt > 0) {
    return now - latestHeartbeatAt > TRACKED_TASK_STALE_MS;
  }

  const lastActivityAt = parseTimestamp(task?.updatedAt)
    || parseTimestamp(task?.dispatchedAt)
    || parseTimestamp(task?.startedAt)
    || parseTimestamp(task?.createdAt);
  if (!lastActivityAt) return false;
  return !activeExecutor && now - lastActivityAt > TRACKED_TASK_STALE_MS;
}

function buildRunningProgress(run = {}) {
  const planned = Number(run?.resultSummary?.itemsPlanned || 0);
  const succeeded = Number(run?.resultSummary?.itemsSucceeded || 0);
  const failed = Number(run?.resultSummary?.failedItems || 0);
  if (planned > 0) {
    const ratio = Math.min(0.95, Math.max(0.1, (succeeded + failed) / planned));
    return Math.round(ratio * 100);
  }
  return 50;
}

function mapRunStatusToWorkbenchStatus(status = '') {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'done') return { status: 'completed', final: true, progress: 100 };
  if (normalized === 'stopped') return { status: 'stopped', final: true, progress: null };
  if (normalized === 'failed' || normalized === 'canceled' || normalized === 'rejected') {
    return { status: 'failed', final: true, progress: 100 };
  }
  if (normalized === 'paused') {
    return { status: 'paused', final: false, progress: null };
  }
  if (normalized === 'running' || normalized === 'accepted' || normalized === 'stopping') {
    return { status: 'running', final: false, progress: null };
  }
  return { status: 'dispatched', final: false, progress: 5 };
}

function mapWorkbenchStatusToEventType(status = '') {
  switch (String(status || '').trim()) {
    case 'completed':
      return WORKBENCH_TASK_EVENT_TYPE.TASK_COMPLETED;
    case 'stopped':
      return WORKBENCH_TASK_EVENT_TYPE.TASK_STOPPED;
    case 'failed':
      return WORKBENCH_TASK_EVENT_TYPE.TASK_FAILED;
    case 'paused':
      return WORKBENCH_TASK_EVENT_TYPE.TASK_PAUSED;
    case 'running':
      return WORKBENCH_TASK_EVENT_TYPE.TASK_PROGRESS;
    default:
      return WORKBENCH_TASK_EVENT_TYPE.TASK_HEARTBEAT;
  }
}

function mapControlActionToStateEvent(action = '') {
  switch (String(action || '').trim()) {
    case REMOTE_TASK_CONTROL_ACTION.PAUSE:
      return WORKBENCH_TASK_EVENT_TYPE.TASK_PAUSED;
    case REMOTE_TASK_CONTROL_ACTION.RESUME:
      return WORKBENCH_TASK_EVENT_TYPE.TASK_RESUMED;
    case REMOTE_TASK_CONTROL_ACTION.STOP:
    case REMOTE_TASK_CONTROL_ACTION.DELETE:
      return WORKBENCH_TASK_EVENT_TYPE.TASK_STOPPING;
    default:
      return WORKBENCH_TASK_EVENT_TYPE.TASK_HEARTBEAT;
  }
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function firstText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function pickMediaUrlFromArray(value) {
  if (!Array.isArray(value)) return '';

  for (const item of value) {
    const direct = firstText(item);
    if (direct) return direct;

    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = firstText(item.urlDefault) || firstText(item.url) || firstText(item.src);
      if (nested) return nested;
    }
  }

  return '';
}

function sanitizeNoteRecord(note = {}) {
  const images = Array.isArray(note.images) ? note.images.filter(Boolean) : [];
  const imageCandidates = Array.isArray(note.imageCandidates) ? note.imageCandidates.filter(Boolean) : [];
  const cover = firstText(note.cover)
    || firstText(note.coverImg)
    || firstText(note.coverUrl)
    || firstText(note.thumbnail)
    || pickMediaUrlFromArray(images);
  const url = String(note.url || note.noteUrl || '').trim();
  const canonicalUrl = String(note.canonicalUrl || url).trim();
  const rawUrl = String(note.rawUrl || canonicalUrl || url).trim();

  return {
    platform: String(note.platform || '').trim(),
    noteId: String(note.noteId || note.platformContentId || note.contentId || '').trim(),
    platformContentId: String(note.platformContentId || note.noteId || note.contentId || '').trim(),
    title: String(note.title || '').trim(),
    content: String(note.content || note.desc || note.bodyText || '').trim(),
    url,
    canonicalUrl,
    rawUrl,
    rawShareText: firstText(note.rawShareText),
    cover,
    coverImg: firstText(note.coverImg) || cover,
    coverUrl: firstText(note.coverUrl) || cover,
    images,
    imageCandidates,
    videoUrl: firstText(note.videoUrl) || firstText(note.video) || firstText(note.videoDownloadUrl) || firstText(note.videoPlayUrl),
    likes: toFiniteNumber(note.likes, 0),
    collects: toFiniteNumber(note.collects, 0),
    comments: toFiniteNumber(note.comments, 0),
    shares: toFiniteNumber(note.shares, 0),
    authorId: String(note.authorId || note.authorPlatformId || note.userId || '').trim(),
    authorPlatformId: String(note.authorPlatformId || note.authorId || note.userId || '').trim(),
    authorEntityId: String(note.authorEntityId || '').trim(),
    authorName: String(note.authorName || note.author || '').trim(),
    authorAvatar: firstText(note.authorAvatar) || firstText(note.avatar),
    publishedAt: note.publishedAt ?? note.publishTime ?? note.releaseDate ?? null,
    publishedAtText:
      firstText(note.publishedAtText)
      || firstText(note.publishTimeText)
      || firstText(note.releaseDateText)
      || firstText(note.releaseDate)
      || firstText(note.timeText)
      || firstText(note.time),
    type: String(note.type || note.contentType || note.noteType || note.itemType || '').trim(),
    lastUpdateTime: note.lastUpdateTime ?? null,
    collectionRunId: String(note.collectionRunId || '').trim(),
    monitorMode: String(note.monitorMode || '').trim(),
    monitorId: String(note.monitorId || note.monitorMeta?.monitorId || '').trim(),
    taskStrategy: String(note.taskStrategy || note.monitorMeta?.taskStrategy || '').trim(),
    monitorMeta: note.monitorMeta && typeof note.monitorMeta === 'object' && !Array.isArray(note.monitorMeta)
      ? { ...note.monitorMeta }
      : {},
  };
}

function sanitizeCommentRecord(comment = {}) {
  return {
    commentId: String(comment.commentId || comment.id || '').trim(),
    noteId: String(comment.noteId || comment.contentId || comment.rootNoteId || '').trim(),
    text: String(comment.text || comment.content || comment.comment || '').trim(),
    author: String(comment.author || comment.authorName || comment.userName || '').trim(),
    authorId: String(comment.authorId || comment.userId || '').trim(),
    likes: toFiniteNumber(comment.likes, 0),
    level: toFiniteNumber(comment.level, 1) || 1,
    url: String(comment.url || '').trim(),
  };
}

function sanitizeAuthorRecord(author = {}) {
  const authorId = String(author.authorId || author.platformAuthorId || author.authorPlatformId || author.userId || author.id || '').trim();
  const platformAuthorId = String(author.platformAuthorId || author.authorPlatformId || authorId).trim();
  const description = String(author.description || author.bio || author.signature || '').trim();
  const fans = toFiniteNumber(author.fans ?? author.followers ?? author.followerCount, 0);
  const follows = toFiniteNumber(author.follows ?? author.following ?? author.followingCount, 0);
  const interactions = toFiniteNumber(
    author.interactions ?? author.likesAndCollects ?? author.likedCount ?? author.totalLiked,
    0,
  );
  const works = toFiniteNumber(author.works ?? author.workCount ?? author.notes ?? author.noteCount, 0);
  const notes = toFiniteNumber(author.notes ?? author.noteCount ?? author.works ?? author.workCount, 0);
  return {
    authorId,
    platformAuthorId,
    authorEntityId: String(author.authorEntityId || '').trim(),
    userId: String(author.userId || '').trim(),
    platform: String(author.platform || '').trim(),
    name: String(author.name || author.authorName || author.nickname || '').trim(),
    profileUrl: String(author.profileUrl || author.url || '').trim(),
    avatar: firstText(author.avatar) || firstText(author.avatarUrl) || firstText(author.image),
    description,
    bio: description,
    ipLocation: String(author.ipLocation || '').trim(),
    location: String(author.location || '').trim(),
    handle: String(author.handle || author.redId || author.douyinId || '').trim(),
    redId: String(author.redId || '').trim(),
    douyinId: String(author.douyinId || '').trim(),
    fans,
    followers: fans,
    follows,
    following: follows,
    interactions,
    likesAndCollects: interactions,
    works,
    notes,
    monitorMode: String(author.monitorMode || '').trim(),
    monitorId: String(author.monitorId || author.monitorMeta?.monitorId || '').trim(),
    taskStrategy: String(author.taskStrategy || author.monitorMeta?.taskStrategy || '').trim(),
    monitorMeta: author.monitorMeta && typeof author.monitorMeta === 'object' && !Array.isArray(author.monitorMeta)
      ? { ...author.monitorMeta }
      : {},
  };
}

function sanitizeMediaAssetRecord(asset = {}) {
  return {
    assetId: String(asset.assetId || asset.id || '').trim(),
    sourceUrl: String(asset.sourceUrl || asset.url || '').trim(),
    localPath: String(asset.localPath || '').trim(),
    status: String(asset.status || '').trim(),
    noteId: String(asset.noteId || asset.contentId || '').trim(),
    commentId: String(asset.commentId || '').trim(),
  };
}

function buildWorkbenchResultSummary(run = {}) {
  const records = run?.records || {};
  const notes = Array.isArray(records.notes)
    ? records.notes.map(sanitizeNoteRecord).filter((note) => note.noteId || note.title || note.content)
    : [];
  const comments = Array.isArray(records.comments)
    ? records.comments.map(sanitizeCommentRecord).filter((comment) => comment.commentId || comment.text)
    : [];
  const authors = Array.isArray(records.authors)
    ? records.authors.map(sanitizeAuthorRecord).filter((author) => author.authorId || author.name)
    : [];
  const mediaAssets = Array.isArray(records.mediaAssets)
    ? records.mediaAssets.map(sanitizeMediaAssetRecord).filter((asset) => asset.assetId || asset.sourceUrl || asset.localPath)
    : [];

  return {
    ...(run?.resultSummary || {}),
    records: {
      notes,
      comments,
      authors,
      mediaAssets,
    },
  };
}

function buildWorkbenchRecordDeltas(activeTask = {}, pluginRunId = '', resultSummary = {}, sequenceBase = Date.now()) {
  const taskId = String(activeTask.taskId || '').trim();
  const runId = String(pluginRunId || activeTask.pluginRunId || activeTask.externalTaskId || activeTask.taskId || '').trim();
  if (!taskId || !runId) return [];

  const records = resultSummary.records || {};
  let sequence = Number.isFinite(Number(sequenceBase)) ? Math.floor(Number(sequenceBase)) : Date.now();
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  const noteDeltas = (Array.isArray(records.notes) ? records.notes : []).map((note) => ({
    taskId,
    pluginRunId: runId,
    recordType: WORKBENCH_RECORD_TYPE.NOTE,
    externalRecordId: String(note.noteId || note.platformContentId || note.url || '').trim(),
    sequence: nextSequence(),
    payload: note,
  }));

  const commentDeltas = (Array.isArray(records.comments) ? records.comments : []).map((comment) => ({
    taskId,
    pluginRunId: runId,
    recordType: WORKBENCH_RECORD_TYPE.COMMENT,
    externalRecordId: String(comment.commentId || comment.id || '').trim(),
    sequence: nextSequence(),
    payload: comment,
  }));

  const authorDeltas = (Array.isArray(records.authors) ? records.authors : []).map((author) => ({
    taskId,
    pluginRunId: runId,
    recordType: WORKBENCH_RECORD_TYPE.AUTHOR,
    externalRecordId: String(author.authorId || author.userId || author.profileUrl || '').trim(),
    sequence: nextSequence(),
    payload: author,
  }));

  const mediaDeltas = (Array.isArray(records.mediaAssets) ? records.mediaAssets : []).map((asset) => ({
    taskId,
    pluginRunId: runId,
    recordType: WORKBENCH_RECORD_TYPE.MEDIA,
    externalRecordId: String(asset.assetId || asset.sourceUrl || asset.localPath || '').trim(),
    sequence: nextSequence(),
    payload: asset,
  }));

  return [
    ...noteDeltas,
    ...commentDeltas,
    ...authorDeltas,
    ...mediaDeltas,
  ].filter((record) => record.externalRecordId || Object.keys(record.payload || {}).length > 0);
}

function hasResultLookupError(result = {}) {
  return /collectionRunId or externalTaskId required|collectionRun not found/i.test(String(result?.error || '').trim());
}

function resolveDispatchCollectionRunId(dispatch = {}) {
  return String(
    dispatch?.collectionRunId
    || dispatch?.resultLookup?.collectionRunId
    || '',
  ).trim();
}

function hydrateTrackedTask(task = {}, now = Date.now()) {
  const taskId = String(task?.id || '').trim();
  if (!taskId) return null;
  return {
    taskId,
    externalTaskId: taskId,
    taskType: String(task?.taskType || '').trim(),
    source: String(task?.source || '').trim(),
    taskStrategy: String(task?.taskStrategy || '').trim(),
    payload: task?.payload && typeof task.payload === 'object' ? task.payload : {},
    pluginRunId: String(task?.pluginRunId || '').trim(),
    executorInstanceId: String(task?.executorInstanceId || '').trim(),
    accountId: String(task?.accountId || '').trim(),
    workbenchStatus: String(task?.status || 'dispatched').trim() || 'dispatched',
    resultFingerprint: '',
    controlCursor: String(task?.controlCursor || '').trim(),
    errorMessage: String(task?.errorMessage || '').trim(),
    dispatchedAtMs:
      parseTimestamp(task?.dispatchedAt)
      || parseTimestamp(task?.updatedAt)
      || parseTimestamp(task?.createdAt)
      || now,
  };
}

function buildIdleTickResult(claimed = {}, idleSnapshot = null) {
  const normalizedSnapshot = idleSnapshot || createTaskLeaseIdleSnapshot(claimed) || null;
  const reason = normalizedSnapshot?.reason || (
    claimed?.reason && typeof claimed.reason === 'object' && !Array.isArray(claimed.reason)
      ? { ...claimed.reason }
      : null
  );
  const nextPollAfterMs = Number.isFinite(Number(claimed?.nextPollAfterMs))
    ? Number(claimed.nextPollAfterMs)
    : Number(normalizedSnapshot?.nextPollAfterMs || 0);

  const result = {
    success: true,
    idle: true,
    nextPollAfterMs: Number.isFinite(nextPollAfterMs) ? nextPollAfterMs : 0,
  };
  if (normalizedSnapshot?.idleReasonCode) {
    result.idleReasonCode = normalizedSnapshot.idleReasonCode;
  }
  if (normalizedSnapshot?.idleReasonMessage) {
    result.idleReasonMessage = normalizedSnapshot.idleReasonMessage;
  }
  if (reason) {
    result.reason = reason;
  }
  return result;
}

export function createTaskPoller(deps = {}) {
  const state = {
    activeTask: null,
    activeLease: null,
    ticking: false,
    seenControlIds: new Set(),
    lastIdleReason: null,
  };

  let tickPromise = null;

  function getNow() {
    return typeof deps.now === 'function' ? deps.now() : Date.now();
  }

  async function notifyContentScriptToStop(activeTask = {}) {
    const tabId = activeTask?.tabId;
    if (!tabId) return;
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'workbenchTaskControl',
        command: 'stop',
      });
    } catch {
      // 标签页已关闭或导航到其他页面，忽略错误
    }
  }

  async function patchTask(taskId, patch) {
    if (!taskId || !patch || typeof deps.patchTask !== 'function') return null;
    return deps.patchTask(taskId, patch);
  }

  async function resolveExecutorInstanceId() {
    if (typeof deps.getExecutorInstanceId !== 'function') return '';
    return String(await deps.getExecutorInstanceId() || '').trim();
  }

  async function clearActiveLease() {
    state.activeLease = null;
    if (typeof deps.clearTaskLease === 'function') {
      await deps.clearTaskLease();
    }
  }

  function updateActiveTask(patch = {}) {
    if (!state.activeTask) return null;
    const nextPatch = typeof patch === 'function'
      ? patch({ ...state.activeTask })
      : patch;
    if (!nextPatch || typeof nextPatch !== 'object') {
      return state.activeTask ? { ...state.activeTask } : null;
    }
    state.activeTask = deepClone({
      ...state.activeTask,
      ...nextPatch,
    });
    return { ...state.activeTask };
  }

  async function consumePendingAccountUsage(activeTask, mappedStatus = '', pluginRunId = '') {
    const accountId = String(activeTask?.pendingAccountUsageId || '').trim();
    if (!accountId) return false;
    if (!pluginRunId || mappedStatus === 'paused' || mappedStatus === 'dispatched') {
      return false;
    }
    if (typeof deps.consumePendingAccountUsage !== 'function') {
      activeTask.pendingAccountUsageId = '';
      return true;
    }
    await deps.consumePendingAccountUsage(accountId, activeTask);
    activeTask.pendingAccountUsageId = '';
    return true;
  }

  async function claimTask(task, lease = null) {
    if (!task?.id) return { success: false, skipped: true, reason: 'missing_task_id' };
    let preCheck = null;

    if (typeof deps.beforeDispatch === 'function') {
      preCheck = await deps.beforeDispatch(task);
      if (preCheck?.shouldPause) {
        await patchTask(task.id, {
          status: 'paused',
          progress: 5,
          errorMessage: preCheck.reason || 'pre_dispatch_check_failed',
        });
        if (lease) await clearActiveLease();
        return { success: false, skipped: true, reason: preCheck.reason };
      }
    }

    let capability;
    try {
      capability = typeof deps.capabilityCheck === 'function'
        ? await deps.capabilityCheck(task)
        : { accepted: false };
    } catch (error) {
      const isRecoverable = isRecoverableConnectionError(error);
      const recoveryStatus = isRecoverable
        ? recoverableConnectionStatusForTask(task)
        : { status: 'failed', progress: 100, eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_FAILED, message: '能力检查失败' };
      await patchTask(task.id, {
        status: recoveryStatus.status,
        progress: recoveryStatus.progress,
        errorMessage: String(error?.message || error || 'capability_check_failed'),
      });
      if (isRecoverable && typeof deps.enqueueEvent === 'function') {
        await deps.enqueueEvent({
          taskId: task.id,
          pluginRunId: '',
          eventType: recoveryStatus.eventType,
          source: WORKBENCH_EVENT_SOURCE.PLUGIN,
          sequence: Date.now(),
          payload: {
            reason: 'connection_interrupted',
            message: recoveryStatus.message,
            status: recoveryStatus.status,
            errorMessage: String(error?.message || error || 'capability_check_failed'),
          },
        });
        if (typeof deps.flushDeltas === 'function') await deps.flushDeltas();
      }
      if (lease) await clearActiveLease();
      return { success: false, skipped: false, reason: String(error?.message || error || 'capability_check_failed') };
    }

    if (!capability?.accepted) {
      if (typeof deps.enqueueEvent === 'function' && task?.id) {
        await deps.enqueueEvent({
          taskId: task.id,
          pluginRunId: '',
          eventType: 'task.capability_mismatch',
          source: WORKBENCH_EVENT_SOURCE.PLUGIN,
          sequence: Date.now(),
          payload: {
            taskType: String(task.taskType || '').trim(),
            reasonCode: capability?.reasonCode || '',
            reasonMessage: capability?.reasonMessage || capability?.error || 'capability_rejected',
            recommendedAction: capability?.recommendedAction || '',
          },
        });
        if (typeof deps.flushDeltas === 'function') {
          await deps.flushDeltas();
        }
      }
      if (lease) await clearActiveLease();
      return {
        success: true,
        skipped: true,
        reason: capability?.error || capability?.reasonMessage || 'capability_rejected',
      };
    }

    let dispatch;
    try {
      dispatch = typeof deps.dispatchTask === 'function'
        ? await deps.dispatchTask(task)
        : { accepted: false };
    } catch (error) {
      const isRecoverable = isRecoverableConnectionError(error);
      const recoveryStatus = isRecoverable
        ? recoverableConnectionStatusForTask(task)
        : { status: 'failed', progress: 100, eventType: WORKBENCH_TASK_EVENT_TYPE.TASK_FAILED, message: '派发任务失败' };
      await patchTask(task.id, {
        status: recoveryStatus.status,
        progress: recoveryStatus.progress,
        errorMessage: String(error?.message || error || 'dispatch_failed'),
      });
      if (isRecoverable && typeof deps.enqueueEvent === 'function') {
        await deps.enqueueEvent({
          taskId: task.id,
          pluginRunId: '',
          eventType: recoveryStatus.eventType,
          source: WORKBENCH_EVENT_SOURCE.PLUGIN,
          sequence: Date.now(),
          payload: {
            reason: 'connection_interrupted',
            message: recoveryStatus.message,
            status: recoveryStatus.status,
            errorMessage: String(error?.message || error || 'dispatch_failed'),
          },
        });
        if (typeof deps.flushDeltas === 'function') await deps.flushDeltas();
      }
      if (lease) await clearActiveLease();
      return { success: false, skipped: false, reason: String(error?.message || error || 'dispatch_failed') };
    }

    if (!dispatch?.accepted) {
      await patchTask(task.id, {
        status: 'failed',
        progress: 100,
        errorMessage: String(dispatch?.error || 'dispatch_failed'),
      });
      if (lease) await clearActiveLease();
      return { success: false, skipped: false, reason: 'dispatch_failed' };
    }

    if (typeof deps.afterDispatchSuccess === 'function') {
      try {
        await deps.afterDispatchSuccess(task, preCheck, dispatch);
      } catch (error) {
        console.warn('[灵感爆爆爆] post-dispatch bookkeeping failed:', error);
      }
    }

    const dispatchCollectionRunId = resolveDispatchCollectionRunId(dispatch);
    const executorInstanceId = await resolveExecutorInstanceId();
    const accountId = String(preCheck?.accountId || '').trim();
    if (!lease || dispatchCollectionRunId) {
      await patchTask(task.id, buildStartupPatch({
        pluginRunId: dispatchCollectionRunId,
        activeExecutor: executorInstanceId,
      }));
    }
    state.activeTask = {
      taskId: task.id,
      externalTaskId: String(dispatch?.resultLookup?.externalTaskId || dispatch?.taskId || task.id).trim(),
      taskType: String(task?.taskType || '').trim(),
      source: String(task?.source || '').trim(),
      taskStrategy: String(task?.taskStrategy || task?.payload?.taskStrategy || '').trim(),
      payload: task?.payload && typeof task.payload === 'object' ? task.payload : {},
      pluginRunId: dispatchCollectionRunId,
      executorInstanceId,
      accountId,
      tabId: task?.tabId || null,
      workbenchStatus: dispatchCollectionRunId ? 'running' : 'dispatched',
      resultFingerprint: '',
      controlCursor: '',
      errorMessage: '',
      dispatchedAtMs: getNow(),
      pendingAccountUsageId: '',
    };
    state.activeLease = lease
      ? {
          leaseToken: String(lease.leaseToken || '').trim(),
          expiresAt: String(lease.expiresAt || '').trim(),
        }
      : null;
    if (!lease) {
      await enqueueTaskEvent(state.activeTask, WORKBENCH_TASK_EVENT_TYPE.TASK_CLAIMED, {
        status: dispatchCollectionRunId ? 'running' : 'dispatched',
        message: dispatchCollectionRunId ? '页面已创建本地执行单，任务开始执行' : '工作台任务已被插件认领',
        collectionRunId: dispatchCollectionRunId || undefined,
      });
    }
    state.lastIdleReason = null;
    return { success: true, accepted: true };
  }

  function getPluginRunId(activeTask = {}) {
    return String(activeTask.pluginRunId || activeTask.externalTaskId || activeTask.taskId || '').trim();
  }

  async function enqueueTaskEvent(activeTask, eventType, payload = {}, options = {}) {
    if (!activeTask || typeof deps.enqueueEvent !== 'function') return null;
    return deps.enqueueEvent({
      taskId: activeTask.taskId,
      pluginRunId: getPluginRunId(activeTask),
      eventType,
      source: options.source || WORKBENCH_EVENT_SOURCE.PLUGIN,
      sequence: options.sequence || Date.now(),
      controlRequestId: options.controlRequestId || '',
      payload,
      snapshot: options.snapshot || null,
    });
  }

  async function consumeControlRequests(activeTask) {
    if (!activeTask || typeof deps.fetchControlRequests !== 'function' || typeof deps.applyTaskControl !== 'function') {
      return { success: true, controls: 0 };
    }

    let response;
    try {
      response = await deps.fetchControlRequests(activeTask.taskId, {
        executorInstanceId: activeTask.executorInstanceId || await resolveExecutorInstanceId(),
        after: activeTask.controlCursor || '',
      });
    } catch (error) {
      if (Number(error?.status) === 404) {
        return { success: true, controls: 0, skipped: true, reason: 'control_api_unavailable' };
      }
      throw error;
    }

    const controls = Array.isArray(response?.controls) ? response.controls : [];
    let handled = 0;
    for (const control of controls) {
      const controlRequestId = String(control?.controlRequestId || control?.id || control?.idempotencyKey || '').trim();
      if (controlRequestId && state.seenControlIds.has(controlRequestId)) continue;

      const originalAction = String(control?.action || '').trim();
      const deleteRequested = originalAction === REMOTE_TASK_CONTROL_ACTION.DELETE;
      const actionToApply = deleteRequested ? REMOTE_TASK_CONTROL_ACTION.STOP : originalAction;
      const controlToApply = {
        ...control,
        taskId: String(control?.taskId || activeTask.taskId || '').trim(),
        taskType: String(control?.taskType || activeTask.taskType || '').trim(),
        action: actionToApply,
        originalAction,
        deleteRequested,
      };

      await enqueueTaskEvent(activeTask, WORKBENCH_TASK_EVENT_TYPE.TASK_CONTROL_REQUESTED, {
        controlRequestId,
        action: originalAction,
        source: control?.source || WORKBENCH_EVENT_SOURCE.WORKBENCH,
        requestedAt: control?.requestedAt || '',
      }, { controlRequestId, source: WORKBENCH_EVENT_SOURCE.WORKBENCH });

      try {
        const applied = await deps.applyTaskControl(controlToApply);
        if (applied?.success === false || applied?.accepted === false || applied?.error) {
          throw new Error(applied?.error || 'control_not_accepted');
        }
        await enqueueTaskEvent(activeTask, WORKBENCH_TASK_EVENT_TYPE.TASK_CONTROL_APPLIED, {
          controlRequestId,
          action: originalAction,
          appliedAction: actionToApply,
          deleteRequested,
        }, { controlRequestId });
        await enqueueTaskEvent(activeTask, mapControlActionToStateEvent(originalAction), {
          controlRequestId,
          action: originalAction,
          status: deleteRequested || actionToApply === REMOTE_TASK_CONTROL_ACTION.STOP ? 'stopping' : actionToApply,
          deleteRequested,
        }, { controlRequestId });
      } catch (error) {
        await enqueueTaskEvent(activeTask, WORKBENCH_TASK_EVENT_TYPE.TASK_CONTROL_FAILED, {
          controlRequestId,
          action: originalAction,
          errorMessage: String(error?.message || error || 'control_failed'),
          deleteRequested,
        }, { controlRequestId });
      }

      handled += 1;
      if (controlRequestId) state.seenControlIds.add(controlRequestId);
      activeTask.controlCursor = String(control?.cursor || response?.nextCursor || activeTask.controlCursor || '').trim();
    }

    if (response?.nextCursor && !controls.length) {
      activeTask.controlCursor = String(response.nextCursor || '').trim();
    }
    return { success: true, controls: handled };
  }

  async function pollActiveTask() {
    if (!state.activeTask || typeof deps.getResultPackage !== 'function') {
      return { success: true, idle: true };
    }
    const activeTask = state.activeTask;
    if (state.activeLease && typeof deps.renewTaskLease === 'function') {
      try {
        const renewal = await deps.renewTaskLease(activeTask.taskId, state.activeLease, {
          status: activeTask.workbenchStatus || 'running',
        });
        if (renewal?.expiresAt) {
          state.activeLease = {
            ...state.activeLease,
            expiresAt: String(renewal.expiresAt || '').trim(),
          };
        }
      } catch (error) {
        await enqueueTaskEvent(activeTask, WORKBENCH_TASK_EVENT_TYPE.TASK_HEARTBEAT, {
          leaseRenewalFailed: true,
          errorMessage: String(error?.message || error || 'lease_renewal_failed'),
        });
      }
    }
    await consumeControlRequests(activeTask);

    let result;
    try {
        result = await deps.getResultPackage({
          collectionRunId: String(activeTask.pluginRunId || '').trim(),
          externalTaskId: String(activeTask.externalTaskId || '').trim(),
        });
    } catch (error) {
      result = { success: false, error: String(error?.message || error || 'result_lookup_failed') };
    }

    if (!result?.success) {
      if (hasResultLookupError(result)) {
        if (
          activeTask.workbenchStatus === 'dispatched' &&
          getNow() - Number(activeTask.dispatchedAtMs || 0) >= DISPATCH_STARTUP_TIMEOUT_MS
        ) {
          const startupErrorMessage = '任务已派出，但页面没有真正启动，已自动释放重试。';
          await patchTask(activeTask.taskId, {
            status: 'pending',
            progress: 0,
            pluginRunId: activeTask.pluginRunId || null,
            errorMessage: startupErrorMessage,
          });
          await enqueueTaskEvent(activeTask, WORKBENCH_TASK_EVENT_TYPE.TASK_HEARTBEAT, {
            status: 'pending',
            errorMessage: startupErrorMessage,
            userMessage: startupErrorMessage,
            reason: 'dispatch_startup_timeout',
          });
          state.activeTask = null;
          state.seenControlIds.clear();
          await clearActiveLease();
          return { success: true, released: true, reason: 'dispatch_startup_timeout' };
        }
        return { success: true, waiting: true };
      }
      const errorMessage = String(result?.error || 'result_lookup_failed');
      if (isRecoverableConnectionError(errorMessage)) {
        const recoveryStatus = recoverableConnectionStatusForTask(activeTask);
        const pausedProgress = activeTask.workbenchStatus === 'running' ? buildRunningProgress({}) : 5;
        await patchTask(activeTask.taskId, {
          status: recoveryStatus.status,
          progress: recoveryStatus.status === 'failed' ? 100 : pausedProgress,
          pluginRunId: activeTask.pluginRunId || null,
          errorMessage,
        });
        await enqueueTaskEvent(activeTask, recoveryStatus.eventType, {
          status: recoveryStatus.status,
          errorMessage,
          message: recoveryStatus.message,
        });
        if (recoveryStatus.status === 'failed') {
          await notifyContentScriptToStop(activeTask);
          state.activeTask = null;
          await clearActiveLease();
          return { success: false, failed: true };
        }
        await notifyContentScriptToStop(activeTask);
        return { success: true, paused: true };
      }
      await patchTask(activeTask.taskId, {
        status: 'failed',
        progress: 100,
        pluginRunId: activeTask.pluginRunId || null,
        errorMessage: errorMessage,
      });
      await enqueueTaskEvent(activeTask, WORKBENCH_TASK_EVENT_TYPE.TASK_FAILED, {
        status: 'failed',
        errorMessage,
        userMessage: result?.userMessage || '任务执行失败',
        errorCode: result?.errorCode || result?.reasonCode || '',
      });
      await notifyContentScriptToStop(activeTask);
      state.activeTask = null;
      await clearActiveLease();
      return { success: false, failed: true };
    }

    const run = result?.result || {};
    const mapped = mapRunStatusToWorkbenchStatus(run.status);
    const pluginRunId = String(run.collectionRunId || activeTask.pluginRunId || '').trim();
    await consumePendingAccountUsage(activeTask, mapped.status, pluginRunId);
    const resultSummary = buildWorkbenchResultSummary(run);
    const errorMessage = String(run.errorMessage || '').trim();
    const userMessage = String(run.userMessage || '').trim();
    const fingerprint = JSON.stringify({
      status: mapped.status,
      pluginRunId,
      resultSummary,
      errorMessage,
    });

    if (
      fingerprint !== activeTask.resultFingerprint ||
      mapped.status !== activeTask.workbenchStatus ||
      errorMessage !== activeTask.errorMessage
    ) {
      await patchTask(activeTask.taskId, {
        status: mapped.status,
        progress: mapped.progress ?? buildRunningProgress(run),
        pluginRunId: pluginRunId || null,
        resultSummary,
        errorMessage: errorMessage || null,
      });
      activeTask.pluginRunId = pluginRunId;
      activeTask.workbenchStatus = mapped.status;
      activeTask.resultFingerprint = fingerprint;
      activeTask.errorMessage = errorMessage;
      const recordDeltas = buildWorkbenchRecordDeltas(
        activeTask,
        pluginRunId || getPluginRunId(activeTask),
        resultSummary,
      );
      if (recordDeltas.length && typeof deps.enqueueRecords === 'function') {
        await deps.enqueueRecords(recordDeltas);
      }
      await enqueueTaskEvent(activeTask, mapWorkbenchStatusToEventType(mapped.status), {
        status: mapped.status,
        progress: mapped.progress ?? buildRunningProgress(run),
        errorMessage: errorMessage || '',
        latestSummary: run?.resultSummary || {},
      }, {
        snapshot: {
          status: mapped.status,
          progress: mapped.progress ?? buildRunningProgress(run),
          latestSummary: run?.resultSummary || {},
          latestHeartbeatAt: new Date().toISOString(),
        },
      });
    }

    if (mapped.final) {
      state.activeTask = null;
      state.seenControlIds.clear();
      await clearActiveLease();
    }

    return { success: true, final: mapped.final, status: mapped.status };
  }

  async function recoverTrackedTask() {
    if (typeof deps.fetchTrackableTasks !== 'function') return null;
    const tasks = await deps.fetchTrackableTasks();
    const now = getNow();
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (isTrackableTaskStale(task, now)) {
        await patchTask(task.id, {
          status: 'failed',
          progress: 100,
          errorMessage: 'Orphaned plugin task released after stale heartbeat.',
        });
        continue;
      }
      const hydrated = hydrateTrackedTask(task, now);
      if (!hydrated) continue;
      if (
        hydrated.workbenchStatus === 'paused' &&
        isMonitorTask(hydrated) &&
        isRecoverableConnectionError(hydrated.errorMessage)
      ) {
        await patchTask(hydrated.taskId, {
          status: 'failed',
          progress: 100,
          pluginRunId: hydrated.pluginRunId || null,
          errorMessage: hydrated.errorMessage,
        });
        if (typeof deps.readTaskLease === 'function') {
          const lease = await deps.readTaskLease();
          if (lease?.taskId === hydrated.taskId) {
            await clearActiveLease();
          }
        }
        continue;
      }
      state.activeTask = hydrated;
      if (typeof deps.readTaskLease === 'function') {
        const lease = await deps.readTaskLease();
        if (lease?.taskId === hydrated.taskId && lease?.leaseToken) {
          state.activeLease = {
            leaseToken: String(lease.leaseToken || '').trim(),
            expiresAt: String(lease.expiresAt || '').trim(),
          };
        }
      }
      return hydrated;
    }
    return null;
  }

  async function tick() {
    if (tickPromise) {
      return { success: true, skipped: true, reason: 'tick_in_progress' };
    }
    tickPromise = (async () => {
      state.ticking = true;
      try {
        if (state.activeTask) {
          return await pollActiveTask();
        }

        const recoveredTask = await recoverTrackedTask();
        if (recoveredTask) {
          return await pollActiveTask();
        }

        if (typeof deps.claimTaskLease !== 'function') {
          state.lastIdleReason = null;
          return buildIdleTickResult({}, null);
        }

        const claimed = await deps.claimTaskLease();
        if (claimed?.task) {
          return await claimTask(claimed.task, claimed.lease || null);
        }

        const idleSnapshot = createTaskLeaseIdleSnapshot(claimed);
        state.lastIdleReason = idleSnapshot;
        return buildIdleTickResult(claimed, idleSnapshot);
      } finally {
        state.ticking = false;
      }
    })();
    return tickPromise;
  }

  function getState() {
    return {
      activeTask: state.activeTask ? { ...state.activeTask } : null,
      activeLease: state.activeLease ? { ...state.activeLease } : null,
      ticking: state.ticking,
      lastIdleReason: state.lastIdleReason ? { ...state.lastIdleReason } : null,
    };
  }

  return {
    tick,
    getState,
    updateActiveTask,
  };
}
