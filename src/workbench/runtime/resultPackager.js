import { buildResultSummary } from './resultSummaryBuilder.js';

async function getRecordsByCollectionRunId(store, collectionRunId) {
  if (!store) return [];
  if (typeof store.getByCollectionRunId === 'function') {
    const result = await store.getByCollectionRunId(collectionRunId);
    return Array.isArray(result) ? result : [];
  }
  if (typeof store.getAll === 'function') {
    const result = await store.getAll();
    return (Array.isArray(result) ? result : []).filter((item) => String(item?.collectionRunId || '').trim() === collectionRunId);
  }
  return [];
}

export function createResultPackager({
  collectionRunStore,
  noteStore,
  commentStore,
  authorStore,
  mediaAssetStore,
} = {}) {
  return {
    async packageByCollectionRunId(collectionRunId = '') {
      const runId = String(collectionRunId || '').trim();
      if (!runId) {
        throw new Error('collectionRunId is required');
      }

      const runRecord = await collectionRunStore?.getById?.(runId);
      if (!runRecord) {
        throw new Error(`collectionRun not found: ${runId}`);
      }

      const [notes, comments, authors, mediaAssets] = await Promise.all([
        getRecordsByCollectionRunId(noteStore, runId),
        getRecordsByCollectionRunId(commentStore, runId),
        getRecordsByCollectionRunId(authorStore, runId),
        getRecordsByCollectionRunId(mediaAssetStore, runId),
      ]);

      await collectionRunStore?.markResultUploadStatus?.(runId, 'packaged', {
        packagedAt: Date.now(),
      });

      return {
        collectionRunId: runId,
        externalTaskId: String(runRecord.externalTaskId || '').trim(),
        externalTaskType: String(runRecord.externalTaskType || '').trim(),
        platform: String(runRecord.platform || '').trim(),
        taskType: String(runRecord.taskType || '').trim(),
        status: String(runRecord.status || '').trim(),
        startedAt: Number(runRecord.startedAt || 0) || 0,
        finishedAt: Number(runRecord.finishedAt || 0) || 0,
        resultSummary: buildResultSummary({
          notes,
          comments,
          authors,
          mediaAssets,
          runRecord,
        }),
        records: {
          notes,
          comments,
          authors,
          mediaAssets,
        },
        runRecord,
      };
    },

    async packageByExternalTaskId(externalTaskId = '') {
      const taskId = String(externalTaskId || '').trim();
      if (!taskId) {
        throw new Error('externalTaskId is required');
      }

      const runRecord = await collectionRunStore?.getLatestByExternalTaskId?.(taskId);
      if (!runRecord?.collectionRunId) {
        throw new Error(`collectionRun not found for externalTaskId: ${taskId}`);
      }

      return this.packageByCollectionRunId(runRecord.collectionRunId);
    },
  };
}
