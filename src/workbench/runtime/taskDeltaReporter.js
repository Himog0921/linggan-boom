import { createDeltaOutbox } from './deltaOutbox.js';

function normalizeConfigResult(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function createTaskDeltaReporter({
  store,
  ingestCollectionTaskDelta,
  getFlywheelConfig,
  prepareRecordPayload,
  shouldPollWorkbenchTasks = () => true,
  executorInstanceId = '',
  getExecutorInstanceId = null,
  getTaskExecutionContext = null,
  autoFlush = true,
} = {}) {
  const outbox = createDeltaOutbox({
    store,
    executorInstanceId,
    getExecutorInstanceId,
    getTaskExecutionContext,
    autoFlush,
    prepareRecordPayload: async (record) => {
      const config = typeof getFlywheelConfig === 'function'
        ? normalizeConfigResult(await getFlywheelConfig())
        : {};
      return typeof prepareRecordPayload === 'function'
        ? prepareRecordPayload(config, record)
        : record.payload;
    },
    ingestDelta: async (taskId, envelope) => {
      const config = typeof getFlywheelConfig === 'function'
        ? normalizeConfigResult(await getFlywheelConfig())
        : {};
      if (!shouldPollWorkbenchTasks(config)) {
        const error = new Error('workbench_sync_disabled');
        error.retryable = true;
        throw error;
      }
      return ingestCollectionTaskDelta(config, taskId, envelope);
    },
  });

  return outbox;
}
