import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = '/Users/moglenny/proma/选题插件-打磨中/linggan-boom';

test('workbench runtime clients reuse shared normalizeServerUrl helper', () => {
  const taskLeaseSource = fs.readFileSync(path.join(projectRoot, 'src/workbench/runtime/taskLeaseClient.js'), 'utf8');
  const stationClientSource = fs.readFileSync(path.join(projectRoot, 'src/workbench/runtime/executionStationClient.js'), 'utf8');

  assert.match(taskLeaseSource, /from '\.\.\/\.\.\/shared\/utils\.js'/);
  assert.match(stationClientSource, /from '\.\.\/\.\.\/shared\/utils\.js'/);
  assert.doesNotMatch(taskLeaseSource, /function normalizeServerUrl\(/);
  assert.doesNotMatch(stationClientSource, /function normalizeServerUrl\(/);
});

test('popup batch settings dialogs share one overlay reset helper', () => {
  const popupSource = fs.readFileSync(path.join(projectRoot, 'src/popup/popup.js'), 'utf8');

  assert.match(popupSource, /function resetBatchSettingsOverlay\(/);
  assert.match(popupSource, /resetBatchSettingsOverlay\(\{\s*subtitle:/);
  assert.doesNotMatch(popupSource, /subtitle\.textContent = "选择采集数量和排序方式";[\s\S]*subtitle\.textContent = "选择采集数量和排序方式";/);
});

test('background workbench task routing uses one shared task context registry', () => {
  const backgroundSource = fs.readFileSync(path.join(projectRoot, 'src/background/index.js'), 'utf8');

  assert.match(backgroundSource, /const workbenchTaskRegistry = new Map\(\);/);
  assert.match(backgroundSource, /function getWorkbenchTaskContext\(/);
  assert.match(backgroundSource, /function setWorkbenchTaskContext\(/);
  assert.doesNotMatch(backgroundSource, /taskExecutionTabRegistry/);
});
