import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWorkbenchSyncPayload } from '../src/dashboard/utils.js';

test('buildWorkbenchSyncPayload preserves quality fields for manual workbench sync', () => {
  const extractedAt = 1776671494763;

  const notesPayload = buildWorkbenchSyncPayload('notes', [{
    noteId: 'note_1',
    title: '标题',
    content: '正文',
    platform: 'douyin',
    url: 'https://www.douyin.com/video/1',
    dataQuality: 'seed',
    qualityReason: 'search_summary_seed',
    sourceTier: 'seed',
    collectionRunId: 'run_note_1',
  }], { extractedAt });

  const commentsPayload = buildWorkbenchSyncPayload('comments', [{
    commentId: 'comment_1',
    contentId: 'xhs_note_1',
    text: '评论',
    author: 'alice',
    platform: 'xhs',
    noteUrl: 'https://www.xiaohongshu.com/explore/note_1?xsec_token=token',
    dataQuality: 'full',
    qualityReason: '',
    sourceTier: 'api',
    collectionRunId: 'run_comment_1',
  }], { extractedAt });

  const authorsPayload = buildWorkbenchSyncPayload('authors', [{
    userId: 'author_1',
    platform: 'xhs',
    nickname: '作者',
    profileUrl: 'https://www.xiaohongshu.com/user/profile/author_1',
    dataQuality: 'degraded',
    qualityReason: 'inject_failed_dom_only',
    sourceTier: 'dom',
    collectionRunId: 'run_author_1',
  }], { extractedAt });

  assert.equal(notesPayload.notes[0].dataQuality, 'seed');
  assert.equal(notesPayload.notes[0].qualityReason, 'search_summary_seed');
  assert.equal(notesPayload.notes[0].sourceTier, 'seed');
  assert.equal(notesPayload.notes[0].collectionRunId, 'run_note_1');
  assert.equal(notesPayload.notes[0].extractedAt, extractedAt);

  assert.equal(commentsPayload.comments[0].dataQuality, 'full');
  assert.equal(commentsPayload.comments[0].qualityReason, '');
  assert.equal(commentsPayload.comments[0].sourceTier, 'api');
  assert.equal(commentsPayload.comments[0].collectionRunId, 'run_comment_1');
  assert.equal(commentsPayload.comments[0].extractedAt, extractedAt);

  assert.equal(authorsPayload.authors[0].dataQuality, 'degraded');
  assert.equal(authorsPayload.authors[0].qualityReason, 'inject_failed_dom_only');
  assert.equal(authorsPayload.authors[0].sourceTier, 'dom');
  assert.equal(authorsPayload.authors[0].collectionRunId, 'run_author_1');
  assert.equal(authorsPayload.authors[0].extractedAt, extractedAt);
});
