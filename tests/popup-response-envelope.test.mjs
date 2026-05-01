import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unwrapTabResponseData } from '../src/popup/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('unwrapTabResponseData reads normalized envelope data and preserves raw payload fallback', () => {
  assert.deepEqual(
    unwrapTabResponseData({ success: true, data: [{ noteId: 'n1' }] }, []),
    [{ noteId: 'n1' }],
  );
  assert.deepEqual(
    unwrapTabResponseData([{ noteId: 'n2' }], []),
    [{ noteId: 'n2' }],
  );
  assert.deepEqual(
    unwrapTabResponseData({ success: false, error: 'x' }, []),
    [],
  );
});

test('popup implementations consume tab data through unwrap helper', () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/popup/App.jsx'), 'utf8');
  const legacySource = fs.readFileSync(path.join(projectRoot, 'src/popup/popup.js'), 'utf8');

  assert.match(appSource, /unwrapTabResponseData/);
  assert.match(legacySource, /unwrapTabResponseData/);
});
