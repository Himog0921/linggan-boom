/**
 * syncEnvelopeV11.js
 *
 * V1.1 采集架构重构 — 内容工作台 /api/execution-stations/sync 协议升级。
 *
 * 目标：把插件 /sync 请求从旧字段（capabilities/platformAccounts/claimMode/
 * mailboxVersion/localLease 单对象）升级到内容工作台手册第 5.5 节 V1.1 协议：
 *   - stationSessionId / protocolVersion="3"
 *   - capacity（按 lane 上报 remainingWorkSeconds/targetWorkSeconds/maxReservedTasks）
 *   - activeLeases[]（数组，替代旧 activeLease 单对象）
 *   - operations[]（6 类 operation；接到 reservation 后用 start_job 确认开始）
 *   - accountReports[]（基础账号健康上报，由 platformAccounts 转换）
 *   - mailboxCursors（station + 各 lane，对象）
 *
 * 设计原则：
 *   1. /sync body 只发送 V1.1 字段；插件授权身份走 Authorization 请求头，
 *      不再把旧 authorizationId / claimMode / mailboxVersion / localLease 等字段混入协议。
 *   2. operations[] 本期只接入 start_job：插件先通过 capacity 领取 reservation，
 *      再回传 start_job 换取正式 lease。任务结果回传仍走 Delta Outbox，
 *      300017 风控仍走本地 markCooldown，后续再迁到完整 operations。
 *   3. capacity 是估算占位：插件没有工时度量基础，按 lane 用 maxReservedTasks=1
 *      作为软上限，remainingWorkSeconds/targetWorkSeconds 用粗略常量。
 *      这部分会被服务端的 claim 逻辑消费（remainingWorkSeconds <
 *      targetWorkSeconds * 0.3 时触发补货），先保证协议字段齐全可联调，
 *      真实度量后续接入。
 *
 * 引用：
 *   - 服务端协议：内容工作台 src/lib/services/execution-sync-service.ts
 *   - 服务端 route：内容工作台 src/app/api/execution-stations/sync/route.ts
 *   - 手册：内容工作台 docs/architecture/refactor/target-architecture-handbook-v1.1.md
 *           第 5.4-5.6 节
 *   - gap 盘点：内容工作台 docs/architecture/refactor/03-sync-protocol-gap.md
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/**
 * V1.1 协议版本号。与服务端 execution-sync-service.ts V11_PROTOCOL_VERSION 对齐。
 * 服务端要求 protocolVersion === "3" 或更高（用 isPluginVersionAtLeast 比较）。
 */
export const SYNC_PROTOCOL_VERSION_V11 = '3';

/**
 * 插件最低协议版本。与服务端 V11_MIN_PLUGIN_VERSION = "2.0.58" 对齐。
 * 低于此版本，服务端返回 426 VERSION_REJECTED。
 */
export const SYNC_MIN_PLUGIN_VERSION_V11 = '2.0.58';

/**
 * capacity 占位常量。
 * 手册 6.4 节：claim 触发条件 remainingWorkSeconds < targetWorkSeconds * 0.3。
 * 插件没有工时度量，按「单 lane 容量 1 个任务，每次同步都希望补货」设置：
 * remainingWorkSeconds=0（已耗尽），targetWorkSeconds=600（10min 上限），
 * maxReservedTasks=1（插件单 tab 单并发）。
 * 这样服务端 lane 永远判定为需要补货（0 < 600 * 0.3），会触发 claim。
 * 后续接入真实工时度量后替换为动态值。
 */
const CAPACITY_PLACEHOLDER = {
  remainingWorkSeconds: 0,
  targetWorkSeconds: 600,
  maxReservedTasks: 1,
};

/**
 * V1.1 正式车道命名。服务端只接受 "platform.lane" 形式，不能再发送
 * 旧的 "xhs" / "douyin" 平台级 key。
 *
 * 当前本地验证优先打通正在排队的两类任务：
 *   - xhs.monitor_patrol：小红书监控巡检
 *   - douyin.governance：抖音治理任务
 */
const PLATFORM_DEFAULT_CAPACITY_LANES = {
  xhs: ['xhs.monitor_patrol'],
  douyin: ['douyin.governance'],
};

