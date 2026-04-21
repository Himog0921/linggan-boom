import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskPoller } from '../src/workbench/runtime/taskPoller.js';

test('task poller claims a pending task and patches completion state', async () => {
  const patches = [];
  const recordBatches = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_1',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/user/profile/demo',
        payload: { limit: 3 },
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({
      success: true,
      accepted: true,
    }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_1',
      resultLookup: { externalTaskId: 'task_1' },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_1',
        status: 'done',
        resultSummary: {
          notes: 3,
          itemsPlanned: 1,
          itemsSucceeded: 1,
          failedItems: 0,
        },
        records: {
          notes: [
            {
              noteId: 'note_1',
              title: '标题 1',
              content: '内容 1',
              url: 'https://example.com/1',
              canonicalUrl: 'https://example.com/1?xsec_token=abc123',
              rawUrl: 'https://example.com/1?xsec_token=abc123',
              rawShareText: '分享文案',
              images: [{ url: 'https://images.example.com/cover.jpg' }],
              likes: 12,
            },
          ],
          comments: [],
          authors: [],
          mediaAssets: [],
        },
      },
    }),
    enqueueRecords: async (records) => {
      recordBatches.push(records);
      return records;
    },
  });

  const firstTick = await poller.tick();
  assert.equal(firstTick.accepted, true);
  assert.equal(patches[0][0], 'task_1');
  assert.equal(patches[0][1].status, 'dispatched');
  assert.equal(patches[0][1].progress, 5);
  assert.equal(patches[0][1].activeExecutor, null);
  assert.ok(Number.isFinite(Date.parse(patches[0][1].latestHeartbeatAt)));

  const secondTick = await poller.tick();
  assert.equal(secondTick.status, 'completed');
  assert.deepEqual(patches[1], [
    'task_1',
    {
      status: 'completed',
      progress: 100,
      pluginRunId: 'run_1',
      resultSummary: {
        notes: 3,
        itemsPlanned: 1,
        itemsSucceeded: 1,
        failedItems: 0,
        records: {
          notes: [
            {
              noteId: 'note_1',
              platformContentId: 'note_1',
              title: '标题 1',
              content: '内容 1',
              url: 'https://example.com/1',
              canonicalUrl: 'https://example.com/1?xsec_token=abc123',
              rawUrl: 'https://example.com/1?xsec_token=abc123',
              rawShareText: '分享文案',
              cover: 'https://images.example.com/cover.jpg',
              coverImg: 'https://images.example.com/cover.jpg',
              coverUrl: 'https://images.example.com/cover.jpg',
              images: [{ url: 'https://images.example.com/cover.jpg' }],
              imageCandidates: [],
              videoUrl: '',
              likes: 12,
              collects: 0,
              comments: 0,
              shares: 0,
              authorName: '',
            },
          ],
          comments: [],
          authors: [],
          mediaAssets: [],
        },
      },
      errorMessage: null,
    },
  ]);
  assert.equal(poller.getState().activeTask, null);
  assert.equal(recordBatches.length, 1);
  assert.equal(recordBatches[0][0].taskId, 'task_1');
  assert.equal(recordBatches[0][0].pluginRunId, 'run_1');
  assert.equal(recordBatches[0][0].recordType, 'note');
  assert.equal(recordBatches[0][0].externalRecordId, 'note_1');
  assert.equal(recordBatches[0][0].payload.cover, 'https://images.example.com/cover.jpg');
  assert.deepEqual(recordBatches[0][0].payload.images, [{ url: 'https://images.example.com/cover.jpg' }]);
});

