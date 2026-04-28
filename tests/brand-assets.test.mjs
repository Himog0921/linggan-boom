import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = '/Users/moglenny/proma/选题插件-打磨中/linggan-boom';

test('shared LG BOOM banner asset uses a rounded yellow base', () => {
  const bannerSource = fs.readFileSync(path.join(projectRoot, 'src/assets/lgboom-banner.svg'), 'utf8');

  assert.match(bannerSource, /<rect class="cls-0"/);
  assert.match(bannerSource, /height="47\.3"/);
  assert.match(bannerSource, /rx="8\.5"/);
  assert.match(bannerSource, /ry="8\.5"/);
});
