import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskNavigationUrl, navigateToTask } from '../src/workbench/runtime/navigationOrchestrator.js';

test('xhs.batchNotes keeps full note urls intact for detail probe navigation', () => {
  const noteUrl = 'https://www.xiaohongshu.com/explore/note_123';

  assert.equal(buildTaskNavigationUrl('xhs.batchNotes', noteUrl), noteUrl);
  assert.equal(
    buildTaskNavigationUrl('xhs.batchNotes', noteUrl, { targetPageType: 'detail' }),
    noteUrl,
  );
});

test('xhs.batchNotes keeps full profile relay urls intact for targeted author-page detail probes', () => {
  const relayUrl = 'https://www.xiaohongshu.com/user/profile/6926d8f4000000003702c666/69baad5e00000000230055ef';

  assert.equal(buildTaskNavigationUrl('xhs.batchNotes', relayUrl), relayUrl);
});

test('douyin.batchNotes keeps full video urls intact for detail probe navigation', () => {
  const videoUrl = 'https://www.douyin.com/video/7260000000000000001';

  assert.equal(buildTaskNavigationUrl('douyin.batchNotes', videoUrl), videoUrl);
  assert.equal(
    buildTaskNavigationUrl('douyin.batchNotes', videoUrl, { targetPageType: 'detail' }),
    videoUrl,
  );
});

test('batchNotes still builds search urls for keyword targets', () => {
  assert.equal(
    buildTaskNavigationUrl('xhs.batchNotes', '数学启蒙'),
    'https://www.xiaohongshu.com/search_result?keyword=%E6%95%B0%E5%AD%A6%E5%90%AF%E8%92%99',
  );
  assert.equal(
    buildTaskNavigationUrl('douyin.batchNotes', '数学启蒙'),
    'https://www.douyin.com/search/%E6%95%B0%E5%AD%A6%E5%90%AF%E8%92%99',
  );
});

test('xhs search urls do not double encode already encoded keyword targets', () => {
  assert.equal(
    buildTaskNavigationUrl('xhs.batchNotes', '%E6%9D%8E%E8%80%81%E5%A4%B4'),
    'https://www.xiaohongshu.com/search_result?keyword=%E6%9D%8E%E8%80%81%E5%A4%B4',
  );
  assert.equal(
    buildTaskNavigationUrl('xhs.batchNotes', '%25E6%259D%258E%25E8%2580%2581%25E5%25A4%25B4'),
    'https://www.xiaohongshu.com/search_result?keyword=%E6%9D%8E%E8%80%81%E5%A4%B4',
  );
});

test('other task types keep their existing navigation behavior', () => {
  assert.equal(
    buildTaskNavigationUrl('xhs.collectAuthor', '6926d8f4000000003702c666'),
    'https://www.xiaohongshu.com/user/profile/6926d8f4000000003702c666',
  );
});

test('navigateToTask opens an unfocused execution window and keeps the task tab non-discardable', async () => {
  const originalChrome = globalThis.chrome;
  const windowCalls = [];
  const updateCalls = [];
  const listeners = [];

  globalThis.chrome = {
    runtime: {
      lastError: null,
    },
    windows: {
      create(options, callback) {
        windowCalls.push(options);
        callback({ id: 77 });
      },
    },
    tabs: {
      async query(queryInfo) {
        assert.deepEqual(queryInfo, { windowId: 77, active: true });
        return [{ id: 701 }];
      },
      async update(tabId, patch) {
        updateCalls.push({ tabId, patch });
        return { id: tabId, ...patch };
      },
      onUpdated: {
        addListener(listener) {
          listeners.push(listener);
          setTimeout(() => listener(701, { status: 'complete' }), 0);
        },
        removeListener(listener) {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      },
    },
  };

  try {
    const result = await navigateToTask('xhs.collectAuthor', '6926d8f4000000003702c666');
    assert.deepEqual(windowCalls, [{
      url: 'https://www.xiaohongshu.com/user/profile/6926d8f4000000003702c666',
      focused: false,
      type: 'normal',
    }]);
    assert.deepEqual(updateCalls, [{
      tabId: 701,
      patch: { autoDiscardable: false },
    }]);
    assert.equal(result.tabId, 701);
    assert.equal(result.error, null);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
