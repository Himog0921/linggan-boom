const FAST_TASK_POLL_INTERVAL_MS = 30_000;
const SLOW_TASK_POLL_INTERVAL_MS = 30_000;
const MIN_CHROME_ALARM_INTERVAL_MS = 30_000;
const EMPTY_POLL_THRESHOLD = 3;
const IDLE_POLL_JITTER_MIN_MS = 5_000;
const IDLE_POLL_JITTER_MAX_MS = 15_000;
const POST_TASK_COOLDOWN_MIN_MS = MIN_CHROME_ALARM_INTERVAL_MS;
const POST_TASK_COOLDOWN_MAX_MS = MIN_CHROME_ALARM_INTERVAL_MS;

function toFinitePositiveNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function normalizeReasonCode(result = null) {
  return String(result?.idleReasonCode || result?.reason?.code || '').trim().toUpperCase();
}

function shouldRespectExactIdleWait(result = null) {
  const code = normalizeReasonCode(result);
  return (
    code === 'STATION_BALANCING_WAIT' ||
    code === 'ACCOUNT_COOLING' ||
    code === 'ACCOUNT_NEEDS_LOGIN' ||
    code === 'ACCOUNT_RESTRICTED' ||
    code === 'ACCOUNT_DAILY_LIMIT' ||
    code === 'STATION_NOT_REGISTERED' ||
    code === 'NO_AVAILABLE_ACCOUNT'
  );
}

function randomRangeMs(minMs, maxMs, randomFn = Math.random) {
  const min = toFinitePositiveNumber(minMs, 0);
  const max = Math.max(min, toFinitePositiveNumber(maxMs, min));
  const ratio = Math.min(1, Math.max(0, Number(randomFn?.() ?? 0)));
  return Math.round(min + (max - min) * ratio);
}

function shouldApplyPostTaskCooldown(result = null) {
  return Boolean(result?.final || result?.released || result?.failed);
}

export function resolveWorkbenchTaskPollIntervalMs(result = null, consecutiveEmptyPolls = 0, options = {}) {
  const randomFn = typeof options.randomFn === 'function' ? options.randomFn : Math.random;
  if (shouldApplyPostTaskCooldown(result)) {
    return randomRangeMs(POST_TASK_COOLDOWN_MIN_MS, POST_TASK_COOLDOWN_MAX_MS, randomFn);
  }

  const idleNextPollAfterMs = toFinitePositiveNumber(result?.nextPollAfterMs, 0);
  if (result?.idle && idleNextPollAfterMs > 0) {
    return shouldRespectExactIdleWait(result)
      ? idleNextPollAfterMs
      : idleNextPollAfterMs + randomRangeMs(IDLE_POLL_JITTER_MIN_MS, IDLE_POLL_JITTER_MAX_MS, randomFn);
  }
  const fallback = consecutiveEmptyPolls >= EMPTY_POLL_THRESHOLD
    ? SLOW_TASK_POLL_INTERVAL_MS
    : FAST_TASK_POLL_INTERVAL_MS;
  if (result?.idle) {
    return fallback + randomRangeMs(IDLE_POLL_JITTER_MIN_MS, IDLE_POLL_JITTER_MAX_MS, randomFn);
  }
  return fallback;
}

export function resolveWorkbenchTaskPollAlarmConfig(result = null, consecutiveEmptyPolls = 0, options = {}) {
  const requestedIntervalMs = resolveWorkbenchTaskPollIntervalMs(result, consecutiveEmptyPolls, options);
  const intervalMs = Math.max(MIN_CHROME_ALARM_INTERVAL_MS, requestedIntervalMs);
  return {
    intervalMs,
    requestedIntervalMs,
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
  randomFn,
} = {}) {
  const config = resolveWorkbenchTaskPollAlarmConfig(result, consecutiveEmptyPolls, { randomFn });
  alarmsApi?.create?.(alarmName, { periodInMinutes: config.periodInMinutes });
  return config;
}

export {
  EMPTY_POLL_THRESHOLD,
  FAST_TASK_POLL_INTERVAL_MS,
  IDLE_POLL_JITTER_MAX_MS,
  IDLE_POLL_JITTER_MIN_MS,
  MIN_CHROME_ALARM_INTERVAL_MS,
  POST_TASK_COOLDOWN_MAX_MS,
  POST_TASK_COOLDOWN_MIN_MS,
  SLOW_TASK_POLL_INTERVAL_MS,
};
