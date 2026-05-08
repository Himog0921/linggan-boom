import test from 'node:test';
import assert from 'node:assert/strict';

import { createDashboardBridge } from '../src/content/dashboardBridge.js';
import { unwrapParentResponseData } from '../src/dashboard/utils.js';

test('dashboard bridge wraps raw collection payloads in a success/data envelope', async () => {
  const payloads = [];
  const TEST_NONCE = 'test-nonce-1';
  const bridge = createDashboardBridge({
    MSG: {
      GET_ALL_NOTES: 'getAllNotes',
      GET_ALL_COMMENTS: 'getAllComments',
      GET_ALL_AUTHORS: 'getAllAuthors',
      DOWNLOAD_NOTE_MEDIA: 'downloadNoteMedia',
      CLEAR_ALL_NOTES: 'clearAllNotes',
      CLEAR_ALL_COMMENTS: 'clearAllComments',
      CLEAR_ALL_AUTHORS: 'clearAllAuthors',
      DELETE_NOTE: 'deleteNote',
      DELETE_COMMENT: 'deleteComment',
      DELETE_AUTHOR: 'deleteAuthor',
      SYNC_TO_WORKBENCH: 'syncToWorkbench',
    },
    noteStore: {
      getAll: async () => [{ noteId: 'n1' }],
    },
    commentStore: {
      getAll: async () => [],
    },
    authorStore: {
      getAll: async () => [],
    },
    downloadNoteMediaFromRecord: async () => ({}),
    _testNonce: TEST_NONCE,
  });

  await bridge.handleDashboardMessageEvent({
    data: {
      source: 'lgboom-dashboard',
      action: 'getAllNotes',
      nonce: TEST_NONCE,
    },
    ports: [{
      postMessage(value) {
        payloads.push(value);
      },
    }],
  });

  assert.deepEqual(payloads[0], {
    success: true,
    data: [{ noteId: 'n1' }],
  });
});

test('dashboard bridge preserves sync metadata while also exposing data envelope', async () => {
  const payloads = [];
  const TEST_NONCE = 'test-nonce-2';
  globalThis.chrome = {
    runtime: {
      async sendMessage() {
        return { success: true, imported: 3, skipped: 1 };
      },
    },
    storage: {
      session: {
        async set() {},
        async get() { return {}; },
        async remove() {},
      },
    },
  };

  const bridge = createDashboardBridge({
    MSG: {
      GET_ALL_NOTES: 'getAllNotes',
      GET_ALL_COMMENTS: 'getAllComments',
      GET_ALL_AUTHORS: 'getAllAuthors',
      DOWNLOAD_NOTE_MEDIA: 'downloadNoteMedia',
      CLEAR_ALL_NOTES: 'clearAllNotes',
      CLEAR_ALL_COMMENTS: 'clearAllComments',
      CLEAR_ALL_AUTHORS: 'clearAllAuthors',
      DELETE_NOTE: 'deleteNote',
      DELETE_COMMENT: 'deleteComment',
      DELETE_AUTHOR: 'deleteAuthor',
      SYNC_TO_WORKBENCH: 'syncToWorkbench',
    },
    noteStore: {},
    commentStore: {},
    authorStore: {},
    downloadNoteMediaFromRecord: async () => ({}),
    _testNonce: TEST_NONCE,
  });

  await bridge.handleDashboardMessageEvent({
    data: {
      source: 'lgboom-dashboard',
      action: 'syncToWorkbench',
      nonce: TEST_NONCE,
      notes: [{ noteId: 'n1' }],
      comments: [],
      authors: [],
    },
    ports: [{
      postMessage(value) {
        payloads.push(value);
      },
    }],
  });

  assert.deepEqual(payloads[0], {
    success: true,
    imported: 3,
    skipped: 1,
    data: {
      imported: 3,
      skipped: 1,
    },
  });

  delete globalThis.chrome;
});

test('unwrapParentResponseData prefers data from a success envelope and falls back to raw payloads', () => {
  assert.deepEqual(
    unwrapParentResponseData({ success: true, data: [{ noteId: 'n1' }] }),
    [{ noteId: 'n1' }],
  );
  assert.deepEqual(
    unwrapParentResponseData([{ noteId: 'n2' }]),
    [{ noteId: 'n2' }],
  );
  assert.deepEqual(unwrapParentResponseData({ success: false, error: 'x' }, []), []);
});
