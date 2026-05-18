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

function normalizeUrl(value = '') {
  return String(value || '').trim();
}

function extractProfileIdentity(url = '') {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return '';

  const match = normalizedUrl.match(/xiaohongshu\.com\/user\/profile\/([^/?#]+)/i)
    || normalizedUrl.match(/douyin\.com\/user\/([^/?#]+)/i)
    || normalizedUrl.match(/douyin\.com\/@([^/?#]+)/i);
  return String(match?.[1] || '').trim().toLowerCase();
}

function extractDetailIdentity(url = '') {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return '';

  const match = normalizedUrl.match(/xiaohongshu\.com\/(?:explore|discovery\/item)\/([^/?#]+)/i)
    || normalizedUrl.match(/douyin\.com\/(?:video|note)\/([^/?#]+)/i);
  return String(match?.[1] || '').trim().toLowerCase();
}

export function canDispatchTaskFromCapabilityReport(report = {}, taskType = '', target = {}) {
  const supportedTaskTypes = Array.isArray(report?.capabilities?.canRunTaskTypes)
    ? report.capabilities.canRunTaskTypes
    : [];
  const readinessReasonCode = String(report?.readiness?.reasonCode || '').trim();
  const platformBlocked = Boolean(report?.contextSnapshot?.platformBlocked)
    || readinessReasonCode === REMOTE_ERROR_CODE.PLATFORM_SECURITY_CHALLENGE;

  if (platformBlocked && !report?.readiness?.ready) {
    return {
      accepted: false,
      reasonCode: readinessReasonCode || REMOTE_ERROR_CODE.PLATFORM_SECURITY_CHALLENGE,
      reasonMessage: String(report?.readiness?.reasonMessage || '平台触发了安全验证，请先完成验证后继续').trim(),
    };
  }

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

  if (expectedPageType === 'profile') {
    const targetProfileId = extractProfileIdentity(target?.url);
    const currentProfileId = extractProfileIdentity(report?.url);
    if (targetProfileId && currentProfileId && targetProfileId !== currentProfileId) {
      return {
        accepted: false,
        reasonCode: REMOTE_ERROR_CODE.PAGE_TARGET_MISMATCH,
        reasonMessage: `当前页面不是任务目标博主：任务要 ${targetProfileId}，实际是 ${currentProfileId}`,
      };
    }
  }

  if (expectedPageType === 'detail') {
    const targetContentId = extractDetailIdentity(target?.url);
    const currentContentId = extractDetailIdentity(report?.url);
    if (targetContentId && targetContentId !== currentContentId) {
      return {
        accepted: false,
        reasonCode: REMOTE_ERROR_CODE.PAGE_TARGET_MISMATCH,
        reasonMessage: currentContentId
          ? `当前页面不是任务目标内容：任务要 ${targetContentId}，实际是 ${currentContentId}`
          : `当前页面不是任务目标内容：任务要 ${targetContentId}`,
      };
    }
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
