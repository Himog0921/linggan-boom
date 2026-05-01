import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = '/Users/moglenny/proma/选题插件-打磨中/linggan-boom';

test('popup cookie fetch scopes requests to the current platform', () => {
  const popupSource = fs.readFileSync(path.join(projectRoot, 'src/popup/App.jsx'), 'utf8');
  const backgroundSource = fs.readFileSync(path.join(projectRoot, 'src/background/index.js'), 'utf8');

  assert.match(popupSource, /sendToBackground\(MSG\.GET_PLATFORM_COOKIES,\s*\{\s*platform\s*\}\)/);
  assert.match(popupSource, /currentPlatform=\{platform\}/);
  assert.match(popupSource, /if \(platform === PLATFORM\.XHS && xhs\?\.count > 0\)/);
  assert.match(backgroundSource, /const requestedPlatform = String\(msg\.platform \|\| ''\)\.trim\(\)/);
  assert.match(backgroundSource, /const activeConfigs = requestedPlatform && platformConfig\[requestedPlatform\]/);
  assert.match(backgroundSource, /Object\.entries\(activeConfigs\)/);
  assert.match(backgroundSource, /const mergedResults = \{\s*\.\.\.\(stored\.platformCookies \|\| \{\}\),\s*\.\.\.results,/s);
});
