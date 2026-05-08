const NAVIGATION_TIMEOUT_MS = 30000;

function decodePossiblyEncodedKeyword(target = '') {
  let value = String(target || '').trim();
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9a-f]{2}/i.test(value)) break;
    try {
      const decoded = decodeURIComponent(value);
      if (!decoded || decoded === value) break;
      value = decoded;
    } catch {
      break;
    }
  }
  return value;
}

function buildXhsSearchUrl(target, options = {}) {
  const keyword = decodePossiblyEncodedKeyword(target);
  const sortMode = String(options.sortMode || '').trim();
  const sortParam = sortMode === 'hot' ? '&sort=hot' : sortMode === 'time' ? '&sort=time' : '';
  return `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}${sortParam}`;
}

function isHttpUrl(value = '') {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function isXhsDetailUrl(url = '') {
  return /^https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/[^/?#]+/i.test(String(url || '').trim());
}

function isDouyinDetailUrl(url = '') {
  return /^https?:\/\/(?:www\.)?douyin\.com\/video\/[^/?#]+/i.test(String(url || '').trim());
}

function shouldPreserveDetailTarget(taskType, target, options = {}) {
  const normalizedTarget = String(target || '').trim();
  if (!isHttpUrl(normalizedTarget)) return false;
  if (String(options.targetPageType || '').trim() === 'detail') return true;
  if (taskType === 'xhs.batchNotes') return isXhsDetailUrl(normalizedTarget);
  if (taskType === 'douyin.batchNotes') return isDouyinDetailUrl(normalizedTarget);
  return false;
}

const TASK_URL_BUILDERS = {
  'xhs.batchNotes': (target, options = {}) =>
    isHttpUrl(target)
      ? String(target || '').trim()
      : shouldPreserveDetailTarget('xhs.batchNotes', target, options)
        ? String(target || '').trim()
        : buildXhsSearchUrl(target, options),
  'xhs.batchComments': (target, options = {}) =>
    /^https?:\/\//i.test(target) ? target : buildXhsSearchUrl(target, options),
  'xhs.collectAuthor': (target) =>
    /^https?:\/\//i.test(target) ? target : `https://www.xiaohongshu.com/user/profile/${target}`,
  'douyin.batchNotes': (target, options = {}) =>
    shouldPreserveDetailTarget('douyin.batchNotes', target, options)
      ? String(target || '').trim()
      : `https://www.douyin.com/search/${encodeURIComponent(target)}`,
  'douyin.batchComments': (target) =>
    /^https?:\/\//i.test(target) ? target : `https://www.douyin.com/search/${encodeURIComponent(target)}`,
  'douyin.collectAuthor': (target) =>
    /^https?:\/\//i.test(target) ? target : `https://www.douyin.com/user/${target}`,
  'douyin.singleComments': (target) =>
    /^https?:\/\//i.test(target) ? target : null,
  'douyin.commentImageDownload': (target) =>
    /^https?:\/\//i.test(target) ? target : null,
};

export function buildTaskNavigationUrl(taskType = '', target = '', options = {}) {
  const builder = TASK_URL_BUILDERS[String(taskType || '').trim()];
  if (typeof builder !== 'function') return null;
  const url = builder(String(target || '').trim(), options);
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

export function navigateToTask(taskType, target, options = {}) {
  return new Promise((resolve) => {
    const url = buildTaskNavigationUrl(taskType, target, options);
    if (!url) {
      resolve({ tabId: null, error: 'cannot_build_url' });
      return;
    }

    let completed = false;

    chrome.windows.create({ url, focused: false, type: 'normal' }, async (createdWindow) => {
      if (chrome.runtime.lastError || !createdWindow?.id) {
        resolve({ tabId: null, error: 'tab_create_failed' });
        return;
      }

      let tabId = Number(createdWindow?.tabs?.[0]?.id || 0) || null;
      if (!tabId) {
        try {
          const tabs = await chrome.tabs.query({
            windowId: createdWindow.id,
            active: true,
          });
          tabId = Number(tabs?.[0]?.id || 0) || null;
        } catch {
          tabId = null;
        }
      }

      if (!tabId) {
        resolve({ tabId: null, error: 'tab_create_failed' });
        return;
      }

      chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});

      const timeout = setTimeout(() => {
        if (completed) return;
        completed = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve({ tabId, error: 'navigation_timeout', timedOut: true });
      }, NAVIGATION_TIMEOUT_MS);

      function listener(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve({ tabId, error: null, windowId: createdWindow.id });
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

export async function closeTab(tabId) {
  if (!tabId) return;
  await chrome.tabs.remove(tabId).catch(() => {});
}
