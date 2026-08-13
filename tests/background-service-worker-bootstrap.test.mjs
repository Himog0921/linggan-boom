import test from 'node:test';
import assert from 'node:assert/strict';

import { removeStaleMediaBlockingRule } from '../src/background/serviceWorkerBootstrap.js';

test('service worker startup tolerates an unavailable dynamic-rules API', () => {
  assert.doesNotThrow(() => removeStaleMediaBlockingRule(undefined));
  assert.equal(removeStaleMediaBlockingRule(undefined), false);
});

test('service worker startup tolerates callback-style dynamic-rules APIs', () => {
  let calls = 0;
  const api = {
    updateDynamicRules(input) {
      calls += 1;
      assert.deepEqual(input, { removeRuleIds: [1] });
    },
  };
  assert.doesNotThrow(() => removeStaleMediaBlockingRule(api));
  assert.equal(calls, 1);
});

test('service worker startup observes but does not rethrow promise rejection', async () => {
  const api = {
    updateDynamicRules() {
      return Promise.reject(new Error('policy unavailable'));
    },
  };
  assert.equal(removeStaleMediaBlockingRule(api), true);
  await new Promise((resolve) => setImmediate(resolve));
});

test('service worker startup tolerates a synchronous API exception', () => {
  const api = {
    updateDynamicRules() {
      throw new Error('extension context unavailable');
    },
  };
  assert.equal(removeStaleMediaBlockingRule(api), false);
});
