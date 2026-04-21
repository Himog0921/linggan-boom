import test from 'node:test';
import assert from 'node:assert/strict';

import { createDashboardBridge } from '../src/content/dashboardBridge.js';

test('dashboard bridge forwards notes, comments, and authors to background sync handler', async () => {
  const sentMessages = [];
  globalThis.chrome = {
    runtime: {
      async sendMessage(payload) {
        sentMessages.push(payload);
        return { success: true, imported: 3, skipped: 0 };
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
  });

  const result = await bridge.handleDashboardMessageEvent({
    data: {
      source: 'lgboom-dashboard',
      action: 'syncToWorkbench',
      notes: [{ noteId: 'n1' }],
      comments: [{ commentId: 'c1' }],
      authors: [{ userId: 'u1' }],
    },
    ports: [{
      postMessage(payload) {
        sentMessages.push({ portPayload: payload });
      },
    }],
  });

  assert.equal(result, true);
  assert.deepEqual(sentMessages[0], {
    action: 'syncToWorkbench',
    notes: [{ noteId: 'n1' }],
    comments: [{ commentId: 'c1' }],
    authors: [{ userId: 'u1' }],
  });
  assert.deepEqual(sentMessages[1], {
    portPayload: {
      success: true,
      imported: 3,
      skipped: 0,
      data: {
        imported: 3,
        skipped: 0,
      },
    },
  });

  delete globalThis.chrome;
});
