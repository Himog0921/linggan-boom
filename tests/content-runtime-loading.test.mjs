import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('content entry keeps heavy runtime seams behind loader indirection', () => {
  const contentSource = fs.readFileSync(path.join(projectRoot, 'src/content/index.js'), 'utf8');

  assert.doesNotMatch(
    contentSource,
    /from '\.\/contentDataRuntime\.js';/,
    'content entry should not statically import content data runtime',
  );
  assert.doesNotMatch(
    contentSource,
    /from '\.\.\/platforms\/douyin\/index\.js';/,
    'content entry should not statically import the Douyin platform adapter',
  );
  assert.match(
    contentSource,
    /from '\.\/contentDataRuntimeLoader\.js';/,
    'content entry should use a loader boundary for content data runtime',
  );
  assert.doesNotMatch(
    contentSource,
    /from '\.\/platformHostMatcher\.js';/,
    'content entry should not own hostname-to-platform matching inline',
  );
  assert.match(
    contentSource,
    /from '\.\/contentRouter\.js';/,
    'content entry should delegate platform routing to the content router helper',
  );
});

test('content runtime loaders keep heavy modules eager for extension content scripts', () => {
  const contentDataRuntimeSource = fs.readFileSync(path.join(projectRoot, 'src/content/contentDataRuntimeLoader.js'), 'utf8');
  const douyinRuntimeSource = fs.readFileSync(path.join(projectRoot, 'src/content/douyinRuntime.js'), 'utf8');
  const manifest = fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8');

  assert.doesNotMatch(
    douyinRuntimeSource,
    /import \* as douyinRuntime from '\.\/douyinRuntimeModule\.js';/,
    'douyin runtime loader should not use a static namespace import',
  );
  assert.match(
    contentDataRuntimeSource,
    /webpackMode:\s*"eager"/,
    'content data runtime loader should avoid async content-script chunks',
  );
  assert.match(
    douyinRuntimeSource,
    /webpackMode:\s*"eager"/,
    'douyin runtime loader should avoid async content-script chunks',
  );
  assert.doesNotMatch(
    manifest,
    /"\*\.chunk\.js"/,
    'content script should not expose async runtime chunks',
  );
});
