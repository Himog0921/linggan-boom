import {
  getByInject,
  safeUrl,
  extractNoteId,
  parseCount,
  toHighQualityImageUrl,
  pickBestVideoStream,
  getHighQualityImageCandidates,
} from '../../shared/utils.js';
import { isContextValid } from '../../shared/messaging.js';
import { noteStore } from '../../db/noteStore.js';
import { createCollectorEvidence, joinRawDomText } from '../../shared/collectorMetadata.js';
import { withMonitorRecordMeta } from '../../workbench/runtime/monitorTask.js';

const XHS_CONTEXT_REFRESH_MESSAGE = '插件刚更新，请刷新当前页面后再点一次，刷新后即可继续。';

function normalizeDiscoverySnapshot(snapshot) {
  if (typeof snapshot === 'number') {
    return {
      visibleCount: snapshot,
      knownNoteIds: null,
    };
  }

  const knownNoteIds = snapshot?.knownNoteIds instanceof Set
    ? snapshot.knownNoteIds
    : null;
  return {
    visibleCount: normalizePositiveInteger(snapshot?.visibleCount, 0),
    knownNoteIds,
  };
}

function hasDiscoveryAdvanced(currentNotes, snapshot) {
  if (snapshot.knownNoteIds && currentNotes.some((note) => note?.noteId && !snapshot.knownNoteIds.has(note.noteId))) {
    return true;
  }
  return currentNotes.length > snapshot.visibleCount;
}

async function waitForDiscoverySettle(containerSelector, previousSnapshot, timeout, isProfileMode) {
  const startedAt = Date.now();
  let stableRounds = 0;
  const snapshot = normalizeDiscoverySnapshot(previousSnapshot);

  while (Date.now() - startedAt < timeout) {
    const currentNotes = discoverNotesFromDOM(containerSelector);
    if (hasDiscoveryAdvanced(currentNotes, snapshot)) {
      stableRounds += 1;
      if (stableRounds >= 2) return;
    } else {
      stableRounds = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, isProfileMode ? 200 : 160));
  }
}

export function selectNoteKey(noteMap = {}, preferredNoteId = '', currentUrl = '') {
  const expectedId = String(preferredNoteId || '').trim();
  if (expectedId && noteMap && noteMap[expectedId]) {
    return expectedId;
  }

  const currentNoteId = extractNoteId(currentUrl);
  const validKeys = Object.keys(noteMap || {}).filter(k => k && k !== 'undefined' && k.length > 10);
  if (currentNoteId && noteMap && noteMap[currentNoteId]) {
    return currentNoteId;
  }
  return validKeys[0] || '';
}

function normalizeNoteData(noteData) {
  let note = Array.isArray(noteData) ? noteData[0] : noteData;
  if (note && note.note && !note.noteId && !note.id) {
    note = note.note;
  }
  return note || null;
}

export function isCollectedNoteUsable(note = {}, expectedNoteId = '', { requireStats = false } = {}) {
  const normalizedExpectedId = String(expectedNoteId || '').trim();
  const normalizedActualId = String(note?.noteId || note?.id || '').trim();
  if (normalizedExpectedId && normalizedActualId && normalizedExpectedId !== normalizedActualId) {
    return false;
  }

  const hasText = Boolean(String(note?.title || '').trim() || String(note?.desc || '').trim());
  const hasMedia = Boolean(
    (Array.isArray(note?.imageList) && note.imageList.length > 0)
      || note?.video?.media?.stream
      || note?.video?.consumer
  );
  const hasAuthor = Boolean(String(note?.user?.nickname || '').trim() || String(note?.user?.userId || '').trim());

  if (!requireStats) {
    const hasStats = Boolean(
      note?.interactInfo?.likedCount
      || note?.interactInfo?.commentCount
      || note?.interactInfo?.shareCount
      || note?.interactInfo?.collectedCount
    );
    return hasText || hasMedia || hasAuthor || hasStats;
  }

  // detail_probe 场景：要求关键互动字段全部到位，避免 AJAX 填充未完成时过早采集
  const interactInfo = note?.interactInfo;
  const hasFullStats = Boolean(
    interactInfo
    && (interactInfo.likedCount != null || interactInfo.likeCount != null)
    && (interactInfo.collectedCount != null || interactInfo.collectCount != null)
    && (interactInfo.commentCount != null || interactInfo.comments != null)
  );
  const hasValidMedia = Boolean(
    (Array.isArray(note?.imageList) && note.imageList.length > 0 && (note.imageList[0]?.url || note.imageList[0]?.urlDefault))
    || note?.video?.media?.stream
    || note?.video?.consumer
  );

  return (hasText || hasValidMedia || hasAuthor) && hasFullStats;
}

