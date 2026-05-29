import test from 'node:test';
import assert from 'node:assert/strict';

const originalChrome = globalThis.chrome;
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: () => {}, removeListener: () => {} },
    onStartup: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    lastError: null,
    getManifest: () => ({ version: '0.0.0-test' }),
  },
  tabs: {
    query: async () => [],
    sendMessage: () => {},
    update: async () => {},
  },
  downloads: {
    download: async () => 1,
    remove: async () => {},
    onChanged: { addListener: () => {}, removeListener: () => {} },
  },
  declarativeNetRequest: {
    updateDynamicRules: () => Promise.resolve(),
  },
  action: {
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
  },
  alarms: {
    create: () => {},
    onAlarm: { addListener: () => {} },
  },
  debugger: {
    attach: async () => {},
    sendCommand: async () => {},
    detach: async () => {},
  },
  cookies: {
    getAll: async () => [],
  },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
    },
  },
};

const { resolvePreferredTaskTarget, scoreTaskTabCandidate, selectReachableTaskTab } = await import('../src/background/index.js');
const { noteStore } = await import('../src/db/noteStore.js');

globalThis.chrome = originalChrome;

test('resolvePreferredTaskTarget reuses signed xhs note url stored from an earlier manual collection', async () => {
  const originalGetById = noteStore.getById;
  noteStore.getById = async () => ({
    noteId: '69d67b88000000002102cded',
    rawUrl: 'https://www.xiaohongshu.com/discovery/item/69d67b88000000002102cded?source=webshare&xhsshare=pc_web&xsec_token=abc123&xsec_source=pc_share',
  });

  try {
    const resolved = await resolvePreferredTaskTarget({
      platform: 'xhs',
      taskType: 'xhs.batchNotes',
      target: 'https://www.xiaohongshu.com/explore/69d67b88000000002102cded',
      payload: {
        targetPageType: 'detail',
        platformContentId: '69d67b88000000002102cded',
      },
    });

    assert.equal(
      resolved,
      'https://www.xiaohongshu.com/discovery/item/69d67b88000000002102cded?source=webshare&xhsshare=pc_web&xsec_token=abc123&xsec_source=pc_share',
    );
  } finally {
    noteStore.getById = originalGetById;
  }
});

test('resolvePreferredTaskTarget opens canonical author profile for xhs relay detail probes when no signed detail url is available', async () => {
  const resolved = await resolvePreferredTaskTarget({
    platform: 'xhs',
    taskType: 'xhs.batchNotes',
    taskStrategy: 'detail_probe',
    target: 'https://www.xiaohongshu.com/user/profile/65f44e0b000000000500f029/69d67b88000000002102cded',
    payload: {
      targetPageType: 'detail',
      platformContentId: '69d67b88000000002102cded',
    },
  });

  assert.equal(
    resolved,
    'https://www.xiaohongshu.com/user/profile/65f44e0b000000000500f029',
  );
});

test('resolvePreferredTaskTarget keeps signed xhs relay detail urls on the direct note path', async () => {
  const signedRelayUrl = 'https://www.xiaohongshu.com/user/profile/65f44e0b000000000500f029/69d67b88000000002102cded?xsec_token=abc123&xsec_source=pc_user';
  const resolved = await resolvePreferredTaskTarget({
    platform: 'xhs',
    taskType: 'xhs.batchNotes',
    taskStrategy: 'detail_probe',
    target: signedRelayUrl,
    payload: {
      targetPageType: 'detail',
      platformContentId: '69d67b88000000002102cded',
    },
  });

  assert.equal(resolved, signedRelayUrl);
});

test('scoreTaskTabCandidate prefers an already-open signed tab for the same xhs note', () => {
  const targetUrl = 'https://www.xiaohongshu.com/explore/69d67b88000000002102cded';
  const signedTabScore = scoreTaskTabCandidate({
    url: 'https://www.xiaohongshu.com/discovery/item/69d67b88000000002102cded?source=webshare&xhsshare=pc_web&xsec_token=abc123&xsec_source=pc_share',
    active: false,
  }, targetUrl);
  const unrelatedActiveTabScore = scoreTaskTabCandidate({
    url: 'https://www.xiaohongshu.com/search_result?keyword=adhd',
    active: true,
  }, targetUrl);

  assert.equal(signedTabScore, 95);
  assert.equal(unrelatedActiveTabScore, 20);
});

test('selectReachableTaskTab skips dead tabs and keeps trying the next live xhs page', async () => {
  const selected = await selectReachableTaskTab([
    {
      id: 11,
      url: 'https://www.xiaohongshu.com/user/profile/demo',
      active: true,
    },
    {
      id: 22,
      url: 'https://www.xiaohongshu.com/user/profile/demo',
      active: false,
    },
  ], 'https://www.xiaohongshu.com/user/profile/demo', async (tab) => {
    if (tab.id === 11) {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    }
    return { accepted: true };
  });

  assert.equal(selected?.id, 22);
});

test('selectReachableTaskTab skips tabs that Chrome says the extension cannot read', async () => {
  const selected = await selectReachableTaskTab([
    {
      id: 11,
      url: 'https://www.douyin.com/user/demo',
      active: false,
    },
    {
      id: 22,
      url: 'https://www.douyin.com/user/demo',
      active: false,
    },
  ], 'https://www.douyin.com/user/demo', async (tab) => {
    if (tab.id === 11) {
      throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
    }
    return { accepted: true };
  });

  assert.equal(selected?.id, 22);
});

test('selectReachableTaskTab avoids hijacking the currently visible tab when a background candidate is available', async () => {
  const selected = await selectReachableTaskTab([
    {
      id: 11,
      url: 'https://www.xiaohongshu.com/user/profile/demo',
      active: true,
      windowId: 501,
    },
    {
      id: 22,
      url: 'https://www.xiaohongshu.com/user/profile/demo',
      active: false,
      windowId: 888,
    },
  ], 'https://www.xiaohongshu.com/user/profile/demo', async (tab) => ({
    accepted: tab.id === 22,
  }), {
    avoidActiveInWindowId: 501,
    strictlyAvoidActiveInWindow: true,
  });

  assert.equal(selected?.id, 22);
});

test('selectReachableTaskTab returns null instead of reusing the currently visible tab when foreground reuse is forbidden', async () => {
  const selected = await selectReachableTaskTab([
    {
      id: 11,
      url: 'https://www.xiaohongshu.com/user/profile/demo',
      active: true,
      windowId: 501,
    },
  ], 'https://www.xiaohongshu.com/user/profile/demo', async () => ({
    accepted: true,
  }), {
    avoidActiveInWindowId: 501,
    strictlyAvoidActiveInWindow: true,
  });

  assert.equal(selected, null);
});
