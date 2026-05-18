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

test('content message handlers forward selected media types into note media download', async () => {
  const downloadCalls = [];
  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => false,
    collectNote: async () => null,
    collectComments: async () => null,
    collectAuthor: async () => null,
    collectDouyinVideo: async () => null,
    collectDouyinComments: async () => null,
    downloadDouyinCommentImages: async () => null,
    collectDouyinAuthor: async () => null,
    noteStore: {
      getById: async () => ({ noteId: 'n1', title: '测试笔记' }),
    },
    commentStore: {},
    authorStore: {},
    reportDone: () => {},
    batchMessageHandlers: {},
    extractNoteId: () => '',
    downloadNoteMediaFromRecord: async (note, options) => {
      downloadCalls.push({ note, options });
      return { total: 1, success: 1, failed: 0 };
    },
    generateCsv: () => '',
    downloadFile: () => {},
    backfillLegacyAiReadyFields: async () => null,
    getPageContext: async () => ({ platform: 'xhs', pageType: 'detail' }),
    collectionRunStore: {},
    packageWorkbenchResult: async () => null,
    discoverXhsSurfaceNotes: async () => [],
    discoverDouyinSurfaceTargets: async () => [],
  });

  const result = await handlers[MSG.DOWNLOAD_NOTE_MEDIA]({
    noteId: 'n1',
    mediaTypes: ['cover'],
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.summary, { total: 1, success: 1, failed: 0 });
  assert.equal(downloadCalls.length, 1);
  assert.deepEqual(downloadCalls[0].options, { mediaTypes: ['cover'] });
});

test('remote xhs single-note collection writes structured diagnostics on failure', async () => {
  const failedCalls = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    location: {
      href: 'https://www.xiaohongshu.com/discovery/item/69fd330a?xsec_token=token',
    },
  };

  try {
    const handlers = createContentMessageHandlers({
      MSG,
      isDouyinPage: () => false,
      collectNote: async () => {
        throw new Error('笔记数据未稳定就绪: expected=69fd330a actual=');
      },
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
          return { collectionRunId: 'run_remote_note_failed' };
        },
        async markDone() {
          throw new Error('markDone should not be called');
        },
        async markStopped() {
          throw new Error('markStopped should not be called');
        },
        async markFailed(runId, error, patch) {
          failedCalls.push([runId, error, patch]);
        },
      },
      packageWorkbenchResult: async () => null,
      discoverXhsSurfaceNotes: async () => [],
      discoverDouyinSurfaceTargets: async () => [],
    });

    await assert.rejects(
      () => handlers[MSG.COLLECT_SINGLE_NOTE]({
        triggerSource: 'workbench_dispatch',
        expectedNoteId: '69fd330a',
        externalTaskMeta: {
          externalTaskId: 'task_remote_note_failed',
          externalTaskType: 'xhs.batchNotes',
          executorInstanceId: 'executor_1',
          protocolVersion: 'v1',
          monitorMeta: {
            monitorId: 'monitor_1',
            taskStrategy: 'detail_probe',
          },
        },
      }),
    );

    assert.equal(failedCalls.length, 1);
    assert.equal(failedCalls[0][0], 'run_remote_note_failed');
    assert.equal(failedCalls[0][1], '笔记数据未稳定就绪: expected=69fd330a actual=');
    assert.equal(failedCalls[0][2].errorMessage, '笔记数据未稳定就绪: expected=69fd330a actual=');
    assert.equal(failedCalls[0][2].userMessage, '目标笔记页面没有加载出可采数据');
    assert.equal(failedCalls[0][2].diagnostic.reasonCode, 'page_data_not_ready');
    assert.equal(failedCalls[0][2].diagnostic.evidence.expectedNoteId, '69fd330a');
    assert.equal(failedCalls[0][2].diagnostic.evidence.monitorId, 'monitor_1');
  } finally {
    globalThis.window = previousWindow;
  }
});

