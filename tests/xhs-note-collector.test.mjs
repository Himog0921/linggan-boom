import test from 'node:test';
import assert from 'node:assert/strict';

import {
  discoverNotesFromDOM,
  isCollectedNoteUsable,
  parseXhsPublishedAt,
  resolveExpectedNoteFromMap,
  selectNoteKey,
} from '../src/platforms/xhs/noteCollector.js';

test('selectNoteKey prefers expected note id over current url and fallback keys', () => {
  const noteMap = {
    '69b1081c000000003402c1c4': { noteId: '69b1081c000000003402c1c4' },
    '69c253e4000000001001d355': { noteId: '69c253e4000000001001d355' },
  };

  assert.equal(
    selectNoteKey(noteMap, '69c253e4000000001001d355', 'https://www.xiaohongshu.com/explore/69b1081c000000003402c1c4'),
    '69c253e4000000001001d355',
  );
});

test('selectNoteKey falls back to current url note id when expected note id is unavailable', () => {
  const noteMap = {
    '69b1081c000000003402c1c4': { noteId: '69b1081c000000003402c1c4' },
    '69c253e4000000001001d355': { noteId: '69c253e4000000001001d355' },
  };

  assert.equal(
    selectNoteKey(noteMap, '69ffffffffffffffffffffff', 'https://www.xiaohongshu.com/explore/69b1081c000000003402c1c4'),
    '69b1081c000000003402c1c4',
  );
});

test('isCollectedNoteUsable rejects mismatched note ids even when content exists', () => {
  assert.equal(isCollectedNoteUsable({
    noteId: 'actual_note_id',
    title: 'A title',
  }, 'expected_note_id'), false);
});

test('resolveExpectedNoteFromMap finds exact note id from wrapped note payload', () => {
  const noteMap = {
    fallback_key: {
      note: {
        noteId: '69b1081c000000003402c1c4',
        title: 'Wrapped note',
      },
    },
  };

  const result = resolveExpectedNoteFromMap(
    noteMap,
    '69b1081c000000003402c1c4',
    'https://www.xiaohongshu.com/explore/69b1081c000000003402c1c4',
  );

  assert.equal(result.actualNoteId, '69b1081c000000003402c1c4');
  assert.equal(result.exactMatch, true);
  assert.equal(result.usable, true);
});

test('discoverNotesFromDOM keeps xhs signed hrefs instead of stripping xsec_token', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const signedHref = '/user/profile/5f1234567890abcd12345678/680123456789abcdef012345?xsec_token=abc123';
  const section = {
    querySelector(selector) {
      if (selector === 'a.cover') {
        return {
          getAttribute(name) {
            return name === 'href' ? signedHref : null;
          },
        };
      }
      if (selector === '.footer span' || selector === '.title') {
        return { textContent: '带签名卡片' };
      }
      if (selector === '.like-wrapper .count') {
        return { textContent: '12' };
      }
      return null;
    },
    getBoundingClientRect() {
      return { top: 10, left: 20 };
    },
  };

  globalThis.document = {
    querySelectorAll() {
      return [section];
    },
  };
  globalThis.window = { scrollY: 0 };

  try {
    const records = discoverNotesFromDOM('#userPostedFeeds');
    assert.equal(records.length, 1);
    assert.equal(
      records[0].url,
      'https://www.xiaohongshu.com/user/profile/5f1234567890abcd12345678/680123456789abcdef012345?xsec_token=abc123',
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test('parseXhsPublishedAt keeps second and millisecond timestamps usable', () => {
  assert.equal(parseXhsPublishedAt(1713501296), 1713501296000);
  assert.equal(parseXhsPublishedAt(1713501296789), 1713501296789);
});

test('parseXhsPublishedAt parses relative and calendar time text', () => {
  const fixedNow = new Date('2026-04-21T12:00:00+08:00').getTime();

  assert.equal(
    parseXhsPublishedAt('昨天 10:30', { now: fixedNow }),
    new Date('2026-04-20T10:30:00+08:00').getTime(),
  );
  assert.equal(
    parseXhsPublishedAt('4月17日 08:15', { now: fixedNow }),
    new Date('2026-04-17T08:15:00+08:00').getTime(),
  );
  assert.equal(
    parseXhsPublishedAt('3小时前', { now: fixedNow }),
    new Date('2026-04-21T09:00:00+08:00').getTime(),
  );
});
