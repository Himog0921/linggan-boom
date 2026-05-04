function normalizeId(value = '') {
  return String(value || '').trim();
}

function uniqueIds(values = []) {
  return Array.from(new Set(values.map(normalizeId).filter(Boolean)));
}

export function taskExecutionCleanupKeys(activeTask = {}) {
  const taskId = normalizeId(activeTask?.taskId);
  const externalTaskId = normalizeId(activeTask?.externalTaskId);
  const pluginRunId = normalizeId(activeTask?.pluginRunId);

  return {
    registryIds: uniqueIds([taskId, externalTaskId, pluginRunId]),
    navigationIds: uniqueIds([taskId, externalTaskId]),
  };
}
