import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDiscoveryPlan, discoverNotesFromDOM, discoverWithScroll, shouldStopDiscovery } from '../src/platforms/xhs/noteCollector.js';

test('profile discovery keeps scanning until enough content is found or the page is actually at the bottom', () => {
  const plan = buildDiscoveryPlan('#userPostedFeeds', {
    maxScrolls: 10,
    expectedCount: 50,
  });

  assert.equal(plan.isProfileMode, true);
  assert.equal(plan.stableNoNewLimit, 4);
  assert.equal(plan.requireBottomOrExpected, true);
  assert.equal(plan.bottomConfirmationRounds, 6);
  assert.ok(plan.maxRounds >= 50);

  assert.equal(shouldStopDiscovery({
    noNewCount: 4,
    stableNoNewLimit: plan.stableNoNewLimit,
    discoveredCount: 28,
    expectedCount: plan.expectedCount,
    atBottom: false,
    bottomNoNewCount: 0,
    bottomConfirmationRounds: plan.bottomConfirmationRounds,
    requireBottomOrExpected: plan.requireBottomOrExpected,
  }), false);

  assert.equal(shouldStopDiscovery({
    noNewCount: 4,
    stableNoNewLimit: plan.stableNoNewLimit,
    discoveredCount: 28,
    expectedCount: plan.expectedCount,
    atBottom: true,
    bottomNoNewCount: 1,
    bottomConfirmationRounds: plan.bottomConfirmationRounds,
    requireBottomOrExpected: plan.requireBottomOrExpected,
  }), false);

  assert.equal(shouldStopDiscovery({
    noNewCount: 4,
    stableNoNewLimit: plan.stableNoNewLimit,
    discoveredCount: 36,
    expectedCount: plan.expectedCount,
    atBottom: true,
    bottomNoNewCount: 3,
    bottomConfirmationRounds: plan.bottomConfirmationRounds,
    requireBottomOrExpected: plan.requireBottomOrExpected,
  }), false);

  assert.equal(shouldStopDiscovery({
    noNewCount: 4,
    stableNoNewLimit: plan.stableNoNewLimit,
    discoveredCount: 36,
    expectedCount: plan.expectedCount,
    atBottom: true,
    bottomNoNewCount: 6,
    bottomConfirmationRounds: plan.bottomConfirmationRounds,
    requireBottomOrExpected: plan.requireBottomOrExpected,
  }), true);
});

test('search discovery keeps the old eager stop behavior', () => {
  const plan = buildDiscoveryPlan('.feeds-container', {
    maxScrolls: 10,
    expectedCount: 50,
  });

  assert.equal(plan.isProfileMode, false);
  assert.equal(plan.stableNoNewLimit, 2);
  assert.equal(plan.requireBottomOrExpected, false);

  assert.equal(shouldStopDiscovery({
    noNewCount: 2,
    stableNoNewLimit: plan.stableNoNewLimit,
    discoveredCount: 12,
    expectedCount: plan.expectedCount,
    atBottom: false,
    requireBottomOrExpected: plan.requireBottomOrExpected,
  }), true);
});

test('profile discovery accumulates virtualized cards beyond the visible 28 items', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNow = Date.now;
  const ids = Array.from({ length: 50 }, (_, index) => `68${String(index).padStart(22, '0')}`);
  let scrollTopValue = 0;
  let maxScrollTop = 0;
  let now = 0;

  const makeSection = (id, index) => ({
    querySelector(selector) {
      if (selector === 'a.cover') {
        return {
          getAttribute(name) {
            return name === 'href'
              ? `/user/profile/5f1234567890abcd12345678/${id}?xsec_token=token-${id}`
              : null;
          },
        };
      }
      if (selector === '.footer span' || selector === '.title') {
        return { textContent: `标题 ${index}` };
      }
      if (selector === '.like-wrapper .count') {
        return { textContent: String(index) };
      }
      return null;
    },
    getBoundingClientRect() {
      return {
        top: 120 + index * 10,
        left: index % 2 === 0 ? 20 : 320,
      };
    },
  });

  const scrollBox = {
    get scrollTop() {
      return scrollTopValue;
    },
    set scrollTop(value) {
      scrollTopValue = Math.max(0, Number(value || 0));
      maxScrollTop = Math.max(maxScrollTop, scrollTopValue);
    },
    clientHeight: 1000,
    scrollHeight: 2400,
    parentElement: null,
  };
  const feed = {
    clientHeight: 1000,
    scrollHeight: 1000,
    parentElement: scrollBox,
  };

  globalThis.document = {
    documentElement: { scrollTop: 0, clientHeight: 1000, scrollHeight: 1000 },
    body: { scrollTop: 0, clientHeight: 1000, scrollHeight: 1000 },
    querySelector(selector) {
      return selector === '#userPostedFeeds' ? feed : null;
    },
    querySelectorAll(selector) {
      if (selector !== '#userPostedFeeds section') return [];
      const visibleIds = scrollTopValue < 400 ? ids.slice(0, 28) : ids.slice(22, 50);
      return visibleIds.map(makeSection);
    },
  };
  globalThis.window = {
    scrollY: 0,
    innerHeight: 1000,
    scrollTo({ top = 0 } = {}) {
      this.scrollY = top;
    },
    scrollBy({ top = 0 } = {}) {
      this.scrollY += top;
    },
  };
  Date.now = () => {
    now += 5000;
    return now;
  };

  try {
    const records = await discoverWithScroll('#userPostedFeeds', 10, {
      expectedCount: 50,
    });

    assert.equal(records.length, 50);
    assert.equal(records[0].noteId, ids[0]);
    assert.equal(records[49].noteId, ids[49]);
    assert.ok(maxScrollTop > 0);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Date.now = originalNow;
  }
});

