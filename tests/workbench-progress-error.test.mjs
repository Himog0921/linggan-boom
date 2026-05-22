import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProgressEvent, toLegacyProgressMessage } from '../src/workbench/runtime/progressEvent.js';
import { mapErrorToProtocolError } from '../src/workbench/runtime/errorMapper.js';
import { attachTaskRuntimeObservability } from '../src/workbench/runtime/taskRuntimeObservability.js';

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

test('normalizeProgressEvent preserves plugin observability counters', () => {
  const event = normalizeProgressEvent({
    current: 5,
    total: 10,
    status: '正在解析页面',
    observability: {
      durationMs: 2500,
      parseAttemptCount: 10,
      parseFailureCount: 1,
      domParseFailed: true,
    },
  });

  assert.equal(event.observability.durationMs, 2500);
  assert.equal(event.observability.parseAttemptCount, 10);
  assert.equal(event.observability.parseFailureCount, 1);
  assert.equal(event.observability.parseFailureRate, 0.1);
  assert.equal(event.observability.domParseFailed, true);
});

test('attachTaskRuntimeObservability adds duration and report flag for failed events', () => {
  const payload = attachTaskRuntimeObservability({
    task: {
      taskType: 'xhs.batchNotes',
      source: 'monitor',
      taskStrategy: 'author_baseline',
      dispatchedAtMs: 1000,
    },
    eventType: 'task.failed',
    now: 3500,
    payload: {
      status: 'failed',
      stage: 'collecting',
      latestSummary: {
        itemsPlanned: 4,
        failedItems: 2,
      },
      diagnostic: {
        reasonCode: 'page_data_not_ready',
      },
    },
  });

  assert.equal(payload.observability.taskType, 'xhs.batchNotes');
  assert.equal(payload.observability.source, 'monitor');
  assert.equal(payload.observability.taskStrategy, 'author_baseline');
  assert.equal(payload.observability.durationMs, 2500);
  assert.equal(payload.observability.itemAttemptCount, 4);
  assert.equal(payload.observability.itemFailureCount, 2);
  assert.equal(payload.observability.reasonCode, 'page_data_not_ready');
  assert.equal(payload.observability.report, true);
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

test('mapErrorToProtocolError separates permission, login, page, and missing-content failures', () => {
  const permission = mapErrorToProtocolError('浏览器缺少页面权限，无法打开小红书');
  assert.equal(permission.code, 'page_permission_denied');
  assert.equal(permission.category, 'auth');
  assert.equal(permission.retryable, false);

  const login = mapErrorToProtocolError('登录已失效，请重新登录');
  assert.equal(login.code, 'login_expired');
  assert.equal(login.category, 'auth');
  assert.equal(login.retryable, false);

  const page = mapErrorToProtocolError('目标页面错误页，无法继续采集');
  assert.equal(page.code, 'error_page');
  assert.equal(page.category, 'context');
  assert.equal(page.retryable, true);

  const missing = mapErrorToProtocolError('作品不存在或已删除');
  assert.equal(missing.code, 'content_not_found');
  assert.equal(missing.category, 'context');
  assert.equal(missing.retryable, false);
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