test('remote xhs author collection fails fast when current profile does not match the monitor target', async () => {
  const failedCalls = [];
  const previousWindow = globalThis.window;

  globalThis.window = {
    location: {
      href: 'https://www.xiaohongshu.com/user/profile/current_author',
      origin: 'https://www.xiaohongshu.com',
    },
  };

  try {
    const handlers = createContentMessageHandlers({
      MSG,
      isDouyinPage: () => false,
      collectNote: async () => null,
      collectComments: async () => null,
      collectAuthor: async () => {
        throw new Error('collectAuthor should not run');
      },
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
      getPageContext: async () => ({ platform: 'xhs', pageType: 'profile' }),
      collectionRunStore: {
        async createRun() {
          return { collectionRunId: 'run_remote_author_1' };
        },
        async markDone() {
          throw new Error('markDone should not be called');
        },
        async markStopped() {
          throw new Error('markStopped should not be called');
        },
        async markFailed(runId, error, patch) {
          failedCalls.push([runId, error, patch]);
        },
      },
      packageWorkbenchResult: async () => null,
      discoverXhsSurfaceNotes: async () => [],
      discoverDouyinSurfaceTargets: async () => [],
    });

    await assert.rejects(
      () => handlers[MSG.COLLECT_AUTHOR]({
        triggerSource: 'workbench_dispatch',
        externalTaskMeta: {
          externalTaskId: 'task_remote_author_1',
          externalTaskType: 'xhs.collectAuthor',
          executorInstanceId: 'executor_1',
          protocolVersion: 'v1',
          monitorMeta: {
            monitorId: 'monitor_author_1',
            taskStrategy: 'author_baseline',
            targetUrl: 'https://www.xiaohongshu.com/user/profile/target_author',
            display: { name: '目标博主' },
          },
        },
      }),
      (error) => {
        assert.equal(error.code, 'target_mismatch');
        return true;
      },
    );

    assert.deepEqual(failedCalls, [[
      'run_remote_author_1',
      '当前页博主身份与任务目标不一致，已停止本轮采集：当前=current_author，目标=目标博主',
      {
        error: '当前页博主身份与任务目标不一致，已停止本轮采集：当前=current_author，目标=目标博主',
        itemsPlanned: 51,
        itemsSucceeded: 0,
        itemsFailed: 51,
        targetIds: [],
        contentIds: [],
      },
    ]]);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('remote xhs author surface scan passes profile selector and scan limit into note discovery', async () => {
  const discoverCalls = [];
  const bulkUpsertCalls = [];
  const doneCalls = [];
  const previousWindow = globalThis.window;

  globalThis.window = {
    location: {
      href: 'https://www.xiaohongshu.com/user/profile/target_author',
      pathname: '/user/profile/target_author',
      origin: 'https://www.xiaohongshu.com',
    },
  };

  try {
    const handlers = createContentMessageHandlers({
      MSG,
      isDouyinPage: () => false,
      collectNote: async () => null,
      collectComments: async () => null,
      collectAuthor: async () => ({
        platformAuthorId: 'target_author',
        userId: 'target_author',
        name: '目标博主',
      }),
      collectDouyinVideo: async () => null,
      collectDouyinComments: async () => null,
      downloadDouyinCommentImages: async () => null,
      collectDouyinAuthor: async () => null,
      noteStore: {
        async bulkUpsert(records) {
          bulkUpsertCalls.push(records);
        },
      },
      commentStore: {},
      authorStore: {},
      reportDone: () => {},
      batchMessageHandlers: {},
      extractNoteId: () => '',
      downloadNoteMediaFromRecord: async () => null,
      generateCsv: () => '',
      downloadFile: () => {},
      backfillLegacyAiReadyFields: async () => null,
      getPageContext: async () => ({ platform: 'xhs', pageType: 'profile' }),
      collectionRunStore: {
        async createRun() {
          return { collectionRunId: 'run_author_surface_1' };
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
      discoverXhsSurfaceNotes: async (...args) => {
        discoverCalls.push(args);
        return [
          { noteId: 'note_1', url: '/explore/note_1', title: '第一条' },
          { noteId: 'note_2', url: '/explore/note_2', title: '第二条' },
        ];
      },
      discoverDouyinSurfaceTargets: async () => [],
    });

    const result = await handlers[MSG.COLLECT_AUTHOR]({
      triggerSource: 'workbench_dispatch',
      externalTaskMeta: {
        externalTaskId: 'task_author_surface_1',
        externalTaskType: 'xhs.collectAuthor',
        executorInstanceId: 'executor_1',
        protocolVersion: 'v1',
        monitorMeta: {
          monitorId: 'monitor_author_surface_1',
          taskStrategy: 'author_patrol',
          targetUrl: 'https://www.xiaohongshu.com/user/profile/target_author',
          scanLimit: 7,
          limit: 7,
          surfaceOnly: true,
          surfaceMode: 'author_surface',
          monitorMode: 'author_surface',
          display: { name: '目标博主' },
        },
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(discoverCalls, [['#userPostedFeeds', 10, { expectedCount: 7 }]]);
    assert.equal(bulkUpsertCalls.length, 1);
    assert.equal(bulkUpsertCalls[0].length, 2);
    assert.equal(doneCalls[0][1].itemsPlanned, 3);
    assert.equal(doneCalls[0][1].itemsSucceeded, 3);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('content message handlers reject collection when plugin authorization is missing', async () => {
  const handlers = createContentMessageHandlers({
    MSG,
    isDouyinPage: () => false,
    assertPluginAuthorized: async () => {
      const error = new Error('当前浏览器还没有插件授权。请先去内容工作台设置生成授权码，再回到插件激活。');
      error.code = 'plugin_authorization_required';
      throw error;
    },
    collectNote: async () => {
      throw new Error('collectNote should not run');
    },
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
    collectionRunStore: {},
    packageWorkbenchResult: async () => null,
    discoverXhsSurfaceNotes: async () => [],
    discoverDouyinSurfaceTargets: async () => [],
  });

  await assert.rejects(
    () => handlers[MSG.COLLECT_SINGLE_NOTE]({ triggerSource: 'popup_manual' }),
    (error) => {
      assert.equal(error.code, 'plugin_authorization_required');
      return true;
    },
  );
});
