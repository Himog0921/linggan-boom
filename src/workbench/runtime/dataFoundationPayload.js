function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function normalizeCodePart(value = '') {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s:/\\|?#[\]{}()'"`]+/g, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '');
}

function normalizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim().toLowerCase().replace(/,/g, '');
    const match = text.match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    if (!Number.isFinite(parsed)) return null;
    const suffix = text.slice((match.index || 0) + match[0].length).trim();
    const multiplier = suffix.startsWith('万') || suffix.startsWith('w')
      ? 10000
      : suffix.startsWith('千') || suffix.startsWith('k')
        ? 1000
        : 1;
    return Math.round(parsed * multiplier);
  }
  return null;
}

function normalizeIso(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1000000000000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function inferPlatform(record = {}) {
  const explicit = normalizeText(record.platform).toLowerCase();
  if (explicit === 'xhs' || explicit === 'douyin') return explicit;
  const url = normalizeText(record.url || record.canonicalUrl || record.rawUrl || record.noteUrl);
  if (/douyin\.com/i.test(url)) return 'douyin';
  return 'xhs';
}

function inferPlatformContentId(record = {}) {
  const explicit = normalizeText(record.platformContentId);
  if (explicit) return explicit.replace(/^(xhs_|dy_|douyin_)/, '');
  const noteId = normalizeText(record.noteId || record.contentId || record.videoId || record.awemeId || record.id);
  return noteId.replace(/^(xhs_|dy_|douyin_)/, '');
}

function inferContentType(record = {}) {
  const explicit = normalizeText(record.contentType || record.type).toLowerCase();
  if (explicit === 'video' || explicit === 'image_text' || explicit === 'image' || explicit === 'note') {
    return explicit === 'image' ? 'image_text' : explicit;
  }
  if (
    normalizeText(record.videoUrl || record.video || record.videoPlayUrl || record.videoDownloadUrl)
    || normalizeArray(record.videoStreams).length > 0
  ) {
    return 'video';
  }
  return 'image_text';
}

function firstNumber(record = {}, fields = []) {
  for (const field of fields) {
    const value = normalizeNumber(record[field]);
    if (value !== null) return value;
  }
  return null;
}

function firstIso(record = {}, fields = []) {
  for (const field of fields) {
    const value = normalizeIso(record[field]);
    if (value) return value;
  }
  return '';
}

function firstText(record = {}, fields = []) {
  for (const field of fields) {
    const value = normalizeText(record[field]);
    if (value) return value;
  }
  return '';
}

function normalizeKeyword(value = '') {
  return normalizeText(value).replace(/^#+/, '').trim();
}

function extractKeywords(record = {}) {
  const values = [
    ...normalizeArray(record.keywords),
    ...normalizeArray(record.hashtags),
    ...normalizeArray(record.tags),
    ...normalizeArray(record.topics),
    ...normalizeArray(record.searchKeywords),
    normalizeText(record.searchKeyword),
  ];
  return [...new Set(values.map(normalizeKeyword).filter(Boolean))];
}

function extractMediaUnderstanding(record = {}) {
  const transcript = firstText(record, ['transcript', 'videoTranscript', 'asrText', 'speechText']);
  const visualSummary = firstText(record, ['visualSummary', 'videoVisualSummary', 'frameSummary', 'imageDescription']);
  const ocrText = firstText(record, ['ocrText', 'coverOcrText', 'imageOcrText', 'doubaoOcrText']);
  if (!transcript && !visualSummary && !ocrText) return undefined;
  return {
    ...(transcript ? { transcript } : {}),
    ...(visualSummary ? { visualSummary } : {}),
    ...(ocrText ? { ocrText } : {}),
  };
}

function buildContentCode({ platform, contentType, platformContentId }) {
  const normalizedPlatform = normalizeCodePart(platform);
  const normalizedType = normalizeCodePart(contentType);
  const normalizedId = normalizeCodePart(platformContentId);
  if (!normalizedPlatform || !normalizedType || !normalizedId) return '';
  return `cw-content:global:${normalizedPlatform}:${normalizedType}:${normalizedId}`;
}

function buildAuthorCode({ platform, authorId }) {
  const normalizedPlatform = normalizeCodePart(platform);
  const normalizedId = normalizeCodePart(authorId);
  if (!normalizedPlatform || !normalizedId) return '';
  return `cw-author:global:${normalizedPlatform}:${normalizedId}`;
}

export function enrichNoteWithDataFoundationPayload(record = {}, context = {}) {
  const platform = inferPlatform(record);
  const platformContentId = inferPlatformContentId(record);
  const contentType = inferContentType(record);
  const authorId = firstText(record, ['authorId', 'authorPlatformId', 'userId']);
  const authorFans = firstNumber(record, [
    'authorFans',
    'fans',
    'fanCount',
    'followerCount',
    'followers',
    'authorFollowerCount',
  ]);
  const authorFansCollectedAt = firstIso(record, [
    'authorFansCollectedAt',
    'fansCollectedAt',
    'authorCollectedAt',
    'collectedAt',
    'updatedAt',
  ]);
  const keywords = extractKeywords(record);
  const mediaUnderstanding = extractMediaUnderstanding(record);
  const taskId = normalizeText(context.taskId);
  const recordId = normalizeText(context.externalRecordId || platformContentId || record.noteId || record.url);
  const pluginRunId = normalizeText(context.pluginRunId || record.collectionRunId);
  const sourceRun = taskId && recordId ? {
    source: normalizeText(context.source) || 'plugin_task_delta',
    taskId,
    recordId,
  } : undefined;
  const standardContentCode = buildContentCode({ platform, contentType, platformContentId });
  const standardAuthorCode = buildAuthorCode({ platform, authorId });

  return {
    ...record,
    platform,
    platformContentId: platformContentId || record.platformContentId,
    contentType,
    ...(standardContentCode ? { standardContentCode } : {}),
    ...(standardAuthorCode ? { standardAuthorCode } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
    ...(authorFans !== null ? { authorFans } : {}),
    ...(authorFansCollectedAt ? { authorFansCollectedAt } : {}),
    ...(mediaUnderstanding ? { mediaUnderstanding } : {}),
    ...(sourceRun ? { sourceRun } : {}),
    dataFoundation: {
      schemaVersion: 'data-foundation-plugin-v1',
      ...(standardContentCode ? { standardContentCode } : {}),
      ...(standardAuthorCode ? { standardAuthorCode } : {}),
      ...(sourceRun ? { sourceRun } : {}),
      ...(pluginRunId ? { pluginRunId } : {}),
      evidenceFields: {
        hasAuthorFans: authorFans !== null,
        hasKeywords: keywords.length > 0,
        hasMediaUnderstanding: Boolean(mediaUnderstanding),
      },
    },
  };
}
