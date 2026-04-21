import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCapabilityReport } from '../src/workbench/runtime/capabilityReportBuilder.js';
import { mapTaskEnvelopeToInternalCommand } from '../src/workbench/runtime/taskEnvelopeMapper.js';
import { createContentMessageHandlers } from '../src/content/messageHandlers.js';
import { MSG } from '../src/shared/constants.js';

test('buildCapabilityReport declares douyin single comments and comment image download task types on detail page', () => {
  const report = buildCapabilityReport({
    platform: 'douyin',
    mode: 'detail',
    pageType: 'detail',
    url: 'https://www.douyin.com/video/demo',
    isDyVideoPage: true,
    isDyStrictDetailPage: true,
    capabilities: {
      canCollectComments: true,
      canDownloadCommentImages: true,
    },
  });

  assert.deepEqual(report.capabilities.canRunTaskTypes.sort(), [
    'douyin.commentImageDownload',
    'douyin.singleComments',
  ]);
});

test('buildCapabilityReport declares xhs batch notes on detail page when the page can run direct note probes', () => {
  const report = buildCapabilityReport({
    platform: 'xhs',
    mode: 'detail',
    pageType: 'noteDetail',
    url: 'https://www.xiaohongshu.com/discovery/item/demo_note',
    capabilities: {
      canCollectPrimary: true,
      canCollectComments: true,
    },
  });

  assert.deepEqual(report.capabilities.canRunTaskTypes, [
    'xhs.batchNotes',
  ]);
});

test('mapTaskEnvelopeToInternalCommand maps douyin.singleComments to async content comment collection', () => {
  const command = mapTaskEnvelopeToInternalCommand({
    type: 'task.envelope',
    protocolVersion: 'v1',
    taskId: 'wb_task_comment_1',
    taskType: 'douyin.singleComments',
    platform: 'douyin',
    triggerSource: 'workbench_dispatch',
    target: {
      pageType: 'detail',
      url: 'https://www.douyin.com/video/demo',
    },
    payload: {
      commentLimit: 20,
      commentDepthMode: 'twoLevel',
    },
  }, { tabId: 99 });

  assert.equal(command.dispatchTarget, 'content');
  assert.equal(command.action, MSG.COLLECT_SINGLE_COMMENT);
  assert.equal(command.payload.asyncDispatch, true);
  assert.equal(command.payload.maxTotal, 20);
  assert.equal(command.payload.commentDepthMode, 'twoLevel');
  assert.equal(command.payload.externalTaskMeta.externalTaskId, 'wb_task_comment_1');
});

test('remote douyin single comment collection acknowledges async dispatch and binds remote collection run', async () => {
  const calls = [];
  let collectorOptions = null;
  let releaseCollector;
  const collectorDone = new Promise((resolve) => {
    releaseCollector = resolve;
  });

  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => true,
    collectDouyinComments: async (options = {}) => {
      collectorOptions = options;
      await collectorDone;
      return {
        total: 12,
        comments: [{ commentId: 'c1' }],
        note: { contentId: 'douyin_note_1', platformContentId: 'aweme_1' },
        collectionRunId: options.collectionRunId,
      };
    },
    downloadDouyinCommentImages: async () => ({ success: true }),
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
    getPageContext: async () => ({ platform: 'douyin', pageType: 'detail' }),
    collectionRunStore: {
      async createRun(input) {
        calls.push(['createRun', input]);
        return { collectionRunId: 'run_dy_comment_1' };
      },
      async markDone(runId, payload) {
        calls.push(['markDone', runId, payload]);
      },
      async markFailed(runId, error, payload) {
        calls.push(['markFailed', runId, error, payload]);
      },
      async markStopped(runId, payload) {
        calls.push(['markStopped', runId, payload]);
      },
    },
  });

  const result = await handlers[MSG.COLLECT_SINGLE_COMMENT]({
    asyncDispatch: true,
    triggerSource: 'workbench_dispatch',
    maxTotal: 20,
    commentDepthMode: 'twoLevel',
    externalTaskMeta: {
      externalTaskId: 'wb_task_comment_1',
      externalTaskType: 'douyin.singleComments',
      protocolVersion: 'v1',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.accepted, true);
  assert.equal(result.pending, true);
  assert.equal(result.collectionRunId, 'run_dy_comment_1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'createRun');

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls[0][1].externalTaskId, 'wb_task_comment_1');
  assert.equal(calls[0][1].externalTaskType, 'douyin.singleComments');
  assert.equal(calls[0][1].taskType, 'singleComments');
  assert.equal(calls[0][1].platform, 'douyin');
  assert.equal(calls[0][1].resultUploadStatus, 'pending_upload');
  assert.equal(collectorOptions.collectionRunId, 'run_dy_comment_1');
  assert.equal(collectorOptions.manageCollectionRun, false);

  releaseCollector();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls[1][0], 'markDone');
  assert.equal(calls[1][1], 'run_dy_comment_1');
  assert.equal(calls[1][2].totalComments, 12);
});

test('remote douyin comment image download acknowledges async dispatch and binds remote collection run', async () => {
  const calls = [];
  let downloaderOptions = null;
  let releaseDownloader;
  const downloaderDone = new Promise((resolve) => {
    releaseDownloader = resolve;
  });

  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => true,
    collectDouyinComments: async () => ({ total: 0, comments: [] }),
    downloadDouyinCommentImages: async (options = {}) => {
      downloaderOptions = options;
      await downloaderDone;
      return {
        success: true,
        downloaded: 3,
        failed: 1,
        total: 4,
        hdCount: 2,
        sdCount: 1,
        scannedImages: 4,
        note: { contentId: 'douyin_note_2', platformContentId: 'aweme_2' },
        collectionRunId: options.collectionRunId,
      };
    },
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
    getPageContext: async () => ({ platform: 'douyin', pageType: 'detail' }),
    collectionRunStore: {
      async createRun(input) {
        calls.push(['createRun', input]);
        return { collectionRunId: 'run_dy_image_1' };
      },
      async markDone(runId, payload) {
        calls.push(['markDone', runId, payload]);
      },
      async markFailed(runId, error, payload) {
        calls.push(['markFailed', runId, error, payload]);
      },
      async markStopped(runId, payload) {
        calls.push(['markStopped', runId, payload]);
      },
    },
  });

  const result = await handlers[MSG.DOWNLOAD_CURRENT_COMMENT_IMAGES]({
    asyncDispatch: true,
    triggerSource: 'workbench_dispatch',
    maxTotal: 10,
    commentDepthMode: 'twoLevel',
    externalTaskMeta: {
      externalTaskId: 'wb_task_image_1',
      externalTaskType: 'douyin.commentImageDownload',
      protocolVersion: 'v1',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.accepted, true);
  assert.equal(result.pending, true);
  assert.equal(result.collectionRunId, 'run_dy_image_1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'createRun');

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls[0][1].taskType, 'commentImageDownload');
  assert.equal(calls[0][1].externalTaskId, 'wb_task_image_1');
  assert.equal(downloaderOptions.collectionRunId, 'run_dy_image_1');

  releaseDownloader();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls[1][0], 'markDone');
  assert.equal(calls[1][1], 'run_dy_image_1');
  assert.equal(calls[1][2].itemsSucceeded, 3);
  assert.equal(calls[1][2].totalImages, 4);
});
