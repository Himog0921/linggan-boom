import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskPoller } from '../src/workbench/runtime/taskPoller.js';

function claimTask(tasksOrFactory) {
  return async () => {
    const tasks = typeof tasksOrFactory === 'function' ? await tasksOrFactory() : tasksOrFactory;
    const task = Array.isArray(tasks) ? tasks[0] : tasks;
    return { task: task || null };
  };
}

test('task poller claims a pending task and patches completion state', async () => {
  const patches = [];
  const recordBatches = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([
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
              platform: '',
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
              authorId: '',
              authorPlatformId: '',
              authorEntityId: '',
              authorName: '',
              authorAvatar: '',
              publishedAt: null,
              publishedAtText: '',
              type: '',
              lastUpdateTime: null,
              collectionRunId: '',
              monitorMode: '',
              monitorId: '',
              taskStrategy: '',
              monitorMeta: {},
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
  assert.deepEqual(secondTick.cleanupTask, {
    taskId: 'task_1',
    externalTaskId: 'task_1',
    pluginRunId: 'run_1',
  });
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
    claimTaskLease: claimTask([
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
  assert.equal(events[1].eventType, 'task.page_opened');
  assert.equal(events[1].payload.collectionRunId, 'run_started_1');
  assert.equal(events[2].eventType, 'task.running');
  assert.equal(events[2].payload.status, 'running');
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

test('task poller attaches runtime observability to terminal workbench events', async () => {
  let now = 1_000;
  const events = [];
  const poller = createTaskPoller({
    now: () => now,
    claimTaskLease: claimTask([
      {
        id: 'task_runtime_1',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_baseline',
      },
    ]),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_runtime_1',
      collectionRunId: 'run_runtime_1',
      resultLookup: {
        externalTaskId: 'task_runtime_1',
        collectionRunId: 'run_runtime_1',
      },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_runtime_1',
        status: 'done',
        resultSummary: {
          itemsPlanned: 4,
          itemsSucceeded: 3,
          failedItems: 1,
        },
        records: {
          notes: [],
          comments: [],
          authors: [],
          mediaAssets: [],
        },
      },
    }),
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
  });

  await poller.tick();
  now = 3_500;
  await poller.tick();

  const terminalEvent = events.find((event) => event.eventType === 'task.succeeded');
  assert.equal(terminalEvent.payload.observability.taskType, 'xhs.batchNotes');
  assert.equal(terminalEvent.payload.observability.source, 'monitor');
  assert.equal(terminalEvent.payload.observability.taskStrategy, 'author_baseline');
  assert.equal(terminalEvent.payload.observability.durationMs, 2500);
  assert.equal(terminalEvent.payload.observability.itemAttemptCount, 4);
  assert.equal(terminalEvent.payload.observability.itemFailureCount, 1);
  assert.equal(terminalEvent.payload.observability.report, true);
});

test('task poller fails the task with schema health when extractor records are invalid', async () => {
  const patches = [];
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([
      {
        id: 'task_schema_1',
        taskType: 'xhs.batchComments',
        platform: 'xhs',
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
      taskId: 'task_schema_1',
      collectionRunId: 'run_schema_1',
      resultLookup: {
        externalTaskId: 'task_schema_1',
        collectionRunId: 'run_schema_1',
      },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_schema_1',
        status: 'done',
        resultSummary: { itemsPlanned: 1, itemsSucceeded: 1, failedItems: 0 },
        records: {
          notes: [],
          comments: [{ commentId: 'c1', text: '缺少父级作品' }],
          authors: [],
          mediaAssets: [],
        },
      },
    }),
    enqueueRecords: async () => {
      const error = new Error('comment payload must include the parent note or video id');
      error.code = 'missing_comment_parent';
      error.reasonCode = 'missing_comment_parent';
      error.retryable = false;
      error.validationErrors = [{
        field: 'payload.noteId',
        code: 'missing_comment_parent',
        message: 'comment payload must include the parent note or video id',
      }];
      error.observability = {
        recordType: 'comment',
        schemaValidationAttemptCount: 1,
        schemaValidationFailureCount: 1,
        schemaValidationFailureRate: 1,
        recordSchemaFailed: true,
        invalidRecordField: 'payload.noteId',
        reasonCode: 'missing_comment_parent',
      };
      throw error;
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
  });

  await poller.tick();
  const result = await poller.tick();

  assert.equal(result.failed, true);
  assert.equal(patches.at(-1)[1].status, 'failed');
  assert.equal(patches.at(-1)[1].errorMessage, 'comment payload must include the parent note or video id');
  const failedEvent = events.find((event) => event.eventType === 'task.failed');
  assert.equal(failedEvent.payload.reasonCode, 'missing_comment_parent');
  assert.equal(failedEvent.payload.observability.recordType, 'comment');
  assert.equal(failedEvent.payload.observability.schemaValidationFailureCount, 1);
  assert.equal(failedEvent.payload.observability.recordSchemaFailed, true);
});

test('task poller exposes lease credentials and page fingerprint for server ingest', async () => {
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_with_truth',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        leaseEpoch: 7,
      },
      lease: {
        leaseToken: 'lease-token-7',
        expiresAt: '2026-04-17T12:05:00.000Z',
        attemptId: 'attempt-7',
        attemptNumber: 3,
        leaseEpoch: 7,
      },
    }),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_with_truth',
      collectionRunId: 'run_truth',
      capabilityReport: {
        platform: 'xhs',
        mode: 'detail',
        pageType: 'noteDetail',
        url: 'https://www.xiaohongshu.com/explore/note_truth',
        readiness: { ready: true },
      },
      resultLookup: {
        externalTaskId: 'task_with_truth',
        collectionRunId: 'run_truth',
      },
    }),
  });

  await poller.tick();
  const context = poller.getExecutionContext('task_with_truth');

  assert.equal(context.leaseToken, 'lease-token-7');
  assert.equal(context.attemptId, 'attempt-7');
  assert.equal(context.leaseEpoch, 7);
  assert.deepEqual(context.pageFingerprint, {
    platform: 'xhs',
    pageType: 'detail',
    rawPageType: 'noteDetail',
    url: 'https://www.xiaohongshu.com/explore/note_truth',
    contentId: 'note_truth',
    routeKey: 'detail:note_truth',
    ready: true,
    readinessReasonCode: '',
  });
});