test('task poller marks task running immediately when dispatch already returns a local run id', async () => {
  const patches = [];
  const events = [];
  const lookups = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_started_1',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/user/profile/demo',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({
      success: true,
      accepted: true,
    }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_started_1',
      collectionRunId: 'run_started_1',
      resultLookup: {
        externalTaskId: 'task_started_1',
        collectionRunId: 'run_started_1',
      },
    }),
    getResultPackage: async (lookup) => {
      lookups.push(lookup);
      return {
        success: true,
        result: {
          collectionRunId: 'run_started_1',
          status: 'running',
          resultSummary: {
            itemsPlanned: 2,
            itemsSucceeded: 1,
            failedItems: 0,
          },
          records: {
            notes: [],
            comments: [],
            authors: [],
            mediaAssets: [],
          },
        },
      };
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
  });

  const firstTick = await poller.tick();
  assert.equal(firstTick.accepted, true);
  assert.deepEqual(patches[0], [
    'task_started_1',
    {
      status: 'running',
      progress: 10,
      pluginRunId: 'run_started_1',
      activeExecutor: null,
      latestHeartbeatAt: patches[0][1].latestHeartbeatAt,
      errorMessage: null,
    },
  ]);
  assert.ok(Number.isFinite(Date.parse(patches[0][1].latestHeartbeatAt)));
  assert.equal(events[0].eventType, 'task.claimed');
  assert.equal(events[0].payload.status, 'running');
  assert.equal(events[0].payload.collectionRunId, 'run_started_1');
  assert.equal(poller.getState().activeTask?.workbenchStatus, 'running');
  assert.equal(poller.getState().activeTask?.pluginRunId, 'run_started_1');

  const secondTick = await poller.tick();
  assert.equal(secondTick.status, 'running');
  assert.deepEqual(lookups[0], {
    collectionRunId: 'run_started_1',
    externalTaskId: 'task_started_1',
  });
  assert.equal(patches[1][1].status, 'running');
  assert.equal(patches[1][1].pluginRunId, 'run_started_1');
});

test('task poller surfaces idle claim reason details without falling back to pending tasks', async () => {
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: null,
      fallbackToPending: false,
      reason: {
        code: 'no_available_account',
        message: '没有可用账号',
      },
      nextPollAfterMs: 30000,
    }),
    fetchPendingTasks: async () => {
      throw new Error('pending fallback should not be used');
    },
  });

  const result = await poller.tick();

  assert.deepEqual(result, {
    success: true,
    idle: true,
    nextPollAfterMs: 30000,
    idleReasonCode: 'no_available_account',
    idleReasonMessage: '没有可用账号',
    reason: {
      code: 'no_available_account',
      message: '没有可用账号',
    },
    fallbackToPending: false,
  });
  assert.deepEqual(poller.getState().lastIdleReason, {
    taskId: '',
    leaseToken: '',
    expiresAt: '',
    idleReasonCode: 'no_available_account',
    idleReasonMessage: '没有可用账号',
    nextPollAfterMs: 30000,
    reason: {
      code: 'no_available_account',
      message: '没有可用账号',
    },
    fallbackToPending: false,
  });
});

test('task poller preserves author profile fields when reporting monitor results', async () => {
  const patches = [];
  const recordBatches = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_author_profile',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_baseline',
        payload: { monitorId: 'monitor_author_1' },
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_author_profile',
      resultLookup: { externalTaskId: 'task_author_profile' },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_author_profile',
        status: 'done',
        resultSummary: { authors: 1, itemsPlanned: 1, itemsSucceeded: 1, failedItems: 0 },
        records: {
          notes: [],
          comments: [],
          authors: [
            {
              authorId: '6926d8f4000000003702c666',
              platformAuthorId: '6926d8f4000000003702c666',
              authorEntityId: 'xhs_6926d8f4000000003702c666',
              platform: 'xhs',
              name: '孙爸养A娃（成长版）',
              avatar: 'https://images.example.com/avatar.jpg',
              profileUrl: 'https://www.xiaohongshu.com/user/profile/6926d8f4000000003702c666',
              description: '混合型 ADHD 清华笨爸',
              follows: 12,
              fans: 16282,
              interactions: 200000,
              notes: 46,
              monitorMode: 'author_profile',
              monitorId: 'monitor_author_1',
              taskStrategy: 'author_baseline',
              monitorMeta: {
                monitorId: 'monitor_author_1',
                monitorMode: 'author_profile',
              },
            },
          ],
          mediaAssets: [],
        },
      },
    }),
    enqueueRecords: async (records) => {
      recordBatches.push(records);
      return records;
    },
  });

  await poller.tick();
  await poller.tick();

  const author = patches[1][1].resultSummary.records.authors[0];
  assert.deepEqual(author, {
    authorId: '6926d8f4000000003702c666',
    platformAuthorId: '6926d8f4000000003702c666',
    authorEntityId: 'xhs_6926d8f4000000003702c666',
    userId: '',
    platform: 'xhs',
    name: '孙爸养A娃（成长版）',
    profileUrl: 'https://www.xiaohongshu.com/user/profile/6926d8f4000000003702c666',
    avatar: 'https://images.example.com/avatar.jpg',
    description: '混合型 ADHD 清华笨爸',
    bio: '混合型 ADHD 清华笨爸',
    ipLocation: '',
    location: '',
    handle: '',
    redId: '',
    douyinId: '',
    fans: 16282,
    followers: 16282,
    follows: 12,
    following: 12,
    interactions: 200000,
    likesAndCollects: 200000,
    works: 46,
    notes: 46,
    monitorMode: 'author_profile',
    monitorId: 'monitor_author_1',
    taskStrategy: 'author_baseline',
    monitorMeta: {
      monitorId: 'monitor_author_1',
      monitorMode: 'author_profile',
    },
  });
  assert.equal(recordBatches[0][0].recordType, 'author');
  assert.equal(recordBatches[0][0].payload.monitorMode, 'author_profile');
  assert.equal(recordBatches[0][0].payload.avatar, 'https://images.example.com/avatar.jpg');
});

