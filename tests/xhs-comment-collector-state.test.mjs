import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeCollectedComments,
  shouldContinueDomAfterApi,
} from '../src/platforms/xhs/commentCollector.js';
import { COMMENT_DEPTH_MODE } from '../src/shared/constants.js';

test('initializeCollectedComments seeds API comments for later DOM continuation without duplicates', () => {
  const seeded = initializeCollectedComments([
    { commentId: 'root_1', level: 1 },
    { commentId: 'reply_1', level: 2 },
    { commentId: 'reply_1', level: 2 },
    { commentId: '', level: 2 },
  ]);

  assert.deepEqual(seeded.allComments.map((item) => item.commentId), ['root_1', 'reply_1']);
  assert.deepEqual([...seeded.seenIds], ['root_1', 'reply_1']);
});

test('shouldContinueDomAfterApi only keeps all-replies flow alive when API hydration degraded and show-more remains', () => {
  assert.equal(shouldContinueDomAfterApi({
    depthMode: COMMENT_DEPTH_MODE.ALL_REPLIES,
    hydrationDegraded: true,
    hasExpandableReplies: true,
  }), true);

  assert.equal(shouldContinueDomAfterApi({
    depthMode: COMMENT_DEPTH_MODE.ALL_REPLIES,
    hydrationDegraded: false,
    hasExpandableReplies: true,
  }), false);

  assert.equal(shouldContinueDomAfterApi({
    depthMode: COMMENT_DEPTH_MODE.TWO_LEVEL,
    hydrationDegraded: true,
    hasExpandableReplies: true,
  }), false);
});
