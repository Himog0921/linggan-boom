import test from 'node:test';
import assert from 'node:assert/strict';

import { canDispatchTaskFromCapabilityReport } from '../src/workbench/runtime/capabilityCheck.js';
import { mapTaskEnvelopeToCapabilityCheck } from '../src/workbench/runtime/taskEnvelopeMapper.js';

test('canDispatchTaskFromCapabilityReport accepts ready task types', () => {
  const result = canDispatchTaskFromCapabilityReport({
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['douyin.batchComments'],
    },
  }, 'douyin.batchComments', { pageType: 'search' });

  assert.equal(result.accepted, true);
  assert.equal(result.reasonCode, '');
});

test('canDispatchTaskFromCapabilityReport rejects unsupported task types', () => {
  const result = canDispatchTaskFromCapabilityReport({
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['douyin.batchNotes'],
    },
  }, 'douyin.batchComments', { pageType: 'search' });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'unsupported_task_type');
});

test('canDispatchTaskFromCapabilityReport forwards readiness failures', () => {
  const result = canDispatchTaskFromCapabilityReport({
    readiness: {
      ready: false,
      reasonCode: 'search_list_unstable',
      reasonMessage: '搜索结果列表尚未形成稳定状态',
    },
    capabilities: {
      canRunTaskTypes: ['douyin.batchComments'],
    },
  }, 'douyin.batchComments', { pageType: 'search' });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'search_list_unstable');
});

test('canDispatchTaskFromCapabilityReport rejects page type mismatches for remote detail tasks', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'profile',
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['xhs.batchNotes'],
    },
  }, 'xhs.batchNotes', { pageType: 'detail' });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'page_type_mismatch');
});

test('canDispatchTaskFromCapabilityReport rejects mismatched profile targets for author tasks', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'profile',
    url: 'https://www.xiaohongshu.com/user/profile/current-author',
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['xhs.collectAuthor'],
    },
  }, 'xhs.collectAuthor', {
    pageType: 'profile',
    url: 'https://www.xiaohongshu.com/user/profile/target-author',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'page_target_mismatch');
});

test('mapTaskEnvelopeToCapabilityCheck converts task envelope into capability check payload', () => {
  const capabilityCheck = mapTaskEnvelopeToCapabilityCheck({
    type: 'task.envelope',
    protocolVersion: 'v1',
    taskId: 'task_1',
    taskType: 'xhs.collectAuthor',
    platform: 'xhs',
    target: {
      pageType: 'profile',
      url: 'https://www.xiaohongshu.com/user/profile/demo',
    },
    payload: {},
  });

  assert.deepEqual(capabilityCheck, {
    type: 'capability.check',
    protocolVersion: 'v1',
    taskType: 'xhs.collectAuthor',
    platform: 'xhs',
    target: {
      pageType: 'profile',
      url: 'https://www.xiaohongshu.com/user/profile/demo',
    },
  });
});
