function normalizeCount(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function countDownloadedMediaAssets(mediaAssets = []) {
  return (mediaAssets || []).filter((asset) => /已下载|成功|complete/i.test(String(asset?.downloadStatus || ''))).length;
}

function buildBreakdown(records = [], key = '') {
  const buckets = {};
  for (const record of Array.isArray(records) ? records : []) {
    const value = String(record?.[key] || '').trim();
    if (!value) continue;
    buckets[value] = (buckets[value] || 0) + 1;
  }
  return buckets;
}

export function buildResultSummary({
  notes = [],
  comments = [],
  authors = [],
  mediaAssets = [],
  runRecord = {},
} = {}) {
  const allRecords = [
    ...(Array.isArray(notes) ? notes : []),
    ...(Array.isArray(comments) ? comments : []),
    ...(Array.isArray(authors) ? authors : []),
  ];
  return {
    notes: Array.isArray(notes) ? notes.length : 0,
    comments: Array.isArray(comments) ? comments.length : 0,
    authors: Array.isArray(authors) ? authors.length : 0,
    mediaAssets: Array.isArray(mediaAssets) ? mediaAssets.length : 0,
    downloadedMediaAssets: countDownloadedMediaAssets(mediaAssets),
    itemsPlanned: normalizeCount(runRecord.itemsPlanned, 0),
    itemsSucceeded: normalizeCount(runRecord.itemsSucceeded, 0),
    failedItems: normalizeCount(runRecord.itemsFailed, 0),
    completionNote: typeof runRecord.completionNote === 'string' ? runRecord.completionNote.trim() : '',
    requestedCount: normalizeCount(runRecord.requestedCount, 0),
    discoveredCount: normalizeCount(runRecord.discoveredCount, 0),
    shortfallCount: normalizeCount(runRecord.shortfallCount, 0),
    dataQualityBreakdown: buildBreakdown(allRecords, 'dataQuality'),
    sourceTierBreakdown: buildBreakdown(allRecords, 'sourceTier'),
  };
}
