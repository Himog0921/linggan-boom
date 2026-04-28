import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = '/Users/moglenny/proma/选题插件-打磨中/linggan-boom';

test('content buttons mutate currentTarget styles instead of nested text spans', () => {
  const buttonGroupSource = fs.readFileSync(path.join(projectRoot, 'src/content/components/ButtonGroup.jsx'), 'utf8');
  const taskbarSource = fs.readFileSync(path.join(projectRoot, 'src/content/components/TaskControlBar.jsx'), 'utf8');

  assert.doesNotMatch(buttonGroupSource, /e\.target\.style\./);
  assert.match(buttonGroupSource, /e\.currentTarget\.style\.transform/);
  assert.match(buttonGroupSource, /e\.currentTarget\.style\.boxShadow/);

  assert.doesNotMatch(taskbarSource, /e\.target\.style\./);
  assert.match(taskbarSource, /e\.currentTarget\.style\.transform/);
  assert.match(taskbarSource, /e\.currentTarget\.style\.boxShadow/);
});
