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

test('douyin runtime loader defers module evaluation without async chunk split', () => {
  const douyinRuntimeSource = fs.readFileSync(path.join(projectRoot, 'src/content/douyinRuntime.js'), 'utf8');

  assert.doesNotMatch(
    douyinRuntimeSource,
    /import \* as douyinRuntime from '\.\/douyinRuntimeModule\.js';/,
    'douyin runtime loader should not use a static namespace import',
  );
  assert.match(
    douyinRuntimeSource,
    /import\(\s*\/\*\s*webpackMode:\s*"eager"\s*\*\/\s*'\.\/douyinRuntimeModule\.js'\s*\)/,
    'douyin runtime loader should use webpack eager dynamic import',
  );
});
