import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runDouyinSelectorBootstrapProbe,
  runDouyinSelectorPreflight,
} from '../src/platforms/douyin/selectorHealth.js';

function createDocument(queryMap = {}) {
  return {
    title: '',
    querySelector(selector) {
      const value = queryMap[selector];
      if (Array.isArray(value)) return value[0] || null;
      return value || null;
    },
    querySelectorAll(selector) {
      const value = queryMap[selector];
      if (Array.isArray(value)) return value;
      return value ? [value] : [];
    },
  };
}

test('douyin selector preflight allows general search batch without video links when search tabs are present', () => {
  const document = createDocument({
    '*': [{ textContent: '综合' }, { textContent: '视频' }],
  });
  document.title = '抖音搜索';

  const result = runDouyinSelectorPreflight('dy_batchVideos', {
    params: { mode: 'search' },
    document,
    win: {
      location: {
        href: 'https://www.douyin.com/search/%E5%92%96%E5%95%A1?type=general',
        pathname: '/search/%E5%92%96%E5%95%A1',
        search: '?type=general',
        origin: 'https://www.douyin.com',
      },
      document,
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.checks[0].verifiedAt, /^20\d{2}-\d{2}-\d{2}T/);
});

test('douyin selector preflight blocks author collect outside profile page', () => {
  const document = createDocument({});
  const result = runDouyinSelectorPreflight('dy_collectAuthor', {
    document,
    win: {
      location: {
        href: 'https://www.douyin.com/search/%E5%92%96%E5%95%A1',
        pathname: '/search/%E5%92%96%E5%95%A1',
        search: '',
        origin: 'https://www.douyin.com',
      },
      document,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'page_mismatch');
});

test('douyin selector preflight requires detail page signal before collecting comments', () => {
  const detailDocument = createDocument({
    video: { nodeType: 1 },
  });
  const pass = runDouyinSelectorPreflight('dy_collectComments', {
    document: detailDocument,
    win: {
      location: {
        href: 'https://www.douyin.com/video/123',
        pathname: '/video/123',
        search: '',
        origin: 'https://www.douyin.com',
      },
      document: detailDocument,
    },
  });
  assert.equal(pass.ok, true);

  const fail = runDouyinSelectorPreflight('dy_collectComments', {
    document: createDocument({}),
    win: {
      location: {
        href: 'https://www.douyin.com/video/123',
        pathname: '/video/123',
        search: '',
        origin: 'https://www.douyin.com',
      },
      document: createDocument({}),
    },
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.code, 'selector_missing');
});

test('douyin selector bootstrap probe inspects current detail route without waiting for a click', () => {
  const detailDocument = createDocument({
    video: { nodeType: 1 },
  });
  const result = runDouyinSelectorBootstrapProbe({
    document: detailDocument,
    win: {
      location: {
        href: 'https://www.douyin.com/video/123',
        pathname: '/video/123',
        search: '',
        origin: 'https://www.douyin.com',
      },
      document: detailDocument,
    },
  });

  assert.equal(result.action, 'bootstrap');
  assert.equal(result.ok, true);
  assert.equal(result.checks[1].name, 'detailDom');
});