test('task poller persists active task context after dispatch starts', async () => {
  const persisted = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_persist_context',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
      },
      lease: {
        leaseToken: 'lease-persist-context',
        attemptId: 'attempt-persist-context',
        leaseEpoch: 3,
      },
    }),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_persist_context',
      tabId: 789,
      collectionRunId: 'run_persist_context',
      resultLookup: {
        externalTaskId: 'task_persist_context',
        collectionRunId: 'run_persist_context',
      },
    }),
    writeActiveTaskContext: async (snapshot) => {
      persisted.push(snapshot);
    },
  });

  await poller.tick();

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].taskId, 'task_persist_context');
  assert.equal(persisted[0].pluginRunId, 'run_persist_context');
  assert.equal(persisted[0].platform, 'xhs');
  assert.equal(persisted[0].tabId, 789);
  assert.equal(persisted[0].lease.leaseToken, 'lease-persist-context');
  assert.equal(persisted[0].lease.attemptId, 'attempt-persist-context');
});

test('task poller recovers persisted context after worker restart', async () => {
  const lookups = [];
  const poller = createTaskPoller({
    readTaskLease: async () => ({
      taskId: 'task_recover_context',
      leaseToken: 'lease-recover-context',
      attemptId: 'attempt-recover-context',
    }),
    readActiveTaskContext: async () => ({
      taskId: 'task_recover_context',
      externalTaskId: 'task_recover_context',
      pluginRunId: 'run_recover_context',
      platform: 'douyin',
      accountId: 'douyin_account_1',
      tabId: 456,
      workbenchStatus: 'running',
      dispatchedAtMs: 1000,
    }),
    reconcileTaskLease: async () => ({
      success: true,
      action: 'resume',
      lease: {
        taskId: 'task_recover_context',
        leaseToken: 'lease-recover-context',
        attemptId: 'attempt-recover-context',
      },
      task: {
        id: 'task_recover_context',
        taskType: 'douyin.batchNotes',
        platform: 'douyin',
        status: 'running',
      },
    }),
    renewTaskLease: async () => ({ success: true, expiresAt: '2026-04-17T12:05:00.000Z' }),
    getResultPackage: async (lookup) => {
      lookups.push(lookup);
      return {
        success: true,
        result: {
          collectionRunId: 'run_recover_context',
          status: 'running',
          resultSummary: { itemsPlanned: 2, itemsSucceeded: 1, failedItems: 0 },
          records: { notes: [], comments: [], authors: [], mediaAssets: [] },
        },
      };
    },
    patchTask: async () => ({ success: true }),
  });

  await poller.tick();

  assert.deepEqual(lookups[0], {
    collectionRunId: 'run_recover_context',
    externalTaskId: 'task_recover_context',
    tabId: 456,
  });
  assert.equal(poller.getState().activeTask.tabId, 456);
  assert.equal(poller.getState().activeTask.accountId, 'douyin_account_1');
});

test('task poller ignores persisted context from a stale attempt', async () => {
  const lookups = [];
  const poller = createTaskPoller({
    readTaskLease: async () => ({
      taskId: 'task_stale_context',
      leaseToken: 'lease-new-context',
      attemptId: 'attempt-new-context',
    }),
    readActiveTaskContext: async () => ({
      taskId: 'task_stale_context',
      externalTaskId: 'task_stale_context',
      pluginRunId: 'run_old_context',
      attemptId: 'attempt-old-context',
      workbenchStatus: 'running',
    }),
    reconcileTaskLease: async () => ({
      success: true,
      action: 'resume',
      lease: {
        taskId: 'task_stale_context',
        leaseToken: 'lease-new-context',
        attemptId: 'attempt-new-context',
      },
      task: {
        id: 'task_stale_context',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        status: 'running',
      },
    }),
    renewTaskLease: async () => ({ success: true, expiresAt: '2026-04-17T12:05:00.000Z' }),
    getResultPackage: async (lookup) => {
      lookups.push(lookup);
      return { success: false, error: 'collectionRun not found for externalTaskId: task_stale_context' };
    },
    patchTask: async () => ({ success: true }),
  });

  await poller.tick();

  assert.deepEqual(lookups[0], {
    collectionRunId: '',
    externalTaskId: 'task_stale_context',
  });
  assert.equal(poller.getState().activeTask.pluginRunId, '');
});

test('task poller keeps persisted execution page when the resumed server task has the same local run id', async () => {
  const lookups = [];
  const persistedSnapshots = [];
  const poller = createTaskPoller({
    readTaskLease: async () => ({
      taskId: 'task_resume_same_run',
      leaseToken: 'lease-new-context',
      attemptId: 'attempt-new-context',
    }),
    readActiveTaskContext: async () => ({
      taskId: 'task_resume_same_run',
      externalTaskId: 'task_resume_same_run',
      pluginRunId: 'run_same_context',
      attemptId: 'attempt-old-context',
      platform: 'douyin',
      accountId: 'douyin_account_1',
      tabId: 987,
      pageFingerprint: {
        platform: 'douyin',
        pageType: 'profile',
        routeKey: 'profile:author-1',
      },
      workbenchStatus: 'running',
      dispatchedAtMs: 1000,
    }),
    writeActiveTaskContext: async (snapshot) => {
      persistedSnapshots.push(snapshot);
    },
    reconcileTaskLease: async () => ({
      success: true,
      action: 'resume',
      lease: {
        taskId: 'task_resume_same_run',
        leaseToken: 'lease-new-context',
        attemptId: 'attempt-new-context',
      },
      task: {
        id: 'task_resume_same_run',
        taskType: 'douyin.collectAuthor',
        platform: 'douyin',
        status: 'running',
        pluginRunId: 'run_same_context',
      },
    }),
    renewTaskLease: async () => ({ success: true, expiresAt: '2026-04-17T12:05:00.000Z' }),
    getResultPackage: async (lookup) => {
      lookups.push(lookup);
      return {
        success: true,
        result: {
          collectionRunId: 'run_same_context',
          status: 'running',
          resultSummary: { itemsPlanned: 2, itemsSucceeded: 1, failedItems: 0 },
          records: { notes: [], comments: [], authors: [], mediaAssets: [] },
        },
      };
    },
    patchTask: async () => ({ success: true }),
  });

  await poller.tick();

  assert.deepEqual(lookups[0], {
    collectionRunId: 'run_same_context',
    externalTaskId: 'task_resume_same_run',
    tabId: 987,
  });
  assert.equal(poller.getState().activeTask.accountId, 'douyin_account_1');
  assert.equal(poller.getState().activeTask.pageFingerprint.routeKey, 'profile:author-1');
  assert.equal(persistedSnapshots.at(-1).tabId, 987);
});

