import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAuthorRecord } from '../src/db/recordNormalization.js';
import { createContentMessageHandlers } from '../src/content/messageHandlers.js';
import { MSG } from '../src/shared/constants.js';

test('normalizeAuthorRecord preserves collectionRunId for author records', () => {
  const normalized = normalizeAuthorRecord({
    platform: 'xhs',
    userId: 'user_1',
    name: '作者A',
    collectionRunId: 'run_author_1',
  });

  assert.equal(normalized.collectionRunId, 'run_author_1');
});

test('remote author collection creates a collection run and passes collectionRunId into xhs collector', async () => {
  const calls = [];
  const collectionRunStore = {
    async createRun(input) {
      calls.push(['createRun', input]);
      return { collectionRunId: 'run_author_1' };
    },
    async markDone(runId, payload) {
      calls.push(['markDone', runId, payload]);
      return { collectionRunId: runId, ...payload };
    },
    async markFailed(runId, error, payload) {
      calls.push(['markFailed', runId, error, payload]);
      return { collectionRunId: runId, error, ...payload };
    },
  };

  let collectorOptions = null;
  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => false,
    collectAuthor: async (options = {}) => {
      collectorOptions = options;
      return {
        userId: 'xhs_1',
        name: '作者A',
        collectionRunId: options.collectionRunId,
      };
    },
    collectDouyinAuthor: async () => ({ ok: true, data: {} }),
    noteStore: { count: async () => 0, getAll: async () => [] },
    commentStore: { count: async () => 0, getAll: async () => [] },
    authorStore: { count: async () => 0, getAll: async () => [] },
    reportDone: () => {},
    batchMessageHandlers: {},
    extractNoteId: () => '',
    downloadNoteMediaFromRecord: async () => ({}),
    generateCsv: () => '',
    downloadFile: () => {},
    backfillLegacyAiReadyFields: async () => ({}),
    getPageContext: async () => ({ platform: 'xhs', pageType: 'profile' }),
    collectionRunStore,
  });

  const result = await handlers[MSG.COLLECT_AUTHOR]({
    triggerSource: 'workbench_dispatch',
    externalTaskMeta: {
      externalTaskId: 'wb_task_author_1',
      externalTaskType: 'xhs.collectAuthor',
      protocolVersion: 'v1',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.collectionRunId, 'run_author_1');
  assert.equal(collectorOptions.collectionRunId, 'run_author_1');
  assert.equal(collectorOptions.triggerSource, 'workbench_dispatch');
  assert.equal(calls[0][0], 'createRun');
  assert.equal(calls[0][1].externalTaskId, 'wb_task_author_1');
  assert.equal(calls[0][1].externalTaskType, 'xhs.collectAuthor');
  assert.equal(calls[0][1].protocolVersion, 'v1');
  assert.equal(calls[0][1].platform, 'xhs');
  assert.equal(calls[0][1].taskType, 'collectAuthor');
  assert.equal(calls[0][1].pageType, 'profile');
  assert.equal(calls[0][1].triggerSource, 'workbench_dispatch');
  assert.equal(calls[0][1].resultUploadStatus, 'pending_upload');
  assert.equal(typeof calls[0][1].lastHeartbeatAt, 'number');
  assert.deepEqual(calls[0][1].config, {});
  assert.deepEqual(calls[0][1].meta, { pageUrl: '' });
  assert.equal(calls[1][0], 'markDone');
  assert.equal(calls[1][1], 'run_author_1');
});

test('remote author collection can acknowledge async dispatch before collector finishes', async () => {
  const calls = [];
  let releaseCollector;
  let collectorStarted = false;
  const collectorDone = new Promise((resolve) => {
    releaseCollector = resolve;
  });

  const collectionRunStore = {
    async createRun(input) {
      calls.push(['createRun', input]);
      return { collectionRunId: 'run_author_async_1' };
    },
    async markDone(runId, payload) {
      calls.push(['markDone', runId, payload]);
      return { collectionRunId: runId, ...payload };
    },
    async markFailed(runId, error, payload) {
      calls.push(['markFailed', runId, error, payload]);
      return { collectionRunId: runId, error, ...payload };
    },
  };

  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => false,
    collectAuthor: async (options = {}) => {
      collectorStarted = true;
      await collectorDone;
      return {
        userId: 'xhs_async_1',
        name: '作者B',
        collectionRunId: options.collectionRunId,
      };
    },
    collectDouyinAuthor: async () => ({ ok: true, data: {} }),
    noteStore: { count: async () => 0, getAll: async () => [] },
    commentStore: { count: async () => 0, getAll: async () => [] },
    authorStore: { count: async () => 0, getAll: async () => [] },
    reportDone: () => {},
    batchMessageHandlers: {},
    extractNoteId: () => '',
    downloadNoteMediaFromRecord: async () => ({}),
    generateCsv: () => '',
    downloadFile: () => {},
    backfillLegacyAiReadyFields: async () => ({}),
    getPageContext: async () => ({ platform: 'xhs', pageType: 'profile' }),
    collectionRunStore,
  });

  const result = await handlers[MSG.COLLECT_AUTHOR]({
    triggerSource: 'workbench_dispatch',
    asyncDispatch: true,
    externalTaskMeta: {
      externalTaskId: 'wb_task_author_async_1',
      externalTaskType: 'xhs.collectAuthor',
      protocolVersion: 'v1',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.accepted, true);
  assert.equal(result.pending, true);
  assert.equal(result.collectionRunId, 'run_author_async_1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'createRun');

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(collectorStarted, true);
  assert.equal(calls.length, 1);

  releaseCollector();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls[1][0], 'markDone');
  assert.equal(calls[1][1], 'run_author_async_1');
});

test('content workbench result handler proxies to page-side result packager', async () => {
  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => false,
    collectAuthor: async () => ({}),
    collectDouyinAuthor: async () => ({ ok: true, data: {} }),
    noteStore: { count: async () => 0, getAll: async () => [] },
    commentStore: { count: async () => 0, getAll: async () => [] },
    authorStore: { count: async () => 0, getAll: async () => [] },
    reportDone: () => {},
    batchMessageHandlers: {},
    extractNoteId: () => '',
    downloadNoteMediaFromRecord: async () => ({}),
    generateCsv: () => '',
    downloadFile: () => {},
    backfillLegacyAiReadyFields: async () => ({}),
    getPageContext: async () => ({ platform: 'xhs', pageType: 'profile' }),
    collectionRunStore: {},
    packageWorkbenchResult: async ({ externalTaskId }) => ({
      externalTaskId,
      resultSummary: { authors: 1 },
    }),
  });

  const result = await handlers[MSG.WORKBENCH_GET_RESULT_PACKAGE]({
    externalTaskId: 'wb_result_1',
  });

  assert.equal(result.success, true);
  assert.equal(result.result.externalTaskId, 'wb_result_1');
  assert.equal(result.result.resultSummary.authors, 1);
});