test('task poller leaves task pending when no executable context is available', async () => {
  const patches = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      { id: 'task_2', taskType: 'douyin.collectAuthor', platform: 'douyin' },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({
      success: false,
      accepted: false,
      error: 'no_matching_tab',
    }),
    dispatchTask: async () => {
      throw new Error('dispatch should not run');
    },
  });

  const tick = await poller.tick();
  assert.equal(tick.skipped, true);
  assert.equal(patches.length, 0);
  assert.equal(poller.getState().activeTask, null);
});

test('task poller stores selected account and consumes quota only after dispatch', async () => {
  const quotaUpdates = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_account_1',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/user/profile/demo',
      },
    ]),
    beforeDispatch: async () => ({
      shouldPause: false,
      accountId: 'account_xhs_1',
    }),
    afterDispatchSuccess: async (task, preCheck) => {
      quotaUpdates.push([task.id, preCheck.accountId]);
    },
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_account_1',
      resultLookup: { externalTaskId: 'task_account_1' },
    }),
  });

  const result = await poller.tick();

  assert.equal(result.accepted, true);
  assert.deepEqual(quotaUpdates, [['task_account_1', 'account_xhs_1']]);
  assert.equal(poller.getState().activeTask?.accountId, 'account_xhs_1');
});

test('task poller does not consume quota when dispatch never starts', async () => {
  const quotaUpdates = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_account_rejected',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
      },
    ]),
    beforeDispatch: async () => ({
      shouldPause: false,
      accountId: 'account_xhs_2',
    }),
    afterDispatchSuccess: async () => {
      quotaUpdates.push('updated');
    },
    capabilityCheck: async () => ({
      success: false,
      accepted: false,
      error: 'no_matching_tab',
    }),
    patchTask: async () => ({ success: true }),
    dispatchTask: async () => {
      throw new Error('dispatch should not run');
    },
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  assert.deepEqual(quotaUpdates, []);
});

test('task poller maps paused status and keeps polling active task', async () => {
  const patches = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_3',
        taskType: 'xhs.batchComments',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/user/profile/demo',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_3',
      resultLookup: { externalTaskId: 'task_3' },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_3',
        status: 'paused',
        resultSummary: {
          comments: 12,
          itemsPlanned: 2,
          itemsSucceeded: 1,
          failedItems: 0,
        },
        records: {
          notes: [],
          comments: [
            { commentId: 'comment_1', text: '已采到的评论' },
          ],
          authors: [],
          mediaAssets: [],
        },
      },
    }),
  });

  await poller.tick();
  const secondTick = await poller.tick();

  assert.equal(secondTick.status, 'paused');
  assert.deepEqual(patches[1], [
    'task_3',
    {
      status: 'paused',
      progress: 50,
      pluginRunId: 'run_3',
      resultSummary: {
        comments: 12,
        itemsPlanned: 2,
        itemsSucceeded: 1,
        failedItems: 0,
        records: {
          notes: [],
          comments: [
            {
              commentId: 'comment_1',
              noteId: '',
              text: '已采到的评论',
              author: '',
              authorId: '',
              likes: 0,
              level: 1,
              url: '',
            },
          ],
          authors: [],
          mediaAssets: [],
        },
      },
      errorMessage: null,
    },
  ]);
  assert.notEqual(poller.getState().activeTask, null);
});