test('profile discovery uses the actual feed viewport height instead of the browser window height', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNow = Date.now;
  const ids = Array.from({ length: 50 }, (_, index) => `68${String(index).padStart(22, '0')}`);
  let scrollTopValue = 0;
  let maxScrollTop = 0;
  let now = 0;

  const makeSection = (id, index) => ({
    querySelector(selector) {
      if (selector === 'a.cover') {
        return {
          getAttribute(name) {
            return name === 'href'
              ? `/user/profile/5f1234567890abcd12345678/${id}?xsec_token=token-${id}`
              : null;
          },
        };
      }
      if (selector === '.footer span' || selector === '.title') {
        return { textContent: `标题 ${index}` };
      }
      if (selector === '.like-wrapper .count') {
        return { textContent: String(index) };
      }
      return null;
    },
    getBoundingClientRect() {
      return {
        top: 120 + index * 10,
        left: index % 2 === 0 ? 20 : 320,
      };
    },
  });

  const scrollBox = {
    get scrollTop() {
      return scrollTopValue;
    },
    set scrollTop(value) {
      scrollTopValue = Math.max(0, Number(value || 0));
      maxScrollTop = Math.max(maxScrollTop, scrollTopValue);
    },
    clientHeight: 320,
    scrollHeight: 1400,
    parentElement: null,
  };
  const feed = {
    clientHeight: 320,
    scrollHeight: 320,
    parentElement: scrollBox,
  };

  globalThis.document = {
    documentElement: { scrollTop: 0, clientHeight: 1000, scrollHeight: 1000 },
    body: { scrollTop: 0, clientHeight: 1000, scrollHeight: 1000 },
    querySelector(selector) {
      return selector === '#userPostedFeeds' ? feed : null;
    },
    querySelectorAll(selector) {
      if (selector !== '#userPostedFeeds section') return [];
      const visibleIds = scrollTopValue < 700 ? ids.slice(0, 28) : ids.slice(22, 50);
      return visibleIds.map(makeSection);
    },
  };
  globalThis.window = {
    scrollY: 0,
    innerHeight: 1000,
    scrollTo({ top = 0 } = {}) {
      this.scrollY = top;
    },
    scrollBy({ top = 0 } = {}) {
      this.scrollY += top;
    },
  };
  Date.now = () => {
    now += 5000;
    return now;
  };

  try {
    const records = await discoverWithScroll('#userPostedFeeds', 10, {
      expectedCount: 50,
    });

    assert.equal(records.length, 50);
    assert.ok(maxScrollTop >= 700);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Date.now = originalNow;
  }
});

