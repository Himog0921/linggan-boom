import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDouyinBatchCommentsRunPatch,
  buildDouyinBatchVideosRunPatch,
} from '../src/workbench/runtime/douyinBatchRunHelper.js';

test('buildDouyinBatchVideosRunPatch exposes target ids content ids and failed targets', () => {
  const patch = buildDouyinBatchVideosRunPatch({
    targets: [
      { awemeId: '7001' },
      { awemeId: '7002' },
      { awemeId: '7003' },
    ],
    results: [
      { awemeId: '7001', ok: true, noteId: 'dy_7001' },
      { awemeId: '7002', ok: false, error: 'timeout' },
      { awemeId: '7003', ok: true, contentId: 'dy_7003' },
    ],
  });

  assert.deepEqual(patch, {
    itemsPlanned: 3,
    itemsSucceeded: 2,
    itemsFailed: 1,
    targetIds: ['7001', '7002', '7003'],
    contentIds: ['dy_7001', 'dy_7003'],
    failedTargets: [{ awemeId: '7002', error: 'timeout' }],
  });
});

test('buildDouyinBatchCommentsRunPatch keeps total comments and per-video traceability', () => {
  const patch = buildDouyinBatchCommentsRunPatch({
    targets: [
      { awemeId: '8001' },
      { awemeId: '8002' },
    ],
    totalComments: 12,
    results: [
      { awemeId: '8001', ok: true, noteId: 'dy_8001', totalComments: 12 },
      { awemeId: '8002', ok: false, error: 'comment api blocked' },
    ],
  });

  assert.deepEqual(patch, {
    itemsPlanned: 2,
    itemsSucceeded: 1,
    itemsFailed: 1,
    totalComments: 12,
    targetIds: ['8001', '8002'],
    contentIds: ['dy_8001'],
    failedTargets: [{ awemeId: '8002', error: 'comment api blocked' }],
  });
});

test('douyin batch run patches normalize prefixed content ids back to raw target ids', () => {
  const patch = buildDouyinBatchVideosRunPatch({
    targets: [
      { contentId: 'dy_9001' },
      { noteId: 'douyin_9002' },
    ],
    results: [
      { contentId: 'dy_9001', ok: true },
      { noteId: 'douyin_9002', ok: false, error: '' },
    ],
  });

  assert.deepEqual(patch.targetIds, ['9001', '9002']);
  assert.deepEqual(patch.contentIds, ['dy_9001']);
  assert.deepEqual(patch.failedTargets, [{ awemeId: '9002', error: 'failed' }]);
});