test('task poller maps stopped status to final stopped patch with partial results', async () => {
  const patches = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_4',
        taskType: 'douyin.batchComments',
        platform: 'douyin',
        target: 'https://www.douyin.com/user/demo',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_4',
      resultLookup: { externalTaskId: 'task_4' },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_4',
        status: 'stopped',
        resultSummary: {
          comments: 6,
          itemsPlanned: 3,
          itemsSucceeded: 1,
          failedItems: 0,
        },
        records: {
          notes: [],
          comments: [
            { commentId: 'comment_9', text: '停止前已采评论' },
          ],
          authors: [],
          mediaAssets: [],
        },
      },
    }),
  });

  await poller.tick();
  const secondTick = await poller.tick();

  assert.equal(secondTick.status, 'stopped');
  assert.deepEqual(patches[1], [
    'task_4',
    {
      status: 'stopped',
      progress: 33,
      pluginRunId: 'run_4',
      resultSummary: {
        comments: 6,
        itemsPlanned: 3,
        itemsSucceeded: 1,
        failedItems: 0,
        records: {
          notes: [],
          comments: [
            {
              commentId: 'comment_9',
              noteId: '',
              text: '停止前已采评论',
              author: '',
              authorId: '',
              likes: 0,
              level: 1,
              url: '',
            },
          ],
          authors: [],
          mediaAssets: [],
        },
      },
      errorMessage: null,
    },
  ]);
  assert.equal(poller.getState().activeTask, null);
});

test('task poller can recover and continue polling a tracked in-flight task after restart', async () => {
  const patches = [];
  const poller = createTaskPoller({
    fetchPendingTasks: async () => [],
    fetchTrackableTasks: async () => ([
      {
        id: 'task_5',
        status: 'dispatched',
        pluginRunId: 'run_5',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_5',
        status: 'paused',
        resultSummary: {
          comments: 4,
          itemsPlanned: 2,
          itemsSucceeded: 1,
          failedItems: 0,
        },
        records: {
          notes: [],
          comments: [{ commentId: 'comment_5', text: '恢复跟踪后的部分结果' }],
          authors: [],
          mediaAssets: [],
        },
      },
    }),
  });

  const tick = await poller.tick();

  assert.equal(tick.status, 'paused');
  assert.deepEqual(patches[0], [
    'task_5',
    {
      status: 'paused',
      progress: 50,
      pluginRunId: 'run_5',
      resultSummary: {
        comments: 4,
        itemsPlanned: 2,
        itemsSucceeded: 1,
        failedItems: 0,
        records: {
          notes: [],
          comments: [
            {
              commentId: 'comment_5',
              noteId: '',
              text: '恢复跟踪后的部分结果',
              author: '',
              authorId: '',
              likes: 0,
              level: 1,
              url: '',
            },
          ],
          authors: [],
          mediaAssets: [],
        },
      },
      errorMessage: null,
    },
  ]);
  assert.notEqual(poller.getState().activeTask, null);
});

