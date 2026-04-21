import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskNavigationUrl } from '../src/workbench/runtime/navigationOrchestrator.js';

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

test('other task types keep their existing navigation behavior', () => {
  assert.equal(
    buildTaskNavigationUrl('xhs.collectAuthor', '6926d8f4000000003702c666'),
    'https://www.xiaohongshu.com/user/profile/6926d8f4000000003702c666',
  );
});
