import test from 'node:test';
import assert from 'node:assert/strict';

import { taskExecutionCleanupKeys } from '../src/workbench/runtime/taskExecutionCleanup.js';

test('task execution cleanup covers task id, external id, and plugin run id', () => {
  assert.deepEqual(taskExecutionCleanupKeys({
    taskId: 'task_1',
    externalTaskId: 'external_task_1',
    pluginRunId: 'run_1',
  }), {
    registryIds: ['task_1', 'external_task_1', 'run_1'],
    navigationIds: ['task_1', 'external_task_1'],
  });
});

test('task execution cleanup dedupes ids for direct workbench tasks', () => {
  assert.deepEqual(taskExecutionCleanupKeys({
    taskId: 'task_1',
    externalTaskId: 'task_1',
    pluginRunId: 'task_1',
  }), {
    registryIds: ['task_1'],
    navigationIds: ['task_1'],
  });
});
