import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import '../extensionPublicPath.js';
import { MSG, COMMENT_DEPTH_MODE } from '../shared/constants.js';
import { initThemeManager, setTheme, getCurrentTheme } from '../themes/themeManager.js';
import {
  PLATFORM, PAGE_MODE,
  detectPlatformByUrl, getModeFromUrl, getPageCapabilities,
  getPrimaryActionWarning, getSecondaryActionWarning, getBatchActionWarning,
  toFriendlyError, formatMaintenanceStats, inferProgressStage,
  sendToTab, sendToBackground,
  unwrapTabResponseData,
  mapNoteToFlywheel, mapCommentToFlywheel, mapAuthorToFlywheel,
  getPageContextText,
  isDouyinVideoUrl, isDouyinStrictDetailUrl,
} from './utils.js';
import { formatTaskLeaseIdleNotice } from '../workbench/runtime/taskLeaseClient.js';

import TabNav from './components/TabNav.jsx';
import StatsSection from './components/StatsSection.jsx';
import ActionButtons from './components/ActionButtons.jsx';
import ProgressSection from './components/ProgressSection.jsx';
import PageContextInfo from './components/PageContextInfo.jsx';
import Notice from './components/Notice.jsx';
import FlywheelSection from './components/FlywheelSection.jsx';
import CookieAccountSection from './components/CookieAccountSection.jsx';
import BatchSettingsModal from './components/BatchSettingsModal.jsx';
import AddAccountModal from './components/AddAccountModal.jsx';

const TABS = [
  { id: 'tab-collect', label: '采集', ariaControls: 'panel-collect' },
  { id: 'tab-data', label: '数据', ariaControls: 'panel-data' },
  { id: 'tab-config', label: '配置', ariaControls: 'panel-config' },
];

const TASK_LEASE_STORAGE_KEY = 'workbenchActiveTaskLease';

function loadIdleClaimSnapshot(value = null) {
  if (!value || typeof value !== 'object') return null;
  const hasReason = Boolean(
    String(value.idleReasonCode || '').trim()
    || String(value.idleReasonMessage || '').trim()
    || String(value.reason?.code || '').trim()
    || String(value.reason?.message || '').trim(),
  );
  if (!hasReason) return null;
  return { ...value };
}

