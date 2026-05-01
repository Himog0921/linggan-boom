import '../extensionPublicPath.js';
import { MSG } from '../shared/constants.js';
import { collectNote, discoverWithScroll } from '../platforms/xhs/noteCollector.js';
import { collectComments, collectCommentImages } from '../platforms/xhs/commentCollector.js';
import { collectAuthor } from '../platforms/xhs/authorCollector.js';
import { BatchNoteController, BatchCommentController } from '../platforms/xhs/batchController.js';
import { ensureXhsCommentApiBridge } from '../platforms/xhs/commentApi.js';
import {
  injectUI,
  toggleStopButton,
  togglePauseResumeButtons,
  showToast,
  showCommentLimitDialog,
  showMediaDownloadDialog,
  showBatchSettingsDialog,
  ensureTaskControlBar,
  updateTaskControlBar,
  hideTaskControlBar,
} from '../platforms/xhs/uiInjector.js';
import { createBatchMessageHandlers } from './douyinBatchMessageHandlers.js';
import { CONTENT_PLATFORM, createContentRouter } from './contentRouter.js';
import { loadContentDataRuntimeFactory } from './contentDataRuntimeLoader.js';
import { loadDouyinRuntime } from './douyinRuntime.js';
import { createXhsPageController } from './xhsPageController.js';
import { reportDone, reportProgress, isContextValid, sendToBackground } from '../shared/messaging.js';
import { generateCsv, downloadFile, extractNoteId } from '../shared/utils.js';
import { createManagedTaskController } from '../shared/managedTaskController.js';
import { normalizeWorkbenchMessageResponse } from '../workbench/protocol/responseEnvelope.js';
import { assertActivePluginAuthorization } from '../workbench/runtime/pluginAuthorization.js';
import { normalizeContentMessageResponse } from './protocol/responseEnvelope.js';
import '../content.css';
import { initThemeManager } from '../themes/themeManager.js';

// 初始化主题管理器（content script 层级）
initThemeManager().catch(() => {});

async function callDouyinRuntime(method, ...args) {
  const douyinRuntime = await loadDouyinRuntime();
  const fn = douyinRuntime?.[method];
  if (typeof fn !== 'function') {
    throw new Error(`抖音运行时缺少方法：${method}`);
  }
  return fn(...args);
}

let contentDataRuntimeInstance = null;
let contentDataRuntimePromise = null;
let dashboardBridgeListenerRegistered = false;
let douyinAdapterRef = null;

async function assertPluginAuthorized() {
  return assertActivePluginAuthorization();
}

async function loadContentDataRuntime() {
  if (contentDataRuntimeInstance) {
    return contentDataRuntimeInstance;
  }
  if (!contentDataRuntimePromise) {
    contentDataRuntimePromise = loadContentDataRuntimeFactory()
      .then((createContentDataRuntime) => createContentDataRuntime({
        MSG,
        isDouyinPage,
        collectNote,
        collectComments,
        collectAuthor,
        collectDouyinVideo: (...args) => callDouyinRuntime('collectDouyinVideo', ...args),
    collectDouyinComments: (...args) => callDouyinRuntime('collectDouyinComments', ...args),
    downloadDouyinCommentImages: (...args) => callDouyinRuntime('downloadDouyinCommentImages', ...args),
    collectDouyinAuthor: (...args) => callDouyinRuntime('collectDouyinAuthor', ...args),
    BatchNoteController,
    reportDone,
    batchMessageHandlers,
    extractNoteId,
        generateCsv,
        downloadFile,
        sendToBackground,
        loadDouyinRuntime,
        discoverXhsSurfaceNotes: discoverWithScroll,
        discoverDouyinSurfaceTargets: (...args) => callDouyinRuntime('discoverDouyinBatchTargets', ...args),
        assertPluginAuthorized,
      }))
      .then((runtime) => {
        contentDataRuntimeInstance = runtime;
        return runtime;
      })
      .catch((error) => {
        contentDataRuntimePromise = null;
        throw error;
      });
  }
  return contentDataRuntimePromise;
}

function registerDashboardBridgeListener() {
  if (dashboardBridgeListenerRegistered) return;
  dashboardBridgeListenerRegistered = true;
  window.addEventListener('message', async (event) => {
    if (event.data?.source !== 'lgboom-dashboard') return;
    const runtime = await loadContentDataRuntime();
    await runtime.dashboardBridge.handleDashboardMessageEvent(event);
  });
}

function normalizeRuntimeMessageResponse(action, result) {
  return normalizeContentMessageResponse(
    action,
    normalizeWorkbenchMessageResponse(action, result),
  );
}

