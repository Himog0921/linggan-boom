import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAST_TASK_POLL_INTERVAL_MS,
  SLOW_TASK_POLL_INTERVAL_MS,
  scheduleWorkbenchTaskPollAlarm,
} from '../src/workbench/runtime/taskPollSchedule.js';

test('task poll scheduler uses claim idle wait time for the next alarm', async () => {
  const calls = [];
  const alarmsApi = {
    create(name, options) {
      calls.push([name, options]);
    },
  };

  const config = scheduleWorkbenchTaskPollAlarm({
    alarmsApi,
    alarmName: 'workbench-task-poll',
    result: {
      idle: true,
      idleReasonCode: 'no_available_account',
      idleReasonMessage: '没有可用账号',
      nextPollAfterMs: 45_000,
    },
    consecutiveEmptyPolls: 0,
  });

  assert.equal(config.intervalMs, 45_000);
  assert.equal(config.periodInMinutes, 0.75);
  assert.equal(config.idleReasonCode, 'no_available_account');
  assert.equal(config.idleReasonMessage, '没有可用账号');
  assert.deepEqual(calls, [[
    'workbench-task-poll',
    { periodInMinutes: 0.75 },
  ]]);
});

test('task poll scheduler keeps the existing fallback cadence when claim provides no delay', async () => {
  const emptyCalls = [];
  const slowCalls = [];

  scheduleWorkbenchTaskPollAlarm({
    alarmsApi: {
      create(name, options) {
        emptyCalls.push([name, options]);
      },
    },
    alarmName: 'workbench-task-poll',
    result: { idle: true },
    consecutiveEmptyPolls: 0,
  });

  const slowConfig = scheduleWorkbenchTaskPollAlarm({
    alarmsApi: {
      create(name, options) {
        slowCalls.push([name, options]);
      },
    },
    alarmName: 'workbench-task-poll',
    result: { idle: true },
    consecutiveEmptyPolls: 3,
  });

  assert.equal(emptyCalls[0][1].periodInMinutes, FAST_TASK_POLL_INTERVAL_MS / 60_000);
  assert.equal(slowConfig.intervalMs, SLOW_TASK_POLL_INTERVAL_MS);
  assert.equal(slowCalls[0][1].periodInMinutes, SLOW_TASK_POLL_INTERVAL_MS / 60_000);
});