test('task poller surfaces idle claim reason details from the lease endpoint', async () => {
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: null,
      reason: {
        code: 'no_available_account',
        message: '没有可用账号',
      },
      nextPollAfterMs: 30000,
    }),
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
  });
});

test('task poller turns retryable claim backpressure into an idle wait', async () => {
  const error = new Error('执行设备通道正在保护数据库，请稍后重试。');
  error.status = 503;
  error.retryable = true;
  error.reasonCode = 'plugin_protocol_backpressure';
  error.nextPollAfterMs = 60_000;
  let dispatchCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => {
      throw error;
    },
    dispatchTask: async () => {
      dispatchCalls += 1;
      throw new Error('dispatch should not run during backpressure');
    },
  });

  const result = await poller.tick();

  assert.deepEqual(result, {
    success: true,
    idle: true,
    nextPollAfterMs: 60_000,
    idleReasonCode: 'plugin_protocol_backpressure',
    idleReasonMessage: '执行设备通道正在保护数据库，请稍后重试。',
    reason: {
      code: 'plugin_protocol_backpressure',
      message: '执行设备通道正在保护数据库，请稍后重试。',
    },
  });
  assert.equal(dispatchCalls, 0);
  assert.equal(poller.getState().lastIdleReason.nextPollAfterMs, 60_000);
});

test('task poller turns authorization failures into a long idle pause', async () => {
  const error = new Error('authorization expired');
  error.status = 401;
  error.retryable = false;
  let dispatchCalls = 0;
  let persistedBackoff = null;
  const poller = createTaskPoller({
    claimTaskLease: async () => {
      throw error;
    },
    dispatchTask: async () => {
      dispatchCalls += 1;
      throw new Error('dispatch should not run when authorization is invalid');
    },
    writeAuthorizationFailureBackoff: async (snapshot) => {
      persistedBackoff = snapshot;
    },
  });

  const result = await poller.tick();

  assert.equal(result.success, true);
  assert.equal(result.idle, true);
  assert.equal(result.idleReasonCode, 'authorization_invalid');
  assert.equal(result.idleReasonMessage, 'authorization expired');
  assert.equal(result.nextPollAfterMs, 15 * 60_000);
  assert.equal(dispatchCalls, 0);
  assert.equal(poller.getState().lastIdleReason.nextPollAfterMs, 15 * 60_000);
  assert.equal(persistedBackoff.reason.code, 'authorization_invalid');
  assert.ok(persistedBackoff.retryAtMs > Date.now());
});

test('task poller honors persisted authorization backoff before claiming work', async () => {
  const retryAtMs = 1_000_000 + 15 * 60_000;
  let claimCalls = 0;
  const poller = createTaskPoller({
    now: () => 1_000_000,
    readAuthorizationFailureBackoff: async () => ({
      retryAtMs,
      reason: {
        code: 'authorization_invalid',
        message: 'authorization expired',
      },
    }),
    claimTaskLease: async () => {
      claimCalls += 1;
      throw new Error('claim should not run during persisted authorization backoff');
    },
  });

  const result = await poller.tick();

  assert.equal(result.success, true);
  assert.equal(result.idle, true);
  assert.equal(result.idleReasonCode, 'authorization_invalid');
  assert.equal(result.idleReasonMessage, 'authorization expired');
  assert.equal(result.nextPollAfterMs, 15 * 60_000);
  assert.equal(claimCalls, 0);
});

test('task poller persists outdated plugin idle backoff', async () => {
  let persistedBackoff = null;
  const poller = createTaskPoller({
    claimTaskLease: async () => {
      return {
        task: null,
        nextPollAfterMs: 300_000,
        reason: {
          code: 'PLUGIN_VERSION_OUTDATED',
          message: '请先更新插件到最新版后再接单',
        },
      };
    },
    writeAuthorizationFailureBackoff: async (snapshot) => {
      persistedBackoff = snapshot;
    },
  });

  const result = await poller.tick();

  assert.equal(result.success, true);
  assert.equal(result.idle, true);
  assert.equal(result.idleReasonCode, 'PLUGIN_VERSION_OUTDATED');
  assert.equal(result.nextPollAfterMs, 300_000);
  assert.equal(persistedBackoff.reason.code, 'PLUGIN_VERSION_OUTDATED');
});