export default function App() {
  const [currentTheme, setCurrentThemeState] = useState('default');
  const [activeTab, setActiveTab] = useState('tab-collect');

  const [tabId, setTabId] = useState(null);
  const [tabUrl, setTabUrl] = useState('');
  const [platform, setPlatform] = useState(PLATFORM.UNKNOWN);
  const [mode, setMode] = useState(PAGE_MODE.UNKNOWN);
  const [isDyVideoPage, setIsDyVideoPage] = useState(false);
  const [isDyStrictDetailPage, setIsDyStrictDetailPage] = useState(false);
  const [isStableSearchList, setIsStableSearchList] = useState(false);
  const [capabilities, setCapabilities] = useState({});

  const [stats, setStats] = useState({ notes: 0, comments: 0, authors: 0 });

  const [progressVisible, setProgressVisible] = useState(false);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressStatus, setProgressStatus] = useState('');
  const [progressStage, setProgressStage] = useState({ label: '', className: '', description: '' });
  const [progressDepthMode, setProgressDepthMode] = useState(null);

  const [batchControlsVisible, setBatchControlsVisible] = useState(false);
  const [batchPaused, setBatchPaused] = useState(false);
  const [batchStopping, setBatchStopping] = useState(false);

  const [notice, setNotice] = useState({ message: '', type: 'info', visible: false });
  const [idleClaimSnapshot, setIdleClaimSnapshot] = useState(null);

  const [flywheelUrl, setFlywheelUrl] = useState('');
  const [flywheelStatus, setFlywheelStatus] = useState('unconfigured');
  const [stationPairingCode, setStationPairingCode] = useState('');
  const [stationStatus, setStationStatus] = useState({ registered: false });

  const [cookieStatus, setCookieStatus] = useState({ xhs: null, douyin: null });
  const [accounts, setAccounts] = useState([]);

  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchModalType, setBatchModalType] = useState('notes');
  const [batchModalPlatform, setBatchModalPlatform] = useState(PLATFORM.XHS);
  const [batchModalMode, setBatchModalMode] = useState('single');
  const batchModalResolveRef = useRef(null);

  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try { await initThemeManager(); } catch {}
      const theme = (() => { try { return getCurrentTheme(); } catch { return 'default'; } })();
      if (mounted) {
        setCurrentThemeState(theme);
        if (theme === 'ac-ui') {
          document.body.setAttribute('data-theme', 'ac-ui');
        }
      }

      const [tab] = await chrome?.tabs?.query?.({ active: true, currentWindow: true }) || [];
      const url = tab?.url || '';
      const id = tab?.id;
      if (!mounted) return;

      setTabId(id);
      setTabUrl(url);

      let detectedPlatform = detectPlatformByUrl(url);
      let detectedMode = getModeFromUrl(url, detectedPlatform);
      let detectedIsDyVideo = detectedPlatform === PLATFORM.DOUYIN && isDouyinVideoUrl(url);
      let detectedIsDyStrict = detectedPlatform === PLATFORM.DOUYIN && isDouyinStrictDetailUrl(url);
      let detectedIsStableSearch = detectedMode === PAGE_MODE.SEARCH;

      if (id && detectedPlatform !== PLATFORM.UNKNOWN) {
        try {
          const response = await sendToTab(id, { action: MSG.GET_PAGE_CONTEXT }, { timeoutMs: 1800 });
          const pageContext = unwrapTabResponseData(response, response?.context || null) || response?.context || null;
          if (pageContext?.platform) {
            detectedPlatform = pageContext.platform;
            detectedMode = pageContext.mode || detectedMode;
            detectedIsDyVideo = Boolean(pageContext.isDyVideoPage);
            detectedIsDyStrict = Boolean(pageContext.isDyStrictDetailPage);
            detectedIsStableSearch = Boolean(pageContext.isStableSearchList);
          }
        } catch {}
      }

      const caps = {
        ...getPageCapabilities(detectedPlatform, detectedMode, {
          isDyVideoPage: detectedIsDyVideo,
          isDyStrictDetailPage: detectedIsDyStrict,
          isStableSearchList: detectedIsStableSearch,
        }),
      };

      if (!mounted) return;
      setPlatform(detectedPlatform);
      setMode(detectedMode);
      setIsDyVideoPage(detectedIsDyVideo);
      setIsDyStrictDetailPage(detectedIsDyStrict);
      setIsStableSearchList(detectedIsStableSearch);
      setCapabilities(caps);

      if (!id) {
        showNotice('没有找到当前页面，请切回小红书或抖音页面后重试。', 'warning');
        return;
      }
      if (detectedPlatform === PLATFORM.UNKNOWN) {
        showNotice('当前页面暂不支持，请打开小红书或抖音页面。', 'warning');
      }

      loadStats(id);

      try {
        const flywheelConfig = await sendToBackground?.(MSG.GET_FLYWHEEL_CONFIG) ?? null;
        if (!flywheelConfig) throw new Error('skip');
        if (flywheelConfig?.serverUrl) {
          setFlywheelUrl(flywheelConfig.serverUrl);
          setFlywheelStatus('configured');
        }
        loadStationStatus();
      } catch {}

      try {
        const storedResult = await sendToBackground(MSG.GET_STORED_PLATFORM_COOKIES);
        if (storedResult?.results) {
          setCookieStatus(storedResult.results);
        }
      } catch {}

      loadAccounts();
    }

    init();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    const readTaskLeaseSnapshot = async () => {
      try {
        const data = await chrome?.storage?.local?.get?.(TASK_LEASE_STORAGE_KEY);
        if (!mounted) return;
        setIdleClaimSnapshot(loadIdleClaimSnapshot(data?.[TASK_LEASE_STORAGE_KEY] || null));
      } catch {
        if (mounted) setIdleClaimSnapshot(null);
      }
    };

    readTaskLeaseSnapshot();

    const handleStorageChange = (changes, areaName) => {
      if (areaName !== 'local' || !changes?.[TASK_LEASE_STORAGE_KEY]) return;
      setIdleClaimSnapshot(loadIdleClaimSnapshot(changes[TASK_LEASE_STORAGE_KEY]?.newValue || null));
    };

    chrome?.storage?.onChanged?.addListener?.(handleStorageChange);
    return () => {
      mounted = false;
      chrome?.storage?.onChanged?.removeListener?.(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!chrome?.runtime?.onMessage) return;
    const listener = (message) => {
      if (message.action === MSG.PROGRESS) {
        setProgressVisible(true);
        setProgressCurrent(message.current || 0);
        setProgressTotal(message.total || 0);
        const displayStatus = message.message || message.progressEvent?.message || message.status || '';
        setProgressStatus(displayStatus);
        setProgressDepthMode(message.commentDepthMode || null);
        const stage = inferProgressStage({
          statusText: displayStatus,
          taskState: message.taskState || message.progressEvent?.status,
          stage: message.stage || message.phase || message.progressEvent?.stage,
          current: message.current || 0,
          total: message.total || 0,
          error: message.error || message.progressEvent?.error,
        });
        setProgressStage(stage);
        const paused = message.taskState === 'paused';
        setBatchControlsVisible(true);
        setBatchPaused(paused);
        setBatchStopping(false);
        if (message.taskState === 'error' && message.error?.message) {
          showNotice(message.error.message, 'warning');
        } else {
          hideNotice();
        }
      }
      if (message.action === MSG.COLLECT_DONE) {
        setProgressVisible(false);
        setBatchControlsVisible(false);
        setBatchPaused(false);
        setBatchStopping(false);
        showNotice('采集完成。', 'info');
        chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => {
          if (t?.id) loadStats(t.id);
        });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const showNotice = useCallback((message, type = 'info') => {
    setNotice({ message, type, visible: true });
  }, []);

  const hideNotice = useCallback(() => {
    setNotice({ message: '', type: 'info', visible: false });
  }, []);

  const idleClaimNotice = useMemo(
    () => formatTaskLeaseIdleNotice(idleClaimSnapshot),
    [idleClaimSnapshot],
  );
  const displayNotice = notice.visible ? notice : idleClaimNotice;

  const loadStats = useCallback(async (id) => {
    try {
      const response = await sendToTab(id, { action: MSG.GET_STATS });
      const stats = unwrapTabResponseData(response, response) || {};
      if (stats) {
        setStats({
          notes: stats.notes || 0,
          comments: stats.comments || 0,
          authors: stats.authors || 0,
        });
      }
    } catch {}
  }, []);

  const loadAccounts = useCallback(async () => {
    try {
      const response = await sendToBackground('getAccounts');
      setAccounts(response?.accounts || []);
    } catch {
      setAccounts([]);
    }
  }, []);

  const loadStationStatus = useCallback(async () => {
    try {
      const status = await sendToBackground(MSG.GET_EXECUTION_STATION_STATUS);
      setStationStatus(status || { registered: false });
    } catch {
      setStationStatus({ registered: false });
    }
  }, []);

  const handleThemeToggle = useCallback(async () => {
    const next = currentTheme === 'ac-ui' ? 'default' : 'ac-ui';
    try { await setTheme(next); } catch {}
    setCurrentThemeState(next);
    document.body.setAttribute('data-theme', next === 'ac-ui' ? 'ac-ui' : '');
  }, [currentTheme]);

  const handleCollectNote = useCallback(async () => {
    if (!capabilities.canCollectPrimary) {
      showNotice(getPrimaryActionWarning(platform, mode, capabilities), 'warning');
      return;
    }
    hideNotice();
    setProgressVisible(true);
    setProgressCurrent(0);
    setProgressTotal(1);
    setProgressStatus(platform === PLATFORM.DOUYIN ? '正在发起视频采集...' : '正在发起笔记采集...');
    try {
      await sendToTab(tabId, { action: MSG.COLLECT_SINGLE_NOTE });
    } catch (err) {
      setProgressVisible(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [capabilities, platform, mode, tabId, hideNotice, showNotice]);

  const handleCollectSecondary = useCallback(async () => {
    if (!capabilities.canCollectSecondary) {
      showNotice(getSecondaryActionWarning(platform, mode, capabilities), 'warning');
      return;
    }
    const isCommentScene = capabilities.secondaryAction === 'comment';
    let payload = { action: MSG.COLLECT_SINGLE_COMMENT };
    if (isCommentScene) {
      const settings = await openCommentLimitSettings({
        title: platform === PLATFORM.DOUYIN ? '抖音当前评论设置' : '小红书当前评论设置',
        subtitle: platform === PLATFORM.DOUYIN
          ? '设置当前视频评论上限与采集深度。留空或填 0 表示全部采集，包含二级评论。'
          : '设置当前笔记评论上限与采集深度。留空或填 0 表示全部采集，包含二级评论。',
        confirmText: '开始采集',
      });
      if (!settings) return;
      const commentDepthMode = settings.commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES
        ? COMMENT_DEPTH_MODE.ALL_REPLIES
        : COMMENT_DEPTH_MODE.TWO_LEVEL;
      payload = {
        action: MSG.COLLECT_SINGLE_COMMENT,
        maxTotal: settings.maxTotal,
        maxSubComments: commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : undefined,
        sortMode: 'hot',
        triggerSource: 'popup_manual',
        commentDepthMode,
      };
    }
    hideNotice();
    setProgressVisible(true);
    setProgressCurrent(0);
    setProgressTotal(1);
    const action = platform === PLATFORM.DOUYIN
      ? (isDyVideoPage ? MSG.COLLECT_SINGLE_COMMENT : MSG.COLLECT_AUTHOR)
      : MSG.COLLECT_SINGLE_COMMENT;
    setProgressStatus(platform === PLATFORM.DOUYIN
      ? (isDyVideoPage ? '正在发起评论采集...' : '正在发起博主采集...')
      : '正在发起评论采集...');
    try {
      await sendToTab(tabId, isCommentScene ? payload : { action });
    } catch (err) {
      setProgressVisible(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [capabilities, platform, mode, isDyVideoPage, tabId, hideNotice, showNotice]);

  const handleCommentImages = useCallback(async () => {
    if (!capabilities.canDownloadCommentImages) {
      showNotice('请先进入抖音严格详情页，再执行评论图片区下载。', 'warning');
      return;
    }
    const settings = await openCommentLimitSettings({
      title: '抖音评论图片区设置',
      subtitle: '设置评论扫描上限与采集深度。留空或填 0 表示尽量扫描全部评论并下载高清评论图片。',
      confirmText: '开始下载',
    });
    if (!settings) return;
    const commentDepthMode = settings.commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES
      ? COMMENT_DEPTH_MODE.ALL_REPLIES
      : COMMENT_DEPTH_MODE.TWO_LEVEL;
    hideNotice();
    setProgressVisible(true);
    setProgressCurrent(0);
    setProgressTotal(1);
    setProgressStatus('正在下载当前视频评论图片区...');
    try {
      const result = await sendToTab(tabId, {
        action: MSG.DOWNLOAD_CURRENT_COMMENT_IMAGES,
        maxTotal: settings.maxTotal,
        maxSubComments: commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : undefined,
        commentDepthMode,
      });
      setProgressVisible(false);
      if (result?.stopped) {
        showNotice(
          result?.downloaded > 0
            ? `评论图片区已停止，已打包 ${result?.downloaded || 0}/${result?.total || 0}，高清 ${result?.hdCount || 0}`
            : (result?.message || '评论图片区下载已停止'),
          'warning',
        );
      } else {
        showNotice(
          `评论图片区下载完成：成功 ${result?.downloaded || 0}/${result?.total || 0}，高清 ${result?.hdCount || 0}`,
          'info',
        );
      }
    } catch (err) {
      setProgressVisible(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [capabilities, tabId, hideNotice, showNotice]);

  const handleBatchNotes = useCallback(async () => {
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
      setProgressVisible(true);
      setProgressCurrent(0);
      setProgressTotal(settings.count);
      setProgressStatus('批量笔记任务已启动');
      setBatchControlsVisible(true);
      setBatchPaused(false);
      setBatchStopping(false);
    } catch (err) {
      setProgressVisible(false);
      setBatchControlsVisible(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [capabilities, platform, mode, tabId, hideNotice, showNotice]);

  const handleBatchComments = useCallback(async () => {
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
      setProgressVisible(true);
      setProgressCurrent(0);
      setProgressTotal(settings.count || 0);
      setProgressStatus('批量评论任务已启动');
      setProgressDepthMode(settings.commentDepthMode);
      setBatchControlsVisible(true);
      setBatchPaused(false);
      setBatchStopping(false);
    } catch (err) {
      setProgressVisible(false);
      setBatchControlsVisible(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [capabilities, platform, mode, tabId, hideNotice, showNotice]);

  const handlePause = useCallback(async () => {
    hideNotice();
    try {
      await Promise.all([
        sendToBackground(MSG.PAUSE_BATCH_NOTES, { tabId }),
        sendToBackground(MSG.PAUSE_BATCH_COMMENTS, { tabId }),
      ]);
      setBatchPaused(true);
      showNotice('任务已暂停，可随时继续。', 'info');
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [tabId, hideNotice, showNotice]);

  const handleResume = useCallback(async () => {
    hideNotice();
    try {
      await Promise.all([
        sendToBackground(MSG.RESUME_BATCH_NOTES, { tabId }),
        sendToBackground(MSG.RESUME_BATCH_COMMENTS, { tabId }),
      ]);
      setBatchPaused(false);
      showNotice('任务继续执行中。', 'info');
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [tabId, hideNotice, showNotice]);

  const handleStop = useCallback(async () => {
    hideNotice();
    setBatchStopping(true);
    try {
      await Promise.all([
        sendToBackground(MSG.STOP_BATCH_NOTES, { tabId }),
        sendToBackground(MSG.STOP_BATCH_COMMENTS, { tabId }),
      ]);
      setBatchControlsVisible(false);
      setProgressVisible(false);
      setBatchStopping(false);
      showNotice('任务已停止。', 'info');
    } catch (err) {
      setBatchStopping(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [tabId, hideNotice, showNotice]);

  const handleDashboard = useCallback(async () => {
    hideNotice();
    try {
      await sendToBackground(MSG.TOGGLE_DASHBOARD, { tabId });
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [tabId, hideNotice, showNotice]);

  const handleExport = useCallback(async () => {
    hideNotice();
    try {
      await sendToTab(tabId, { action: MSG.EXPORT_JSON });
      showNotice('导出任务已发起。', 'info');
    } catch (err) {
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [tabId, hideNotice, showNotice]);

  const handleMaintenance = useCallback(async () => {
    if (platform === PLATFORM.UNKNOWN) {
      showNotice('请先打开小红书或抖音页面，再执行数据维护。', 'warning');
      return;
    }
    hideNotice();
    setProgressVisible(true);
    setProgressCurrent(0);
    setProgressTotal(1);
    setProgressStatus('正在整理历史数据...');
    try {
      const response = await sendToTab(tabId, { action: MSG.RUN_DATA_MAINTENANCE });
      setProgressVisible(false);
      const mStats = unwrapTabResponseData(response, response?.stats || {}) || {};
      showNotice(formatMaintenanceStats(mStats), 'info');
      loadStats(tabId);
    } catch (err) {
      setProgressVisible(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [platform, tabId, hideNotice, showNotice, loadStats]);

  const handleFlywheelTest = useCallback(async () => {
    const serverUrl = flywheelUrl.trim();
    if (!serverUrl) {
      showNotice('请输入飞轮服务器地址。', 'warning');
      return;
    }
    hideNotice();
    setFlywheelStatus('testing');
    try {
      const url = serverUrl.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'http://');
      const resp = await fetch(`${url}/api/collect/status`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        setFlywheelStatus('connected');
        await sendToBackground(MSG.SAVE_FLYWHEEL_CONFIG, { config: { serverUrl, enabled: true } });
        showNotice('连接成功！飞轮工作台已就绪。', 'info');
      } else {
        setFlywheelStatus('disconnected');
        showNotice(`连接失败：服务器返回 ${resp.status}`, 'warning');
      }
    } catch (err) {
      setFlywheelStatus('disconnected');
      showNotice(`连接失败：${err.message || '无法连接'}`, 'warning');
    }
  }, [flywheelUrl, hideNotice, showNotice]);

  const handleStationPair = useCallback(async () => {
    const serverUrl = flywheelUrl.trim();
    const code = stationPairingCode.trim();
    if (!serverUrl) {
      showNotice('请先配置工作台地址。', 'warning');
      return;
    }
    if (!code) {
      showNotice('请输入工作台生成的配对码。', 'warning');
      return;
    }
    setStationStatus({ registered: false, pairing: true });
    try {
      const result = await sendToBackground(MSG.REGISTER_EXECUTION_STATION, {
        serverUrl,
        pairingCode: code,
        browserLabel: navigator.userAgent || '',
      });
      if (!result?.success) {
        throw new Error(result?.error || '绑定失败');
      }
      setStationPairingCode('');
      setStationStatus({
        registered: true,
        identity: result.identity,
        heartbeat: result.heartbeat,
      });
      const stationRole = result?.identity?.role === 'manual' ? '手动采集工位' : '监控工位';
      showNotice(`${stationRole}已绑定，这个浏览器会按这条车道接任务。`, 'info');
    } catch (err) {
      setStationStatus({ registered: false });
      showNotice(`绑定失败：${toFriendlyError(err)}`, 'warning');
    }
  }, [flywheelUrl, stationPairingCode, showNotice]);

  const handleSyncToFlywheel = useCallback(async () => {
    const serverUrl = flywheelUrl.trim();
    if (!serverUrl) {
      showNotice('请先配置飞轮服务器地址。', 'warning');
      return;
    }
    hideNotice();
    await sendToBackground(MSG.SAVE_FLYWHEEL_CONFIG, { config: { serverUrl, enabled: true } });
    setProgressVisible(true);
    setProgressCurrent(0);
    setProgressTotal(1);
    setProgressStatus('正在读取本地数据...');
    try {
      const xhsTabs = await chrome.tabs.query({ url: '*://*.xiaohongshu.com/*' });
      let dataTabId = xhsTabs.find(t => t.id === tabId)?.id || xhsTabs[0]?.id;
      if (!dataTabId) {
        setProgressVisible(false);
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

      if (!notes || notes.length === 0) {
        setProgressVisible(false);
        showNotice('没有可同步的数据。请先在小红书页面采集笔记。', 'warning');
        return;
      }

      setProgressStatus(`正在发送 ${notes.length} 条笔记到飞轮...`);

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

      setProgressVisible(false);
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
      setProgressVisible(false);
      showNotice(`发送失败：${err.message || '网络错误'}`, 'warning');
    }
  }, [flywheelUrl, tabId, hideNotice, showNotice]);

  const handleGetCookies = useCallback(async () => {
    hideNotice();
    setProgressVisible(true);
    setProgressCurrent(0);
    setProgressTotal(1);
    setProgressStatus('正在获取 Cookie...');
    try {
      const result = await sendToBackground(MSG.GET_PLATFORM_COOKIES);
      setProgressVisible(false);
      setCookieStatus(result.results || {});
      if (result.success) {
        const xhs = result.results?.xhs;
        const dy = result.results?.douyin;

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
      setProgressVisible(false);
      showNotice(toFriendlyError(err), 'warning');
    }
  }, [hideNotice, showNotice, loadAccounts]);

  const openBatchSettings = useCallback((type, plat) => {
    return new Promise((resolve) => {
      batchModalResolveRef.current = resolve;
      setBatchModalType(type);
      setBatchModalPlatform(plat);
      setBatchModalMode('batch');
      setBatchModalOpen(true);
    });
  }, []);

  const openCommentLimitSettings = useCallback((options) => {
    return new Promise((resolve) => {
      batchModalResolveRef.current = resolve;
      setBatchModalType('comments');
      setBatchModalPlatform(platform);
      setBatchModalMode('single');
      setBatchModalOpen(true);
      window._commentLimitOptions = options;
    });
  }, [platform]);

  const handleBatchModalConfirm = useCallback((settings) => {
    setBatchModalOpen(false);
    if (batchModalResolveRef.current) {
      batchModalResolveRef.current(settings);
      batchModalResolveRef.current = null;
    }
    window._commentLimitOptions = null;
  }, []);

  const handleBatchModalCancel = useCallback(() => {
    setBatchModalOpen(false);
    if (batchModalResolveRef.current) {
      batchModalResolveRef.current(null);
      batchModalResolveRef.current = null;
    }
    window._commentLimitOptions = null;
  }, []);

  const handleAddAccount = useCallback(async (accountData) => {
    try {
      const response = await sendToBackground('addAccount', accountData);
      if (response?.success) {
        setAddAccountModalOpen(false);
        loadAccounts();
      } else {
        alert(response?.error || '添加失败');
      }
    } catch (err) {
      alert(toFriendlyError(err));
    }
  }, [loadAccounts]);

  const { scene, hint, tags } = getPageContextText(platform, mode, { isDyVideoPage, isDyStrictDetailPage, isStableSearchList });

  const platformLabel = platform === PLATFORM.XHS ? '小红书' : platform === PLATFORM.DOUYIN ? '抖音' : '未识别';
  const subtitle = platform === PLATFORM.DOUYIN
    ? '抖音内容采集模块（Beta）'
    : platform === PLATFORM.XHS
      ? '小红书数据采集工具箱'
      : '请在小红书或抖音页面使用';
  const nextThemeLabel = currentTheme === 'ac-ui' ? '默认' : 'AC';
  const nextThemeTitle = currentTheme === 'ac-ui' ? '切换到默认主题' : '切换到 AC 主题';

  return (
    <div className="popup-container" data-theme={currentTheme === 'ac-ui' ? 'ac-ui' : undefined}>
      <header className="popup-header">
        <div className="header-copy">
          <h1>灵感爆爆爆</h1>
          <p className="subtitle" id="platformSubtitle">{subtitle}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="header-badge" id="platformBadge">{platformLabel}</span>
          <button
            id="themeToggle"
            className="theme-toggle-btn"
            onClick={handleThemeToggle}
            title={nextThemeTitle}
            aria-label={nextThemeTitle}
          >
            {nextThemeLabel}
          </button>
        </div>
      </header>

      <TabNav tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

      <main>
        {activeTab === 'tab-collect' && (
          <div id="panel-collect" className="tab-panel" role="tabpanel" aria-labelledby="tab-collect">
            <PageContextInfo
              platform={platform}
              scene={scene}
              hint={hint}
              tags={tags}
              capabilities={capabilities}
            />

            <div className="action-card">
              <div className="actions-section">
                <ActionButtons
                  platform={platform}
                  capabilities={capabilities}
                  onCollectNote={handleCollectNote}
                  onCollectSecondary={handleCollectSecondary}
                  onCommentImages={handleCommentImages}
                />
                <div className="btn-row">
                  <button
                    id="btnBatchNotes"
                    className="popup-btn primary small"
                    disabled={!capabilities.canBatchNotes}
                    onClick={handleBatchNotes}
                  >
                    {platform === PLATFORM.DOUYIN ? '批量视频' : '批量笔记'}
                  </button>
                  <button
                    id="btnBatchComments"
                    className="popup-btn primary small"
                    disabled={!capabilities.canBatchComments}
                    onClick={handleBatchComments}
                  >
                    批量评论
                  </button>
                </div>
              </div>
            </div>

            <ProgressSection
              visible={progressVisible}
              current={progressCurrent}
              total={progressTotal}
              status={progressStatus}
              stage={progressStage}
              depthMode={progressDepthMode}
            />

            {batchControlsVisible && (
              <div id="batchControlRow" className="btn-row">
                {batchStopping ? (
                  <button className="popup-btn small" disabled>
                    停止中...
                  </button>
                ) : (
                  <>
                    <button
                      id="btnPause"
                      className="popup-btn secondary small"
                      onClick={handlePause}
                      style={{ display: batchPaused ? 'none' : 'block' }}
                    >
                      暂停
                    </button>
                    <button
                      id="btnResume"
                      className="popup-btn primary small"
                      onClick={handleResume}
                      style={{ display: batchPaused ? 'block' : 'none' }}
                    >
                      继续
                    </button>
                    <button
                      id="btnStop"
                      className="popup-btn danger small"
                      onClick={handleStop}
                    >
                      停止
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="bottom-section">
              <button className="popup-btn outline" id="btnDashboard" onClick={handleDashboard}>
                打开工作台
              </button>
              <button className="popup-btn outline" id="btnExport" onClick={handleExport}>
                快速导出
              </button>
              <button className="popup-btn outline" id="btnMaintenance" onClick={handleMaintenance}>
                数据维护
              </button>
            </div>
          </div>
        )}

        {activeTab === 'tab-data' && (
          <div id="panel-data" className="tab-panel" role="tabpanel" aria-labelledby="tab-data">
            <StatsSection stats={stats} />
            <CookieAccountSection
              cookieStatus={cookieStatus}
              accounts={accounts}
              onGetCookies={handleGetCookies}
              onOpenAddAccount={() => setAddAccountModalOpen(true)}
              onRemoveAccount={async (accountId) => {
                await sendToBackground('removeAccount', { accountId });
                loadAccounts();
              }}
            />
          </div>
        )}

        {activeTab === 'tab-config' && (
          <div id="panel-config" className="tab-panel" role="tabpanel" aria-labelledby="tab-config">
            <FlywheelSection
              flywheelUrl={flywheelUrl}
              flywheelStatus={flywheelStatus}
              stationPairingCode={stationPairingCode}
              stationStatus={stationStatus}
              onUrlChange={setFlywheelUrl}
              onPairingCodeChange={setStationPairingCode}
              onTest={handleFlywheelTest}
              onPair={handleStationPair}
              onSync={handleSyncToFlywheel}
            />
          </div>
        )}
      </main>

      {displayNotice && <Notice {...displayNotice} onClose={hideNotice} />}

      <BatchSettingsModal
        open={batchModalOpen}
        type={batchModalType}
        platform={batchModalPlatform}
        mode={batchModalMode}
        commentLimitOptions={window._commentLimitOptions}
        onConfirm={handleBatchModalConfirm}
        onCancel={handleBatchModalCancel}
      />

      <AddAccountModal
        open={addAccountModalOpen}
        onClose={() => setAddAccountModalOpen(false)}
        onConfirm={handleAddAccount}
        onExtractCookie={async () => {
          try {
            const result = await sendToBackground(MSG.GET_PLATFORM_COOKIES);
            const xhs = result?.results?.xhs;
            return {
              success: Number(xhs?.count || 0) > 0,
              cookies: Number(xhs?.count || 0) > 0 ? xhs.cookies : null,
              allResults: result?.results,
              error: result?.success ? null : '未检测到小红书 Cookie',
            };
          } catch (err) {
            return { success: false, error: err.message };
          }
        }}
        onCookieResult={setCookieStatus}
      />
    </div>
  );
}
