import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPlatformAccountReports,
  MONITOR_STATION_CAPABILITIES,
} from '../src/workbench/runtime/executionStationRuntime.js';

test('execution station runtime reports generic execution accounts and surface capabilities', () => {
  const reports = buildPlatformAccountReports([
    {
      accountId: 'account-1',
      name: '监控小红书 01',
      platform: 'xhs',
      status: 'available',
      dailyQuotaUsed: 3,
      dailyQuotaLimit: 100,
      cooldownUntil: 0,
    },
  ], {
    now: new Date('2026-04-17T12:00:00.000Z').getTime(),
  });

  assert.deepEqual(reports.map((account) => ({
    platform: account.platform,
    purpose: account.purpose,
    healthStatus: account.healthStatus,
    dailyTaskCount: account.dailyTaskCount,
    dailyOpenedCount: account.dailyOpenedCount,
  })), [
    {
      platform: 'xhs',
      purpose: 'execution',
      healthStatus: 'healthy',
      dailyTaskCount: 3,
      dailyOpenedCount: 3,
    },
  ]);
  assert.equal(MONITOR_STATION_CAPABILITIES.includes('xhs.authorSurfaceScan'), true);
  assert.equal(MONITOR_STATION_CAPABILITIES.includes('xhs.keywordSurfaceScan'), true);
});

test('monitor station runtime reports cooling accounts with explicit cooldown metadata', () => {
  const reports = buildPlatformAccountReports([
    {
      accountId: 'account-1',
      name: '监控小红书 01',
      platform: 'xhs',
      status: 'cooldown',
      dailyQuotaUsed: 8,
      dailyQuotaLimit: 100,
      cooldownUntil: new Date('2026-04-17T12:05:00.000Z').getTime(),
    },
  ], {
    now: new Date('2026-04-17T12:00:00.000Z').getTime(),
  });

  assert.deepEqual(reports.map((account) => ({
    platform: account.platform,
    healthStatus: account.healthStatus,
    cooldownUntil: account.cooldownUntil,
    dailyTaskCount: account.dailyTaskCount,
  })), [
    {
      platform: 'xhs',
      healthStatus: 'cooling',
      cooldownUntil: new Date('2026-04-17T12:05:00.000Z').getTime(),
      dailyTaskCount: 8,
    },
  ]);
});