test('task poller clears local active task when it has no valid lease for too long', async () => {
  let now = 1_000;
  const patches = [];
  const events = [];
  const leases = [];
  const poller = createTaskPoller({
    now: () => now,
    claimTaskLease: claimTask([
      {
        id: 'task_no_lease_1',
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
      taskId: 'task_no_lease_1',
      resultLookup: { externalTaskId: 'task_no_lease_1' },
    }),
    getResultPackage: async () => ({ success: false, error: 'run_not_found' }),
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {
      leases.push('cleared');
    },
  });

  const first = await poller.tick();
  assert.equal(first.accepted, true);

  now += 6 * 60_000;
  const second = await poller.tick();

  assert.equal(second.released, true);
  assert.equal(second.reason, 'local_lease_missing_timeout');
  assert.equal(poller.getState().activeTask, null);
  assert.equal(leases.length, 1);
  assert.equal(patches.at(-1)[1].status, 'pending');
  assert.equal(patches.at(-1)[1].errorMessage, '插件本地任务没有有效租约，已自动释放重试。');
  assert.equal(events.at(-1).payload.reason, 'local_lease_missing_timeout');
});

test('task poller keeps monitor tasks running when the local lease is missing', async () => {
  let now = 1_000;
  const patches = [];
  const events = [];
  const poller = createTaskPoller({
    now: () => now,
    claimTaskLease: claimTask([
      {
        id: 'monitor_no_lease_1',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_baseline',
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
      taskId: 'monitor_no_lease_1',
      collectionRunId: 'run_monitor_no_lease_1',
      resultLookup: { externalTaskId: 'monitor_no_lease_1' },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_monitor_no_lease_1',
        status: 'running',
        resultSummary: {
          itemsPlanned: 50,
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
    }),
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
  });

  const first = await poller.tick();
  assert.equal(first.accepted, true);

  now += 6 * 60_000;
  const second = await poller.tick();

  assert.equal(second.released, undefined);
  assert.equal(poller.getState().activeTask.taskId, 'monitor_no_lease_1');
  assert.equal(
    patches.some(([, patch]) => patch.status === 'pending' && patch.errorMessage === '插件本地任务没有有效租约，已自动释放重试。'),
    false
  );
  assert.equal(events.some((event) => event.payload?.reason === 'local_lease_missing_timeout'), false);
});

test('task poller preserves author profile fields when reporting monitor results', async () => {
  const patches = [];
  const recordBatches = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([
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

test('task poller preserves note author and publish-time fields when reporting monitor note results', async () => {
  const patches = [];
  const recordBatches = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([
      {
        id: 'task_author_notes',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_baseline',
        payload: { monitorId: 'monitor_author_2' },
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
      taskId: 'task_author_notes',
      resultLookup: { externalTaskId: 'task_author_notes' },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_author_notes',
        status: 'done',
        resultSummary: { notes: 1, itemsPlanned: 1, itemsSucceeded: 1, failedItems: 0 },
        records: {
          notes: [
            {
              platform: 'xhs',
              noteId: 'note_50',
              platformContentId: 'note_50',
              title: '最近一条作品',
              content: '正文内容',
              url: 'https://www.xiaohongshu.com/explore/note_50',
              canonicalUrl: 'https://www.xiaohongshu.com/explore/note_50',
              rawUrl: 'https://www.xiaohongshu.com/explore/note_50?xsec_token=abc123',
              likes: 520,
              collects: 88,
              comments: 34,
              shares: 12,
              authorId: 'author_target_1',
              authorPlatformId: 'author_target_1',
              authorEntityId: 'xhs_author_target_1',
              authorName: '目标博主',
              authorAvatar: 'https://images.example.com/author.jpg',
              publishedAt: 1776766122,
              publishedAtText: '4月21日 18:08',
              type: 'video',
              lastUpdateTime: 1776766999,
              monitorMode: 'author_surface',
              monitorId: 'monitor_author_2',
              taskStrategy: 'author_baseline',
              monitorMeta: {
                monitorId: 'monitor_author_2',
                taskStrategy: 'author_baseline',
                targetUrl: 'https://www.xiaohongshu.com/user/profile/author_target_1',
              },
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

  await poller.tick();
  await poller.tick();

  const note = patches[1][1].resultSummary.records.notes[0];
  assert.equal(note.authorId, 'author_target_1');
  assert.equal(note.authorPlatformId, 'author_target_1');
  assert.equal(note.publishedAt, 1776766122);
  assert.equal(note.publishedAtText, '4月21日 18:08');
  assert.equal(note.type, 'video');
  assert.equal(note.monitorMeta.targetUrl, 'https://www.xiaohongshu.com/user/profile/author_target_1');
  assert.equal(recordBatches[0][0].payload.authorId, 'author_target_1');
  assert.equal(recordBatches[0][0].payload.publishedAt, 1776766122);
  assert.equal(recordBatches[0][0].payload.type, 'video');
});

test('task poller leaves task pending when no executable context is available', async () => {
  const patches = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([
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

test('task poller releases a leased task when the content script is unavailable', async () => {
  const patches = [];
  const events = [];
  const leases = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_missing_content_script',
        taskType: 'douyin.batchComments',
        platform: 'douyin',
        target: 'https://www.douyin.com/search/%E5%92%96%E5%95%A1',
      },
      lease: {
        leaseToken: 'lease-missing-content',
        attemptId: 'attempt-missing-content',
        leaseEpoch: 2,
      },
    }),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({
      success: true,
      accepted: false,
      reasonCode: 'page_context_unavailable',
      reasonMessage: '当前页面没有加载插件内容脚本',
      recommendedAction: 'reload_supported_page_with_plugin',
    }),
    dispatchTask: async () => {
      throw new Error('dispatch should not run');
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {
      leases.push('cleared');
    },
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, '当前页面没有加载插件内容脚本');
  assert.deepEqual(patches[0], [
    'task_missing_content_script',
    {
      status: 'pending',
      progress: 0,
      errorMessage: '当前页面没有加载插件内容脚本',
    },
  ]);
  assert.equal(events.at(-1).eventType, 'task.released');
  assert.equal(events.at(-1).attemptId, 'attempt-missing-content');
  assert.equal(events.at(-1).leaseId, 'lease-missing-content');
  assert.equal(events.at(-1).platform, 'douyin');
  assert.equal(events.at(-1).payload.reasonCode, 'page_context_unavailable');
  assert.equal(events.at(-1).payload.recommendedAction, 'reload_supported_page_with_plugin');
  assert.equal(leases.length, 1);
  assert.equal(poller.getState().activeTask, null);
});

test('task poller fails unavailable detail pages instead of returning them to pending', async () => {
  const patches = [];
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_deleted_note',
        taskType: 'xhs.batchComments',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/explore/deleted-note',
      },
      lease: {
        leaseToken: 'lease-deleted-note',
        attemptId: 'attempt-deleted-note',
      },
    }),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({
      success: true,
      accepted: false,
      reasonCode: 'content_not_found',
      reasonMessage: '当前笔记已删除或不可访问',
      report: {
        mode: 'unknown',
        pageType: 'error',
        url: 'https://www.xiaohongshu.com/explore/deleted-note',
        readiness: {
          ready: false,
          reasonCode: 'content_not_found',
          reasonMessage: '当前笔记已删除或不可访问',
        },
        capabilities: {
          canRunTaskTypes: [],
        },
      },
    }),
    dispatchTask: async () => {
      throw new Error('dispatch should not run');
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {},
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  assert.deepEqual(patches[0], [
    'task_deleted_note',
    {
      status: 'failed',
      progress: 100,
      errorMessage: '当前笔记已删除或不可访问',
    },
  ]);
  const mismatchEvent = events.find((event) => event.eventType === 'task.capability_mismatch');
  assert.equal(mismatchEvent.payload.reasonCode, 'content_not_found');
  assert.equal(mismatchEvent.payload.reportPageType, 'error');
  assert.equal(mismatchEvent.payload.reportUrl, 'https://www.xiaohongshu.com/explore/deleted-note');
  assert.equal(mismatchEvent.payload.status, 'failed');
  assert.equal(events.some((event) => event.eventType === 'task.released'), false);
  assert.equal(poller.getState().activeTask, null);
});

test('task poller fails comment detail tasks when capability only reports unsupported task type', async () => {
  const patches = [];
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_comment_unsupported',
        taskType: 'xhs.batchComments',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/explore/note-1',
        taskStrategy: 'detail_probe',
        payload: {
          noteId: 'note-1',
          taskStrategy: 'detail_probe',
        },
      },
      lease: {
        leaseToken: 'lease-comment-unsupported',
        attemptId: 'attempt-comment-unsupported',
      },
    }),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({
      success: true,
      accepted: false,
      reasonCode: 'unsupported_task_type',
      reasonMessage: '当前页面能力报告未声明支持该任务类型',
      report: {
        mode: 'detail',
        pageType: 'detail',
        url: 'https://www.xiaohongshu.com/explore/note-1',
        readiness: {
          ready: false,
          reasonCode: 'content_not_found',
          reasonMessage: '当前笔记已删除或不可访问',
        },
        capabilities: {
          canRunTaskTypes: [],
        },
      },
    }),
    dispatchTask: async () => {
      throw new Error('dispatch should not run');
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {},
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  assert.deepEqual(patches[0], [
    'task_comment_unsupported',
    {
      status: 'failed',
      progress: 100,
      errorMessage: '当前页面能力报告未声明支持该任务类型',
    },
  ]);
  const mismatchEvent = events.find((event) => event.eventType === 'task.capability_mismatch');
  assert.equal(mismatchEvent.payload.reasonCode, 'unsupported_task_type');
  assert.equal(mismatchEvent.payload.status, 'failed');
  assert.equal(events.some((event) => event.eventType === 'task.released'), false);
  assert.equal(poller.getState().activeTask, null);
});

test('task poller releases target mismatch with an explicit target mismatch code', async () => {
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_target_mismatch',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/user/profile/expected_author',
      },
      lease: {
        leaseToken: 'lease-target-mismatch',
        attemptId: 'attempt-target-mismatch',
      },
    }),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({
      success: true,
      accepted: false,
      reasonCode: 'page_target_mismatch',
      reasonMessage: '当前页面不是任务目标博主',
    }),
    dispatchTask: async () => {
      throw new Error('dispatch should not run');
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {},
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  const releaseEvent = events.find((event) => event.eventType === 'task.released');
  assert.equal(releaseEvent.payload.reasonCode, 'page_target_mismatch');
  assert.equal(releaseEvent.payload.errorCode, 'TARGET_MISMATCH');
  assert.equal(releaseEvent.payload.userMessage, '当前页面不是任务目标博主');
});

test('task poller emits a failed event when dispatch throws before startup', async () => {
  const patches = [];
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_dispatch_throw',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
      },
      lease: {
        leaseToken: 'lease-dispatch-throw',
        attemptId: 'attempt-dispatch-throw',
      },
    }),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => {
      throw new Error('content handler crashed during startup');
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {},
  });

  const result = await poller.tick();

  assert.equal(result.success, false);
  assert.equal(result.reason, 'content handler crashed during startup');
  assert.equal(patches[0][1].status, 'failed');
  const failedEvent = events.find((event) => event.eventType === 'task.failed');
  assert.equal(failedEvent.attemptId, 'attempt-dispatch-throw');
  assert.equal(failedEvent.leaseId, 'lease-dispatch-throw');
  assert.equal(failedEvent.payload.reason, 'dispatch_failed');
  assert.equal(failedEvent.payload.errorMessage, 'content handler crashed during startup');
});

test('task poller emits a failed event when dispatch is rejected', async () => {
  const events = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_dispatch_rejected',
        taskType: 'douyin.batchNotes',
        platform: 'douyin',
      },
      lease: {
        leaseToken: 'lease-dispatch-rejected',
        attemptId: 'attempt-dispatch-rejected',
      },
    }),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: false,
      accepted: false,
      error: 'dispatch_not_accepted',
      reasonCode: 'page_context_unavailable',
    }),
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {},
  });

  const result = await poller.tick();

  assert.equal(result.success, false);
  const failedEvent = events.find((event) => event.eventType === 'task.failed');
  assert.equal(failedEvent.attemptId, 'attempt-dispatch-rejected');
  assert.equal(failedEvent.payload.reasonCode, 'page_context_unavailable');
  assert.equal(failedEvent.payload.errorMessage, 'dispatch_not_accepted');
});

