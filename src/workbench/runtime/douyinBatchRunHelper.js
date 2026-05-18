function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeDouyinTargetId(item = {}) {
  return normalizeText(
    item.awemeId
    || item.platformContentId
    || item.videoId
    || item.noteId
    || item.contentId,
  ).replace(/^(dy_|douyin_)/i, '');
}

function normalizeDouyinContentId(item = {}) {
  const direct = normalizeText(item.contentId || item.noteId);
  if (direct.startsWith('dy_')) return direct;

  const targetId = normalizeDouyinTargetId(item);
  return targetId ? `dy_${targetId}` : '';
}

function buildTargetIds(targets = []) {
  return (Array.isArray(targets) ? targets : [])
    .map((item) => normalizeDouyinTargetId(item))
    .filter(Boolean);
}

function buildFailedTargets(results = []) {
  return (Array.isArray(results) ? results : [])
    .filter((item) => !item?.ok)
    .map((item) => ({
      awemeId: normalizeDouyinTargetId(item),
      error: normalizeText(item?.error) || 'failed',
    }))
    .filter((item) => item.awemeId || item.error);
}

function buildContentIds(results = []) {
  return (Array.isArray(results) ? results : [])
    .filter((item) => item?.ok)
    .map((item) => normalizeDouyinContentId(item))
    .filter(Boolean);
}

export function buildDouyinBatchVideosRunPatch({
  targets = [],
  results = [],
} = {}) {
  const targetIds = buildTargetIds(targets);
  const failedTargets = buildFailedTargets(results);

  return {
    itemsPlanned: targetIds.length,
    itemsSucceeded: buildContentIds(results).length,
    itemsFailed: failedTargets.length,
    targetIds,
    contentIds: buildContentIds(results),
    failedTargets,
  };
}

export function buildDouyinBatchCommentsRunPatch({
  targets = [],
  results = [],
  totalComments = 0,
} = {}) {
  const targetIds = buildTargetIds(targets);
  const failedTargets = buildFailedTargets(results);

  return {
    itemsPlanned: targetIds.length,
    itemsSucceeded: buildContentIds(results).length,
    itemsFailed: failedTargets.length,
    totalComments: Math.max(0, Number(totalComments || 0) || 0),
    targetIds,
    contentIds: buildContentIds(results),
    failedTargets,
  };
}
