import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRemoteRunCreatePayload,
  buildXhsBatchNotesProgressPatch,
  buildXhsBatchNotesRunPatch,
  buildXhsBatchCommentsProgressPatch,
  buildXhsBatchCommentsRunPatch,
} from '../src/workbench/runtime/xhsBatchRunHelper.js';

test('buildRemoteRunCreatePayload returns null without external task id', () => {
  const payload = buildRemoteRunCreatePayload({
    platform: 'xhs',
    taskType: 'batchNotes',
    pageType: 'search',
    triggerSource: 'popup_manual',
    externalTaskMeta: {},
  });

  assert.equal(payload, null);
});

test('buildRemoteRunCreatePayload builds createRun payload for remote xhs batch task', () => {
  const payload = buildRemoteRunCreatePayload({
    platform: 'xhs',
    taskType: 'batchComments',
    pageType: 'profile',
    triggerSource: 'workbench_dispatch',
    pageUrl: 'https://www.xiaohongshu.com/user/profile/abc',
    config: { count: 12, topByLikes: true },
    externalTaskMeta: {
      externalTaskId: 'wb_task_xhs_1',
      externalTaskType: 'xhs.batchComments',
      protocolVersion: 'v1',
      executorInstanceId: 'executor_1',
    },
  });

  assert.deepEqual(payload, {
    externalTaskId: 'wb_task_xhs_1',
    externalTaskType: 'xhs.batchComments',
    executorInstanceId: 'executor_1',
    protocolVersion: 'v1',
    platform: 'xhs',
    taskType: 'batchComments',
    pageType: 'profile',
    triggerSource: 'workbench_dispatch',
    resultUploadStatus: 'pending_upload',
    lastHeartbeatAt: payload.lastHeartbeatAt,
    config: { count: 12, topByLikes: true },
    meta: { pageUrl: 'https://www.xiaohongshu.com/user/profile/abc' },
  });
  assert.equal(typeof payload.lastHeartbeatAt, 'number');
  assert.ok(payload.lastHeartbeatAt > 0);
});

test('buildXhsBatchNotesRunPatch summarizes batch note results', () => {
  const patch = buildXhsBatchNotesRunPatch({
    noteList: [{ noteId: 'n1' }, { noteId: 'n2' }, { noteId: 'n3' }],
    collected: [{ noteId: 'n1' }, { noteId: 'n3' }],
    failed: [{ noteId: 'n2', error: 'timeout' }],
  });

  assert.deepEqual(patch, {
    itemsPlanned: 3,
    itemsSucceeded: 2,
    itemsFailed: 1,
    targetIds: ['n1', 'n2', 'n3'],
    contentIds: ['xhs_n1', 'xhs_n3'],
    failedTargets: [{ noteId: 'n2', error: 'timeout' }],
  });
});

test('buildXhsBatchNotesProgressPatch only counts processed targets during a running task', () => {
  const patch = buildXhsBatchNotesProgressPatch({
    noteList: [{ noteId: 'n1' }, { noteId: 'n2' }, { noteId: 'n3' }],
    processedCount: 2,
    collected: [{ noteId: 'n1', contentId: 'xhs_n1' }],
    failed: [{ noteId: 'n2', error: 'timeout' }],
  });

  assert.deepEqual(patch, {
    itemsPlanned: 3,
    itemsSucceeded: 1,
    itemsFailed: 1,
    targetIds: ['n1', 'n2', 'n3'],
    contentIds: ['xhs_n1'],
    failedTargets: [{ noteId: 'n2', error: 'timeout' }],
  });
});

test('buildXhsBatchCommentsRunPatch summarizes batch comment results', () => {
  const patch = buildXhsBatchCommentsRunPatch({
    noteList: [{ noteId: 'n1' }, { noteId: 'n2' }],
    results: [
      { noteId: 'n1', total: 5 },
      { noteId: 'n2', total: 0 },
    ],
  });

  assert.deepEqual(patch, {
    itemsPlanned: 2,
    itemsSucceeded: 1,
    itemsFailed: 1,
    totalComments: 5,
    targetIds: ['n1', 'n2'],
    contentIds: ['xhs_n1'],
    failedTargets: [{ noteId: 'n2', total: 0 }],
  });
});

test('buildXhsBatchCommentsProgressPatch only counts processed targets during a running task', () => {
  const patch = buildXhsBatchCommentsProgressPatch({
    noteList: [{ noteId: 'n1' }, { noteId: 'n2' }, { noteId: 'n3' }],
    processedCount: 2,
    results: [
      { noteId: 'n1', total: 5 },
      { noteId: 'n2', total: 0 },
    ],
  });

  assert.deepEqual(patch, {
    itemsPlanned: 3,
    itemsSucceeded: 1,
    itemsFailed: 1,
    totalComments: 5,
    targetIds: ['n1', 'n2', 'n3'],
    contentIds: ['xhs_n1'],
    failedTargets: [{ noteId: 'n2', total: 0 }],
  });
});
