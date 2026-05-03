const FAST_TASK_POLL_INTERVAL_MS = 30_000;
const SLOW_TASK_POLL_INTERVAL_MS = 30_000;
const EMPTY_POLL_THRESHOLD = 3;

function toFinitePositiveNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function resolveWorkbenchTaskPollIntervalMs(result = null, consecutiveEmptyPolls = 0) {
  const idleNextPollAfterMs = toFinitePositiveNumber(result?.nextPollAfterMs, 0);
  if (result?.idle && idleNextPollAfterMs > 0) {
    return idleNextPollAfterMs;
  }
  return consecutiveEmptyPolls >= EMPTY_POLL_THRESHOLD
    ? SLOW_TASK_POLL_INTERVAL_MS
    : FAST_TASK_POLL_INTERVAL_MS;
}

export function resolveWorkbenchTaskPollAlarmConfig(result = null, consecutiveEmptyPolls = 0) {
  const intervalMs = resolveWorkbenchTaskPollIntervalMs(result, consecutiveEmptyPolls);
  return {
    intervalMs,
    periodInMinutes: intervalMs / 60_000,
    nextPollAfterMs: toFinitePositiveNumber(result?.nextPollAfterMs, 0),
    idleReasonCode: String(result?.idleReasonCode || '').trim(),
    idleReasonMessage: String(result?.idleReasonMessage || '').trim(),
  };
}

export function scheduleWorkbenchTaskPollAlarm({
  alarmsApi = globalThis.chrome?.alarms,
  alarmName = 'workbench-task-poll',
  result = null,
  consecutiveEmptyPolls = 0,
} = {}) {
  const config = resolveWorkbenchTaskPollAlarmConfig(result, consecutiveEmptyPolls);
  alarmsApi?.create?.(alarmName, { periodInMinutes: config.periodInMinutes });
  return config;
}

export {
  EMPTY_POLL_THRESHOLD,
  FAST_TASK_POLL_INTERVAL_MS,
  SLOW_TASK_POLL_INTERVAL_MS,
};