test('task poller stores selected account and consumes quota only after dispatch', async () => {
  const quotaUpdates = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([
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

test('task poller releases a leased task when the selected account is busy', async () => {
  const events = [];
  let dispatchCalls = 0;
  let clearLeaseCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_account_busy',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
      },
      lease: {
        leaseToken: 'lease-account-busy',
        attemptId: 'attempt-account-busy',
      },
    }),
    beforeDispatch: async () => ({
      shouldPause: false,
      accountId: 'xhs_account_busy',
    }),
    acquireExecutionLock: async () => ({
      acquired: false,
      reasonCode: 'account_busy',
      reasonMessage: '同一账号正在执行另一个采集任务',
      retryAfterMs: 60000,
    }),
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => {
      dispatchCalls += 1;
      throw new Error('dispatch should not run while account is busy');
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {
      clearLeaseCalls += 1;
    },
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'account_busy');
  assert.equal(dispatchCalls, 0);
  assert.equal(clearLeaseCalls, 1);
  const releaseEvent = events.find((event) => event.eventType === 'task.released');
  assert.equal(releaseEvent.payload.reasonCode, 'account_busy');
  assert.equal(releaseEvent.payload.accountId, 'xhs_account_busy');
  assert.equal(releaseEvent.payload.retryAfterMs, 60000);
});

test('task poller clears a stale workbench account lock before dispatching a fresh task', async () => {
  const acquiredLocks = [];
  const releasedLocks = [];
  let dispatchCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'new_douyin_task',
        taskType: 'douyin.collectAuthor',
        platform: 'douyin',
      },
      lease: {
        leaseToken: 'lease-new-douyin-task',
        attemptId: 'attempt-new-douyin-task',
      },
    }),
    beforeDispatch: async () => ({
      shouldPause: false,
      accountId: 'douyin_account_1',
    }),
    readTaskLease: async () => ({
      taskId: 'new_douyin_task',
      leaseToken: 'lease-new-douyin-task',
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    acquireExecutionLock: async (lock) => {
      acquiredLocks.push(lock);
      if (acquiredLocks.length === 1) {
        return {
          acquired: false,
          reasonCode: 'account_busy',
          reasonMessage: '同一账号正在执行另一个采集任务',
          existingTaskId: 'old_douyin_task',
          retryAfterMs: 60000,
        };
      }
      return { acquired: true };
    },
    releaseExecutionLock: async (lock) => {
      releasedLocks.push(lock);
    },
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => {
      dispatchCalls += 1;
      return {
        success: true,
        accepted: true,
        taskId: 'new_douyin_task',
        resultLookup: { externalTaskId: 'new_douyin_task' },
      };
    },
  });

  const result = await poller.tick();

  assert.equal(result.accepted, true);
  assert.equal(dispatchCalls, 1);
  assert.equal(acquiredLocks.length, 2);
  assert.deepEqual(releasedLocks, [
    {
      platform: 'douyin',
      accountId: 'douyin_account_1',
      taskId: 'old_douyin_task',
    },
  ]);
  assert.equal(poller.getState().activeTask?.taskId, 'new_douyin_task');
  assert.equal(poller.getState().activeTask?.accountId, 'douyin_account_1');
});

