import test from 'node:test';
import assert from 'node:assert/strict';

import { MSG, TASK_STATE } from '../src/shared/constants.js';
import { createBatchMessageHandlers } from '../src/content/douyinBatchMessageHandlers.js';

function createManagedTaskController(runTask) {
  return {
    start() {
      void runTask({
        shouldStop: () => false,
        waitIfPaused: async () => {},
      });
    },
    stop() {},
  };
}

test('douyin stopped batch video summary keeps success ratio in taskbar message', async () => {
  const syncCalls = [];
  let batchNoteController = null;

  const handlers = createBatchMessageHandlers({
    isDouyinPage: () => true,
    createManagedTaskController,
    batchCollectDouyinProfileVideos: async () => ({
      ok: true,
      stopped: true,
      success: 2,
      total: 5,
    }),
    batchCollectDouyinProfileComments: async () => ({
      ok: true,
      successVideos: 1,
      totalVideos: 1,
      totalComments: 1,
    }),
    BatchNoteController: class {},
    BatchCommentController: class {},
    reportProgress: () => {},
    reportDone: () => {},
    syncTaskUI: () => {},
    startBatchTask: () => {},
    toggleStopButton: () => {},
    hideTaskControlBar: () => {},
    setActiveTaskType: () => {},
    pauseActiveTask: () => {},
    resumeActiveTask: () => {},
    getBatchNoteCtrl: () => batchNoteController,
    setBatchNoteCtrl: (value) => {
      batchNoteController = value;
    },
    getBatchCommentCtrl: () => null,
    setBatchCommentCtrl: () => {},
    getDouyinAdapter: () => ({
      syncTaskUI(progress) {
        syncCalls.push(progress);
      },
      startBatchTask() {},
      hideTaskControlBar() {},
      setActiveTaskType() {},
      attachExternalBatchController() {},
      pauseBatch() {},
      resumeBatch() {},
      stopBatch() {},
    }),
  });

  await handlers[MSG.START_BATCH_NOTES]({ count: 5, mode: 'profile' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const stopped = syncCalls.find((entry) => entry.taskState === TASK_STATE.IDLE);
  assert.ok(stopped);
  assert.equal(stopped.message, '批量视频已停止：成功 2/5');
});

test('douyin stopped batch comment summary keeps video and comment totals in taskbar message', async () => {
  const syncCalls = [];
  let batchCommentController = null;

  const handlers = createBatchMessageHandlers({
    isDouyinPage: () => true,
    createManagedTaskController,
    batchCollectDouyinProfileVideos: async () => ({
      ok: true,
      success: 1,
      total: 1,
    }),
    batchCollectDouyinProfileComments: async () => ({
      ok: true,
      stopped: true,
      successVideos: 1,
      totalVideos: 3,
      totalComments: 9,
    }),
    BatchNoteController: class {},
    BatchCommentController: class {},
    reportProgress: () => {},
    reportDone: () => {},
    syncTaskUI: () => {},
    startBatchTask: () => {},
    toggleStopButton: () => {},
    hideTaskControlBar: () => {},
    setActiveTaskType: () => {},
    pauseActiveTask: () => {},
    resumeActiveTask: () => {},
    getBatchNoteCtrl: () => null,
    setBatchNoteCtrl: () => {},
    getBatchCommentCtrl: () => batchCommentController,
    setBatchCommentCtrl: (value) => {
      batchCommentController = value;
    },
    getDouyinAdapter: () => ({
      syncTaskUI(progress) {
        syncCalls.push(progress);
      },
      startBatchTask() {},
      hideTaskControlBar() {},
      setActiveTaskType() {},
      attachExternalBatchController() {},
      pauseBatch() {},
      resumeBatch() {},
      stopBatch() {},
    }),
  });

  await handlers[MSG.START_BATCH_COMMENTS]({ count: 3, mode: 'profile' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const stopped = syncCalls.find((entry) => entry.taskState === TASK_STATE.IDLE);
  assert.ok(stopped);
  assert.equal(stopped.message, '批量评论已停止：视频 1/3，评论 9 条');
});

test('douyin failed batch video summary uses TASK_STATE.ERROR for taskbar state', async () => {
  const syncCalls = [];
  let batchNoteController = null;

  const handlers = createBatchMessageHandlers({
    isDouyinPage: () => true,
    createManagedTaskController,
    batchCollectDouyinProfileVideos: async () => ({
      ok: false,
      error: 'network down',
    }),
    batchCollectDouyinProfileComments: async () => ({
      ok: true,
      successVideos: 1,
      totalVideos: 1,
      totalComments: 1,
    }),
    BatchNoteController: class {},
    BatchCommentController: class {},
    reportProgress: () => {},
    reportDone: () => {},
    syncTaskUI: () => {},
    startBatchTask: () => {},
    toggleStopButton: () => {},
    hideTaskControlBar: () => {},
    setActiveTaskType: () => {},
    pauseActiveTask: () => {},
    resumeActiveTask: () => {},
    getBatchNoteCtrl: () => batchNoteController,
    setBatchNoteCtrl: (value) => {
      batchNoteController = value;
    },
    getBatchCommentCtrl: () => null,
    setBatchCommentCtrl: () => {},
    getDouyinAdapter: () => ({
      syncTaskUI(progress) {
        syncCalls.push(progress);
      },
      startBatchTask() {},
      hideTaskControlBar() {},
      setActiveTaskType() {},
      attachExternalBatchController() {},
      pauseBatch() {},
      resumeBatch() {},
      stopBatch() {},
    }),
  });

  await handlers[MSG.START_BATCH_NOTES]({ count: 5, mode: 'profile' });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const failed = syncCalls.find((entry) => entry.message.includes('批量视频失败'));
  assert.ok(failed);
  assert.equal(failed.taskState, TASK_STATE.ERROR);
});