test('profile discovery nudges the bottom of an infinite profile feed before giving up at 28 cards', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalWheelEvent = globalThis.WheelEvent;
  const originalNow = Date.now;
  const ids = Array.from({ length: 50 }, (_, index) => `68${String(index).padStart(22, '0')}`);
  let loadTriggered = false;
  let scrollY = 0;
  let now = 0;

  class FakeWheelEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.deltaY = init.deltaY || 0;
    }
  }

  const makeSection = (id, index) => ({
    querySelector(selector) {
      if (selector === 'a.cover') {
        return {
          getAttribute(name) {
            return name === 'href'
              ? `/user/profile/5f1234567890abcd12345678/${id}?xsec_token=token-${id}`
              : null;
          },
          querySelector() {
            return { currentSrc: `https://sns-img.example.com/${id}.jpg` };
          },
        };
      }
      if (selector === '.footer span' || selector === '.title') {
        return { textContent: `标题 ${index}` };
      }
      if (selector === '.like-wrapper .count') {
        return { textContent: String(index) };
      }
      return null;
    },
    getBoundingClientRect() {
      return {
        top: 120 + index * 10,
        left: index % 2 === 0 ? 20 : 320,
      };
    },
  });

  const feed = {
    clientHeight: 1000,
    get scrollHeight() {
      return loadTriggered ? 2400 : 1000;
    },
    parentElement: null,
  };

  const documentElement = {
    scrollTop: 0,
    clientHeight: 1000,
    get scrollHeight() {
      return loadTriggered ? 2400 : 1000;
    },
    dispatchEvent(event) {
      if (event?.type === 'wheel' && event.deltaY > 0) loadTriggered = true;
      return true;
    },
  };
  const body = {
    scrollTop: 0,
    clientHeight: 1000,
    get scrollHeight() {
      return loadTriggered ? 2400 : 1000;
    },
    dispatchEvent: documentElement.dispatchEvent,
  };

  globalThis.WheelEvent = FakeWheelEvent;
  globalThis.document = {
    documentElement,
    body,
    querySelector(selector) {
      return selector === '#userPostedFeeds' ? feed : null;
    },
    querySelectorAll(selector) {
      if (selector !== '#userPostedFeeds section') return [];
      const visibleIds = loadTriggered || scrollY > 0 ? ids : ids.slice(0, 28);
      return visibleIds.map(makeSection);
    },
    dispatchEvent(event) {
      if (event?.type === 'wheel' && event.deltaY > 0) loadTriggered = true;
      return true;
    },
  };
  globalThis.window = {
    get scrollY() {
      return scrollY;
    },
    set scrollY(value) {
      scrollY = Math.max(0, Number(value || 0));
    },
    innerHeight: 1000,
    scrollTo({ top = 0 } = {}) {
      scrollY = Math.max(0, Number(top || 0));
      documentElement.scrollTop = scrollY;
      body.scrollTop = scrollY;
    },
    scrollBy({ top = 0 } = {}) {
      scrollY = Math.max(0, scrollY + Number(top || 0));
      documentElement.scrollTop = scrollY;
      body.scrollTop = scrollY;
      if (top > 0 && scrollY === 0) loadTriggered = true;
    },
    dispatchEvent(event) {
      if (event?.type === 'wheel' && event.deltaY > 0) loadTriggered = true;
      return true;
    },
  };
  Date.now = () => {
    now += 5000;
    return now;
  };

  try {
    const records = await discoverWithScroll('#userPostedFeeds', 10, {
      expectedCount: 50,
    });

    assert.equal(records.length, 50);
    assert.equal(loadTriggered, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.WheelEvent = originalWheelEvent;
    Date.now = originalNow;
  }
});

test('note discovery carries the card cover image into surface records', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const noteId = '680123456789abcdef012345';

  globalThis.document = {
    querySelectorAll(selector) {
      if (selector !== '#userPostedFeeds section') return [];
      return [{
        querySelector(selector) {
          if (selector === 'a.cover') {
            return {
              getAttribute(name) {
                return name === 'href'
                  ? `/user/profile/5f1234567890abcd12345678/${noteId}?xsec_token=abc123`
                  : null;
              },
              querySelector(imageSelector) {
                if (imageSelector !== 'img, picture img, source') return null;
                return {
                  currentSrc: '',
                  src: '',
                  getAttribute(name) {
                    if (name === 'data-src') return 'https://sns-img.example.com/card-cover.jpg';
                    return null;
                  },
                };
              },
            };
          }
          if (selector === '.footer span' || selector === '.title') {
            return { textContent: '带封面的作品' };
          }
          if (selector === '.like-wrapper .count') {
            return { textContent: '123' };
          }
          return null;
        },
        getBoundingClientRect() {
          return { top: 100, left: 20 };
        },
      }];
    },
  };
  globalThis.window = { scrollY: 0 };

  try {
    const records = discoverNotesFromDOM('#userPostedFeeds');

    assert.equal(records.length, 1);
    assert.equal(records[0].cover, 'https://sns-img.example.com/card-cover.jpg');
    assert.equal(records[0].coverImg, 'https://sns-img.example.com/card-cover.jpg');
    assert.deepEqual(records[0].images, ['https://sns-img.example.com/card-cover.jpg']);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