test('task poller keeps manual account locks reserved for local sync work', async () => {
  const releasedLocks = [];
  let dispatchCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'new_douyin_task_manual_busy',
        taskType: 'douyin.collectAuthor',
        platform: 'douyin',
      },
      lease: {
        leaseToken: 'lease-manual-busy',
        attemptId: 'attempt-manual-busy',
      },
    }),
    beforeDispatch: async () => ({
      shouldPause: false,
      accountId: 'douyin_account_1',
    }),
    acquireExecutionLock: async () => ({
      acquired: false,
      reasonCode: 'account_busy',
      reasonMessage: '同一账号正在执行另一个采集任务',
      existingTaskId: 'manual:startBatchNotes:1',
      retryAfterMs: 60000,
    }),
    releaseExecutionLock: async (lock) => {
      releasedLocks.push(lock);
    },
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => {
      dispatchCalls += 1;
      throw new Error('dispatch should not run while a manual lock is active');
    },
    clearTaskLease: async () => {},
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'account_busy');
  assert.equal(dispatchCalls, 0);
  assert.deepEqual(releasedLocks, []);
});

test('task poller releases a leased task when no local account is available before dispatch', async () => {
  const patches = [];
  const events = [];
  let dispatchCalls = 0;
  let clearLeaseCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_no_account',
        taskType: 'xhs.batchComments',
        platform: 'xhs',
        target: 'https://www.xiaohongshu.com/explore/note-1',
      },
      lease: {
        leaseToken: 'lease-no-account',
        attemptId: 'attempt-no-account',
      },
    }),
    beforeDispatch: async () => ({
      shouldPause: true,
      reason: 'no_available_account',
    }),
    patchTask: async (taskId, patch) => {
      patches.push([taskId, patch]);
      return { success: true };
    },
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => {
      dispatchCalls += 1;
      throw new Error('dispatch should not run without account');
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {
      clearLeaseCalls += 1;
    },
  });

  const result = await poller.tick();

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_available_account');
  assert.equal(dispatchCalls, 0);
  assert.equal(clearLeaseCalls, 1);
  assert.deepEqual(patches[0], [
    'task_no_account',
    {
      status: 'pending',
      progress: 0,
      errorMessage: 'no_available_account',
    },
  ]);
  const releaseEvent = events.find((event) => event.eventType === 'task.released');
  assert.equal(releaseEvent.payload.reasonCode, 'no_available_account');
  assert.equal(releaseEvent.payload.status, 'pending');
  assert.equal(poller.getState().activeTask, null);
});

test('task poller releases the account execution lock when a task finishes', async () => {
  const releasedLocks = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_account_lock_done',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
      },
      lease: {
        leaseToken: 'lease-account-lock-done',
        attemptId: 'attempt-account-lock-done',
      },
    }),
    beforeDispatch: async () => ({
      shouldPause: false,
      accountId: 'xhs_account_lock_done',
    }),
    acquireExecutionLock: async () => ({ acquired: true }),
    releaseExecutionLock: async (lock) => {
      releasedLocks.push(lock);
    },
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_account_lock_done',
      collectionRunId: 'run_account_lock_done',
      resultLookup: {
        externalTaskId: 'task_account_lock_done',
        collectionRunId: 'run_account_lock_done',
      },
    }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_account_lock_done',
        status: 'done',
        resultSummary: { itemsPlanned: 1, itemsSucceeded: 1, failedItems: 0 },
        records: { notes: [], comments: [], authors: [], mediaAssets: [] },
      },
    }),
  });

  await poller.tick();
  await poller.tick();

  assert.deepEqual(releasedLocks, [
    {
      platform: 'xhs',
      accountId: 'xhs_account_lock_done',
      taskId: 'task_account_lock_done',
    },
  ]);
});