const CAPABILITY_CAPACITY_LANES = {
  'xhs.authorsurfacescan': ['xhs.monitor_patrol'],
  'xhs.batchnotes': ['xhs.monitor_patrol'],
  'xhs.collectauthor': ['xhs.monitor_patrol'],
  'xhs.authornotelinks': ['xhs.monitor_patrol'],
  'xhs.batchcomments': ['xhs.comments'],
  'douyin.authorsurfacescan': ['douyin.governance'],
  'douyin.batchnotes': ['douyin.governance'],
  'douyin.collectauthor': ['douyin.governance'],
  'douyin.batchcomments': ['douyin.comments'],
  'douyin.singlecomments': ['douyin.comments'],
};

const KNOWN_PLATFORMS = Object.keys(PLATFORM_DEFAULT_CAPACITY_LANES);

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function normalizeString(value = '') {
  return String(value || '').trim();
}

function toFiniteNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toOptionalInteger(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : undefined;
}

function toStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// stationSessionId
// ---------------------------------------------------------------------------

/**
 * stationSessionId 是单次插件启动周期内的会话标识（chrome.runtime lifespan 内稳定）。
 * 服务端用于追踪「同 stationId 不同 session」的断连/重连场景。
 *
 * 实现：缓存在 chrome.storage.local（key=workbenchStationSessionId），首次启动
 * 生成 uuid，service worker 重启后保留（storage.local 跨 SW 重启持久化）。
 * 清理工位身份（clearStationIdentity）时一并清。
 *
 * 注意：service worker 在 MV3 下会被频繁回收（30s 闲置后），但 storage.local 持久化，
 * 所以 stationSessionId 在「同一浏览器同一插件安装」内稳定，符合手册「会话」语义。
 */
export async function resolveStationSessionId({
  storageArea = globalThis.chrome?.storage?.local,
  randomUUID = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
} = {}) {
  const STORAGE_KEY = 'workbenchStationSessionId';
  if (!storageArea?.get) {
    // 兜底：storage 不可用时退化为进程内 uuid（每次 SW 重启变化，弱语义但保证有值）
    return normalizeString(randomUUID());
  }
  const data = await storageArea.get(STORAGE_KEY);
  const existing = normalizeString(data?.[STORAGE_KEY]);
  if (existing) return existing;
  const next = normalizeString(randomUUID());
  if (storageArea.set) {
    await storageArea.set({ [STORAGE_KEY]: next });
  }
  return next;
}

/**
 * 清理 stationSessionId（在 clearStationIdentity 时调用，保证换授权码/换工位时
 * 服务端看到新 session）。
 */
