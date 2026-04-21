import test from 'node:test';
import assert from 'node:assert/strict';

import { sendToTab } from '../src/shared/messaging.js';

test('sendToTab resolves recoverable tab context errors when allowContextError is enabled', async () => {
  const originalChrome = globalThis.chrome;
  const runtime = {
    id: 'extension-id',
    lastError: null,
  };
  globalThis.chrome = {
    runtime,
    tabs: {
      sendMessage(tabId, payload, callback) {
        runtime.lastError = { message: 'Receiving end does not exist.' };
        callback(undefined);
        runtime.lastError = null;
      },
    },
  };

  try {
    const result = await sendToTab(123, { action: 'PING' }, { allowContextError: true });
    assert.deepEqual(result, {
      success: false,
      skipped: true,
      recoverable: true,
      error: 'Receiving end does not exist.',
    });
  } finally {
    globalThis.chrome = originalChrome;
  }
});