test('task poller refreshes the account execution lock while a task is running', async () => {
  const acquiredLocks = [];
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'task_account_lock_running',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
      },
      lease: {
        leaseToken: 'lease-account-lock-running',
        attemptId: 'attempt-account-lock-running',
      },
    }),
    beforeDispatch: async () => ({
      shouldPause: false,
      accountId: 'xhs_account_lock_running',
    }),
    acquireExecutionLock: async (lock) => {
      acquiredLocks.push(lock);
      return { acquired: true };
    },
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'task_account_lock_running',
      collectionRunId: 'run_account_lock_running',
      resultLookup: {
        externalTaskId: 'task_account_lock_running',
        collectionRunId: 'run_account_lock_running',
      },
    }),
    renewTaskLease: async () => ({ success: true, expiresAt: '2026-05-24T01:12:00.000Z' }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_account_lock_running',
        status: 'running',
        resultSummary: { itemsPlanned: 2, itemsSucceeded: 1, failedItems: 0 },
        records: { notes: [], comments: [], authors: [], mediaAssets: [] },
      },
    }),
  });

  await poller.tick();
  await poller.tick();

  assert.equal(acquiredLocks.length, 2);
  assert.deepEqual(acquiredLocks[1], {
    platform: 'xhs',
    accountId: 'xhs_account_lock_running',
    taskId: 'task_account_lock_running',
    leaseToken: 'lease-account-lock-running',
    attemptId: 'attempt-account-lock-running',
  });
});