const xhsPageController = createXhsPageController({
  MSG,
  assertPluginAuthorized,
  collectComments,
  collectCommentImages,
  collectNote,
  collectAuthor,
  BatchNoteController,
  BatchCommentController,
  injectUI,
  toggleStopButton,
  togglePauseResumeButtons,
  showToast,
  showCommentLimitDialog,
  showMediaDownloadDialog,
  showBatchSettingsDialog,
  ensureTaskControlBar,
  updateTaskControlBar,
  hideTaskControlBar,
  isContextValid,
  reportDone,
  extractNoteId,
  sendToBackground,
  downloadNoteMediaFromRecord: async (note) => {
    const runtime = await loadContentDataRuntime();
    return runtime.downloadNoteMediaFromRecord(note);
  },
});

async function initDouyinPage() {
  const douyinRuntime = await loadDouyinRuntime();
  const { DouyinAdapter } = douyinRuntime;
  douyinAdapterRef = DouyinAdapter;
  DouyinAdapter.init();
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.lgboom-dy-btn, .lgboom-dy-task-btn');
    if (!btn) return;
    e.preventDefault();
    const action = btn.dataset.action;
    const params = btn.dataset.params ? JSON.parse(btn.dataset.params) : {};
    Promise.resolve(DouyinAdapter.handleButtonClick(action, params)).catch((err) => {
      console.error('[灵感爆爆爆] 抖音按钮动作失败:', err);
    });
  });
  console.log('[灵感爆爆爆] 抖音模式已启动');
}

function initXhsPage() {
  ensureXhsCommentApiBridge();
  xhsPageController.initPage();
  console.log('[灵感爆爆爆] 插件已加载');
}

const contentRouter = createContentRouter({
  getHostname: () => location.hostname,
  initByPlatform: {
    [CONTENT_PLATFORM.DOUYIN]: initDouyinPage,
    [CONTENT_PLATFORM.XHS]: initXhsPage,
  },
});

function isDouyinPage() {
  return contentRouter.resolvePlatform() === CONTENT_PLATFORM.DOUYIN;
}

// ========== 初始化 ==========

async function init() {
  await contentRouter.init();
}

registerDashboardBridgeListener();

// ========== 消息监听（来自 popup / background / dashboard） ==========

if (isContextValid()) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isContextValid()) return; // 扩展已重载，忽略消息

    // 工作台任务控制消息（停止/暂停）——直接处理，不经过 runtime messageHandlers
    if (message.action === MSG.WORKBENCH_TASK_CONTROL) {
      const batchNoteCtrl = xhsPageController.getBatchNoteCtrl?.();
      const batchCommentCtrl = xhsPageController.getBatchCommentCtrl?.();
      if (message.command === 'stop') {
        batchNoteCtrl?.stop?.();
        batchCommentCtrl?.stop?.();
      }
      sendResponse({ success: true });
      return true;
    }

    Promise.resolve(loadContentDataRuntime())
      .then((runtime) => {
        const handler = runtime.messageHandlers[message.action];
        if (!handler) {
          sendResponse(undefined);
          return;
        }
        return Promise.resolve(handler(message)).then((result) => {
          if (result?.toggleDashboard) {
            runtime.dashboardBridge.toggleDashboard();
            sendResponse({ success: true });
            return;
          }
          sendResponse(normalizeRuntimeMessageResponse(message.action, result));
        });
      })
      .catch((err) => {
        sendResponse(normalizeRuntimeMessageResponse(message.action, {
          success: false,
          error: err.message,
        }));
      });
    return true; // 保持消息通道
  });
}

const batchMessageHandlers = createBatchMessageHandlers({
  isDouyinPage,
  createManagedTaskController,
  batchCollectDouyinProfileVideos: (options) => callDouyinRuntime('batchCollectDouyinProfileVideos', options),
  batchCollectDouyinProfileComments: (options) => callDouyinRuntime('batchCollectDouyinProfileComments', options),
  BatchNoteController,
  BatchCommentController,
  reportProgress,
  reportDone,
  syncTaskUI: xhsPageController.syncTaskUI,
  startBatchTask: xhsPageController.startBatchTask,
  toggleStopButton,
  hideTaskControlBar,
  setActiveTaskType: xhsPageController.setActiveTaskType,
  pauseActiveTask: xhsPageController.pauseActiveTask,
  resumeActiveTask: xhsPageController.resumeActiveTask,
  getBatchNoteCtrl: xhsPageController.getBatchNoteCtrl,
  setBatchNoteCtrl: xhsPageController.setBatchNoteCtrl,
  getBatchCommentCtrl: xhsPageController.getBatchCommentCtrl,
  setBatchCommentCtrl: xhsPageController.setBatchCommentCtrl,
  getDouyinAdapter: () => douyinAdapterRef,
});

// ========== 启动 ==========

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
