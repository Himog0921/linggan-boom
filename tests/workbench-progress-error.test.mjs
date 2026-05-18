import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProgressEvent, toLegacyProgressMessage } from '../src/workbench/runtime/progressEvent.js';
import { mapErrorToProtocolError } from '../src/workbench/runtime/errorMapper.js';

test('normalizeProgressEvent structures progress with explicit stage and heartbeat', () => {
  const event = normalizeProgressEvent({
    current: 3,
    total: 10,
    status: '正在采集第 3 条',
    taskState: 'running',
    phase: 'collecting',
    taskType: 'batchNotes',
    metrics: {
      discovered: 10,
      failed: 1,
    },
    heartbeatAt: 123456,
  });

  assert.equal(event.status, 'running');
  assert.equal(event.stage, 'collecting');
  assert.equal(event.current, 3);
  assert.equal(event.total, 10);
  assert.equal(event.metrics.discovered, 10);
  assert.equal(event.heartbeatAt, 123456);
  assert.equal(event.message, '正在采集第 3 条');
});

test('toLegacyProgressMessage keeps popup-compatible status text', () => {
  const legacy = toLegacyProgressMessage({
    status: 'paused',
    stage: 'collecting',
    message: '任务已暂停',
    current: 5,
    total: 20,
  });

  assert.equal(legacy.status, '任务已暂停');
  assert.equal(legacy.taskState, 'paused');
  assert.equal(legacy.phase, 'collecting');
  assert.equal(legacy.current, 5);
  assert.equal(legacy.total, 20);
});

test('normalizeProgressEvent treats completion summary with zero failures as done', () => {
  const event = normalizeProgressEvent({
    message: '采集完成：成功 5，失败 0',
    current: 5,
    total: 5,
    taskType: 'batchNotes',
  });

  assert.equal(event.status, 'done');
  assert.equal(event.stage, 'finalizing');
});

test('mapErrorToProtocolError maps plain strings into retryable protocol errors', () => {
  const mapped = mapErrorToProtocolError('当前页面未形成可执行上下文');

  assert.equal(mapped.code, 'page_context_unavailable');
  assert.equal(mapped.category, 'context');
  assert.equal(mapped.retryable, true);
  assert.match(mapped.message, /当前页面/);
});

test('mapErrorToProtocolError maps platform verification to platform block', () => {
  const mapped = mapErrorToProtocolError('检测到抖音安全验证，请先完成验证码后继续操作');

  assert.equal(mapped.code, 'platform_security_challenge');
  assert.equal(mapped.category, 'platform_block');
  assert.equal(mapped.retryable, true);
  assert.match(mapped.userMessage, /安全验证/);
});

test('mapErrorToProtocolError keeps explicit code and category overrides', () => {
  const mapped = mapErrorToProtocolError(new Error('用户主动停止任务'), {
    code: 'task_stopped_by_user',
    category: 'user_cancel',
    retryable: false,
  });

  assert.equal(mapped.code, 'task_stopped_by_user');
  assert.equal(mapped.category, 'user_cancel');
  assert.equal(mapped.retryable, false);
  assert.equal(mapped.message, '用户主动停止任务');
});