test('task poller releases stale tracked tasks before claiming fresh pending work', async () => {
  const patches = [];
  const dispatched = [];
  const poller = createTaskPoller({
    now: () => new Date('2026-04-13T10:00:00.000Z').getTime(),
    fetchTrackableTasks: async () => ([
      {
        id: 'stale_task',
        status: 'dispatched',
        pluginRunId: 'run_stale',
        updatedAt: '2026-04-09T10:00:00.000Z',
      },
    ]),
    fetchPendingTasks: async () => ([
      {
        id: 'fresh_task',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/search_result?keyword=ADHD',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async (task) => {
      dispatched.push(task.id);
      return {
        success: true,
        accepted: true,
        taskId: task.id,
        resultLookup: { externalTaskId: task.id },
      };
    },
    getExecutorInstanceId: () => 'executor_1',
  });

  const tick = await poller.tick();

  assert.equal(tick.accepted, true);
  assert.deepEqual(dispatched, ['fresh_task']);
  assert.equal(patches[0][0], 'stale_task');
  assert.deepEqual(patches[0][1], {
    status: 'failed',
    progress: 100,
    errorMessage: 'Orphaned plugin task released after stale heartbeat.',
  });
  assert.equal(patches[1][0], 'fresh_task');
  assert.equal(patches[1][1].status, 'dispatched');
  assert.equal(patches[1][1].activeExecutor, 'executor_1');
  assert.ok(Number.isFinite(Date.parse(patches[1][1].latestHeartbeatAt)));
  assert.equal(poller.getState().activeTask?.taskId, 'fresh_task');
});

test('task poller releases recovered paused monitor connection failures before pending work', async () => {
  const patches = [];
  const dispatched = [];
  let clearLeaseCalls = 0;
  const poller = createTaskPoller({
    fetchTrackableTasks: async () => ([
      {
        id: 'paused_monitor_task',
        status: 'paused',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_patrol',
        errorMessage: 'Could not establish connection. Receiving end does not exist.',
      },
    ]),
    fetchPendingTasks: async () => ([
      {
        id: 'fresh_after_pause',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_patrol',
      },
    ]),
    readTaskLease: async () => ({ taskId: 'paused_monitor_task', leaseToken: 'lease-paused' }),
    clearTaskLease: async () => {
      clearLeaseCalls += 1;
    },
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async (task) => {
      dispatched.push(task.id);
      return {
        success: true,
        accepted: true,
        taskId: task.id,
        resultLookup: { externalTaskId: task.id },
      };
    },
  });

  const tick = await poller.tick();

  assert.equal(tick.accepted, true);
  assert.deepEqual(patches[0], [
    'paused_monitor_task',
    {
      status: 'failed',
      progress: 100,
      pluginRunId: null,
      errorMessage: 'Could not establish connection. Receiving end does not exist.',
    },
  ]);
  assert.equal(patches[1][0], 'fresh_after_pause');
  assert.equal(patches[1][1].status, 'dispatched');
  assert.deepEqual(dispatched, ['fresh_after_pause']);
  assert.equal(clearLeaseCalls, 1);
});

test('task poller fails monitor tasks on recoverable tab connection errors and releases the lease', async () => {
  const patches = [];
  const events = [];
  let clearLeaseCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'monitor_connection_task',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_patrol',
      },
      lease: {
        leaseToken: 'lease-monitor-1',
        expiresAt: '2026-04-19T01:11:00.000Z',
      },
    }),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'monitor_connection_task',
      resultLookup: { externalTaskId: 'monitor_connection_task' },
    }),
    renewTaskLease: async () => ({ success: true, expiresAt: '2026-04-19T01:12:00.000Z' }),
    getResultPackage: async () => ({
      success: false,
      error: 'Could not establish connection. Receiving end does not exist.',
    }),
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {
      clearLeaseCalls += 1;
    },
  });

  await poller.tick();
  const secondTick = await poller.tick();

  assert.equal(secondTick.failed, true);
  assert.deepEqual(patches[0], [
    'monitor_connection_task',
    {
      status: 'failed',
      progress: 100,
      pluginRunId: null,
      errorMessage: 'Could not establish connection. Receiving end does not exist.',
    },
  ]);
  assert.equal(events[0].eventType, 'task.failed');
  assert.equal(events[0].payload.status, 'failed');
  assert.equal(clearLeaseCalls, 1);
  assert.equal(poller.getState().activeTask, null);
  assert.equal(poller.getState().activeLease, null);
});

