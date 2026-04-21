import { REMOTE_ERROR_CODE } from '../protocol/schema.js';

function normalizeCapabilityPageMode(report = {}) {
  const mode = String(report?.mode || '').trim();
  if (mode) return mode;

  const pageType = String(report?.pageType || '').trim();
  if (pageType === 'noteDetail' || pageType === 'videoDetail' || pageType === 'detail') {
    return 'detail';
  }
  if (pageType === 'profile') return 'profile';
  if (pageType === 'search') return 'search';
  return '';
}

export function canDispatchTaskFromCapabilityReport(report = {}, taskType = '', target = {}) {
  const supportedTaskTypes = Array.isArray(report?.capabilities?.canRunTaskTypes)
    ? report.capabilities.canRunTaskTypes
    : [];

  if (!supportedTaskTypes.includes(String(taskType || '').trim())) {
    return {
      accepted: false,
      reasonCode: REMOTE_ERROR_CODE.UNSUPPORTED_TASK_TYPE,
      reasonMessage: '当前页面能力报告未声明支持该任务类型',
    };
  }

  const expectedPageType = String(target?.pageType || '').trim();
  const actualPageType = normalizeCapabilityPageMode(report);
  if (expectedPageType && expectedPageType !== 'unknown' && actualPageType && actualPageType !== expectedPageType) {
    return {
      accepted: false,
      reasonCode: REMOTE_ERROR_CODE.PAGE_TYPE_MISMATCH,
      reasonMessage: `当前页面类型不对：任务需要 ${expectedPageType}，实际是 ${actualPageType}`,
    };
  }

  if (!report?.readiness?.ready) {
    return {
      accepted: false,
      reasonCode: String(report?.readiness?.reasonCode || REMOTE_ERROR_CODE.PAGE_CONTEXT_UNAVAILABLE).trim(),
      reasonMessage: String(report?.readiness?.reasonMessage || '当前页面未形成可执行上下文').trim(),
    };
  }

  return {
    accepted: true,
    reasonCode: '',
    reasonMessage: '',
  };
}