export async function clearStationSessionId({
  storageArea = globalThis.chrome?.storage?.local,
} = {}) {
  const STORAGE_KEY = 'workbenchStationSessionId';
  if (!storageArea?.remove) return;
  await storageArea.remove(STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// mailboxCursors 构造
// ---------------------------------------------------------------------------

/**
 * 把旧 mailboxVersion（单数字）+ lane 集合转换为 V1.1 mailboxCursors 对象。
 *
 * 服务端期望：{ station: number, [lane]: number, ... }
 * 客户端把上次 sync 响应里的 mailboxVersions 整体回传，作为「我已经看到的版本号」
 * cursor。服务端对比自己的当前 mailboxVersions，如果一致则短路 idle 返回。
 *
 * @param {object} options
 * @param {number|undefined} options.stationVersion - 上次响应的 mailboxVersions.station（或旧 mailbox.version）
 * @param {Record<string, number>} options.laneVersions - 上次响应的各 lane 版本号
 * @returns {object} mailboxCursors 对象，至少含 station 字段（如果 stationVersion 有值）
 */
export function buildMailboxCursors({ stationVersion, laneVersions = {} } = {}) {
  const cursors = {};
  const stationCursor = toOptionalInteger(stationVersion);
  if (stationCursor !== undefined) {
    cursors.station = stationCursor;
  }
  if (isPlainObject(laneVersions)) {
    for (const [lane, version] of Object.entries(laneVersions)) {
      const normalizedLane = normalizeString(lane);
      const normalizedVersion = toOptionalInteger(version);
      if (normalizedLane && normalizedVersion !== undefined) {
        cursors[normalizedLane] = normalizedVersion;
      }
    }
  }
  return cursors;
}

// ---------------------------------------------------------------------------
// capacity 构造
// ---------------------------------------------------------------------------

/**
 * 把 capabilities（字符串数组）+ 当前页面平台转换为 V1.1 capacity 对象（按正式车道）。
 *
 * 服务端期望：{ [lane]: { remainingWorkSeconds, targetWorkSeconds, maxReservedTasks } }
 * 客户端按自己能跑的 platform.lane 上报。手册要求 capacity 反映「真实剩余工时」，
 * 但插件没有工时度量基础，这里用占位策略（见 CAPACITY_PLACEHOLDER 注释）。
 *
 * @param {object} options
 * @param {string[]} options.capabilities - 插件能力列表（旧 capabilities 字段，含 'xhs' / 'douyin' 等）
 * @param {string} options.activeLane - 当前活跃平台（'xhs' / 'douyin' / ''），可选
 * @returns {Record<string, {remainingWorkSeconds, targetWorkSeconds, maxReservedTasks}>}
 *          按 platform.lane 的 capacity 对象；无 lane 时返回空对象（服务端走 no_capacity 分支）
 */
export function buildLaneCapacity({ capabilities = [], activeLane = '' } = {}) {
  const caps = toStringArray(capabilities);
  const lanes = new Set();
  // 从 capabilities 推导正式车道：capabilities 格式是 'xhs.batchNotes' / 'douyin.collectAuthor'
  for (const cap of caps) {
    const normalizedCap = normalizeString(cap).toLowerCase();
    const mappedLanes = CAPABILITY_CAPACITY_LANES[normalizedCap];
    if (mappedLanes) {
      mappedLanes.forEach((lane) => lanes.add(lane));
      continue;
    }
    for (const platform of KNOWN_PLATFORMS) {
      if (normalizedCap === platform || normalizedCap.startsWith(platform + '.') || normalizedCap.startsWith(platform + '_')) {
        PLATFORM_DEFAULT_CAPACITY_LANES[platform].forEach((lane) => lanes.add(lane));
      }
    }
  }
  // activeLane（当前页面平台）：没有具体 capability 时至少声明平台默认 V1.1 车道。
  const normalizedActiveLane = normalizeString(activeLane).toLowerCase();
  if (normalizedActiveLane && PLATFORM_DEFAULT_CAPACITY_LANES[normalizedActiveLane]) {
    PLATFORM_DEFAULT_CAPACITY_LANES[normalizedActiveLane].forEach((lane) => lanes.add(lane));
  }

  const capacity = {};
  for (const lane of lanes) {
    capacity[lane] = { ...CAPACITY_PLACEHOLDER };
  }
  return capacity;
}

// ---------------------------------------------------------------------------
// activeLeases[] 构造
// ---------------------------------------------------------------------------

/**
 * 把旧 activeLease/localLease（单对象）转换为 V1.1 activeLeases 数组。
 *
 * 服务端期望：[{ jobId, leaseToken, leaseEpoch, lane?, progress?, stage?, lastProgressAt? }]
 * - jobId 对应旧 taskId（手册统一为 jobId 概念，但当前服务端实现也用 jobId 字段名，
 *   值仍是 taskId 的值——任务 ID 在 V1.1 全局唯一，jobId === taskId）
 * - lane 推导自 task.platform 或 task.lane（如果存在）
 * - progress/stage/lastProgressAt 来自插件 taskPoller 的 streamedRecordCounts/stage
 *
 * @param {object} options
 * @param {object|null} options.localLease - 旧 lease 快照 { taskId, leaseToken, leaseEpoch, attemptId, ... }
 * @param {object|null} options.activeTask - 当前活动任务（含 platform/stage/streamedRecordCounts 等），可选
 * @returns {Array} activeLeases 数组；无 lease 时返回空数组
 */
export function buildActiveLeases({ localLease = null, activeTask = null } = {}) {
  if (!isPlainObject(localLease)) return [];

  const jobId = normalizeString(localLease.taskId || localLease.jobId);
  const leaseToken = normalizeString(localLease.leaseToken);
  const leaseEpoch = toOptionalInteger(localLease.leaseEpoch);
  if (!jobId || !leaseToken) return [];

  const lease = { jobId, leaseToken };
  if (leaseEpoch !== undefined) lease.leaseEpoch = leaseEpoch;

  // lane：优先 localLease.lane，其次 activeTask.platform
  const lane = normalizeString(localLease.lane || activeTask?.platform || activeTask?.lane).toLowerCase();
  if (lane) lease.lane = lane;

  // progress / stage / lastProgressAt：从 activeTask 推导（如果有）
  if (isPlainObject(activeTask)) {
    const progress = toOptionalInteger(activeTask.progress);
    if (progress !== undefined && progress >= 0 && progress <= 100) {
      lease.progress = progress;
    }
    const stage = normalizeString(activeTask.stage || activeTask.executionPhase);
    if (stage) lease.stage = stage;
    const lastProgressAtMs = toFiniteNumber(activeTask.lastProgressAtMs, 0);
    if (lastProgressAtMs > 0) {
      lease.lastProgressAt = new Date(lastProgressAtMs).toISOString();
    }
  }

  return [lease];
}

// ---------------------------------------------------------------------------
// accountReports[] 构造
// ---------------------------------------------------------------------------

/**
 * 把旧 platformAccounts 数组转换为 V1.1 accountReports 数组。
 *
 * 服务端期望：[{ platform, platformAccountId?, healthStatus, cooldownUntil? }]
 * 旧 platformAccounts 是插件本地账号快照，含 platform/platformAccountId/healthStatus/
 * cooldownUntil 等字段。V1.1 只是协议化字段名 + 协议化结构。
 *
 * @param {Array} platformAccounts - 旧 platformAccounts 数组
 * @returns {Array} accountReports 数组；空输入返回空数组
 */
export function buildAccountReports(platformAccounts = []) {
  if (!Array.isArray(platformAccounts)) return [];
  const reports = [];
  for (const account of platformAccounts) {
    if (!isPlainObject(account)) continue;
    const platform = normalizeString(account.platform).toLowerCase();
    if (!platform) continue;
    const report = {
      platform,
      healthStatus: normalizeString(account.healthStatus || account.health || 'unknown') || 'unknown',
    };
    const platformAccountId = normalizeString(account.platformAccountId || account.id);
    if (platformAccountId) report.platformAccountId = platformAccountId;
    const cooldownUntil = normalizeString(account.cooldownUntil);
    if (cooldownUntil) report.cooldownUntil = cooldownUntil;
    reports.push(report);
  }
  return reports;
}

// ---------------------------------------------------------------------------
// 完整 /sync 请求构造
// ---------------------------------------------------------------------------

/**
 * 构造 V1.1 /sync 请求的完整 body。
 *
 * 调用方：
 *   - executionStationClient.sendHeartbeat（心跳路径，localLease=null）
 *   - taskLeaseClient.claimCollectionTaskLease（claim 路径，localLease 来自 store）
 *   - taskLeaseClient.reconcileExecutionStationLease（reconcile 路径，localLease 来自参数）
 *
 * @param {object} options
 * @param {string} options.stationId
 * @param {string} options.stationToken
 * @param {string} options.authorizationId
 * @param {string} options.pluginVersion
 * @param {string} options.stationSessionId - 已 resolve 的 session id
 * @param {string} [options.status='online'] - 旧 status 字段（保留）
 * @param {string[]} [options.capabilities=[]] - 旧 capabilities 字段（保留 + 用于推导 lane）
 * @param {Array} [options.platformAccounts=[]] - 旧 platformAccounts（保留 + 转换为 accountReports）
 * @param {string} [options.activeLane=''] - 当前活跃 lane
 * @param {object|null} [options.localLease=null] - 旧 lease 快照
 * @param {object|null} [options.activeTask=null] - 当前活动任务
 * @param {number|undefined} [options.mailboxStationVersion] - 上次响应的 station mailbox 版本
 * @param {Record<string, number>} [options.mailboxLaneVersions={}] - 上次响应的 lane 版本
 * @param {Array} [options.operations=[]] - V1.1 operation 列表
 * @param {boolean} [options.includeCapacity=true] - 是否上报 capacity；start_job 回执不再重复补货
 * @param {string} [options.mode=''] - 同步目的：heartbeat 只保活，claim 才允许领 reservation
 * @param {string} [options.claimMode='status_only'] - 旧 claimMode（保留）
 * @param {boolean} [options.forceFullSync=false] - 旧 forceFullSync（保留）
 * @returns {object} /sync 请求 body
 */
export function buildSyncRequestV11({
  stationId,
  stationToken,
  authorizationId,
  pluginVersion,
  stationSessionId,
  status = 'online',
  capabilities = [],
  platformAccounts = [],
  activeLane = '',
  localLease = null,
  activeTask = null,
  mailboxStationVersion,
  mailboxLaneVersions = {},
  operations = [],
  includeCapacity = true,
  mode = '',
  claimMode = 'status_only',
  forceFullSync = false,
} = {}) {
  // --- V1.1 字段 ---
  const v11Fields = {
    stationId: normalizeString(stationId),
    stationToken: normalizeString(stationToken),
    pluginVersion: normalizeString(pluginVersion),
    protocolVersion: SYNC_PROTOCOL_VERSION_V11,
    stationSessionId: normalizeString(stationSessionId),
  };
  const normalizedMode = normalizeString(mode);
  if (normalizedMode) {
    v11Fields.mode = normalizedMode;
  }

  // mailboxCursors
  const cursors = buildMailboxCursors({
    stationVersion: mailboxStationVersion,
    laneVersions: mailboxLaneVersions,
  });
  if (Object.keys(cursors).length > 0) {
    v11Fields.mailboxCursors = cursors;
  }

  // capacity（按 lane）
  const capacity = includeCapacity ? buildLaneCapacity({ capabilities, activeLane }) : {};
  if (Object.keys(capacity).length > 0) {
    v11Fields.capacity = capacity;
  }

  // activeLeases[]
  const activeLeases = buildActiveLeases({ localLease, activeTask });
  if (activeLeases.length > 0) {
    v11Fields.activeLeases = activeLeases;
  }

  // operations[]
  v11Fields.operations = Array.isArray(operations) ? operations : [];

  // accountReports[]
  const accountReports = buildAccountReports(platformAccounts);
  if (accountReports.length > 0) {
    v11Fields.accountReports = accountReports;
  }

  return v11Fields;
}

// ---------------------------------------------------------------------------
// 响应解析（V1.1 + 旧 envelope 双路径）
// ---------------------------------------------------------------------------

/**
 * 从 /sync 响应里提取 V1.1 mailboxVersions（含 station + 各 lane）。
 *
 * V1.1 服务端响应（execution-sync-service.ts SyncResponse）：
 *   body.mailboxVersions = { station: number, [lane]: number, ... }
 *
 * 旧服务端响应（execution-station-sync-service.ts）：
 *   body.mailbox.version = number（station 级）
 *
 * @param {object} data - /sync 响应 body
 * @returns {{ station?: number, lanes: Record<string, number> }}
 */
export function extractMailboxVersionsFromResponse(data = {}) {
  if (!isPlainObject(data)) return { lanes: {} };

  // V1.1 路径
  const v11Mailbox = data.mailboxVersions;
  if (isPlainObject(v11Mailbox)) {
    const station = toOptionalInteger(v11Mailbox.station);
    const lanes = {};
    for (const [key, value] of Object.entries(v11Mailbox)) {
      if (key === 'station') continue;
      const lane = normalizeString(key).toLowerCase();
      const version = toOptionalInteger(value);
      if (lane && version !== undefined) {
        lanes[lane] = version;
      }
    }
    const result = { lanes };
    if (station !== undefined) result.station = station;
    return result;
  }

  // 旧路径
  const legacyVersion = toOptionalInteger(
    data?.mailbox?.version
    ?? data?.mailboxVersion
    ?? data?.sync?.mailbox?.version,
  );
  if (legacyVersion !== undefined) {
    return { station: legacyVersion, lanes: {} };
  }
  return { lanes: {} };
}

/**
 * 从 /sync 响应里提取 nextSync（V1.1 对象）或 nextSyncAfterMs（旧数字）。
 *
 * V1.1: body.nextSync = { afterMs: number, reason: string }
 * 旧:   body.nextSyncAfterMs = number
 *
 * @param {object} data
 * @returns {{ afterMs: number, reason: string }}
 */
export function extractNextSyncFromResponse(data = {}) {
  if (!isPlainObject(data)) return { afterMs: 60_000, reason: 'fallback' };

  if (isPlainObject(data.nextSync)) {
    return {
      afterMs: toFiniteNumber(data.nextSync.afterMs, 60_000),
      reason: normalizeString(data.nextSync.reason) || 'unknown',
    };
  }
  const legacyMs = toOptionalInteger(data.nextSyncAfterMs);
  if (legacyMs !== undefined) {
    return { afterMs: legacyMs, reason: 'legacy_nextSyncAfterMs' };
  }
  return { afterMs: 60_000, reason: 'fallback' };
}

/**
 * 判断 /sync 响应是否是 V1.1 协议（含 mailboxVersions 对象 + operationResults）。
 * 用于调用方区分响应格式（影响后续解析路径）。
 */
export function isV11SyncResponse(data = {}) {
  return Boolean(
    isPlainObject(data)
    && isPlainObject(data.mailboxVersions)
    && Object.prototype.hasOwnProperty.call(data, 'operationResults'),
  );
}
