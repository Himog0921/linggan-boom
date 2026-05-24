import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

test('workbench runtime clients reuse shared normalizeServerUrl helper', () => {
  const taskLeaseSource = fs.readFileSync(path.join(projectRoot, 'src/workbench/runtime/taskLeaseClient.js'), 'utf8');
  const stationClientSource = fs.readFileSync(path.join(projectRoot, 'src/workbench/runtime/executionStationClient.js'), 'utf8');

  assert.match(taskLeaseSource, /from '\.\.\/\.\.\/shared\/utils\.js'/);
  assert.match(stationClientSource, /from '\.\.\/\.\.\/shared\/utils\.js'/);
  assert.doesNotMatch(taskLeaseSource, /function normalizeServerUrl\(/);
  assert.doesNotMatch(stationClientSource, /function normalizeServerUrl\(/);
});

test('popup batch settings dialogs use the React modal as the single source of truth', () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'src/popup/App.jsx'), 'utf8');
  const modalSource = fs.readFileSync(path.join(projectRoot, 'src/popup/components/BatchSettingsModal.jsx'), 'utf8');
  const legacySource = path.join(projectRoot, 'src/popup/popup.js');

  assert.equal(fs.existsSync(legacySource), false);
  assert.match(appSource, /BatchSettingsModal/);
  assert.match(modalSource, /readPopupBatchSettings/);
  assert.doesNotMatch(appSource, /resetBatchSettingsOverlay/);
});

test('background workbench task routing uses one shared task context registry', () => {
  const backgroundSource = fs.readFileSync(path.join(projectRoot, 'src/background/index.js'), 'utf8');

  assert.match(backgroundSource, /const workbenchTaskRegistry = new Map\(\);/);
  assert.match(backgroundSource, /function getWorkbenchTaskContext\(/);
  assert.match(backgroundSource, /function setWorkbenchTaskContext\(/);
  assert.doesNotMatch(backgroundSource, /taskExecutionTabRegistry/);
});

test('douyin page lifecycle can clean listeners, observers, and injected UI', () => {
  const adapterSource = fs.readFileSync(path.join(projectRoot, 'src/platforms/douyin/index.js'), 'utf8');
  const uiSource = fs.readFileSync(path.join(projectRoot, 'src/platforms/douyin/uiInjector.js'), 'utf8');
  const contentSource = fs.readFileSync(path.join(projectRoot, 'src/content/index.js'), 'utf8');

  assert.match(adapterSource, /_initialized:\s*false/);
  assert.match(adapterSource, /cleanupLifecycleListeners\(\)/);
  assert.match(adapterSource, /_urlObserver\?\.disconnect\(\)/);
  assert.match(adapterSource, /document\.removeEventListener\('click', this\._nativeShareClickHandler, true\)/);
  assert.match(adapterSource, /window\.removeEventListener\(BRIDGE_EVENT, handleWindowBridgeEvent\)/);
  assert.match(uiSource, /export function cleanupDouyinInjectedUI/);
  assert.match(contentSource, /douyinClickListenerRegistered/);
});
