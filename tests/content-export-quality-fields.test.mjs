import test from 'node:test';
import assert from 'node:assert/strict';

import { MSG } from '../src/shared/constants.js';
import { createContentMessageHandlers } from '../src/content/messageHandlers.js';

function createHandlersWithStores({ notes = [], comments = [], authors = [], csvCalls }) {
  return createContentMessageHandlers({
    MSG,
    isDouyinPage: () => false,
    collectNote: async () => null,
    collectComments: async () => null,
    collectAuthor: async () => null,
    collectDouyinVideo: async () => null,
    collectDouyinComments: async () => null,
    downloadDouyinCommentImages: async () => null,
    collectDouyinAuthor: async () => null,
    noteStore: { getAll: async () => notes },
    commentStore: { getAll: async () => comments },
    authorStore: { getAll: async () => authors },
    reportDone: () => {},
    batchMessageHandlers: {},
    extractNoteId: () => '',
    downloadNoteMediaFromRecord: async () => null,
    generateCsv: (headers, rows) => {
      csvCalls.push({ headers, rows });
      return 'csv-content';
    },
    downloadFile: () => {},
    backfillLegacyAiReadyFields: async () => null,
    getPageContext: async () => ({ platform: 'xhs', pageType: 'detail' }),
    collectionRunStore: null,
    packageWorkbenchResult: async () => null,
    discoverXhsSurfaceNotes: async () => [],
    discoverDouyinSurfaceTargets: async () => [],
  });
}

test('content export csv includes quality fields for notes comments and authors', async () => {
  const csvCalls = [];
  const handlers = createHandlersWithStores({
    csvCalls,
    notes: [{
      platform: 'douyin',
      noteId: 'note_1',
      dataQuality: 'degraded',
      qualityReason: 'search_summary_seed',
      sourceTier: 'seed',
    }],
    comments: [{
      platform: 'xhs',
      commentId: 'comment_1',
      dataQuality: 'full',
      qualityReason: 'api_snapshot_partial',
      sourceTier: 'api',
    }],
    authors: [{
      platform: 'xhs',
      userId: 'author_1',
      handle: 'alice',
      dataQuality: 'degraded',
      qualityReason: 'inject_failed_dom_only',
      sourceTier: 'dom',
    }],
  });

  await handlers[MSG.EXPORT_CSV]({ type: 'notes' });
  await handlers[MSG.EXPORT_CSV]({ type: 'comments' });
  await handlers[MSG.EXPORT_CSV]({ type: 'authors' });

  assert.equal(csvCalls.length, 3);

  const [noteCsv, commentCsv, authorCsv] = csvCalls;

  assert.ok(noteCsv.headers.includes('dataQuality'));
  assert.ok(noteCsv.headers.includes('qualityReason'));
  assert.ok(noteCsv.headers.includes('sourceTier'));
  assert.deepEqual(
    noteCsv.rows[0].slice(-3),
    ['degraded', 'search_summary_seed', 'seed'],
  );

  assert.ok(commentCsv.headers.includes('dataQuality'));
  assert.ok(commentCsv.headers.includes('qualityReason'));
  assert.ok(commentCsv.headers.includes('sourceTier'));
  assert.deepEqual(
    commentCsv.rows[0].slice(-3),
    ['full', 'api_snapshot_partial', 'api'],
  );

  assert.ok(authorCsv.headers.includes('dataQuality'));
  assert.ok(authorCsv.headers.includes('qualityReason'));
  assert.ok(authorCsv.headers.includes('sourceTier'));
  assert.deepEqual(
    authorCsv.rows[0].slice(-3),
    ['degraded', 'inject_failed_dom_only', 'dom'],
  );
});
