import test from 'node:test';
import assert from 'node:assert/strict';

import { MSG } from '../src/shared/constants.js';
import { createContentMessageHandlers } from '../src/content/messageHandlers.js';

test('remote douyin single-comment collection keeps partial stopped summary when comments were collected', async () => {
  const stoppedCalls = [];
  const doneCalls = [];
  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => true,
    collectNote: async () => null,
    collectComments: async () => null,
    collectAuthor: async () => null,
    collectDouyinVideo: async () => null,
    collectDouyinComments: async () => ({
      stopped: true,
      total: 17,
      comments: [{ commentId: 'comment_1' }],
      note: {
        contentId: 'dy_content_1',
        platformContentId: 'video_1',
      },
    }),
    downloadDouyinCommentImages: async () => null,
    collectDouyinAuthor: async () => null,
    noteStore: {},
    commentStore: {},
    authorStore: {},
    reportDone: () => {},
    batchMessageHandlers: {},
    extractNoteId: () => '',
    downloadNoteMediaFromRecord: async () => null,
    generateCsv: () => '',
    downloadFile: () => {},
    backfillLegacyAiReadyFields: async () => null,
    getPageContext: async () => ({ platform: 'douyin', pageType: 'detail' }),
    collectionRunStore: {
      async createRun() {
        return { collectionRunId: 'run_remote_comment_1' };
      },
      async markStopped(runId, patch) {
        stoppedCalls.push([runId, patch]);
      },
      async markDone(runId, patch) {
        doneCalls.push([runId, patch]);
      },
      async markFailed() {
        throw new Error('markFailed should not be called');
      },
    },
    packageWorkbenchResult: async () => null,
    discoverXhsSurfaceNotes: async () => [],
    discoverDouyinSurfaceTargets: async () => [],
  });

  const result = await handlers[MSG.COLLECT_SINGLE_COMMENT]({
    triggerSource: 'workbench_dispatch',
    externalTaskMeta: {
      externalTaskId: 'task_remote_comment_1',
      externalTaskType: 'douyin.singleComments',
      executorInstanceId: 'executor_1',
      protocolVersion: 'v1',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.total, 17);
  assert.equal(doneCalls.length, 0);
  assert.deepEqual(stoppedCalls, [[
    'run_remote_comment_1',
    {
      itemsPlanned: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
      totalComments: 17,
      contentId: 'dy_content_1',
      targetIds: ['video_1'],
    },
  ]]);
});

test('remote xhs single-note collection creates a run and writes back success summary', async () => {
  const doneCalls = [];
  const note = {
    noteId: '69baad5e00000000230055ef',
    platformContentId: '69baad5e00000000230055ef',
    contentId: 'xhs_69baad5e00000000230055ef',
    title: '示例笔记',
  };
  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => false,
    collectNote: async () => note,
    collectComments: async () => null,
    collectAuthor: async () => null,
    collectDouyinVideo: async () => null,
    collectDouyinComments: async () => null,
    downloadDouyinCommentImages: async () => null,
    collectDouyinAuthor: async () => null,
    noteStore: {},
    commentStore: {},
    authorStore: {},
    reportDone: () => {},
    batchMessageHandlers: {},
    extractNoteId: () => '',
    downloadNoteMediaFromRecord: async () => null,
    generateCsv: () => '',
    downloadFile: () => {},
    backfillLegacyAiReadyFields: async () => null,
    getPageContext: async () => ({ platform: 'xhs', pageType: 'detail' }),
    collectionRunStore: {
      async createRun() {
        return { collectionRunId: 'run_remote_note_1' };
      },
      async markDone(runId, patch) {
        doneCalls.push([runId, patch]);
      },
      async markStopped() {
        throw new Error('markStopped should not be called');
      },
      async markFailed() {
        throw new Error('markFailed should not be called');
      },
    },
    packageWorkbenchResult: async () => null,
    discoverXhsSurfaceNotes: async () => [],
    discoverDouyinSurfaceTargets: async () => [],
  });

  const result = await handlers[MSG.COLLECT_SINGLE_NOTE]({
    triggerSource: 'workbench_dispatch',
    expectedNoteId: '69baad5e00000000230055ef',
    externalTaskMeta: {
      externalTaskId: 'task_remote_note_1',
      externalTaskType: 'xhs.batchNotes',
      executorInstanceId: 'executor_1',
      protocolVersion: 'v1',
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.note.title, '示例笔记');
  assert.deepEqual(doneCalls, [[
    'run_remote_note_1',
    {
      itemsPlanned: 1,
      itemsSucceeded: 1,
      itemsFailed: 0,
      targetIds: ['69baad5e00000000230055ef'],
      contentIds: ['xhs_69baad5e00000000230055ef'],
    },
  ]]);
});