export function resolveExpectedNoteFromMap(noteMap = {}, expectedNoteId = '', currentUrl = '') {
  const expectedId = String(expectedNoteId || '').trim();
  const preferredKey = selectNoteKey(noteMap, expectedId, currentUrl);
  const candidateKeys = [];
  if (expectedId) candidateKeys.push(expectedId);
  if (preferredKey && !candidateKeys.includes(preferredKey)) candidateKeys.push(preferredKey);

  const entries = Object.entries(noteMap || {});
  for (const [key, value] of entries) {
    const note = normalizeNoteData(value);
    const actualId = String(note?.noteId || note?.id || '').trim();
    if (expectedId && actualId === expectedId && !candidateKeys.includes(key)) {
      candidateKeys.unshift(key);
    }
  }

  for (const key of candidateKeys) {
    const note = normalizeNoteData(noteMap?.[key]);
    if (!note) continue;
    const actualId = String(note?.noteId || note?.id || '').trim();
    return {
      noteKey: key,
      note,
      actualNoteId: actualId,
      exactMatch: !expectedId || actualId === expectedId,
      usable: isCollectedNoteUsable(note, expectedId),
    };
  }

  return {
    noteKey: '',
    note: null,
    actualNoteId: '',
    exactMatch: false,
    usable: false,
  };
}

/**
 * 提取话题标签
 */
