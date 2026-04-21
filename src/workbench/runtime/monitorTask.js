import { parseCount } from '../../shared/utils.js';
import {
  MONITOR_RECORD_MODE,
  MONITOR_TASK_STRATEGY,
  REMOTE_TARGET_PAGE_TYPE,
} from '../protocol/schema.js';

const STRATEGY_VALUES = new Set(Object.values(MONITOR_TASK_STRATEGY));

function normalizeString(value) {
  return String(value || '').trim();
}

function isSignedXhsShareUrl(url = '') {
  const normalized = normalizeString(url);
  if (!normalized) return false;
  return /xsec_token=/i.test(normalized) || /xhslink\.com/i.test(normalized);
}

function extractXhsTargetNoteId({ payload = {}, target = {} } = {}) {
  const directId = normalizeString(
    payload?.platformContentId
    || payload?.noteId
    || payload?.contentId,
  ).replace(/^xhs_/, '');
  if (directId) return directId;

  const targetUrl = normalizeString(target?.url);
  if (!targetUrl) return '';
  const match = targetUrl.match(
    /xiaohongshu\.com\/(?:(?:explore|discovery\/item)\/|user\/profile\/[^/?#]+\/)([^/?#]+)/i,
  );
  return normalizeString(match?.[1] || '').replace(/^xhs_/, '');
}

function buildCanonicalXhsNoteUrl(noteId = '') {
  const normalizedNoteId = normalizeString(noteId).replace(/^xhs_/, '');
  return normalizedNoteId ? `https://www.xiaohongshu.com/explore/${normalizedNoteId}` : '';
}

function ensurePositiveInteger(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function pickStrategy({ taskStrategy = '', payload = {} } = {}) {
  const candidates = [
    taskStrategy,
    payload?.taskStrategy,
    payload?.monitorStrategy,
  ];
  for (const candidate of candidates) {
    const value = normalizeString(candidate);
    if (STRATEGY_VALUES.has(value)) return value;
  }
  return '';
}

function inferMonitorMode(strategy, pageType = '') {
  if (strategy === MONITOR_TASK_STRATEGY.KEYWORD_PATROL) {
    return MONITOR_RECORD_MODE.KEYWORD_SURFACE;
  }
  if (strategy === MONITOR_TASK_STRATEGY.DETAIL_PROBE || strategy === MONITOR_TASK_STRATEGY.DEEP_COLLECT) {
    return MONITOR_RECORD_MODE.DETAIL_PROBE;
  }
  if (pageType === REMOTE_TARGET_PAGE_TYPE.SEARCH) {
    return MONITOR_RECORD_MODE.KEYWORD_SURFACE;
  }
  return MONITOR_RECORD_MODE.AUTHOR_SURFACE;
}

export function normalizeMonitorTaskStrategy(value = '') {
  const strategy = normalizeString(value);
  return STRATEGY_VALUES.has(strategy) ? strategy : '';
}

export function buildMonitorTaskMeta({
  platform = '',
  taskType = '',
  taskStrategy = '',
  payload = {},
  target = {},
} = {}) {
  const strategy = pickStrategy({ taskStrategy, payload });
  if (!strategy) return null;

  const pageType = normalizeString(target?.pageType);
  const monitorMode = inferMonitorMode(strategy, pageType);
  const isDetail = monitorMode === MONITOR_RECORD_MODE.DETAIL_PROBE;
  const surfaceOnly = !isDetail;
  const scanLimit = ensurePositiveInteger(payload.scanLimit ?? payload.limit ?? payload.count, surfaceOnly ? 30 : 0);
  const detailProbeLimit = ensurePositiveInteger(payload.detailProbeLimit ?? payload.limit ?? payload.count, isDetail ? 10 : 0);
  const effectiveLimit = isDetail
    ? ensurePositiveInteger(detailProbeLimit, 10)
    : ensurePositiveInteger(scanLimit, 30);

  return {
    monitorId: normalizeString(payload.monitorId),
    taskStrategy: strategy,
    platform: normalizeString(platform),
    taskType: normalizeString(taskType),
    targetNoteId: extractXhsTargetNoteId({ payload, target }),
    targetPageType: pageType,
    targetUrl: normalizeString(target?.url),
    keyword: normalizeString(payload.keyword || payload.query),
    monitorStrength: normalizeString(payload.monitorStrength),
    accountPurpose: normalizeString(payload.accountPurpose),
    display: payload.display && typeof payload.display === 'object' ? payload.display : {},
    scanLimit,
    detailProbeLimit,
    limit: effectiveLimit,
    surfaceOnly,
    surfaceMode: surfaceOnly ? monitorMode : '',
    monitorMode,
    stopAfterKnownStreak: ensurePositiveInteger(payload.stopAfterKnownStreak, 0),
  };
}

export function withMonitorRecordMeta(record = {}, monitorMeta = null, mode = '') {
  if (!monitorMeta?.taskStrategy) return record;
  const monitorMode = normalizeString(mode || record.monitorMode || monitorMeta.monitorMode || monitorMeta.surfaceMode);
  return {
    ...record,
    monitorMode,
    monitorId: normalizeString(record.monitorId || monitorMeta.monitorId),
    taskStrategy: normalizeString(record.taskStrategy || monitorMeta.taskStrategy),
    monitorMeta: {
      ...(monitorMeta || {}),
      ...(record.monitorMeta || {}),
      monitorMode,
    },
  };
}

function normalizeXhsUrl(url = '', noteId = '') {
  const value = normalizeString(url);
  const absolute = !value
    ? ''
    : /^https?:\/\//i.test(value)
      ? value
      : value.startsWith('/')
        ? `https://www.xiaohongshu.com${value}`
        : value;

  if (isSignedXhsShareUrl(absolute)) return absolute;
  return buildCanonicalXhsNoteUrl(noteId) || absolute;
}

function normalizeDouyinUrl(url = '') {
  const value = normalizeString(url);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `https://www.douyin.com${value}`;
  return value;
}

function createMonitorSurfaceSeedMeta() {
  return {
    dataQuality: 'seed',
    qualityReason: 'monitor_surface_seed',
    sourceTier: 'seed',
  };
}

export function buildXhsSurfaceNoteRecords(cards = [], {
  monitorMeta = null,
  collectionRunId = '',
  mode = '',
  limit = 0,
  sourcePageUrl = '',
  searchKeyword = '',
  searchPageUrl = '',
} = {}) {
  const max = ensurePositiveInteger(limit, ensurePositiveInteger(monitorMeta?.limit, cards.length));
  return (Array.isArray(cards) ? cards : [])
    .filter((card) => normalizeString(card?.noteId || card?.platformContentId || card?.contentId))
    .slice(0, max)
    .map((card, index) => {
      const noteId = normalizeString(card.noteId || card.platformContentId || card.contentId);
      const url = normalizeXhsUrl(card.url || (noteId ? `/explore/${noteId}` : ''), noteId);
      return withMonitorRecordMeta({
        ...createMonitorSurfaceSeedMeta(),
        noteId,
        platformContentId: noteId,
        contentId: noteId.startsWith('xhs_') ? noteId : `xhs_${noteId}`,
        platform: 'xhs',
        title: normalizeString(card.title || card.titleHint),
        content: normalizeString(card.content || card.desc || card.title || card.titleHint),
        bodyText: normalizeString(card.bodyText || card.content || card.desc || card.title || card.titleHint),
        url,
        canonicalUrl: url,
        cover: normalizeString(card.cover || card.coverImg || card.coverUrl || card.thumbnail),
        coverImg: normalizeString(card.coverImg || card.cover || card.coverUrl || card.thumbnail),
        likes: parseCount(card.likes),
        comments: parseCount(card.comments),
        collects: parseCount(card.collects),
        shares: parseCount(card.shares),
        type: normalizeString(card.type || 'normal') || 'normal',
        authorName: normalizeString(card.authorName || card.authorHint),
        sourcePageUrl: normalizeString(sourcePageUrl),
        searchKeyword: normalizeString(searchKeyword || monitorMeta?.keyword),
        searchPageUrl: normalizeString(searchPageUrl),
        batchRank: index + 1,
        collectionRunId: normalizeString(collectionRunId),
        dataSource: 'monitor_surface_card',
        collectedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, monitorMeta, mode || monitorMeta?.surfaceMode);
    });
}

export function buildDouyinSurfaceNoteRecords(targets = [], {
  monitorMeta = null,
  collectionRunId = '',
  mode = '',
  limit = 0,
  searchKeyword = '',
  searchPageUrl = '',
} = {}) {
  const max = ensurePositiveInteger(limit, ensurePositiveInteger(monitorMeta?.limit, targets.length));
  return (Array.isArray(targets) ? targets : [])
    .filter((target) => normalizeString(target?.awemeId || target?.platformContentId || target?.noteId || target?.contentId))
    .slice(0, max)
    .map((target, index) => {
      const platformContentId = normalizeString(target.awemeId || target.platformContentId || target.noteId || target.contentId).replace(/^dy_/, '');
      const url = normalizeDouyinUrl(target.href || target.url || (platformContentId ? `/video/${platformContentId}` : ''));
      return withMonitorRecordMeta({
        ...createMonitorSurfaceSeedMeta(),
        noteId: platformContentId,
        platformContentId,
        contentId: `dy_${platformContentId}`,
        platform: 'douyin',
        title: normalizeString(target.titleHint || target.title || platformContentId),
        content: normalizeString(target.titleHint || target.title || ''),
        bodyText: normalizeString(target.titleHint || target.title || ''),
        url,
        canonicalUrl: url,
        cover: normalizeString(target.cover || target.coverImg || target.coverUrl || target.thumbnail),
        coverImg: normalizeString(target.coverImg || target.cover || target.coverUrl || target.thumbnail),
        likes: parseCount(target.likes),
        comments: parseCount(target.comments),
        collects: parseCount(target.collects),
        shares: parseCount(target.shares),
        type: 'video',
        authorName: normalizeString(target.authorHint || target.authorName),
        publishedAtText: normalizeString(target.timeHint || target.publishedAtText),
        searchKeyword: normalizeString(searchKeyword || target.searchKeyword || monitorMeta?.keyword),
        searchPageUrl: normalizeString(searchPageUrl),
        batchRank: index + 1,
        collectionRunId: normalizeString(collectionRunId),
        dataSource: 'monitor_surface_card',
        collectedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, monitorMeta, mode || monitorMeta?.surfaceMode);
    });
}
