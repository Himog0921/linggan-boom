import { createNoteMediaDownloadService } from './noteMediaDownload.js';
import { createContentMessageHandlers } from './messageHandlers.js';
import { createDashboardBridge } from './dashboardBridge.js';
import { detectPageType } from '../platforms/xhs/pageDetector.js';
import { noteStore } from '../db/noteStore.js';
import { commentStore } from '../db/commentStore.js';
import { authorStore } from '../db/authorStore.js';
import { collectionRunStore } from '../db/collectionRunStore.js';
import { mediaAssetStore } from '../db/mediaAssetStore.js';
import { backfillLegacyAiReadyFields } from '../db/legacyDataMaintenance.js';
import { buildCapabilityReport } from '../workbench/runtime/capabilityReportBuilder.js';
import { createResultPackager } from '../workbench/runtime/resultPackager.js';
import { REMOTE_ERROR_CODE } from '../workbench/protocol/schema.js';

export function createContentDataRuntime({
  MSG,
  isDouyinPage,
  assertPluginAuthorized,
  collectNote,
  collectComments,
  collectAuthor,
  collectDouyinVideo,
  collectDouyinComments,
  downloadDouyinCommentImages,
  collectDouyinAuthor,
  BatchNoteController,
  reportDone,
  batchMessageHandlers,
  extractNoteId,
  generateCsv,
  downloadFile,
  sendToBackground,
  loadDouyinRuntime,
  discoverXhsSurfaceNotes,
  discoverDouyinSurfaceTargets,
} = {}) {
  const { downloadNoteMediaFromRecord } = createNoteMediaDownloadService({
    MSG,
    noteStore,
    sendToBackground,
    collectNote,
    loadDouyinRuntime,
    extractNoteId,
  });

  const dashboardBridge = createDashboardBridge({
    MSG,
    noteStore,
    commentStore,
    authorStore,
    downloadNoteMediaFromRecord,
  });

  const resultPackager = createResultPackager({
    collectionRunStore,
    noteStore,
    commentStore,
    authorStore,
    mediaAssetStore,
  });

  async function getPageContext() {
    if (isDouyinPage()) {
      const douyinRuntime = await loadDouyinRuntime();
      const hasSecurityChallenge = douyinRuntime.detectDouyinSecurityChallenge({
        root: document,
        href: window.location.href,
      });
      if (hasSecurityChallenge) {
        return buildCapabilityReport({
          platform: 'douyin',
          mode: 'unknown',
          pageType: 'unknown',
          url: window.location.href,
          platformBlocked: true,
          blockReasonCode: REMOTE_ERROR_CODE.PLATFORM_SECURITY_CHALLENGE,
          blockReasonMessage: '检测到抖音安全验证，请先完成验证后继续操作',
          capabilities: {
            canCollectPrimary: false,
            canCollectSecondary: false,
            canCollectAuthor: false,
            canCollectComments: false,
            canDownloadCommentImages: false,
            canBatchNotes: false,
            canBatchComments: false,
            secondaryAction: 'none',
          },
        });
      }

      const page = douyinRuntime.detectDouyinPageType();
      const searchContext = douyinRuntime.detectDouyinSearchBatchContext(window);
      const isDyVideoPage = page.type === 'videoDetail' || page.type === 'noteDetail';
      const isDyStrictDetailPage = douyinRuntime.isStrictDouyinDetailPage(window.location.href);
      const mode = page.type === 'profile'
        ? 'profile'
        : page.type === 'search'
          ? 'search'
          : isDyVideoPage
            ? 'detail'
            : 'unknown';

      return buildCapabilityReport({
        platform: 'douyin',
        mode,
        pageType: page.type,
        url: page.url,
        isDyVideoPage,
        isDyStrictDetailPage,
        isStableSearchList: Boolean(searchContext.stableSearchList),
        searchKeyword: searchContext.keyword || '',
        capabilities: {
          canCollectPrimary: isDyVideoPage,
          canCollectSecondary: isDyVideoPage || page.type === 'profile',
          canCollectAuthor: page.type === 'profile',
          canCollectComments: isDyVideoPage,
          canDownloadCommentImages: isDyStrictDetailPage,
          canBatchNotes: page.type === 'profile' || (page.type === 'search' && Boolean(searchContext.stableSearchList)),
          canBatchComments: page.type === 'profile' || (page.type === 'search' && Boolean(searchContext.stableSearchList)),
          secondaryAction: isDyVideoPage ? 'comment' : (page.type === 'profile' ? 'author' : 'none'),
        },
      });
    }

    const page = detectPageType();
    const mode = page.type === 'noteDetail'
      ? 'detail'
      : page.type === 'profile'
        ? 'profile'
        : page.type === 'search'
          ? 'search'
          : 'unknown';

    return buildCapabilityReport({
      platform: 'xhs',
      mode,
      pageType: page.type,
      url: page.url,
      isStableSearchList: mode === 'search',
      capabilities: {
        canCollectPrimary: mode === 'detail',
        canCollectSecondary: mode === 'detail' || mode === 'profile',
        canCollectAuthor: mode === 'profile',
        canCollectComments: mode === 'detail',
        canDownloadCommentImages: false,
        canBatchNotes: mode === 'search' || mode === 'profile',
        canBatchComments: mode === 'search' || mode === 'profile',
        secondaryAction: mode === 'profile' ? 'author' : (mode === 'detail' ? 'comment' : 'none'),
      },
    });
  }

  const messageHandlers = createContentMessageHandlers({
    MSG,
    isDouyinPage,
    assertPluginAuthorized,
    collectNote,
    collectComments,
    collectAuthor,
    collectDouyinVideo,
    collectDouyinComments,
    downloadDouyinCommentImages,
    collectDouyinAuthor,
    BatchNoteController,
    noteStore,
    commentStore,
    authorStore,
    reportDone,
    batchMessageHandlers,
    extractNoteId,
    downloadNoteMediaFromRecord,
    generateCsv,
    downloadFile,
    backfillLegacyAiReadyFields,
    getPageContext,
    collectionRunStore,
    discoverXhsSurfaceNotes,
    discoverDouyinSurfaceTargets,
    packageWorkbenchResult: async ({ collectionRunId = '', externalTaskId = '' } = {}) => {
      if (collectionRunId) {
        return resultPackager.packageByCollectionRunId(collectionRunId);
      }
      return resultPackager.packageByExternalTaskId(externalTaskId);
    },
  });

  return {
    noteStore,
    commentStore,
    authorStore,
    downloadNoteMediaFromRecord,
    dashboardBridge,
    messageHandlers,
  };
}
