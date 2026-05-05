import '../extensionPublicPath.js';
import { MSG, COMMENT_DEPTH_MODE } from '../shared/constants.js';
import { sendToBackground } from '../shared/messaging.js';
import { initThemeManager, setTheme, getCurrentTheme } from '../themes/themeManager.js';
import {
  sendToTab,
  unwrapTabResponseData,
  mapNoteToFlywheel,
  mapCommentToFlywheel,
  mapAuthorToFlywheel,
} from './utils.js';

const PLATFORM = {
  XHS: 'xhs',
  DOUYIN: 'douyin',
  UNKNOWN: 'unknown',
};

const PAGE_MODE = {
  DETAIL: 'detail',
  PROFILE: 'profile',
  SEARCH: 'search',
  UNKNOWN: 'unknown',
};

// ========== Tab 切换 ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById(btn.getAttribute('aria-controls')).style.display = 'flex';
  });
});

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化主题
  await initThemeManager();
  const currentTheme = getCurrentTheme();
  if (currentTheme === 'ac-ui') {
    document.body.setAttribute('data-theme', 'ac-ui');
  }

  // 主题切换按钮
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', async () => {
      const next = getCurrentTheme() === 'ac-ui' ? 'default' : 'ac-ui';
      await setTheme(next);
      document.body.setAttribute('data-theme', next === 'ac-ui' ? 'ac-ui' : '');
    });
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || '';
  const tabId = tab?.id;
  let platform = detectPlatformByUrl(tabUrl);
  let mode = getModeFromUrl(tabUrl, platform);
  let isDyVideoPage = platform === PLATFORM.DOUYIN && isDouyinVideoUrl(tabUrl);
  let isDyStrictDetailPage = platform === PLATFORM.DOUYIN && isDouyinStrictDetailUrl(tabUrl);
  let isStableSearchList = mode === PAGE_MODE.SEARCH;
  let capabilities = getPageCapabilities(platform, mode, { isDyVideoPage, isDyStrictDetailPage, isStableSearchList });

  if (tabId && platform !== PLATFORM.UNKNOWN) {
    try {
      const response = await sendToTab(tabId, { action: MSG.GET_PAGE_CONTEXT }, { timeoutMs: 1800 });
      const pageContext = unwrapTabResponseData(response, response?.context || null) || response?.context || null;
      if (pageContext?.platform) {
        platform = pageContext.platform;
        mode = pageContext.mode || mode;
        isDyVideoPage = Boolean(pageContext.isDyVideoPage);
        isDyStrictDetailPage = Boolean(pageContext.isDyStrictDetailPage);
        isStableSearchList = Boolean(pageContext.isStableSearchList);
        capabilities = {
          ...getPageCapabilities(platform, mode, { isDyVideoPage, isDyStrictDetailPage, isStableSearchList }),
          ...(pageContext.capabilities || {}),
          isDyVideoPage,
          isDyStrictDetailPage,
          isStableSearchList,
        };
      }
    } catch {
      // content script 未就绪时退回 URL 判定
    }
  }

  applyPlatformUI(platform, capabilities);
  renderPageContext(platform, mode, { isDyVideoPage, isDyStrictDetailPage, isStableSearchList, tabUrl });

  if (!tabId) {
    showNotice('没有找到当前页面，请切回小红书或抖音页面后重试。', 'warning');
    return;
  }

  if (platform === PLATFORM.UNKNOWN) {
    showNotice('当前页面暂不支持，请打开小红书或抖音页面。', 'warning');
  }

  // 加载统计数据
  loadStats(tabId);

  // 单篇内容采集（XHS=笔记，抖音=视频）
  document.getElementById('btnCollectNote').addEventListener('click', async () => {
    if (!capabilities.canCollectPrimary) {
      showNotice(getPrimaryActionWarning(platform, mode, capabilities), 'warning');
      return;
    }
    hideNotice();
    showProgress(true);
    updateProgress(0, 1, platform === PLATFORM.DOUYIN ? '正在发起视频采集...' : '正在发起笔记采集...');
    try {
      await sendToTab(tabId, { action: MSG.COLLECT_SINGLE_NOTE });
    } catch (err) {
      showProgress(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  // 第二动作（XHS=评论，抖音=博主）
  document.getElementById("btnCollectComment").addEventListener("click", async () => {
    if (!capabilities.canCollectSecondary) {
      showNotice(getSecondaryActionWarning(platform, mode, capabilities), "warning");
      return;
    }
    const isCommentScene = capabilities.secondaryAction === 'comment';
    let payload = { action: MSG.COLLECT_SINGLE_COMMENT };
    if (isCommentScene) {
      const settings = await openCurrentCommentLimitSettings({
        title: platform === PLATFORM.DOUYIN ? "抖音当前评论设置" : "小红书当前评论设置",
        subtitle: platform === PLATFORM.DOUYIN
          ? "设置当前视频评论上限与采集深度。留空或填 0 表示全部采集，包含二级评论。"
          : "设置当前笔记评论上限与采集深度。留空或填 0 表示全部采集，包含二级评论。",
        confirmText: "开始采集",
      });
      if (!settings) return;
      const commentDepthMode = settings.commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES
        ? COMMENT_DEPTH_MODE.ALL_REPLIES
        : COMMENT_DEPTH_MODE.TWO_LEVEL;
      payload = {
        action: MSG.COLLECT_SINGLE_COMMENT,
        maxTotal: settings.maxTotal,
        maxSubComments: commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : undefined,
        sortMode: "hot",
        triggerSource: "popup_manual",
        commentDepthMode,
      };
    }
    hideNotice();
    showProgress(true);
    const action = platform === PLATFORM.DOUYIN
      ? (isDyVideoPage ? MSG.COLLECT_SINGLE_COMMENT : MSG.COLLECT_AUTHOR)
      : MSG.COLLECT_SINGLE_COMMENT;
    updateProgress(0, 1, platform === PLATFORM.DOUYIN
      ? (isDyVideoPage ? "正在发起评论采集..." : "正在发起博主采集...")
      : "正在发起评论采集...");
    try {
      await sendToTab(tabId, isCommentScene ? payload : { action });
    } catch (err) {
      showProgress(false);
      showNotice(toFriendlyError(err), "warning");
    }
  });
  document.getElementById("btnCommentImages").addEventListener("click", async () => {
    if (!capabilities.canDownloadCommentImages) {
      showNotice("请先进入抖音严格详情页，再执行评论图片区下载。", "warning");
      return;
    }
    const settings = await openCurrentCommentLimitSettings({
      title: "抖音评论图片区设置",
      subtitle: "设置评论扫描上限与采集深度。留空或填 0 表示尽量扫描全部评论并下载高清评论图片。",
      confirmText: "开始下载",
    });
    if (!settings) return;
    const commentDepthMode = settings.commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES
      ? COMMENT_DEPTH_MODE.ALL_REPLIES
      : COMMENT_DEPTH_MODE.TWO_LEVEL;
    hideNotice();
    showProgress(true);
    updateProgress(0, 1, "正在下载当前视频评论图片区...");
    try {
      const result = await sendToTab(tabId, {
        action: MSG.DOWNLOAD_CURRENT_COMMENT_IMAGES,
        maxTotal: settings.maxTotal,
        maxSubComments: commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : undefined,
        commentDepthMode,
      });
      showProgress(false);
      if (result?.stopped) {
        showNotice(
          result?.downloaded > 0
            ? `评论图片区已停止，已打包 ${result?.downloaded || 0}/${result?.total || 0}，高清 ${result?.hdCount || 0}`
            : (result?.message || "评论图片区下载已停止"),
          "warning",
        );
      } else {
        showNotice(
          `评论图片区下载完成：成功 ${result?.downloaded || 0}/${result?.total || 0}，高清 ${result?.hdCount || 0}`,
          "info",
        );
      }
    } catch (err) {
      showProgress(false);
      showNotice(toFriendlyError(err), "warning");
    }
  });
  // 批量笔记采集
  document.getElementById('btnBatchNotes').addEventListener('click', async () => {
    if (!capabilities.canBatchNotes) {
      showNotice(getBatchActionWarning(platform, mode, capabilities), 'warning');
      return;
    }
    const settings = await openBatchSettings('notes', platform);
    if (!settings) return;
    hideNotice();
    try {
      await sendToBackground(MSG.START_BATCH_NOTES, {
        tabId,
        mode,
        count: settings.count,
        topByLikes: settings.topByLikes,
      });
      showProgress(true);
      updateProgress(0, settings.count, '批量笔记任务已启动');
      toggleBatchControls(true, false);
    } catch (err) {
      showProgress(false);
      toggleBatchControls(false, false);
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  // 批量评论采集
  document.getElementById('btnBatchComments').addEventListener('click', async () => {
    if (!capabilities.canBatchComments) {
      showNotice(getBatchActionWarning(platform, mode, capabilities), 'warning');
      return;
    }
    const settings = await openBatchSettings('comments', platform);
    if (!settings) return;
    hideNotice();
    try {
      await sendToBackground(MSG.START_BATCH_COMMENTS, {
        tabId,
        mode,
        count: settings.count,
        topByLikes: settings.topByLikes,
        commentLimit: settings.commentLimit,
        commentDepthMode: settings.commentDepthMode,
      });
      showProgress(true);
      updateProgress(0, settings.count || 0, '批量评论任务已启动', {}, settings.commentDepthMode);
      toggleBatchControls(true, false);
    } catch (err) {
      showProgress(false);
      toggleBatchControls(false, false);
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  document.getElementById('btnPause').addEventListener('click', async () => {
    hideNotice();
    try {
      await Promise.all([
        sendToBackground(MSG.PAUSE_BATCH_NOTES, { tabId }),
        sendToBackground(MSG.PAUSE_BATCH_COMMENTS, { tabId }),
      ]);
      toggleBatchControls(true, true);
      showNotice('任务已暂停，可随时继续。', 'info');
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  document.getElementById('btnResume').addEventListener('click', async () => {
    hideNotice();
    try {
      await Promise.all([
        sendToBackground(MSG.RESUME_BATCH_NOTES, { tabId }),
        sendToBackground(MSG.RESUME_BATCH_COMMENTS, { tabId }),
      ]);
      toggleBatchControls(true, false);
      showNotice('任务继续执行中。', 'info');
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  // 停止
  document.getElementById('btnStop').addEventListener('click', async () => {
    hideNotice();
    toggleBatchControls(true, false, true);
    try {
      await Promise.all([
        sendToBackground(MSG.STOP_BATCH_NOTES, { tabId }),
        sendToBackground(MSG.STOP_BATCH_COMMENTS, { tabId }),
      ]);
      toggleBatchControls(false, false);
      showProgress(false);
      showNotice('任务已停止。', 'info');
    } catch (err) {
      toggleBatchControls(true, false);
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  // 打开 Dashboard
  document.getElementById('btnDashboard').addEventListener('click', async () => {
    hideNotice();
    try {
      await sendToBackground(MSG.TOGGLE_DASHBOARD, { tabId });
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  // 快速导出
  document.getElementById('btnExport').addEventListener('click', async () => {
    hideNotice();
    try {
      await sendToTab(tabId, { action: MSG.EXPORT_JSON });
      showNotice('导出任务已发起。', 'info');
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  document.getElementById('btnMaintenance').addEventListener('click', async () => {
    if (platform === PLATFORM.UNKNOWN) {
      showNotice('请先打开小红书或抖音页面，再执行数据维护。', 'warning');
      return;
    }
    hideNotice();
    showProgress(true);
    updateProgress(0, 1, '正在整理历史数据...');
    try {
      const response = await sendToTab(tabId, { action: MSG.RUN_DATA_MAINTENANCE });
      showProgress(false);
      const stats = unwrapTabResponseData(response, response?.stats || {}) || {};
      showNotice(formatMaintenanceStats(stats), 'info');
      loadStats(tabId);
    } catch (err) {
      showProgress(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  });

  // ========== 飞轮工作台同步 ==========

  // 加载飞轮配置
  try {
    const flywheelConfig = await sendToBackground(MSG.GET_FLYWHEEL_CONFIG);
    if (flywheelConfig?.serverUrl) {
      document.getElementById('flywheelUrl').value = flywheelConfig.serverUrl;
    }
    updateFlywheelStatus(flywheelConfig?.serverUrl);
    loadExecutionStationStatus();
  } catch {}

  // 测试连接
  document.getElementById('btnFlywheelTest').addEventListener('click', async () => {
    const serverUrl = document.getElementById('flywheelUrl').value.trim();
    if (!serverUrl) {
      showNotice('请输入飞轮服务器地址。', 'warning');
      return;
    }
    hideNotice();
    const statusEl = document.getElementById('flywheelStatus');
    statusEl.textContent = '测试中...';
    statusEl.className = 'flywheel-status testing';
    try {
      const url = serverUrl.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://');
      const resp = await fetch(`${url}/api/collect/status`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        statusEl.textContent = '已连接';
        statusEl.className = 'flywheel-status connected';
        await sendToBackground(MSG.SAVE_FLYWHEEL_CONFIG, { config: { serverUrl, enabled: true } });
        showNotice('连接成功！飞轮工作台已就绪。', 'info');
      } else {
        statusEl.textContent = '连接失败';
        statusEl.className = 'flywheel-status disconnected';
        showNotice(`连接失败：服务器返回 ${resp.status}`, 'warning');
      }
    } catch (err) {
      statusEl.textContent = '连接失败';
      statusEl.className = 'flywheel-status disconnected';
      showNotice(`连接失败：${err.message || '无法连接'}`, 'warning');
    }
  });

  document.getElementById('btnStationPair').addEventListener('click', async () => {
    const serverUrl = document.getElementById('flywheelUrl').value.trim();
    const pairingCode = document.getElementById('stationPairingCode').value.trim();
    if (!serverUrl) {
      showNotice('请先配置工作台地址。', 'warning');
      return;
    }
    if (!pairingCode) {
      showNotice('请输入工作台生成的配对码。', 'warning');
      return;
    }
    const statusEl = document.getElementById('stationStatus');
    statusEl.textContent = '绑定中...';
    statusEl.className = 'flywheel-status testing';
    try {
      const result = await sendToBackground(MSG.REGISTER_EXECUTION_STATION, {
        serverUrl,
        pairingCode,
        browserLabel: navigator.userAgent || '',
      });
      if (!result?.success) {
        throw new Error(result?.error || '绑定失败');
      }
      document.getElementById('stationPairingCode').value = '';
      updateExecutionStationStatusUI({
        registered: true,
        identity: result.identity,
        heartbeat: result.heartbeat,
      });
      const stationRole = result?.identity?.role === 'manual' ? '手动采集工位' : '监控工位';
      showNotice(`${stationRole}已绑定，这个浏览器会按这条车道接任务。`, 'info');
    } catch (err) {
      statusEl.textContent = '绑定失败';
      statusEl.className = 'flywheel-status disconnected';
      showNotice(`绑定失败：${toFriendlyError(err)}`, 'warning');
    }
  });

  // 全部同步到飞轮（通过 content script 读取页面 IndexedDB 数据 + 推送）
  document.getElementById('btnSyncToFlywheel').addEventListener('click', async () => {
    const serverUrl = document.getElementById('flywheelUrl').value.trim();
    if (!serverUrl) {
      showNotice('请先配置飞轮服务器地址。', 'warning');
      return;
    }
    hideNotice();
    await sendToBackground(MSG.SAVE_FLYWHEEL_CONFIG, { config: { serverUrl, enabled: true } });
    showProgress(true);
    updateProgress(0, 1, '正在读取本地数据...');
    try {
      // 通过 content script 读取数据（popup 与页面 IndexedDB 属于不同 origin）
      const xhsTabs = await chrome.tabs.query({ url: '*://*.xiaohongshu.com/*' });
      let dataTabId = xhsTabs.find(t => t.id === tabId)?.id || xhsTabs[0]?.id;
      if (!dataTabId) {
        showProgress(false);
        showNotice('请先打开小红书页面，插件需要通过页面读取采集数据。', 'warning');
        return;
      }

      const [notesResp, commentsResp, authorsResp] = await Promise.all([
        sendToTab(dataTabId, { action: MSG.GET_ALL_NOTES }),
        sendToTab(dataTabId, { action: MSG.GET_ALL_COMMENTS }),
        sendToTab(dataTabId, { action: MSG.GET_ALL_AUTHORS }),
      ]);

      const notes = Array.isArray(notesResp) ? notesResp : (notesResp?.data || []);
      const comments = Array.isArray(commentsResp) ? commentsResp : (commentsResp?.data || []);
      const authors = Array.isArray(authorsResp) ? authorsResp : (authorsResp?.data || []);

      console.log('[飞轮同步] content script 返回:', { notes: notes?.length, comments: comments?.length, authors: authors?.length });

      if (!notes || notes.length === 0) {
        showProgress(false);
        showNotice('没有可同步的数据。请先在小红书页面采集笔记。', 'warning');
        return;
      }

      updateProgress(0, 1, `正在发送 ${notes.length} 条笔记到飞轮...`);

      // 数据映射
      const mappedNotes = notes.map(mapNoteToFlywheel);
      const mappedComments = (comments || []).map(mapCommentToFlywheel);
      const mappedAuthors = (authors || []).map(mapAuthorToFlywheel);

      const url = serverUrl.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://');
      const resp = await fetch(`${url}/api/collect/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: mappedNotes, comments: mappedComments, authors: mappedAuthors }),
        signal: AbortSignal.timeout(30000),
      });

      showProgress(false);
      if (resp.ok) {
        const data = await resp.json();
        const m = data.meta || {};
        const imported = data.imported || 0;
        const skipped = data.skipped || 0;
        showNotice(`发送完成：导入 ${imported} 条，跳过 ${skipped} 条（笔记 ${m.notesReceived || 0}，评论 ${m.commentsReceived || 0}，博主 ${m.authorsReceived || 0}）`, 'info');
      } else {
        const text = await resp.text().catch(() => '');
        showNotice(`发送失败：服务器返回 ${resp.status} ${text}`, 'warning');
      }
    } catch (err) {
      showProgress(false);
      showNotice(`发送失败：${err.message || '网络错误'}`, 'warning');
    }
  });

});

// ========== 进度显示 ==========

function showProgress(visible) {
  document.getElementById('progressSection').style.display = visible ? 'block' : 'none';
}

function updateProgress(current, total, status, event = {}, depthMode = null) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const displayStatus = event.message || status;
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressCount').textContent = `${current}/${total}`;
  document.getElementById('progressStatus').textContent = displayStatus;
  const depthHint = document.getElementById('progressDepthHint');
  if (depthHint && depthMode) {
    depthHint.textContent = depthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? '评论深度：全部展开' : '评论深度：仅一二级';
    depthHint.style.display = 'block';
  } else if (depthHint) {
    depthHint.style.display = 'none';
  }
  const stage = inferProgressStage({
    statusText: displayStatus,
    taskState: event.taskState,
    stage: event.stage || event.phase,
    current,
    total,
    error: event.error,
  });
  const stageBadge = document.getElementById('progressStageBadge');
  const progressTitle = document.getElementById('progressTitle');
  if (stageBadge) {
    stageBadge.textContent = stage.label;
    stageBadge.className = `task-stage-badge ${stage.className}`.trim();
  }
  if (progressTitle) {
    progressTitle.textContent = stage.description;
  }
}

function toggleBatchControls(show, paused, stopping = false) {
  const row = document.getElementById('batchControlRow');
  const pause = document.getElementById('btnPause');
  const resume = document.getElementById('btnResume');
  const stop = document.getElementById('btnStop');
  const stoppingBtn = document.getElementById('btnStopping');
  row.style.display = show ? 'flex' : 'none';
  if (!show) return;
  if (stopping) {
    pause.style.display = 'none';
    resume.style.display = 'none';
    stop.style.display = 'none';
    stoppingBtn.style.display = 'block';
  } else {
    stoppingBtn.style.display = 'none';
    stop.style.display = 'block';
    pause.style.display = paused ? 'none' : 'block';
    resume.style.display = paused ? 'block' : 'none';
  }
}

function syncButtonGroupActive(buttons, attrName, value) {
  buttons.forEach((btn) => {
    btn.classList.toggle('active', String(btn.dataset[attrName] || '') === String(value || ''));
  });
}

function getSelectedButtonValue(buttons, attrName, fallback) {
  const active = buttons.find((btn) => btn.classList.contains('active'));
  return active ? String(active.dataset[attrName] || fallback || '') : String(fallback || '');
}

function showNotice(message, type = 'info') {
  const el = document.getElementById('popupNotice');
  if (!el) return;
  el.textContent = message;
  el.className = `popup-notice ${type}`;
  el.style.display = 'block';
}

function hideNotice() {
  const el = document.getElementById('popupNotice');
  if (!el) return;
  el.textContent = '';
  el.className = 'popup-notice';
  el.style.display = 'none';
}

function detectPlatformByUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || '';
    if (host.includes('xiaohongshu.com')) return PLATFORM.XHS;
    if (host.includes('douyin.com')) return PLATFORM.DOUYIN;
    return PLATFORM.UNKNOWN;
  } catch {
    return PLATFORM.UNKNOWN;
  }
}

function applyPlatformUI(platform, options = {}) {
  const {
    canCollectPrimary = false,
    canCollectSecondary = false,
    canDownloadCommentImages = false,
    canBatchNotes = false,
    canBatchComments = false,
    secondaryAction = 'comment',
    isDyVideoPage = false,
  } = options;
  const subtitle = document.getElementById('platformSubtitle');
  const platformBadge = document.getElementById('platformBadge');
  const btnCollectNote = document.getElementById('btnCollectNote');
  const btnCollectComment = document.getElementById('btnCollectComment');
  const btnCommentImages = document.getElementById('btnCommentImages');
  const btnBatchNotes = document.getElementById('btnBatchNotes');
  const btnBatchComments = document.getElementById('btnBatchComments');

  const currentContentSection = document.getElementById('currentContentSection');

  if (!subtitle || !platformBadge || !btnCollectNote || !btnCollectComment || !btnCommentImages || !btnBatchNotes || !btnBatchComments) return;

  // 先恢复默认（小红书）
  subtitle.textContent = '小红书数据采集工具箱';
  platformBadge.textContent = '小红书';
  btnCollectNote.textContent = canCollectPrimary ? '采集当前笔记' : '先打开笔记页';
  btnCollectComment.textContent = canCollectSecondary ? '采集当前评论' : '先打开笔记页';
  btnCommentImages.textContent = '评论图片区';
  btnCommentImages.style.display = 'none';
  btnBatchNotes.textContent = '批量笔记';
  btnBatchComments.textContent = '批量评论';
  btnCollectNote.disabled = !canCollectPrimary;
  btnCollectComment.disabled = !canCollectSecondary;
  btnCommentImages.disabled = !canDownloadCommentImages;
  btnBatchNotes.disabled = !canBatchNotes;
  btnBatchComments.disabled = !canBatchComments;

  if (currentContentSection) {
    currentContentSection.style.display = (!canCollectPrimary && !canCollectSecondary) ? 'none' : '';
  }

  if (platform === PLATFORM.DOUYIN) {
    subtitle.textContent = '抖音内容采集模块（Beta）';
    platformBadge.textContent = '抖音';
    btnCollectNote.textContent = isDyVideoPage ? '采集当前视频' : '当前页不支持';
    btnCollectComment.textContent = canCollectSecondary
      ? (secondaryAction === 'author' ? '采集当前博主' : '采集当前评论')
      : '当前页不支持';
    btnCommentImages.textContent = '评论图片区';
    btnCommentImages.style.display = canDownloadCommentImages ? 'block' : 'none';
    btnBatchNotes.textContent = '批量视频';
    btnBatchComments.textContent = '批量评论';
    btnCollectNote.disabled = !canCollectPrimary;
    btnCollectComment.disabled = !canCollectSecondary;
    btnCommentImages.disabled = !canDownloadCommentImages;
    btnBatchNotes.disabled = !canBatchNotes;
    btnBatchComments.disabled = !canBatchComments;

    if (currentContentSection) {
      currentContentSection.style.display = (!canCollectPrimary && !canCollectSecondary) ? 'none' : '';
    }
    return;
  }

  if (platform === PLATFORM.UNKNOWN) {
    subtitle.textContent = '请在小红书或抖音页面使用';
    platformBadge.textContent = '未识别';
    btnCollectNote.disabled = true;
    btnCollectComment.disabled = true;
    btnCommentImages.disabled = true;
    btnBatchNotes.disabled = true;
    btnBatchComments.disabled = true;

    if (currentContentSection) {
      currentContentSection.style.display = 'none';
    }
  }
}

function renderPageContext(platform, mode, options = {}) {
  const { isDyVideoPage = false, isDyStrictDetailPage = false, isStableSearchList = false, tabUrl = '' } = options;
  const sceneEl = document.getElementById('contextSceneLabel');
  const hintEl = document.getElementById('contextHint');
  const tagsEl = document.getElementById('contextTags');
  if (!sceneEl || !hintEl || !tagsEl) return;

  const tags = [];
  let scene = '未识别页面';
  let hint = '请切换到小红书或抖音页面，再执行采集任务。';

  if (platform === PLATFORM.XHS) {
    if (mode === PAGE_MODE.DETAIL) {
      scene = '小红书笔记详情页';
      hint = '适合执行单篇笔记和单篇评论。评论图片区当前仅支持页内入口，不在 Popup 中提供。';
      tags.push('单条可用', '评论可用');
    } else if (mode === 'profile') {
      scene = '小红书博主页';
      hint = '适合批量笔记和批量评论。单篇动作请先进入具体笔记详情页。';
      tags.push('批量可用');
    } else if (mode === 'search') {
      scene = '小红书搜索/列表页';
      hint = '适合从当前可见列表发起批量笔记或批量评论。';
      tags.push('批量可用', '顺位采集');
    } else {
      scene = '小红书页面';
      hint = '当前页面可用能力取决于是否处于详情页或稳定列表页。';
    }
  } else if (platform === PLATFORM.DOUYIN) {
    if (isDyStrictDetailPage) {
      scene = '抖音详情页';
      hint = '单条视频、评论和评论图片区都适合在这里执行，稳定性最高。';
      tags.push('单条可用', '评论可用', '图片素材可用');
    } else if (isDyVideoPage) {
      scene = '抖音视频弹层页';
      hint = '适合采集当前视频与评论；评论图片区建议先进入真正详情页再执行。';
      tags.push('单条可用', '分享采集可用');
    } else if (mode === 'profile') {
      scene = '抖音博主页';
      hint = '适合博主采集、批量视频和批量评论。';
      tags.push('批量可用', '博主可用');
    } else if (mode === 'search') {
      scene = '抖音搜索结果页';
      hint = isStableSearchList
        ? '当前已识别为稳定搜索列表，可执行批量视频或批量评论。'
        : '当前仍未识别为稳定搜索列表，暂不建议从这里发起批量任务。';
      tags.push(isStableSearchList ? '搜索批量可用' : '搜索列表待确认', '顺位/Top N');
    } else {
      scene = '抖音页面';
      hint = '当前页面可用能力取决于是否处于详情页、弹层页或稳定搜索列表。';
    }
  }

  sceneEl.textContent = scene;
  hintEl.textContent = hint;
  tagsEl.innerHTML = tags.map((tag) => `<span class="context-tag">${escapeHtml(tag)}</span>`).join('');
}

function inferProgressStage({ statusText = '', taskState = '', stage = '', current = 0, total = 0, error = null } = {}) {
  const text = String(statusText || '').trim();
  const normalizedTaskState = String(taskState || '').trim();
  const normalizedStage = String(stage || '').trim();
  if (normalizedTaskState === 'error') {
    return { label: '失败', className: 'is-error', description: error?.message || '任务执行失败，请检查提示后重试。' };
  }
  if (normalizedTaskState === 'paused') {
    return { label: '已暂停', className: 'is-paused', description: '任务已暂停，可以继续或停止。' };
  }
  if (normalizedTaskState === 'stopping') {
    return { label: '停止中', className: 'is-warning', description: '任务正在完成当前步骤并安全停止。' };
  }
  if (/暂停/.test(text)) {
    return { label: '已暂停', className: 'is-paused', description: '任务已暂停，可以继续或停止。' };
  }
  if (normalizedStage === 'downloading' || /下载|打包/.test(text)) {
    return { label: '下载中', className: 'is-running', description: '当前任务已进入下载或打包阶段。' };
  }
  if (normalizedStage === 'discovering' || /扫描|发现|滚动/.test(text)) {
    return { label: '扫描中', className: 'is-running', description: '正在发现目标内容或扫描素材，请稍候。' };
  }
  if (normalizedStage === 'context_check' || /启动|准备/.test(text) || (current === 0 && total > 0)) {
    return { label: '准备中', className: '', description: '任务已经发起，正在建立本轮执行上下文。' };
  }
  if (total > 0 && current >= total) {
    return { label: '处理中', className: 'is-running', description: '任务已接近完成，请继续等待最终结果。' };
  }
  return { label: '进行中', className: 'is-running', description: '任务正在执行中，可在这里查看进度和控制。' };
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isDouyinStrictDetailUrl(url) {
  return /\/video\/[A-Za-z0-9_\-]+/.test(url)
    || /\/note\/[A-Za-z0-9_\-]+/.test(url);
}

function isDouyinVideoUrl(url) {
  return /\/video\/[A-Za-z0-9_\-]+/.test(url)
    || /[?&]modal_id=/.test(url)
    || /\/note\/[A-Za-z0-9_\-]+/.test(url);
}

// ========== 数据统计 ==========

async function loadStats(tabId) {
  try {
    const response = await sendToTab(tabId, { action: MSG.GET_STATS });
    const stats = unwrapTabResponseData(response, response) || {};
    if (stats) {
      document.getElementById('noteCount').textContent = stats.notes || 0;
      document.getElementById('commentCount').textContent = stats.comments || 0;
      document.getElementById('authorCount').textContent = stats.authors || 0;
    }
  } catch (e) {
    // 页面未加载完成或不在小红书页面
  }
}

// ========== 监听进度消息 ==========

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === MSG.PROGRESS) {
    showProgress(true);
    updateProgress(message.current, message.total, message.status, {
      ...message.progressEvent,
      taskState: message.taskState || message.progressEvent?.status,
      stage: message.stage || message.phase || message.progressEvent?.stage,
      error: message.error || message.progressEvent?.error,
      message: message.message || message.progressEvent?.message,
    });
    const paused = message.taskState === 'paused';
    toggleBatchControls(true, paused);
    if (message.taskState === 'error' && message.error?.message) {
      showNotice(message.error.message, 'warning');
    } else {
      hideNotice();
    }
  }
  if (message.action === MSG.COLLECT_DONE) {
    showProgress(false);
    toggleBatchControls(false, false);
    showNotice('采集完成。', 'info');
    // 重新加载统计
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) loadStats(tab.id);
    });
  }
});

function getModeFromUrl(url, platform = PLATFORM.XHS) {
  if (platform === PLATFORM.DOUYIN) {
    if (/\/user\/|\/@/.test(url)) return PAGE_MODE.PROFILE;
    if (/\/search/.test(url)) return PAGE_MODE.SEARCH;
    if (isDouyinVideoUrl(url)) return PAGE_MODE.DETAIL;
    return PAGE_MODE.UNKNOWN;
  }
  if (/\/user\/profile\//.test(url)) return PAGE_MODE.PROFILE;
  if (/\/search_result/.test(url)) return PAGE_MODE.SEARCH;
  if (/\/explore\/|\/discovery\/item\//.test(url)) return PAGE_MODE.DETAIL;
  return PAGE_MODE.UNKNOWN;
}

function getPageCapabilities(platform, mode, options = {}) {
  const {
    isDyVideoPage = false,
    isDyStrictDetailPage = false,
    isStableSearchList = false,
  } = options;
  if (platform === PLATFORM.XHS) {
    return {
      canCollectPrimary: mode === PAGE_MODE.DETAIL,
      canCollectSecondary: mode === PAGE_MODE.DETAIL,
      canDownloadCommentImages: false,
      canBatchNotes: mode === PAGE_MODE.SEARCH || mode === PAGE_MODE.PROFILE,
      canBatchComments: mode === PAGE_MODE.SEARCH || mode === PAGE_MODE.PROFILE,
      secondaryAction: 'comment',
      isDyVideoPage,
      isDyStrictDetailPage,
      isStableSearchList,
    };
  }

  if (platform === PLATFORM.DOUYIN) {
    return {
      canCollectPrimary: isDyVideoPage,
      canCollectSecondary: isDyVideoPage || mode === PAGE_MODE.PROFILE,
      canDownloadCommentImages: isDyStrictDetailPage,
      canBatchNotes: mode === PAGE_MODE.PROFILE || (mode === PAGE_MODE.SEARCH && isStableSearchList),
      canBatchComments: mode === PAGE_MODE.PROFILE || (mode === PAGE_MODE.SEARCH && isStableSearchList),
      secondaryAction: isDyVideoPage ? 'comment' : (mode === PAGE_MODE.PROFILE ? 'author' : 'none'),
      isDyVideoPage,
      isDyStrictDetailPage,
      isStableSearchList,
    };
  }

  return {
    canCollectPrimary: false,
    canCollectSecondary: false,
    canDownloadCommentImages: false,
    canBatchNotes: false,
    canBatchComments: false,
    secondaryAction: 'comment',
    isDyVideoPage,
    isDyStrictDetailPage,
    isStableSearchList,
  };
}

function getPrimaryActionWarning(platform, mode, capabilities) {
  if (platform === PLATFORM.DOUYIN && !capabilities.canCollectPrimary) {
    return '请先进入抖音视频详情页或弹层页，再点击“采集当前视频”。';
  }
  if (platform === PLATFORM.XHS && mode !== PAGE_MODE.DETAIL) {
    return '请先进入小红书笔记详情页，再采集当前笔记。';
  }
  return '当前页面暂不支持该操作。';
}

function getSecondaryActionWarning(platform, mode, capabilities) {
  if (platform === PLATFORM.DOUYIN && capabilities.secondaryAction === 'author') {
    return '请先进入抖音博主页，再采集当前博主。';
  }
  if (platform === PLATFORM.DOUYIN) {
    return '请先进入抖音视频详情页或弹层页，再采集当前评论。';
  }
  if (platform === PLATFORM.XHS && mode !== PAGE_MODE.DETAIL) {
    return '请先进入小红书笔记详情页，再采集当前评论。';
  }
  return '当前页面暂不支持该操作。';
}

function getBatchActionWarning(platform, mode, capabilities = {}) {
  if (platform === PLATFORM.DOUYIN) {
    if (mode === PAGE_MODE.DETAIL) {
      return '抖音批量任务请在搜索结果页或博主页发起，详情页只适合单条动作。';
    }
    if (mode === PAGE_MODE.SEARCH && !capabilities.isStableSearchList) {
      return '当前抖音页面还没形成稳定搜索列表，请等待列表加载完成后再发起批量任务。';
    }
    return '当前抖音页面还不是稳定批量场景，请切到搜索结果页或博主页后重试。';
  }
  if (platform === PLATFORM.XHS) {
    if (mode === PAGE_MODE.DETAIL) {
      return '小红书批量任务请在搜索结果页或博主页发起，详情页只适合单条动作。';
    }
    return '当前小红书页面还不是稳定批量场景，请切到搜索结果页或博主页后重试。';
  }
  return '当前页面暂不支持批量任务。';
}

function getErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string') return err.message;
  return String(err);
}

function isContextError(msg) {
  return /Extension context invalidated|context invalidated|Could not establish connection|Receiving end does not exist|message port closed/i.test(msg);
}

function toFriendlyError(err) {
  const msg = getErrorMessage(err);
  if (isContextError(msg)) {
    return '插件刚更新或页面连接已断开，请刷新当前页面后再点一次，刷新后即可继续。';
  }
  if (/未找到笔记数据|笔记详情页/.test(msg)) {
    return '当前不是完整笔记详情页，请先打开笔记详情后再采集。';
  }
  return msg || '操作失败，请稍后重试。';
}

function formatMaintenanceStats(stats = {}) {
  const notes = Number(stats.notes || 0);
  const comments = Number(stats.comments || 0);
  const authors = Number(stats.authors || 0);
  const mediaAssets = Number(stats.mediaAssets || 0);
  const total = Number(stats.total || 0);
  if (total <= 0) {
    return '数据维护完成：当前历史数据已是最新结构，无需回填。';
  }
  const parts = [];
  if (notes > 0) parts.push(`笔记 ${notes}`);
  if (comments > 0) parts.push(`评论 ${comments}`);
  if (authors > 0) parts.push(`博主 ${authors}`);
  if (mediaAssets > 0) parts.push(`媒体 ${mediaAssets}`);
  return `数据维护完成：共回填 ${total} 条，${parts.join('，')}。`;
}

function updateFlywheelStatus(serverUrl) {
  const statusEl = document.getElementById('flywheelStatus');
  if (!statusEl) return;
  if (serverUrl) {
    statusEl.textContent = '已配置';
    statusEl.className = 'flywheel-status configured';
  } else {
    statusEl.textContent = '未配置';
    statusEl.className = 'flywheel-status unconfigured';
  }
}

function updateExecutionStationStatusUI(status = {}) {
  const statusEl = document.getElementById('stationStatus');
  const hintEl = document.getElementById('stationHint');
  if (!statusEl || !hintEl) return;

  if (status.registered) {
    const identity = status.identity || {};
    const name = identity.displayName || identity.stationId || '已绑定';
    const role = identity.role === 'manual' ? 'manual' : 'monitor';
    const roleLabel = role === 'manual' ? '手动采集工位' : '监控工位';
    const accounts = Array.isArray(status.platformAccounts) ? status.platformAccounts : [];
    const healthyCount = accounts.filter((account) => account.healthStatus === 'healthy').length;
    const roleTaskHint = role === 'manual'
      ? `已发现 ${healthyCount} 个可用账号。当前是手动采集工位，只接采集控制台下发的手动任务；监控任务请绑定监控工位。`
      : `已发现 ${healthyCount} 个可用账号。当前是监控工位，只接监控中心下发的监控任务；手动任务请绑定手动采集工位。`;
    statusEl.textContent = `${name} · ${roleLabel}`;
    statusEl.className = 'flywheel-status connected';
    hintEl.textContent = healthyCount > 0
      ? roleTaskHint
      : `已绑定${roleLabel}；请先在 Cookie & 账号里保存可用账号，才能领取任务。`;
  } else {
    statusEl.textContent = '未绑定';
    statusEl.className = 'flywheel-status unconfigured';
    hintEl.textContent = '把内容工作台给的配对码填进来：来自采集控制台的是手动工位，来自监控中心的是监控工位。';
  }
}

async function loadExecutionStationStatus() {
  try {
    const status = await sendToBackground(MSG.GET_EXECUTION_STATION_STATUS);
    updateExecutionStationStatusUI(status || {});
  } catch {
    updateExecutionStationStatusUI({ registered: false });
  }
}

function updateCookieStatusUI(results) {
  if (!results) return;
  const platforms = [
    { key: 'xhs', badgeId: 'cookieXhsBadge' },
    { key: 'douyin', badgeId: 'cookieDouyinBadge' },
  ];
  for (const { key, badgeId } of platforms) {
    const badge = document.getElementById(badgeId);
    if (!badge) continue;
    const data = results[key];
    if (data?.count > 0) {
      const time = data.capturedAt ? new Date(data.capturedAt) : null;
      const timeStr = time ? `${time.getMonth() + 1}/${time.getDate()} ${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}` : '';
      badge.textContent = `${data.count} 条 ${timeStr}`;
      badge.className = 'cookie-platform-badge captured';
    } else {
      badge.textContent = '未获取';
      badge.className = 'cookie-platform-badge not-captured';
    }
  }
}

const BATCH_SETTINGS_DEFAULT_SUBTITLE = "选择采集数量和排序方式";

function resetBatchSettingsOverlay({
  subtitle = BATCH_SETTINGS_DEFAULT_SUBTITLE,
  showCountOptions = true,
  showSelectionModeLabel = true,
  showTopWrap = false,
  showTopHint = true,
  showCommentDepth = false,
  showCommentLimit = false,
  confirmText = "开始采集",
} = {}) {
  const overlay = document.getElementById("batchSettingsOverlay");
  const subtitleEl = document.querySelector(".batch-settings-subtitle");
  const countOptions = document.getElementById("countOptions");
  const selectionModeLabel = document.getElementById("selectionModeLabel");
  const topWrap = document.getElementById("topLikesWrap");
  const topHint = document.getElementById("topLikesHint");
  const topInput = document.getElementById("topLikesInput");
  const commentDepthLabel = document.getElementById("commentDepthLabel");
  const commentDepthWrap = document.getElementById("commentDepthWrap");
  const commentDepthHint = document.getElementById("commentDepthHint");
  const commentLimitWrap = document.getElementById("commentLimitWrap");
  const commentLimitInput = document.getElementById("commentLimitInput");
  const btnConfirm = document.getElementById("btnBatchConfirm");

  if (overlay) {
    overlay.style.display = showCountOptions || showCommentDepth || showCommentLimit ? "flex" : "none";
    overlay.setAttribute("aria-hidden", showCountOptions || showCommentDepth || showCommentLimit ? "false" : "true");
  }
  if (subtitleEl) subtitleEl.textContent = subtitle;
  if (countOptions) countOptions.style.display = showCountOptions ? "grid" : "none";
  if (selectionModeLabel) selectionModeLabel.style.display = showSelectionModeLabel ? "block" : "none";
  if (topWrap) topWrap.style.display = showTopWrap ? "flex" : "none";
  if (topHint) topHint.style.display = showTopHint ? "block" : "none";
  if (topInput) topInput.checked = false;
  if (commentDepthLabel) commentDepthLabel.style.display = showCommentDepth ? "block" : "none";
  if (commentDepthWrap) commentDepthWrap.style.display = showCommentDepth ? "grid" : "none";
  if (commentDepthHint) commentDepthHint.style.display = showCommentDepth ? "block" : "none";
  if (commentLimitWrap) commentLimitWrap.style.display = showCommentLimit ? "block" : "none";
  if (commentLimitInput) {
    commentLimitInput.style.display = showCommentLimit ? "block" : "none";
    commentLimitInput.value = "";
  }
  if (btnConfirm) btnConfirm.textContent = confirmText;
}

function getCommentDepthMode() {
  const checked = document.querySelector('#commentDepthWrap input[name="commentDepth"]:checked');
  return checked?.value === COMMENT_DEPTH_MODE.ALL_REPLIES
    ? COMMENT_DEPTH_MODE.ALL_REPLIES
    : COMMENT_DEPTH_MODE.TWO_LEVEL;
}

function openBatchSettings(type, platform = PLATFORM.XHS) {
  const overlay = document.getElementById("batchSettingsOverlay");
  const title = document.getElementById("batchSettingsTitle");
  const countOptions = document.getElementById("countOptions");
  const selectionModeLabel = document.getElementById("selectionModeLabel");
  const topWrap = document.getElementById("topLikesWrap");
  const topLabel = document.getElementById("topLikesLabel");
  const topHint = document.getElementById("topLikesHint");
  const topInput = document.getElementById("topLikesInput");
  const commentDepthLabel = document.getElementById("commentDepthLabel");
  const commentDepthWrap = document.getElementById("commentDepthWrap");
  const commentDepthHint = document.getElementById("commentDepthHint");
  const commentLimitWrap = document.getElementById("commentLimitWrap");
  const commentLimitInput = document.getElementById("commentLimitInput");
  const countButtons = [...document.querySelectorAll("#countOptions button")];
  const btnCancel = document.getElementById("btnBatchCancel");
  const btnConfirm = document.getElementById("btnBatchConfirm");
  const isDouyin = platform === PLATFORM.DOUYIN;
  const isDyCommentBatch = isDouyin && type === "comments";

  title.textContent = type === "comments"
    ? "批量采集评论"
    : (isDouyin ? "批量采集视频" : "批量采集笔记");
  resetBatchSettingsOverlay({
    subtitle: type === "comments"
      ? (isDyCommentBatch ? "选择采集数量、选取方式、评论上限与采集深度" : "选择采集数量、评论上限与采集深度")
      : BATCH_SETTINGS_DEFAULT_SUBTITLE,
    showCountOptions: true,
    showSelectionModeLabel: type === "notes" || isDyCommentBatch,
    showTopWrap: type === "notes" || isDyCommentBatch,
    showTopHint: type === "notes" || isDyCommentBatch,
    showCommentDepth: type === "comments",
    showCommentLimit: type === "comments",
  });
  if (isDyCommentBatch) {
    topLabel.textContent = "勾选后按点赞 Top N 选取；不勾选则按当前页面顺位逐条采集评论";
    topHint.textContent = "顺位模式更贴近你当前看到的作品顺序；Top N 更适合优先分析高互动作品。";
  } else {
    topLabel.textContent = "勾选后按点赞 Top N 选取；不勾选则按当前页面顺位采集";
    topHint.textContent = "顺位模式更贴近页面浏览顺序；Top N 更适合快速抓高互动内容。";
  }
  let count = 10;
  const showCommentDepth = type === "comments";

  countButtons.forEach((btn) => {
    if (isDyCommentBatch && btn.dataset.count === "50") {
      btn.style.display = "none";
    } else {
      btn.style.display = "";
    }
    btn.classList.toggle("active", btn.dataset.count === "10");
    btn.onclick = () => {
      count = parseInt(btn.dataset.count, 10);
      countButtons.forEach((item) => item.classList.remove("active"));
      btn.classList.add("active");
    };
  });

  return new Promise((resolve) => {
    const cleanup = (result) => {
      resetBatchSettingsOverlay({
        subtitle: BATCH_SETTINGS_DEFAULT_SUBTITLE,
        showCountOptions: false,
        showSelectionModeLabel: true,
        showTopWrap: false,
        showTopHint: true,
        showCommentDepth: false,
        showCommentLimit: false,
      });
      btnCancel.onclick = null;
      btnConfirm.onclick = null;
      resolve(result);
    };

    btnCancel.onclick = () => cleanup(null);
    btnConfirm.onclick = () => cleanup({
      count,
      topByLikes: (type === "notes" || isDyCommentBatch) ? topInput.checked : false,
      commentLimit: type === "comments" ? Math.max(0, parseInt(String(commentLimitInput.value || "").trim(), 10) || 0) : 0,
      commentDepthMode: showCommentDepth ? getCommentDepthMode() : COMMENT_DEPTH_MODE.TWO_LEVEL,
    });
    (isDyCommentBatch ? commentLimitInput : countButtons.find((btn) => btn.classList.contains("active")))?.focus?.();
  });
}
function openCurrentCommentLimitSettings({
  title: dialogTitle = "抖音当前评论设置",
  subtitle: dialogSubtitle = "设置当前评论上限与采集深度。留空或填 0 表示全部采集，包含二级评论。",
  confirmText = "开始采集",
} = {}) {
  const overlay = document.getElementById("batchSettingsOverlay");
  const title = document.getElementById("batchSettingsTitle");
  const commentLimitInput = document.getElementById("commentLimitInput");
  const btnCancel = document.getElementById("btnBatchCancel");

  title.textContent = dialogTitle;
  resetBatchSettingsOverlay({
    subtitle: dialogSubtitle,
    showCountOptions: false,
    showSelectionModeLabel: false,
    showTopWrap: false,
    showTopHint: false,
    showCommentDepth: true,
    showCommentLimit: true,
    confirmText,
  });

  return new Promise((resolve) => {
    const cleanup = (result) => {
      resetBatchSettingsOverlay({
        subtitle: BATCH_SETTINGS_DEFAULT_SUBTITLE,
        showCountOptions: false,
        showSelectionModeLabel: true,
        showTopWrap: false,
        showTopHint: true,
        showCommentDepth: false,
        showCommentLimit: false,
      });
      btnCancel.onclick = null;
      document.getElementById("btnBatchConfirm").onclick = null;
      resolve(result);
    };

    btnCancel.onclick = () => cleanup(null);
    document.getElementById("btnBatchConfirm").onclick = () => cleanup({
      maxTotal: Math.max(0, parseInt(String(commentLimitInput.value || "").trim(), 10) || 0),
      commentDepthMode: getCommentDepthMode(),
    });
    commentLimitInput.focus();
  });
}

// ========== Cookie & 账号管理（合并） ==========

const accountListEl = document.getElementById('accountList');
const accountCountEl = document.getElementById('accountCount');
const addAccountOverlay = document.getElementById('addAccountOverlay');
const btnAddAccount = document.getElementById('btnAddAccount');
const btnAccountCancel = document.getElementById('btnAccountCancel');
const btnAccountConfirm = document.getElementById('btnAccountConfirm');
const accountNameInput = document.getElementById('accountNameInput');
const accountCookieInput = document.getElementById('accountCookieInput');
const accountQuotaInput = document.getElementById('accountQuotaInput');

async function loadAccounts() {
  const response = await sendToBackground('getAccounts');
  const accounts = response?.accounts || [];
  accountCountEl.textContent = `${accounts.length} 个账号`;

  if (!accounts.length) {
    accountListEl.innerHTML = '<div style="color:#999;font-size:12px;padding:8px 0">暂无采集账号</div>';
    return;
  }

  accountListEl.innerHTML = accounts.map((a) => {
    const statusText = a.status === 'cooldown'
      ? `冷却中（${new Date(a.cooldownUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 恢复）`
      : a.status === 'disabled'
        ? '已禁用'
        : '可用';
    const statusColor = a.status === 'available' ? '#22c55e' : a.status === 'cooldown' ? '#f59e0b' : '#999';
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f0">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name || '未命名')}</div>
          <div style="font-size:11px;color:#999">${a.dailyQuotaUsed || 0}/${a.dailyQuotaLimit || 100} · <span style="color:${statusColor}">${escapeHtml(statusText)}</span></div>
        </div>
        <button class="popup-btn outline small" data-remove-account="${escapeHtml(a.accountId)}" style="font-size:11px;padding:4px 8px;color:#ef4444">删除</button>
      </div>`;
  }).join('');

  accountListEl.querySelectorAll('[data-remove-account]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const accountId = btn.dataset.removeAccount;
      await sendToBackground('removeAccount', { accountId });
      loadAccounts();
    });
  });
}

// 加载已保存的 cookie 状态
try {
  const storedResult = await sendToBackground(MSG.GET_STORED_PLATFORM_COOKIES);
  if (storedResult?.results) {
    updateCookieStatusUI(storedResult.results);
  }
} catch {}

// 一键获取 Cookie → 提取 + 自动保存为采集账号
document.getElementById('btnGetCookies').addEventListener('click', async () => {
  hideNotice();
  showProgress(true);
  updateProgress(0, 1, '正在获取 Cookie...');
  try {
    const result = await sendToBackground(MSG.GET_PLATFORM_COOKIES);
    showProgress(false);
    if (result.success) {
      updateCookieStatusUI(result.results);
      const xhs = result.results?.xhs;
      const dy = result.results?.douyin;

      // 自动保存小红书 cookie 为采集账号
      if (xhs?.count > 0) {
        const name = `小红书-${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
        await sendToBackground('addAccount', {
          name,
          cookieJson: JSON.stringify(xhs.cookies),
          platform: 'xhs',
          dailyQuotaLimit: 100,
        });
        loadAccounts();
      }

      const parts = [];
      if (xhs?.count > 0) parts.push(`小红书 ${xhs.count} 条`);
      if (dy?.count > 0) parts.push(`抖音 ${dy.count} 条`);
      const accountNote = xhs?.count > 0 ? '，小红书 Cookie 已自动保存为采集账号。' : '';
      showNotice(`获取成功：${parts.join('，')}${accountNote}`, 'info');
    } else {
      showNotice('获取 Cookie 失败，请确认已登录小红书或抖音。', 'warning');
    }
  } catch (err) {
    showProgress(false);
    showNotice(toFriendlyError(err), 'warning');
  }
});

if (btnAddAccount) {
  btnAddAccount.addEventListener('click', () => {
    addAccountOverlay.style.display = '';
    addAccountOverlay.setAttribute('aria-hidden', 'false');
    accountNameInput.value = '';
    accountCookieInput.value = '';
    accountQuotaInput.value = '100';
    accountNameInput.focus();
  });
}

if (btnAccountCancel) {
  btnAccountCancel.addEventListener('click', () => {
    addAccountOverlay.style.display = 'none';
    addAccountOverlay.setAttribute('aria-hidden', 'true');
  });
}

// 添加账号弹窗里的一键提取（保留，支持手动添加场景）
const btnExtractCookie = document.getElementById('btnExtractCookie');
if (btnExtractCookie) {
  btnExtractCookie.addEventListener('click', async () => {
    btnExtractCookie.textContent = '提取中...';
    btnExtractCookie.disabled = true;
    try {
      const result = await sendToBackground(MSG.GET_PLATFORM_COOKIES);
      const xhs = result?.results?.xhs;
      if (xhs?.count > 0) {
        accountCookieInput.value = JSON.stringify(xhs.cookies, null, 2);
        updateCookieStatusUI(result.results);
        if (!accountNameInput.value.trim()) {
          accountNameInput.value = `小红书账号-${new Date().toLocaleDateString('zh-CN')}`;
        }
      } else {
        alert('未检测到小红书 Cookie。\n请先在浏览器中打开 xiaohongshu.com 并登录，然后重试。');
      }
    } catch (e) {
      alert('提取失败：' + (e?.message || e));
    } finally {
      btnExtractCookie.textContent = '一键提取';
      btnExtractCookie.disabled = false;
    }
  });
}

if (btnAccountConfirm) {
  btnAccountConfirm.addEventListener('click', async () => {
    const name = (accountNameInput.value || '').trim();
    const cookieRaw = (accountCookieInput.value || '').trim();
    const dailyQuotaLimit = parseInt(accountQuotaInput.value) || 100;

    if (!name || !cookieRaw) {
      alert('请填写账号名称，并点击「一键提取」获取 Cookie');
      return;
    }

    let cookieJson;
    try {
      const parsed = JSON.parse(cookieRaw);
      cookieJson = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      const pairs = cookieRaw.split(';').map(s => s.trim()).filter(Boolean);
      if (pairs.length > 0 && pairs.every(p => p.includes('='))) {
        cookieJson = pairs.map(p => {
          const eqIdx = p.indexOf('=');
          return {
            name: p.slice(0, eqIdx).trim(),
            value: p.slice(eqIdx + 1).trim(),
            domain: '.xiaohongshu.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'lax',
          };
        });
      } else {
        alert('Cookie 格式不正确。请点击「一键提取」自动获取，或粘贴 JSON 格式的 Cookie。');
        return;
      }
    }

    if (!cookieJson.some(c => c.name)) {
      alert('Cookie 中没有有效字段，请重新提取。');
      return;
    }

    const response = await sendToBackground('addAccount', {
      name,
      cookieJson: JSON.stringify(cookieJson),
      platform: 'xhs',
      dailyQuotaLimit,
    });

    if (response?.success) {
      addAccountOverlay.style.display = 'none';
      addAccountOverlay.setAttribute('aria-hidden', 'true');
      loadAccounts();
    } else {
      alert(response?.error || '添加失败');
    }
  });
}

loadAccounts();
