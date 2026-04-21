import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = '/Users/moglenny/proma/选题插件-打磨中/linggan-boom';

test('popup current-content section collapses duplicate disabled copy into a single empty-state hint', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'src/popup/components/ActionButtons.jsx'), 'utf8');
  assert.match(source, /action-empty-state/);
  assert.match(source, /当前内容暂不支持单条操作，请先打开笔记页/);
  assert.match(source, /if \(!hasCurrentContentActions\)/);
});

test('popup data tab shows account count badge with consistent numeric copy', () => {
  const componentSource = fs.readFileSync(path.join(projectRoot, 'src/popup/components/CookieAccountSection.jsx'), 'utf8');
  const styleSource = fs.readFileSync(path.join(projectRoot, 'src/popup/popup.css'), 'utf8');

  assert.match(componentSource, /Cookie 状态/);
  assert.match(componentSource, /采集账号/);
  assert.match(componentSource, /section-count-badge/);
  assert.match(componentSource, /个账号/);
  assert.match(styleSource, /\.section-count-badge/);
  assert.match(styleSource, /\.data-subsection/);
});

test('xhs batch dialog titles use unified 批量采集 copy', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'src/content/xhsPageController.js'), 'utf8');
  assert.match(source, /title:\s*'批量采集笔记'/);
  assert.match(source, /title:\s*'批量采集评论'/);
  assert.doesNotMatch(source, /批量笔记设置/);
  assert.doesNotMatch(source, /批量评论设置/);
});

test('popup placeholders, disabled buttons, and checkbox controls use unified styling hooks', () => {
  const addAccountSource = fs.readFileSync(path.join(projectRoot, 'src/popup/components/AddAccountModal.jsx'), 'utf8');
  const styleSource = fs.readFileSync(path.join(projectRoot, 'src/popup/popup.css'), 'utf8');

  assert.match(addAccountSource, /className="add-account-input"/);
  assert.match(addAccountSource, /className="add-account-textarea"/);
  assert.match(addAccountSource, /placeholder="例如：100"/);

  assert.match(styleSource, /\.flywheel-input::placeholder/);
  assert.match(styleSource, /\.add-account-input::placeholder/);
  assert.match(styleSource, /\.popup-btn:disabled/);
  assert.match(styleSource, /background:\s*#ece7df/);
  assert.match(styleSource, /\.batch-checkbox input \{/);
  assert.match(styleSource, /appearance:\s*none/);
});
