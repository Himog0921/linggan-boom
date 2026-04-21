import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResultSummary } from '../src/workbench/runtime/resultSummaryBuilder.js';
import { createResultPackager } from '../src/workbench/runtime/resultPackager.js';

test('buildResultSummary counts records and failed items', () => {
  const summary = buildResultSummary({
    notes: [{ dataQuality: 'seed', sourceTier: 'seed' }, { dataQuality: 'full', sourceTier: 'api' }],
    comments: [
      { dataQuality: 'degraded', sourceTier: 'dom' },
      { dataQuality: 'full', sourceTier: 'api' },
      { dataQuality: 'full', sourceTier: 'api' },
    ],
    authors: [{ dataQuality: 'degraded', sourceTier: 'mixed' }],
    mediaAssets: [
      { downloadStatus: '已下载' },
      { downloadStatus: '失败' },
    ],
    runRecord: {
      itemsPlanned: 5,
      itemsFailed: 2,
    },
  });

  assert.equal(summary.notes, 2);
  assert.equal(summary.comments, 3);
  assert.equal(summary.authors, 1);
  assert.equal(summary.mediaAssets, 2);
  assert.equal(summary.downloadedMediaAssets, 1);
  assert.equal(summary.failedItems, 2);
  assert.deepEqual(summary.dataQualityBreakdown, {
    full: 3,
    degraded: 2,
    seed: 1,
  });
  assert.deepEqual(summary.sourceTierBreakdown, {
    api: 3,
    dom: 1,
    mixed: 1,
    seed: 1,
  });
});

test('createResultPackager packages one run with records and summary', async () => {
  const calls = [];
  const packager = createResultPackager({
    collectionRunStore: {
      getById: async () => ({
        collectionRunId: 'run_1',
        platform: 'douyin',
        taskType: 'batchComments',
        status: 'done',
      }),
      markResultUploadStatus: async (runId, status, patch = {}) => {
        calls.push([runId, status, patch]);
      },
    },
    noteStore: {
      getByCollectionRunId: async () => [{ noteId: 'n1' }],
    },
    commentStore: {
      getByCollectionRunId: async () => [{ commentId: 'c1' }, { commentId: 'c2' }],
    },
    authorStore: {
      getByCollectionRunId: async () => [{ userId: 'u1' }],
    },
    mediaAssetStore: {
      getByCollectionRunId: async () => [{ assetId: 'a1', downloadStatus: '已下载' }],
    },
  });

  const result = await packager.packageByCollectionRunId('run_1');

  assert.equal(result.collectionRunId, 'run_1');
  assert.equal(result.platform, 'douyin');
  assert.equal(result.resultSummary.comments, 2);
  assert.equal(result.records.notes.length, 1);
  assert.equal(result.records.authors.length, 1);
  assert.equal(calls[0][0], 'run_1');
  assert.equal(calls[0][1], 'packaged');
  assert.equal(typeof calls[0][2].packagedAt, 'number');
});

test('createResultPackager can resolve latest run by externalTaskId', async () => {
  const calls = [];
  const packager = createResultPackager({
    collectionRunStore: {
      getById: async (id) => ({
        collectionRunId: id,
        externalTaskId: 'wb_task_1',
        platform: 'douyin',
        taskType: 'batchNotes',
        status: 'done',
      }),
      getLatestByExternalTaskId: async () => ({
        collectionRunId: 'run_external_1',
        externalTaskId: 'wb_task_1',
        platform: 'douyin',
        taskType: 'batchNotes',
        status: 'done',
      }),
      markResultUploadStatus: async (runId, status, patch = {}) => {
        calls.push([runId, status, patch]);
      },
    },
    noteStore: {
      getByCollectionRunId: async () => [{ noteId: 'n1' }, { noteId: 'n2' }],
    },
    commentStore: {
      getByCollectionRunId: async () => [],
    },
    authorStore: {
      getByCollectionRunId: async () => [],
    },
    mediaAssetStore: {
      getByCollectionRunId: async () => [],
    },
  });

  const result = await packager.packageByExternalTaskId('wb_task_1');

  assert.equal(result.collectionRunId, 'run_external_1');
  assert.equal(result.externalTaskId, 'wb_task_1');
  assert.equal(result.resultSummary.notes, 2);
  assert.equal(calls[0][0], 'run_external_1');
  assert.equal(calls[0][1], 'packaged');
});