test('task poller releases dispatched tasks that never produce a startup run', async () => {
  const patches = [];
  const events = [];
  let nowMs = Date.parse('2026-04-20T15:00:00.000Z');
  const poller = createTaskPoller({
    now: () => nowMs,
    fetchPendingTasks: async () => ([
      {
        id: 'task_startup_timeout',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'detail_probe',
        target: 'https://www.xiaohongshu.com/user/profile/demo',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_startup_timeout',
      resultLookup: { externalTaskId: 'task_startup_timeout' },
    }),
    getResultPackage: async () => ({
      success: false,
      error: 'collectionRun not found for externalTaskId: task_startup_timeout',
    }),
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
  });

  const firstTick = await poller.tick();
  assert.equal(firstTick.accepted, true);
  nowMs += 46_000;

  const secondTick = await poller.tick();

  assert.equal(secondTick.released, true);
  assert.deepEqual(patches[1], [
    'task_startup_timeout',
    {
      status: 'pending',
      progress: 0,
      pluginRunId: null,
      errorMessage: '任务已派出，但页面没有真正启动，已自动释放重试。',
    },
  ]);
  assert.equal(events.at(-1).eventType, 'task.heartbeat');
  assert.equal(events.at(-1).payload.reason, 'dispatch_startup_timeout');
  assert.equal(events.at(-1).payload.userMessage, '任务已派出，但页面没有真正启动，已自动释放重试。');
  assert.equal(poller.getState().activeTask, null);
});

test('task poller does not startup-timeout tasks that were locally marked paused', async () => {
  const patches = [];
  let nowMs = Date.parse('2026-04-20T16:00:00.000Z');
  const poller = createTaskPoller({
    now: () => nowMs,
    fetchPendingTasks: async () => ([
      {
        id: 'task_risk_pause',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'detail_probe',
        target: 'https://www.xiaohongshu.com/user/profile/demo',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_risk_pause',
      resultLookup: { externalTaskId: 'task_risk_pause' },
    }),
    getResultPackage: async () => ({
      success: false,
      error: 'collectionRun not found for externalTaskId: task_risk_pause',
    }),
  });

  const firstTick = await poller.tick();
  assert.equal(firstTick.accepted, true);

  poller.updateActiveTask({
    workbenchStatus: 'paused',
    accountId: 'xhs_account_2',
    pendingAccountUsageId: 'xhs_account_2',
    errorMessage: '风控(300017)，已切换账号，等待恢复',
  });

  nowMs += 46_000;
  const secondTick = await poller.tick();

  assert.equal(secondTick.waiting, true);
  assert.equal(patches.length, 1);
  assert.equal(poller.getState().activeTask?.workbenchStatus, 'paused');
  assert.equal(poller.getState().activeTask?.pendingAccountUsageId, 'xhs_account_2');
});

test('task poller only consumes deferred replacement account usage after a run starts', async () => {
  const patches = [];
  const consumedAccountIds = [];
  let resultLookupCount = 0;
  const poller = createTaskPoller({
    fetchPendingTasks: async () => ([
      {
        id: 'task_risk_resume',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/user/profile/demo',
      },
    ]),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_risk_resume',
      resultLookup: { externalTaskId: 'task_risk_resume' },
    }),
    getResultPackage: async () => {
      resultLookupCount += 1;
      if (resultLookupCount === 1) {
        return {
          success: true,
          result: {
            collectionRunId: 'run_risk_resume',
            status: 'running',
            resultSummary: {
              itemsPlanned: 2,
              itemsSucceeded: 1,
              failedItems: 0,
            },
            records: {
              notes: [],
              comments: [],
              authors: [],
              mediaAssets: [],
            },
          },
        };
      }
      return {
        success: true,
        result: {
          collectionRunId: 'run_risk_resume',
          status: 'done',
          resultSummary: {
            itemsPlanned: 2,
            itemsSucceeded: 2,
            failedItems: 0,
          },
          records: {
            notes: [],
            comments: [],
            authors: [],
            mediaAssets: [],
          },
        },
      };
    },
    consumePendingAccountUsage: async (accountId) => {
      consumedAccountIds.push(accountId);
    },
  });

  await poller.tick();
  poller.updateActiveTask({
    workbenchStatus: 'paused',
    accountId: 'xhs_account_3',
    pendingAccountUsageId: 'xhs_account_3',
  });
  assert.deepEqual(consumedAccountIds, []);

  await poller.tick();

  assert.deepEqual(consumedAccountIds, ['xhs_account_3']);
  assert.equal(poller.getState().activeTask?.pendingAccountUsageId, '');
  assert.equal(patches[1][1].status, 'running');
});
