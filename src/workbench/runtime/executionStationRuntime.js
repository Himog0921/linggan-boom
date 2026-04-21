export const MONITOR_STATION_CAPABILITIES = [
  'xhs.authorSurfaceScan',
  'xhs.keywordSurfaceScan',
  'xhs.noteDetailProbe',
  'xhs.deepCollect',
  'xhs.batchNotes',
  'xhs.batchComments',
  'xhs.collectAuthor',
  'douyin.authorSurfaceScan',
  'douyin.keywordSurfaceScan',
  'douyin.noteDetailProbe',
  'douyin.deepCollect',
  'douyin.batchNotes',
  'douyin.batchComments',
  'douyin.collectAuthor',
  'douyin.singleComments',
  'douyin.commentImageDownload',
];

function normalizeText(value = '') {
  return String(value || '').trim();
}

function isAccountHealthy(account = {}, now = Date.now()) {
  if (normalizeText(account.status || 'available') !== 'available') return false;
  if (Number(account.dailyQuotaLimit || 0) > 0 && Number(account.dailyQuotaUsed || 0) >= Number(account.dailyQuotaLimit || 0)) {
    return false;
  }
  return !(Number(account.cooldownUntil || 0) > now);
}

function mapAccountHealth(account = {}, now = Date.now()) {
  if (Number(account.cooldownUntil || 0) > now) return 'cooling';
  return isAccountHealthy(account, now) ? 'healthy' : 'unhealthy';
}

export function buildPlatformAccountReports(accounts = [], {
  purpose = 'monitor',
  now = Date.now(),
} = {}) {
  const latestByPlatform = new Map();
  for (const account of Array.isArray(accounts) ? accounts : []) {
    const platform = normalizeText(account.platform || 'xhs');
    if (!platform) continue;
    const current = latestByPlatform.get(platform);
    const next = {
      platform,
      platformAccountId: normalizeText(account.accountId) || null,
      displayName: normalizeText(account.name) || null,
      purpose,
      healthStatus: mapAccountHealth(account, now),
      cooldownUntil: Number(account.cooldownUntil || 0) || 0,
      dailyTaskCount: Number(account.dailyQuotaUsed || 0),
      dailyOpenedCount: Number(account.dailyQuotaUsed || 0),
      rawProfile: {
        status: normalizeText(account.status || 'available'),
        dailyQuotaUsed: Number(account.dailyQuotaUsed || 0),
        dailyQuotaLimit: Number(account.dailyQuotaLimit || 0),
        cooldownUntil: Number(account.cooldownUntil || 0),
        lastUsedAt: Number(account.lastUsedAt || 0),
      },
    };

    if (!current || (current.healthStatus !== 'healthy' && next.healthStatus === 'healthy')) {
      latestByPlatform.set(platform, next);
    }
  }
  return [...latestByPlatform.values()];
}

export async function collectStationPlatformAccounts(accountStore, options = {}) {
  if (!accountStore?.getAll) return [];
  const accounts = await accountStore.getAll();
  return buildPlatformAccountReports(accounts, options);
}