function extractHashtags(text = '') {
  const raw = String(text || '');
  const matches = raw.match(/#\s*[^\s#，。！？,.!?:：;；、]+/g) || [];
  return matches.map(tag => tag.replace(/^#/, '').trim()).filter(Boolean);
}

/**
 * 移除话题标签
 */
function removeHashtags(text = '') {
  return String(text || '').replace(/#\s*[^\s#，。！？,.!?:：;；、]+/g, '').replace(/\s+/g, ' ').trim();
}

function stripLooseHashes(text = '') {
  return String(text || '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/(^|\s)(?:#\s*){2,}(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanNoteBodyText(text = '') {
  return stripLooseHashes(removeHashtags(text));
}

function toNormalizedTimestamp(raw) {
  if (raw == null || raw === '') return 0;
  if (raw instanceof Date) {
    const ts = raw.getTime();
    return Number.isFinite(ts) && ts > 0 ? ts : 0;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return raw < 1000000000000 ? raw * 1000 : raw;
  }
  const text = String(raw).trim();
  if (!text) return 0;
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value < 1000000000000 ? value * 1000 : value;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildDateFromParts(baseDate, {
  year,
  month,
  day,
  hours = 0,
  minutes = 0,
  seconds = 0,
} = {}) {
  const candidate = new Date(baseDate);
  candidate.setFullYear(year, month - 1, day);
  candidate.setHours(hours, minutes, seconds, 0);
  return candidate;
}

export function parseXhsPublishedAt(raw, { now = Date.now() } = {}) {
  const directTimestamp = toNormalizedTimestamp(raw);
  if (directTimestamp > 0) return directTimestamp;

  const text = String(raw || '').trim()
    .replace(/^[发發]布于?\s*/i, '')
    .replace(/^[发發]布時間[:：]?\s*/i, '')
    .replace(/^[编編][辑輯]于?\s*/i, '')
    .replace(/\s*IP.*$/i, '')
    .trim();
  if (!text) return 0;

  const nowDate = new Date(now);
  const relativeMatch = text.match(/^(\d+)\s*(秒钟?|分钟|分鐘|小时|小時|天|周|週|个月|個月|月|年)前$/);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    if (Number.isFinite(amount) && amount >= 0) {
      const unit = relativeMatch[2];
      const multipliers = {
        秒: 1000,
        秒钟: 1000,
        分钟: 60 * 1000,
        分鐘: 60 * 1000,
        小时: 60 * 60 * 1000,
        小時: 60 * 60 * 1000,
        天: 24 * 60 * 60 * 1000,
        周: 7 * 24 * 60 * 60 * 1000,
        週: 7 * 24 * 60 * 60 * 1000,
        个月: 30 * 24 * 60 * 60 * 1000,
        個月: 30 * 24 * 60 * 60 * 1000,
        月: 30 * 24 * 60 * 60 * 1000,
        年: 365 * 24 * 60 * 60 * 1000,
      };
      const multiplier = multipliers[unit];
      if (multiplier) return Math.max(0, nowDate.getTime() - amount * multiplier);
    }
  }

  if (/^刚刚$/i.test(text)) return nowDate.getTime();

  const dayWordMatch = text.match(/^(今天|昨日|昨天|前天)\s*(\d{1,2}:\d{2})?$/);
  if (dayWordMatch) {
    const [, dayWord, timePart] = dayWordMatch;
    const candidate = new Date(nowDate);
    candidate.setSeconds(0, 0);
    if (dayWord === '昨天' || dayWord === '昨日') candidate.setDate(candidate.getDate() - 1);
    if (dayWord === '前天') candidate.setDate(candidate.getDate() - 2);
    const [hours, minutes] = String(timePart || '00:00').split(':').map((value) => Number(value || 0));
    candidate.setHours(hours || 0, minutes || 0, 0, 0);
    return candidate.getTime();
  }

  const fullDateMatch = text.match(/^(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (fullDateMatch) {
    const [, year, month, day, hours, minutes, seconds] = fullDateMatch;
    return buildDateFromParts(nowDate, {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hours: Number(hours || 0),
      minutes: Number(minutes || 0),
      seconds: Number(seconds || 0),
    }).getTime();
  }

  const monthDayMatch = text.match(/^(\d{1,2})[月/-](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (monthDayMatch) {
    const [, month, day, hours, minutes, seconds] = monthDayMatch;
    let candidate = buildDateFromParts(nowDate, {
      year: nowDate.getFullYear(),
      month: Number(month),
      day: Number(day),
      hours: Number(hours || 0),
      minutes: Number(minutes || 0),
      seconds: Number(seconds || 0),
    });
    if (candidate.getTime() - nowDate.getTime() > 24 * 60 * 60 * 1000) {
      candidate = buildDateFromParts(nowDate, {
        year: nowDate.getFullYear() - 1,
        month: Number(month),
        day: Number(day),
        hours: Number(hours || 0),
        minutes: Number(minutes || 0),
        seconds: Number(seconds || 0),
      });
    }
    return candidate.getTime();
  }

  return 0;
}

/**
 * 采集单篇笔记数据
 * 技术路径：注入 noteMap.js → 从 __INITIAL_STATE__ 提取结构化数据
 *
 * @param {Window} wd - 目标 window（主页面或 iframe.contentWindow）
 * @returns {Object} 采集到的笔记数据
 */
export async function collectNote(wd = window, options = {}) {
  if (!isContextValid()) {
    throw new Error(XHS_CONTEXT_REFRESH_MESSAGE);
  }

  // 1. 注入脚本获取 noteDetailMap（最多重试 3 次，等待 __INITIAL_STATE__ 填充）
  let noteMap = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
      noteMap = await getByInject(wd, 'noteMap');
      if (noteMap && Object.keys(noteMap).length > 0) break;
    } catch (e) {
      lastErr = e;
      console.warn(`[灵感爆爆爆] getByInject 第 ${attempt + 1} 次失败:`, e.message);
      const msg = String(e?.message || '');
      if (/Extension context invalidated|context invalidated/i.test(msg) || !isContextValid()) {
        lastErr = new Error(XHS_CONTEXT_REFRESH_MESSAGE);
        break;
      }
    }
    noteMap = null;
  }

  if (!noteMap || Object.keys(noteMap).length === 0) {
    throw lastErr || new Error('未找到笔记数据，请确认当前页面是笔记详情页');
  }

  // 2. 找到正确的笔记数据
  // 优先用当前 URL 的 noteId 精确匹配，避免拿到 'undefined' / '' 等无效 key
  const expectedNoteId = String(options.expectedNoteId || '').trim();
  const currentUrl = wd.location?.href || window.location.href;
  const currentNoteId = extractNoteId(currentUrl);
  const validKeys = Object.keys(noteMap).filter(k => k && k !== 'undefined' && k.length > 10);

  console.log('[灵感爆爆爆] noteMap keys:', validKeys, '| currentNoteId:', currentNoteId, '| expectedNoteId:', expectedNoteId);

  const noteKey = selectNoteKey(noteMap, expectedNoteId, currentUrl);

  if (!noteKey) {
    throw new Error('未找到笔记数据，请确认当前页面是笔记详情页');
  }

  const { note } = resolveExpectedNoteFromMap(noteMap, expectedNoteId, currentUrl);

  console.log('[灵感爆爆爆] note 原始数据:', JSON.stringify({
    noteId: note?.noteId, id: note?.id, title: note?.title,
    likes: note?.interactInfo?.likedCount, type: note?.type,
  }));

  if (!note || (!note.noteId && !note.id && !note.title)) {
    throw new Error('笔记数据解析失败，数据结构异常');
  }

  if (!isCollectedNoteUsable(note, expectedNoteId, { requireStats: true })) {
    throw new Error(`笔记数据未稳定就绪: expected=${expectedNoteId || 'unknown'} actual=${note.noteId || note.id || ''}`);
  }

  // 3. 映射字段
  const imageUrls = (note.imageList || [])
    .map((img) => toHighQualityImageUrl(img.urlDefault || img.url || ''))
    .filter(Boolean);
  const imageCandidates = (note.imageList || [])
    .map((img) => getHighQualityImageCandidates(img.urlDefault || img.url || ''))
    .filter((arr) => arr.length > 0);
  const videoSelection = pickBestVideoStream(note.video?.media?.stream || {});
  const existing = await noteStore.getById(note.noteId || note.id || noteKey);

  const platformContentId = note.noteId || note.id || noteKey;
  const collectedAt = Date.now();
  const publishedAt = parseXhsPublishedAt(
    note.publishTime
      || note.publishDate
      || note.publishedAt
      || note.createTime
      || note.create_time
      || note.time,
    { now: collectedAt },
  );

  const noteInfo = withMonitorRecordMeta({
    noteId: platformContentId,
    contentId: `xhs_${platformContentId}`,
    platformContentId,
    platform: 'xhs',
    url: safeUrl(wd.location?.href || window.location.href),
    canonicalUrl: safeUrl(wd.location?.href || window.location.href),
    title: cleanNoteBodyText(note.title || ''),
    content: cleanNoteBodyText(note.desc || ''),
    bodyText: cleanNoteBodyText(note.desc || ''),
    hashtags: [...new Set([...extractHashtags(note.title || ''), ...extractHashtags(note.desc || '')])],
    type: note.type === 'video' ? 'video' : 'normal',
    cover: toHighQualityImageUrl(note.imageList?.[0]?.urlDefault || note.imageList?.[0]?.url || ''),
    images: imageUrls,
    imageCandidates,
    video: videoSelection.url || note.video?.media?.stream?.h264?.[0]?.masterUrl || '',
    videoStreams: videoSelection.streams || [],
    likes: parseCount(note.interactInfo?.likedCount),
    collects: parseCount(note.interactInfo?.collectedCount),
    comments: parseCount(note.interactInfo?.commentCount),
    shares: parseCount(note.interactInfo?.shareCount),
    keywords: (note.tagList || []).map(t => t.name).filter(Boolean),
    topicIds: (note.tagList || []).map(t => t.id).filter(Boolean),
    atUserList: (note.atUserList || []).map((u) => ({
      userId: u?.userId || '',
      nickname: u?.nickname || '',
    })).filter((u) => u.userId || u.nickname),
    releaseDate: note.time || '',
    lastUpdateTime: note.lastUpdateTime || '',
    ipLocation: note.ipLocation || '',
    shareRestricted: Boolean(note.shareInfo?.unShare),
    authorFollowed: Boolean(note.interactInfo?.followed),
    authorId: note.user?.userId || '',
    authorEntityId: note.user?.userId ? `xhs_${note.user.userId}` : '',
    authorName: note.user?.nickname || '',
    authorAvatar: note.user?.avatar || '',
    publishedAt,
    publishedAtText: note.time || '',
    collectedAt,
    updatedAt: collectedAt,
    collectionRunId: String(options.collectionRunId || '').trim(),
    dataSource: '__INITIAL_STATE__',
    createdAt: existing?.createdAt || collectedAt,
    mediaQuality: 'HD',
    syncStatus: 'pending',
    lastSyncAt: null,
    ...createCollectorEvidence({
      rawPayload: note,
      rawDomText: joinRawDomText([
        note.title || '',
        note.desc || '',
        (note.tagList || []).map((item) => item?.name || '').filter(Boolean).join(' '),
      ]),
      rawUrl: safeUrl(wd.location?.href || window.location.href),
      rawSource: '__INITIAL_STATE__.noteMap',
    }),
  }, options.monitorMeta);

  // 4. 写入 IndexedDB（主键 noteId 自动去重）
  await noteStore.upsert(noteInfo);

  return noteInfo;
}

/**
 * 从搜索/博主页的笔记卡片 DOM 中提取基础信息
 * 用于批量采集时的笔记列表发现
 *
 * 按视觉位置排序（先上后下，同行先左后右），解决瀑布流双列布局下
 * DOM 顺序 ≠ 视觉顺序导致的采集乱序问题
 */
export function discoverNotesFromDOM(containerSelector) {
  const notes = [];
  const seenIds = new Set();
  const sections = document.querySelectorAll(`${containerSelector} section`);

  sections.forEach((section) => {
    const coverLink = section.querySelector('a.cover');
    if (!coverLink) return;

    const url = coverLink.getAttribute('href') || '';
    const noteId = extractNoteId(url);
    if (!noteId || seenIds.has(noteId)) return;
    seenIds.add(noteId);

    const titleEl = section.querySelector('.footer span') || section.querySelector('.title');
    const likesEl = section.querySelector('.like-wrapper .count');
    const hasVideo = section.querySelector('.play-icon') !== null;
    const cover = pickCardCoverImage(section, coverLink);

    // 获取元素的视觉位置用于排序
    const rect = section.getBoundingClientRect();

    notes.push({
      noteId,
      url: safeUrl(url),
      title: titleEl?.textContent?.trim() || '',
      likes: likesEl?.textContent?.trim() || '0',
      type: hasVideo ? 'video' : 'normal',
      cover,
      coverImg: cover,
      coverUrl: cover,
      thumbnail: cover,
      images: cover ? [cover] : [],
      element: section,
      _top: rect.top + window.scrollY,
      _left: rect.left,
    });
  });

  // 按视觉位置排序：先按纵坐标（容差 50px 视为同行），再按横坐标
  notes.sort((a, b) => {
    const rowDiff = Math.abs(a._top - b._top);
    if (rowDiff < 50) return a._left - b._left; // 同行按左右
    return a._top - b._top; // 不同行按上下
  });

  return notes;
}

function normalizePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function firstText(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed !== '[object Object]' ? trimmed : '';
}

function readAttribute(element, name) {
  if (!element || typeof element.getAttribute !== 'function') return '';
  return firstText(element.getAttribute(name));
}

function firstSrcsetUrl(value = '') {
  const text = firstText(value);
  if (!text) return '';
  const candidates = text
    .split(',')
    .map((item) => firstText(item).split(/\s+/)[0])
    .filter(Boolean);
  return candidates[candidates.length - 1] || '';
}

function backgroundImageUrl(value = '') {
  const text = firstText(value);
  const match = text.match(/url\((["']?)(.*?)\1\)/i);
  return firstText(match?.[2] || '');
}

function pickImageUrlFromElement(element) {
  if (!element) return '';
  const candidates = [
    firstText(element.currentSrc),
    firstText(element.src),
    readAttribute(element, 'src'),
    readAttribute(element, 'data-src'),
    readAttribute(element, 'data-original'),
    readAttribute(element, 'data-lazy-src'),
    readAttribute(element, 'data-url'),
    firstSrcsetUrl(readAttribute(element, 'srcset')),
    backgroundImageUrl(element.style?.backgroundImage),
    backgroundImageUrl(readAttribute(element, 'style')),
  ];
  const raw = candidates.find(Boolean) || '';
  return raw ? toHighQualityImageUrl(raw) : '';
}

function pickCardCoverImage(section, coverLink) {
  const imageSelectors = [
    'img, picture img, source',
    'img',
    'picture img',
    'source',
  ];
  const candidates = [];

  for (const selector of imageSelectors) {
    const fromCover = typeof coverLink?.querySelector === 'function'
      ? coverLink.querySelector(selector)
      : null;
    if (fromCover) candidates.push(fromCover);

    const fromSection = typeof section?.querySelector === 'function'
      ? section.querySelector(selector)
      : null;
    if (fromSection) candidates.push(fromSection);
  }

  candidates.push(coverLink, section);

  for (const candidate of candidates) {
    const imageUrl = pickImageUrlFromElement(candidate);
    if (imageUrl) return imageUrl;
  }

  return '';
}

function getWindowScrollTarget() {
  return { type: 'window', element: null };
}

function isScrollableElement(element) {
  if (!element) return false;
  const scrollHeight = Number(element.scrollHeight || 0);
  const clientHeight = Number(element.clientHeight || 0);
  return clientHeight > 0 && scrollHeight > clientHeight + 24;
}

function getDiscoveryScrollTarget(containerSelector) {
  if (typeof document === 'undefined' || typeof document.querySelector !== 'function') {
    return getWindowScrollTarget();
  }

  let node = document.querySelector(containerSelector);
  while (node && node !== document.body && node !== document.documentElement) {
    if (isScrollableElement(node)) {
      return { type: 'element', element: node };
    }
    node = node.parentElement;
  }

  return getWindowScrollTarget();
}

function isElementScrollTarget(scrollTarget) {
  return scrollTarget?.type === 'element' && scrollTarget.element;
}

function getScrollMetrics(scrollTarget = getWindowScrollTarget()) {
  if (isElementScrollTarget(scrollTarget)) {
    const element = scrollTarget.element;
    const elementHeight = Number(element.clientHeight || 0);
    const windowHeight = typeof window === 'undefined' ? Number(document?.documentElement?.clientHeight || 0) : Number(window.innerHeight || 0);
    // 对列表自身可滚动的虚拟流，必须按列表可视高度算“到底”，不能拿浏览器整窗高度代替。
    const viewportHeight = Math.max(elementHeight || windowHeight, 1);
    const scrollHeight = Math.max(Number(element.scrollHeight || 0), viewportHeight);
    const scrollTop = Math.max(Number(element.scrollTop || 0), 0);
    const maxTop = Math.max(0, scrollHeight - viewportHeight);
    return {
      scrollTop,
      viewportHeight,
      scrollHeight,
      maxTop,
      atBottom: scrollTop >= Math.max(0, maxTop - 24),
    };
  }

  const doc = document.documentElement || document.body;
  const body = document.body || doc;
  const scrollTop = Math.max(window.scrollY || 0, doc?.scrollTop || 0, body?.scrollTop || 0);
  const viewportHeight = Math.max(window.innerHeight || 0, doc?.clientHeight || 0, body?.clientHeight || 0);
  const scrollHeight = Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0, viewportHeight);
  const maxTop = Math.max(0, scrollHeight - viewportHeight);
  return {
    scrollTop,
    viewportHeight,
    scrollHeight,
    maxTop,
    atBottom: scrollTop >= Math.max(0, maxTop - 24),
  };
}

function scrollDiscoveryTargetTo(scrollTarget, top) {
  const nextTop = Math.max(0, Number(top || 0));
  if (isElementScrollTarget(scrollTarget)) {
    scrollTarget.element.scrollTop = nextTop;
    return;
  }
  window.scrollTo({ top: nextTop, behavior: 'auto' });
}

function scrollDiscoveryTargetBy(scrollTarget, top) {
  const offset = Number(top || 0);
  if (isElementScrollTarget(scrollTarget)) {
    const currentTop = Math.max(0, Number(scrollTarget.element.scrollTop || 0));
    scrollTarget.element.scrollTop = Math.max(0, currentTop + offset);
    return;
  }
  window.scrollBy({ top: offset, behavior: 'auto' });
}

export function buildDiscoveryPlan(containerSelector, {
  maxScrolls = 10,
  expectedCount = 0,
} = {}) {
  const isProfileMode = containerSelector === '#userPostedFeeds';
  const normalizedMaxScrolls = normalizePositiveInteger(maxScrolls, 10);
  const normalizedExpectedCount = normalizePositiveInteger(expectedCount, 0);
  const profileTargetRounds = normalizedExpectedCount > 0
    ? Math.min(Math.max(normalizedExpectedCount, 28), 80)
    : 28;
  const maxRounds = isProfileMode
    ? Math.max(
      normalizedMaxScrolls,
      profileTargetRounds,
    )
    : normalizedMaxScrolls;

  return {
    isProfileMode,
    expectedCount: normalizedExpectedCount,
    maxRounds,
    settleDelay: isProfileMode ? 1300 : 900,
    stableNoNewLimit: isProfileMode ? 4 : 2,
    bottomConfirmationRounds: isProfileMode ? 6 : 0,
    stepRatio: isProfileMode ? 0.55 : 0.68,
    requireBottomOrExpected: isProfileMode,
  };
}

export function shouldStopDiscovery({
  noNewCount = 0,
  stableNoNewLimit = 2,
  discoveredCount = 0,
  expectedCount = 0,
  atBottom = false,
  bottomNoNewCount = 0,
  bottomConfirmationRounds = 0,
  requireBottomOrExpected = false,
} = {}) {
  if (noNewCount < stableNoNewLimit) return false;
  if (!requireBottomOrExpected) return true;
  const discoveredEnough = expectedCount > 0 && discoveredCount >= expectedCount;
  if (discoveredEnough) return true;
  return atBottom && bottomNoNewCount >= bottomConfirmationRounds;
}

function createWheelEvent(deltaY) {
  if (typeof WheelEvent === 'function') {
    return () => new WheelEvent('wheel', {
      deltaY,
      bubbles: true,
      cancelable: true,
    });
  }

  if (typeof Event === 'function') {
    return () => {
      const event = new Event('wheel', {
        bubbles: true,
        cancelable: true,
      });
      try {
        Object.defineProperty(event, 'deltaY', { value: deltaY });
      } catch {
        // Some browser Event objects do not allow redefining properties.
      }
      return event;
    };
  }

  return () => ({ type: 'wheel', deltaY });
}

function dispatchDiscoveryWheel(scrollTarget, deltaY) {
  const makeEvent = createWheelEvent(deltaY);
  const targets = isElementScrollTarget(scrollTarget)
    ? [scrollTarget.element]
    : [window, document, document.documentElement, document.body];

  for (const target of targets) {
    if (!target || typeof target.dispatchEvent !== 'function') continue;
    try {
      target.dispatchEvent(makeEvent());
    } catch {
      // The wheel event is only a loading nudge; normal scroll still moves the page.
    }
  }
}

async function probeProfileBottom(containerSelector, previousSnapshot, settleDelay, scrollTarget) {
  const metrics = getScrollMetrics(scrollTarget);
  if (!metrics.atBottom) return false;

  const bounceStep = Math.max(180, Math.round(metrics.viewportHeight * 0.35));
  const retreatTop = Math.max(0, metrics.scrollTop - bounceStep);
  if (retreatTop < metrics.scrollTop - 1) {
    scrollDiscoveryTargetTo(scrollTarget, retreatTop);
    await new Promise((resolve) => setTimeout(resolve, 220));
  }

  const refreshed = getScrollMetrics(scrollTarget);
  const returnTop = Math.max(metrics.maxTop, refreshed.maxTop);
  if (returnTop > refreshed.scrollTop + 1) {
    scrollDiscoveryTargetTo(scrollTarget, returnTop);
  }

  const nudgeStep = Math.max(220, Math.round(metrics.viewportHeight * 0.45));
  scrollDiscoveryTargetBy(scrollTarget, nudgeStep);
  dispatchDiscoveryWheel(scrollTarget, nudgeStep);

  await waitForDiscoverySettle(
    containerSelector,
    previousSnapshot,
    settleDelay + 900,
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 320));
  return true;
}

/**
 * 滚动发现更多笔记（处理懒加载）
 * 在批量采集前调用，确保尽可能多的笔记被加载到 DOM 中
 */
export async function discoverWithScroll(containerSelector, maxScrolls = 10, options = {}) {
  const allNotes = new Map(); // key=noteId，滚动期间持续累积，不依赖回顶后的 DOM
  let noNewCount = 0;
  let bottomNoNewCount = 0;
  let scrollTarget = getDiscoveryScrollTarget(containerSelector);
  const plan = buildDiscoveryPlan(containerSelector, {
    maxScrolls,
    expectedCount: options.expectedCount,
  });

  for (let i = 0; i < plan.maxRounds; i++) {
    scrollTarget = getDiscoveryScrollTarget(containerSelector);
    const found = discoverNotesFromDOM(containerSelector);
    let hasNew = false;

    for (const note of found) {
      if (!allNotes.has(note.noteId)) {
        allNotes.set(note.noteId, {
          ...note,
          _discoveryOrder: allNotes.size,
        });
        hasNew = true;
      }
    }

    const discoveredEnough = plan.expectedCount > 0 && allNotes.size >= plan.expectedCount;
    if (discoveredEnough) break;

    const metrics = getScrollMetrics(scrollTarget);
    const discoverySnapshot = {
      visibleCount: found.length,
      knownNoteIds: new Set(allNotes.keys()),
    };
    if (!hasNew) {
      noNewCount++;
      if (plan.isProfileMode && metrics.atBottom && !discoveredEnough) {
        bottomNoNewCount++;
        if (bottomNoNewCount < plan.bottomConfirmationRounds) {
          await probeProfileBottom(containerSelector, discoverySnapshot, plan.settleDelay, scrollTarget);
          continue;
        }
      } else {
        bottomNoNewCount = 0;
      }
      if (shouldStopDiscovery({
        noNewCount,
        stableNoNewLimit: plan.stableNoNewLimit,
        discoveredCount: allNotes.size,
        expectedCount: plan.expectedCount,
        atBottom: metrics.atBottom,
        bottomNoNewCount,
        bottomConfirmationRounds: plan.bottomConfirmationRounds,
        requireBottomOrExpected: plan.requireBottomOrExpected,
      })) break;
    } else {
      noNewCount = 0;
      bottomNoNewCount = 0;
    }

    // 每次滚动约 68% 屏高；博主页使用更慢节奏防止空白卡片
    const step = Math.round(metrics.viewportHeight * plan.stepRatio);
    const nextTop = Math.min(metrics.maxTop, metrics.scrollTop + step);
    if (nextTop > metrics.scrollTop + 1) {
      scrollDiscoveryTargetTo(scrollTarget, nextTop);
    } else if (!metrics.atBottom) {
      scrollDiscoveryTargetBy(scrollTarget, step);
    }
    await waitForDiscoverySettle(
      containerSelector,
      discoverySnapshot,
      plan.settleDelay,
      plan.isProfileMode,
    );

    // 某些博主页会出现短暂空白，额外等待一次再做下一轮
    if (plan.isProfileMode && found.length === 0) {
      await new Promise(r => setTimeout(r, 450));
    }
  }

  // 滚回顶部
  scrollDiscoveryTargetTo(scrollTarget, 0);
  await new Promise(r => setTimeout(r, 200));

  // 关键修复：返回滚动期间累积的所有笔记（按发现时的视觉位置排序）
  // 不能再次调用 discoverNotesFromDOM，因为虚拟列表在回顶后已卸载底部卡片
  const result = Array.from(allNotes.values());
  result.sort((a, b) => {
    const orderA = Number.isFinite(a._discoveryOrder) ? a._discoveryOrder : Number.MAX_SAFE_INTEGER;
    const orderB = Number.isFinite(b._discoveryOrder) ? b._discoveryOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    const rowDiff = Math.abs(a._top - b._top);
    if (rowDiff < 50) return a._left - b._left;
    return a._top - b._top;
  });
  return result;
}