test('task poller does not consume quota when dispatch never starts', async () => {
  const quotaUpdates = [];
  const poller = createTaskPoller({
    claimTaskLease: claimTask([
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
    claimTaskLease: claimTask([
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
    claimTaskLease: claimTask([
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
          totalComments: 6,
          targetIds: ['7001', '7002', '7003'],
          contentIds: ['dy_7001'],
          failedTargets: [{ awemeId: '7002', error: 'comment api blocked' }],
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
        totalComments: 6,
        targetIds: ['7001', '7002', '7003'],
        contentIds: ['dy_7001'],
        failedTargets: [{ awemeId: '7002', error: 'comment api blocked' }],
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
      leaseToken: 'lease-monitor-1',
    },
  ]);
  assert.equal(events[0].eventType, 'task.failed');
  assert.equal(events[0].payload.status, 'failed');
  assert.equal(clearLeaseCalls, 1);
  assert.equal(poller.getState().activeTask, null);
  assert.equal(poller.getState().activeLease, null);
});

test('task poller preserves failed run diagnostics when the local run only stored error', async () => {
  const patches = [];
  const events = [];
  let clearLeaseCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => ({
      task: {
        id: 'detail_probe_task',
        taskType: 'xhs.batchNotes',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'detail_probe',
        payload: {
          targetNoteId: '69fd330a',
        },
      },
      lease: {
        leaseToken: 'lease-detail-1',
        expiresAt: '2026-05-09T01:11:00.000Z',
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
      taskId: 'detail_probe_task',
      collectionRunId: 'run_failed_detail',
      resultLookup: {
        collectionRunId: 'run_failed_detail',
        externalTaskId: 'detail_probe_task',
      },
    }),
    renewTaskLease: async () => ({ success: true, expiresAt: '2026-05-09T01:12:00.000Z' }),
    getResultPackage: async () => ({
      success: true,
      result: {
        collectionRunId: 'run_failed_detail',
        status: 'failed',
        resultSummary: {
          itemsPlanned: 1,
          itemsSucceeded: 0,
          failedItems: 1,
        },
        records: {
          notes: [],
          comments: [],
          authors: [],
          mediaAssets: [],
        },
        runRecord: {
          error: '笔记数据未稳定就绪: expected=69fd330a actual=',
          diagnostic: {
            stage: 'collecting',
            failureCategory: 'retry_wait',
            reasonCode: 'page_data_not_ready',
            userMessage: '目标笔记页面没有加载出可采数据',
            technicalMessage: '笔记数据未稳定就绪: expected=69fd330a actual=',
            recommendedAction: '稍后自动重试，或改用作者页重新定位该笔记',
            evidence: {
              expectedNoteId: '69fd330a',
              currentNoteId: '',
            },
          },
        },
      },
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

  assert.equal(secondTick.status, 'failed');
  assert.equal(patches[0][0], 'detail_probe_task');
  assert.equal(patches[0][1].status, 'running');
  assert.equal(patches[1][0], 'detail_probe_task');
  assert.equal(patches[1][1].status, 'failed');
  assert.equal(patches[1][1].errorMessage, '笔记数据未稳定就绪: expected=69fd330a actual=');
  const failedEvent = events.find((event) => event.eventType === 'task.failed');
  assert.ok(failedEvent);
  assert.equal(failedEvent.payload.userMessage, '目标笔记页面没有加载出可采数据');
  assert.equal(failedEvent.payload.stage, 'collecting');
  assert.equal(failedEvent.payload.failureCategory, 'retry_wait');
  assert.equal(failedEvent.payload.reasonCode, 'page_data_not_ready');
  assert.equal(failedEvent.payload.recommendedAction, '稍后自动重试，或改用作者页重新定位该笔记');
  assert.deepEqual(failedEvent.payload.evidence, {
    expectedNoteId: '69fd330a',
    currentNoteId: '',
  });
  assert.equal(clearLeaseCalls, 1);
});

test('task poller releases stale active task when lease renewal conflicts', async () => {
  const events = [];
  let clearLeaseCalls = 0;
  let claimCalls = 0;
  const poller = createTaskPoller({
    claimTaskLease: async () => {
      claimCalls += 1;
      return {
        task: {
          id: 'stale_lease_task',
          taskType: 'xhs.collectAuthor',
          platform: 'xhs',
          source: 'monitor',
          taskStrategy: 'author_baseline',
        },
        lease: {
          leaseToken: 'lease-stale',
          expiresAt: '2026-04-19T01:11:00.000Z',
        },
      };
    },
    patchTask: async () => ({ success: true }),
    capabilityCheck: async () => ({ success: true, accepted: true }),
    dispatchTask: async () => ({
      success: true,
      accepted: true,
      taskId: 'stale_lease_task',
      collectionRunId: 'run-stale-lease',
      resultLookup: { externalTaskId: 'stale_lease_task' },
    }),
    renewTaskLease: async () => {
      const error = new Error('Task lease is held by another station');
      error.status = 409;
      error.retryable = false;
      throw error;
    },
    getResultPackage: async () => {
      throw new Error('result lookup should stop after lease conflict');
    },
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

  assert.equal(secondTick.released, true);
  assert.equal(secondTick.reason, 'lease_conflict');
  assert.equal(claimCalls, 1);
  assert.equal(clearLeaseCalls, 1);
  assert.equal(poller.getState().activeTask, null);
  assert.equal(poller.getState().activeLease, null);
  assert.equal(events.at(-1).payload.reason, 'lease_conflict');
});

test('task poller releases dispatched tasks that never produce a startup run', async () => {
  const patches = [];
  const events = [];
  let nowMs = Date.parse('2026-04-20T15:00:00.000Z');
  const poller = createTaskPoller({
    now: () => nowMs,
    claimTaskLease: claimTask([
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
  const retryAt = new Date(nowMs + 2 * 60 * 1000).toISOString();

  const secondTick = await poller.tick();

  assert.equal(secondTick.released, true);
  assert.deepEqual(secondTick.cleanupTask, {
    taskId: 'task_startup_timeout',
    externalTaskId: 'task_startup_timeout',
    pluginRunId: '',
  });
  assert.deepEqual(patches[1], [
    'task_startup_timeout',
    {
      status: 'pending',
      progress: 0,
      pluginRunId: null,
      errorMessage: '任务已派出，但页面没有真正启动，已自动释放重试。',
      notBeforeAt: retryAt,
    },
  ]);
  assert.equal(events.at(-1).eventType, 'task.page_open_failed');
  assert.equal(events.at(-1).payload.reason, 'dispatch_startup_timeout');
  assert.equal(events.at(-1).payload.userMessage, '任务已派出，但页面没有真正启动，已自动释放重试。');
  assert.equal(events.at(-1).payload.notBeforeAt, retryAt);
  assert.equal(poller.getState().activeTask, null);
});

test('task poller fails running task when the result package handoff is lost', async () => {
  const patches = [];
  const events = [];
  const lookups = [];
  let nowMs = Date.parse('2026-04-20T16:00:00.000Z');
  const poller = createTaskPoller({
    now: () => nowMs,
    claimTaskLease: claimTask([
      {
        id: 'task_handoff_lost',
        taskType: 'douyin.collectAuthor',
        platform: 'douyin',
        source: 'monitor',
        taskStrategy: 'author_baseline',
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
      taskId: 'task_handoff_lost',
      tabId: 789,
      collectionRunId: 'run_handoff_lost',
      resultLookup: {
        externalTaskId: 'task_handoff_lost',
        collectionRunId: 'run_handoff_lost',
      },
    }),
    renewTaskLease: async () => ({ success: true, expiresAt: '2026-04-20T16:20:00.000Z' }),
    getResultPackage: async (lookup) => {
      lookups.push(lookup);
      return {
        success: false,
        error: 'collectionRun not found for collectionRunId: run_handoff_lost',
      };
    },
    enqueueEvent: async (event) => {
      events.push(event);
      return event;
    },
    clearTaskLease: async () => {},
  });

  await poller.tick();
  nowMs += 13 * 60 * 1000;
  const result = await poller.tick();

  assert.equal(result.failed, true);
  assert.equal(result.reason, 'result_package_handoff_lost');
  assert.deepEqual(lookups[0], {
    collectionRunId: 'run_handoff_lost',
    externalTaskId: 'task_handoff_lost',
    tabId: 789,
  });
  assert.deepEqual(patches.at(-1), [
    'task_handoff_lost',
    {
      status: 'failed',
      progress: 100,
      pluginRunId: 'run_handoff_lost',
      errorMessage: '采集页结果包没有交回工作台：插件没有找到本轮执行页，已停止这条卡住的任务。',
    },
  ]);
  assert.equal(events.at(-1).eventType, 'task.failed');
  assert.equal(events.at(-1).payload.reason, 'result_package_handoff_lost');
  assert.equal(poller.getState().activeTask, null);
});

test('task poller does not startup-timeout tasks that were locally marked paused', async () => {
  const patches = [];
  let nowMs = Date.parse('2026-04-20T16:00:00.000Z');
  const poller = createTaskPoller({
    now: () => nowMs,
    claimTaskLease: claimTask([
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
    claimTaskLease: claimTask([
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

test('task poller reconciles a stale local lease before claiming fresh work', async () => {
  let reconcileCalls = 0;
  let clearLeaseCalls = 0;
  let claimCalls = 0;
  const poller = createTaskPoller({
    now: () => 1_000_000,
    readTaskLease: async () => ({ taskId: 'stale-task', leaseToken: 'stale-token' }),
    clearTaskLease: async () => {
      clearLeaseCalls += 1;
    },
    reconcileTaskLease: async ({ localLease }) => {
      reconcileCalls += 1;
      assert.equal(localLease.leaseToken, 'stale-token');
      return { success: true, action: 'clear_local' };
    },
    claimTaskLease: async () => {
      claimCalls += 1;
      return { task: null, nextPollAfterMs: 120_000 };
    },
  });

  const result = await poller.tick();

  assert.equal(result.idle, true);
  assert.equal(reconcileCalls, 1);
  assert.equal(clearLeaseCalls, 1);
  assert.equal(claimCalls, 1);
});

test('task poller resumes a server lease returned by reconcile', async () => {
  let claimCalls = 0;
  const renewals = [];
  const poller = createTaskPoller({
    now: () => 1_000_000,
    readTaskLease: async () => null,
    reconcileTaskLease: async () => ({
      success: true,
      action: 'resume',
      task: {
        id: 'resume-task',
        taskType: 'xhs.collectAuthor',
        platform: 'xhs',
        source: 'monitor',
        taskStrategy: 'author_patrol',
        status: 'running',
      },
      lease: {
        taskId: 'resume-task',
        leaseToken: 'resume-token',
        expiresAt: '2026-05-10T01:10:00.000Z',
      },
    }),
    renewTaskLease: async (taskId, lease) => {
      renewals.push([taskId, lease.leaseToken]);
      return { success: true, expiresAt: '2026-05-10T01:15:00.000Z' };
    },
    claimTaskLease: async () => {
      claimCalls += 1;
      return { task: null };
    },
    getResultPackage: async () => ({
      success: true,
      result: {
        status: 'running',
        resultSummary: {
          itemsPlanned: 3,
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
    }),
  });

  const result = await poller.tick();

  assert.equal(result.status, 'running');
  assert.deepEqual(renewals, [['resume-task', 'resume-token']]);
  assert.equal(claimCalls, 0);
  assert.equal(poller.getState().activeTask.taskId, 'resume-task');
  assert.equal(poller.getState().activeLease.leaseToken, 'resume-token');
});
