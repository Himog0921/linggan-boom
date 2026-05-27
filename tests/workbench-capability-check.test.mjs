import test from 'node:test';
import assert from 'node:assert/strict';

import { canDispatchTaskFromCapabilityReport } from '../src/workbench/runtime/capabilityCheck.js';
import {
  mapTaskEnvelopeToCapabilityCheck,
  mapTaskEnvelopeToInternalCommand,
} from '../src/workbench/runtime/taskEnvelopeMapper.js';

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

test('canDispatchTaskFromCapabilityReport prioritizes platform security verification over unsupported task type', () => {
  const result = canDispatchTaskFromCapabilityReport({
    readiness: {
      ready: false,
      reasonCode: 'platform_security_challenge',
      reasonMessage: '检测到抖音安全验证，请先完成验证后继续操作',
    },
    contextSnapshot: {
      platformBlocked: true,
    },
    capabilities: {
      canRunTaskTypes: [],
    },
  }, 'douyin.singleComments', { pageType: 'detail' });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'platform_security_challenge');
  assert.match(result.reasonMessage, /安全验证/);
});

test('canDispatchTaskFromCapabilityReport keeps unavailable detail page reason over unsupported task type', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'unknown',
    url: 'https://www.xiaohongshu.com/explore/deleted-note',
    readiness: {
      ready: false,
      reasonCode: 'content_not_found',
      reasonMessage: '当前笔记已删除或不可访问',
    },
    capabilities: {
      canRunTaskTypes: [],
    },
  }, 'xhs.batchComments', {
    pageType: 'detail',
    url: 'https://www.xiaohongshu.com/explore/deleted-note',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'content_not_found');
  assert.equal(result.reasonMessage, '当前笔记已删除或不可访问');
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

test('canDispatchTaskFromCapabilityReport rejects mismatched detail targets', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'detail',
    url: 'https://www.xiaohongshu.com/discovery/item/69f27f63000000003601c448?xsec_token=old',
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['xhs.batchNotes'],
    },
  }, 'xhs.batchNotes', {
    pageType: 'detail',
    url: 'https://www.xiaohongshu.com/explore/69fdb9db000000001b021e8d?xsec_token=target',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'page_target_mismatch');
});

test('canDispatchTaskFromCapabilityReport accepts matching detail targets across xhs url forms', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'detail',
    url: 'https://www.xiaohongshu.com/discovery/item/69fdb9db000000001b021e8d?xsec_token=current',
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['xhs.batchNotes'],
    },
  }, 'xhs.batchNotes', {
    pageType: 'detail',
    url: 'https://www.xiaohongshu.com/explore/69fdb9db000000001b021e8d?xsec_token=target',
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reasonCode, '');
});

test('canDispatchTaskFromCapabilityReport accepts matching xhs profile relay detail targets', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'detail',
    url: 'https://www.xiaohongshu.com/explore/69fdb9db000000001b021e8d?xsec_token=current',
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['xhs.batchNotes'],
    },
  }, 'xhs.batchNotes', {
    pageType: 'detail',
    url: 'https://www.xiaohongshu.com/user/profile/6926d8f4000000003702c666/69fdb9db000000001b021e8d',
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reasonCode, '');
});

test('canDispatchTaskFromCapabilityReport validates douyin note detail targets', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'detail',
    url: 'https://www.douyin.com/note/7321309610927770930',
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['douyin.singleComments'],
    },
  }, 'douyin.singleComments', {
    pageType: 'detail',
    url: 'https://www.douyin.com/note/7321309610927770931',
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, 'page_target_mismatch');
});

test('canDispatchTaskFromCapabilityReport accepts matching douyin note detail targets', () => {
  const result = canDispatchTaskFromCapabilityReport({
    mode: 'detail',
    url: 'https://www.douyin.com/note/7321309610927770930?previous_page=app_code_link',
    readiness: { ready: true, reasonCode: '', reasonMessage: '' },
    capabilities: {
      canRunTaskTypes: ['douyin.singleComments'],
    },
  }, 'douyin.singleComments', {
    pageType: 'detail',
    url: 'https://www.douyin.com/note/7321309610927770930',
  });

  assert.equal(result.accepted, true);
  assert.equal(result.reasonCode, '');
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

test('mapTaskEnvelopeToInternalCommand scopes xhs detail comment probes to the target note', () => {
  const command = mapTaskEnvelopeToInternalCommand({
    type: 'task.envelope',
    protocolVersion: 'v1',
    taskId: 'task_comment_detail_1',
    taskType: 'xhs.batchComments',
    platform: 'xhs',
    taskStrategy: 'detail_probe',
    target: {
      pageType: 'detail',
      url: 'https://www.xiaohongshu.com/explore/69fdb9db000000001b021e8d?xsec_token=target',
    },
    payload: {
      commentLimit: 50,
      noteId: '69fdb9db000000001b021e8d',
    },
  });

  assert.equal(command.action, 'startBatchComments');
  assert.equal(command.payload.mode, 'detail');
  assert.equal(command.payload.commentLimit, 50);
  assert.deepEqual(command.payload.noteList, [
    {
      noteId: '69fdb9db000000001b021e8d',
      url: 'https://www.xiaohongshu.com/explore/69fdb9db000000001b021e8d?xsec_token=target',
    },
  ]);
});
