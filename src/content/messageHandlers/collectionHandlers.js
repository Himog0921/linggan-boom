import { COMMENT_DEPTH_MODE } from '../../shared/constants.js';
import {
  MONITOR_RECORD_MODE,
  MONITOR_TASK_STRATEGY,
} from '../../workbench/protocol/schema.js';
import {
  buildDouyinSurfaceNoteRecords,
  buildXhsSurfaceNoteRecords,
} from '../../workbench/runtime/monitorTask.js';
import { buildDouyinSingleCommentRunPatch } from '../../platforms/douyin/commentTaskSupport.js';
import { checkXhsAuthorMonitorTarget } from '../../platforms/xhs/batchController.js';
import { checkDouyinAuthorMonitorTarget } from '../../platforms/douyin/batchController.js';

const buildAuthorBaselineShortfallNote = ({
  requestedCount = 0,
  discoveredCount = 0,
  succeededCount = 0,
} = {}) => {
  const requested = Math.max(0, Number(requestedCount || 0) || 0);
  const discovered = Math.max(0, Number(discoveredCount || 0) || 0);
  const succeeded = Math.max(0, Number(succeededCount || 0) || 0);
  if (requested <= 0 || discovered >= requested) return '';
  if (succeeded > 0 && succeeded !== discovered) {
    return `这轮原计划建档 ${requested} 条，但当前主页最终只发现 ${discovered} 条可采作品，实际写入 ${succeeded} 条，所以先按现有作品完成建档。`;
  }
  return `这轮原计划建档 ${requested} 条，但当前主页最终只发现 ${discovered} 条可采作品，所以先按现有作品完成建档。`;
};

const getMonitorMetaFromMessage = (msg = {}) => msg.monitorMeta || msg.externalTaskMeta?.monitorMeta || null;

const inferSingleNoteFailureReasonCode = (message = '') => {
  if (/未稳定就绪|未找到笔记数据|数据结构异常|加载/i.test(message)) {
    return 'page_data_not_ready';
  }
  if (/目标|expected|actual|不一致|mismatch/i.test(message)) {
    return 'target_mismatch';
  }
  if (/登录|授权|风控|安全验证|访问受限|300017/i.test(message)) {
    return 'account_or_platform_blocked';
  }
  return 'single_note_collection_failed';
};

const buildSingleNoteFailureDiagnostic = ({
  error,
  expectedNoteId = '',
  monitorMeta = null,
} = {}) => {
  const technicalMessage = String(error?.message || error || '单篇笔记采集失败').trim();
  const reasonCode = inferSingleNoteFailureReasonCode(technicalMessage);
  const pageUrl = String(globalThis.window?.location?.href || '').trim();
  const userMessage = reasonCode === 'page_data_not_ready'
    ? '目标笔记页面没有加载出可采数据'
    : reasonCode === 'target_mismatch'
      ? '打开的页面和目标笔记不一致'
      : reasonCode === 'account_or_platform_blocked'
        ? '当前账号或平台访问状态不适合继续采集'
        : '单篇笔记采集失败';
  return {
    stage: 'collecting',
    failureCategory: reasonCode === 'account_or_platform_blocked' ? 'waiting_resource' : 'retry_wait',
    reasonCode,
    userMessage,
    technicalMessage,
    recommendedAction: reasonCode === 'account_or_platform_blocked'
      ? '检查账号状态，恢复后再继续采集'
      : '稍后自动重试，或改用作者页重新定位该笔记',
    evidence: {
      expectedNoteId: String(expectedNoteId || '').trim(),
      pageUrl,
      monitorId: String(monitorMeta?.monitorId || '').trim(),
      taskStrategy: String(monitorMeta?.taskStrategy || '').trim(),
    },
  };
};

const resolveXhsSurfaceContainerSelector = () => {
  const pathname = String(globalThis.window?.location?.pathname || '').trim();
  return /\/user\/profile\//i.test(pathname) ? '#userPostedFeeds' : '.feeds-container';
};

function assertAuthorMonitorTarget({ isDouyinPage, monitorMeta = null } = {}) {
  if (!monitorMeta) return;
  const check = isDouyinPage()
    ? checkDouyinAuthorMonitorTarget(monitorMeta)
    : checkXhsAuthorMonitorTarget(monitorMeta, { mode: 'profile' });
  if (check?.ok || check?.code !== 'target_mismatch') return;
  const error = new Error(String(check.message || '当前页博主身份与任务目标不一致'));
  error.code = 'target_mismatch';
  error.reasonCode = 'target_mismatch';
  error.eventType = 'target_mismatch';
  error.userMessage = error.message;
  error.targetAuthorId = check.targetAuthorId || '';
  error.currentAuthorId = check.currentAuthorId || '';
  throw error;
}

export function createCollectionHandlers({
  MSG,
  isDouyinPage,
  ensurePluginAuthorized,
  collectNote,
  collectComments,
  collectAuthor,
  collectDouyinVideo,
  collectDouyinComments,
  collectDouyinAuthor,
  BatchNoteController,
  noteStore,
  reportDone,
  reportProgress,
  reportTaskError,
  batchMessageHandlers,
  extractNoteId,
  createRemoteRun,
  finalizeRemoteRun,
  collectionRunStore,
  remoteControlRegistry,
  discoverXhsSurfaceNotes,
  discoverDouyinSurfaceTargets,
} = {}) {
  return {
    [MSG.COLLECT_SINGLE_NOTE]: async (msg = {}) => {
      await ensurePluginAuthorized();
      const triggerSource = String(msg.triggerSource || 'popup_manual').trim() || 'popup_manual';
      const monitorMeta = getMonitorMetaFromMessage(msg);
      const expectedNoteId = String(
        msg.expectedNoteId
        || monitorMeta?.targetNoteId
        || '',
      ).trim().replace(/^xhs_/, '');
      const currentWindow = globalThis.window;

      if (isDouyinPage()) {
        const result = await collectDouyinVideo();
        if (!result?.ok) {
          throw new Error(result?.error || '抖音视频采集失败');
        }
        reportDone('note', 1, { platform: 'douyin' });
        return { success: true, note: result.data };
      }

      const createRemoteNoteRun = () => createRemoteRun({
        platform: 'xhs',
        triggerSource,
        remoteTaskMeta: msg.externalTaskMeta,
        taskType: 'singleNote',
        config: {
          expectedNoteId: expectedNoteId || undefined,
          monitorMeta: monitorMeta || undefined,
        },
      });

      const runNoteCollection = async (remoteRun = null) => {
        try {
          const note = await collectNote(currentWindow, {
            collectionRunId: remoteRun?.collectionRunId || '',
            expectedNoteId,
            monitorMeta,
          });
          await finalizeRemoteRun(remoteRun, 'done', {
            itemsPlanned: 1,
            itemsSucceeded: 1,
            itemsFailed: 0,
            targetIds: [String(note?.noteId || note?.platformContentId || expectedNoteId || '').trim()].filter(Boolean),
            contentIds: [String(note?.contentId || '').trim()].filter(Boolean),
          });
          reportDone('note', 1);
          return {
            success: true,
            note,
            collectionRunId: remoteRun?.collectionRunId || '',
          };
        } catch (error) {
          const diagnostic = buildSingleNoteFailureDiagnostic({
            error,
            expectedNoteId,
            monitorMeta,
          });
          await finalizeRemoteRun(remoteRun, 'failed', {
            error: diagnostic.technicalMessage,
            errorMessage: diagnostic.technicalMessage,
            userMessage: diagnostic.userMessage,
            diagnostic,
            itemsPlanned: 1,
            itemsSucceeded: 0,
            itemsFailed: 1,
            targetIds: [expectedNoteId].filter(Boolean),
          });
          throw error;
        }
      };

      const isRemoteDispatch = Boolean(String(msg.externalTaskMeta?.externalTaskId || '').trim());
      if (!isRemoteDispatch) {
        const note = await collectNote(currentWindow, {
          expectedNoteId,
          monitorMeta,
        });
        reportDone('note', 1);
        return { success: true, note };
      }

      const remoteRun = await createRemoteNoteRun();
      if (msg.asyncDispatch) {
        Promise.resolve()
          .then(() => runNoteCollection(remoteRun))
          .then(() => {
            reportProgress?.(1, 1, '完成', { taskState: 'done', collectionRunId: remoteRun?.collectionRunId });
          })
          .catch((error) => {
            console.error('[灵感爆爆爆] 远程单篇笔记采集失败:', error);
            reportTaskError?.(error, { collectionRunId: remoteRun?.collectionRunId, phase: 'collection' });
            if (remoteRun?.collectionRunId && collectionRunStore?.updateStatus) {
              collectionRunStore.updateStatus(remoteRun.collectionRunId, 'failed', {
                errorMessage: String(error?.message || error),
              }).catch(() => {});
            }
          });
        return {
          success: true,
          accepted: true,
          pending: true,
          collectionRunId: remoteRun?.collectionRunId || '',
        };
      }

      return runNoteCollection(remoteRun);
    },

    [MSG.COLLECT_SINGLE_COMMENT]: async (msg = {}) => {
      await ensurePluginAuthorized();
      const triggerSource = String(msg.triggerSource || 'popup_manual').trim() || 'popup_manual';
      const commentDepthMode = String(msg.commentDepthMode || COMMENT_DEPTH_MODE.TWO_LEVEL) === COMMENT_DEPTH_MODE.ALL_REPLIES
        ? COMMENT_DEPTH_MODE.ALL_REPLIES
        : COMMENT_DEPTH_MODE.TWO_LEVEL;
      if (isDouyinPage()) {
        const maxTotal = Math.max(0, Number(msg.maxTotal || 0) || 0);
        const maxSubComments = commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : Math.max(0, Number(msg.maxSubComments || 0) || 0);
        const sortMode = String(msg.sortMode || 'hot').trim() || 'hot';
        const createRemoteCommentRun = () => createRemoteRun({
          platform: 'douyin',
          triggerSource,
          remoteTaskMeta: msg.externalTaskMeta,
          taskType: 'singleComments',
          config: {
            maxTotal,
            maxSubComments,
            commentDepthMode,
            sortMode,
          },
        });
        const runCommentCollection = async (remoteRun = null) => {
          const controlBinding = remoteControlRegistry.bindRemoteControl({
            remoteRun,
            remoteTaskMeta: msg.externalTaskMeta,
          });
          try {
            const result = await collectDouyinComments({
              maxTotal,
              maxSubComments,
              sortMode,
              triggerSource,
              commentDepthMode,
              collectionRunId: remoteRun?.collectionRunId || '',
              manageCollectionRun: !remoteRun?.collectionRunId,
              shouldStop: controlBinding.control.shouldStop,
              waitIfPaused: controlBinding.control.waitIfPaused,
            });
            await finalizeRemoteRun(
              remoteRun,
              result?.stopped ? 'stopped' : 'done',
              buildDouyinSingleCommentRunPatch({
                stopped: Boolean(result?.stopped),
                totalComments: result.total || 0,
                note: result?.note || {},
              }),
            );
            reportDone('comment', result.total, { platform: 'douyin' });
            return {
              success: true,
              total: result.total,
              comments: result.comments,
              collectionRunId: remoteRun?.collectionRunId || result.collectionRunId || '',
            };
          } catch (error) {
            await finalizeRemoteRun(remoteRun, 'failed', {
              error: String(error?.message || error),
              itemsPlanned: 1,
              itemsSucceeded: 0,
              itemsFailed: 1,
            });
            throw error;
          } finally {
            controlBinding.release();
          }
        };

        if (msg.asyncDispatch) {
          const remoteRun = await createRemoteCommentRun();
          Promise.resolve()
            .then(() => runCommentCollection(remoteRun))
            .catch((error) => {
              console.error('[灵感爆爆爆] 远程抖音单条评论采集失败:', error);
            });
          return {
            success: true,
            accepted: true,
            pending: true,
            collectionRunId: remoteRun?.collectionRunId || '',
          };
        }

        const remoteRun = await createRemoteCommentRun();
        return runCommentCollection(remoteRun);
      }
      const result = await collectComments({
        noteId: extractNoteId(window.location.href),
        maxTotal: Math.max(0, Number(msg.maxTotal || 0) || 0),
        maxSubComments: commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : Math.max(0, Number(msg.maxSubComments || 0) || 0),
        commentDepthMode,
      });
      reportDone('comment', result.total);
      return { success: true, total: result.total };
    },

    [MSG.COLLECT_AUTHOR]: async (msg = {}) => {
      await ensurePluginAuthorized();
      const triggerSource = String(msg.triggerSource || 'popup_manual').trim() || 'popup_manual';
      const monitorMeta = getMonitorMetaFromMessage(msg);
      const isMonitorSurface = Boolean(monitorMeta?.surfaceOnly);
      const isAuthorBaselineMonitor = !isDouyinPage()
        && String(monitorMeta?.taskStrategy || '').trim() === MONITOR_TASK_STRATEGY.AUTHOR_BASELINE;
      const scanLimit = Math.max(1, Number(msg.count || monitorMeta?.scanLimit || monitorMeta?.limit || 30) || 30);
      const baselineBatchCount = Math.max(1, Number(monitorMeta?.scanLimit || monitorMeta?.limit || 50) || 50);
      const collectAuthorSurfaceRecords = async ({ platform, collectionRunId }) => {
        if (!isMonitorSurface || !collectionRunId || isAuthorBaselineMonitor) return [];
        const pageUrl = String(globalThis.window?.location?.href || '').trim();
        if (platform === 'douyin' && typeof discoverDouyinSurfaceTargets === 'function') {
          const targets = await discoverDouyinSurfaceTargets({
            maxCount: scanLimit,
            topByLikes: false,
          });
          const records = buildDouyinSurfaceNoteRecords(targets, {
            monitorMeta,
            collectionRunId,
            mode: MONITOR_RECORD_MODE.AUTHOR_SURFACE,
            limit: scanLimit,
            searchKeyword: '',
            searchPageUrl: '',
          });
          if (records.length > 0) await noteStore.bulkUpsert(records);
          return records;
        }
        if (platform === 'xhs' && typeof discoverXhsSurfaceNotes === 'function') {
          const cards = await discoverXhsSurfaceNotes(resolveXhsSurfaceContainerSelector(), 10, {
            expectedCount: scanLimit,
          });
          const records = buildXhsSurfaceNoteRecords(cards, {
            monitorMeta,
            collectionRunId,
            mode: MONITOR_RECORD_MODE.AUTHOR_SURFACE,
            limit: scanLimit,
            sourcePageUrl: pageUrl,
          });
          if (records.length > 0) await noteStore.bulkUpsert(records);
          return records;
        }
        return [];
      };
      const createRemoteAuthorRun = () => createRemoteRun({
        platform: isDouyinPage() ? 'douyin' : 'xhs',
        triggerSource,
        remoteTaskMeta: msg.externalTaskMeta,
        taskType: 'collectAuthor',
        config: monitorMeta ? {
          surfaceOnly: isMonitorSurface && !isAuthorBaselineMonitor,
          scanLimit,
          baselineBatchCount: isAuthorBaselineMonitor ? baselineBatchCount : undefined,
          monitorMeta: monitorMeta || undefined,
        } : {},
      });
      const runXhsBaselineBatchCollection = async (remoteRun = null) => {
        if (!isAuthorBaselineMonitor || !BatchNoteController) {
          return {
            planned: 0,
            succeeded: 0,
            failed: 0,
            targetIds: [],
            contentIds: [],
            stopped: false,
            completionNote: '',
            requestedCount: baselineBatchCount,
            discoveredCount: 0,
            shortfallCount: baselineBatchCount,
          };
        }
        const controller = new BatchNoteController();
        await controller.start('profile', () => {}, {
          count: baselineBatchCount,
          topByLikes: false,
          triggerSource,
          collectionRunId: remoteRun?.collectionRunId || '',
          monitorMeta,
          surfaceOnly: false,
        });
        const targetIds = (Array.isArray(controller.noteList) ? controller.noteList : [])
          .map((item) => String(item?.noteId || '').trim())
          .filter(Boolean);
        const contentIds = (Array.isArray(controller.collected) ? controller.collected : [])
          .map((item) => String(item?.contentId || '').trim())
          .filter(Boolean);
        return {
          planned: targetIds.length,
          succeeded: Array.isArray(controller.collected) ? controller.collected.length : 0,
          failed: Array.isArray(controller.failed) ? controller.failed.length : 0,
          targetIds,
          contentIds,
          stopped: Boolean(controller?._stoppedByUser),
          completionNote: buildAuthorBaselineShortfallNote({
            requestedCount: baselineBatchCount,
            discoveredCount: targetIds.length,
            succeededCount: Array.isArray(controller.collected) ? controller.collected.length : 0,
          }),
          requestedCount: baselineBatchCount,
          discoveredCount: targetIds.length,
          shortfallCount: Math.max(0, baselineBatchCount - targetIds.length),
        };
      };
      const runAuthorCollection = async (remoteRun = null) => {
        if (isDouyinPage()) {
          try {
            assertAuthorMonitorTarget({ isDouyinPage, monitorMeta });
            const result = await collectDouyinAuthor({
              collectionRunId: remoteRun?.collectionRunId || '',
              triggerSource,
              externalTaskMeta: msg.externalTaskMeta || {},
              monitorMeta,
            });
            if (!result?.ok) {
              throw new Error(result?.error || '抖音博主采集失败');
            }
            const surfaceRecords = await collectAuthorSurfaceRecords({
              platform: 'douyin',
              collectionRunId: remoteRun?.collectionRunId || '',
            });
            const surfaceTargetIds = surfaceRecords
              .map((record) => String(record.platformContentId || record.noteId || '').trim())
              .filter(Boolean);
            const surfaceContentIds = surfaceRecords
              .map((record) => String(record.contentId || '').trim())
              .filter(Boolean);
            const summaryPatch = {
              itemsPlanned: 1 + surfaceRecords.length,
              itemsSucceeded: 1 + surfaceRecords.length,
              itemsFailed: 0,
              targetIds: [
                String(result?.data?.platformAuthorId || result?.data?.userId || '').trim(),
                ...surfaceTargetIds,
              ].filter(Boolean),
              contentIds: surfaceContentIds,
            };
            if (isMonitorSurface) {
              summaryPatch.requestedCount = scanLimit;
              summaryPatch.discoveredCount = surfaceRecords.length;
              summaryPatch.shortfallCount = Math.max(0, scanLimit - surfaceRecords.length);
            }
            await finalizeRemoteRun(remoteRun, 'done', summaryPatch);
            reportDone('author', 1, { platform: 'douyin' });
            return {
              success: true,
              author: result.data,
              collectionRunId: remoteRun?.collectionRunId || '',
            };
          } catch (error) {
            await finalizeRemoteRun(remoteRun, 'failed', {
              error: String(error?.message || error),
              itemsPlanned: 1,
              itemsSucceeded: 0,
              itemsFailed: 1,
            });
            throw error;
          }
        }
        let author = null;
        let batchResult = {
          planned: 0,
          succeeded: 0,
          failed: 0,
          targetIds: [],
          contentIds: [],
          stopped: false,
          completionNote: '',
          requestedCount: 0,
          discoveredCount: 0,
          shortfallCount: 0,
        };
        try {
          assertAuthorMonitorTarget({ isDouyinPage, monitorMeta });
          author = await collectAuthor({
            collectionRunId: remoteRun?.collectionRunId || '',
            triggerSource,
            externalTaskMeta: msg.externalTaskMeta || {},
            monitorMeta,
          });
          batchResult = isAuthorBaselineMonitor
            ? await runXhsBaselineBatchCollection(remoteRun)
            : { planned: 0, succeeded: 0, failed: 0, targetIds: [], contentIds: [], stopped: false };
          const surfaceRecords = await collectAuthorSurfaceRecords({
            platform: 'xhs',
            collectionRunId: remoteRun?.collectionRunId || '',
          });
          const authorTargetId = String(author?.platformAuthorId || author?.userId || '').trim();
          const finalStatus = batchResult.stopped ? 'stopped' : 'done';
          await finalizeRemoteRun(remoteRun, finalStatus, {
            itemsPlanned: 1 + batchResult.planned + surfaceRecords.length,
            itemsSucceeded: 1 + batchResult.succeeded + surfaceRecords.length,
            itemsFailed: batchResult.failed,
            targetIds: [authorTargetId, ...batchResult.targetIds].filter(Boolean),
            contentIds: batchResult.contentIds,
            completionNote: batchResult.completionNote || undefined,
            requestedCount: batchResult.requestedCount || undefined,
            discoveredCount: batchResult.discoveredCount || undefined,
            shortfallCount: batchResult.shortfallCount || undefined,
          });
          reportDone('author', 1);
          return {
            success: true,
            author,
            stopped: batchResult.stopped,
            collectionRunId: remoteRun?.collectionRunId || '',
          };
        } catch (error) {
          const authorTargetId = String(author?.platformAuthorId || author?.userId || '').trim();
          const plannedItems = isAuthorBaselineMonitor
            ? 1 + Math.max(batchResult.planned, baselineBatchCount)
            : 1;
          const succeededItems = author ? 1 + batchResult.succeeded : 0;
          const failedItems = Math.max(
            1,
            plannedItems - succeededItems,
            batchResult.failed,
          );
          await finalizeRemoteRun(remoteRun, 'failed', {
            error: String(error?.message || error),
            itemsPlanned: plannedItems,
            itemsSucceeded: succeededItems,
            itemsFailed: failedItems,
            targetIds: [authorTargetId, ...batchResult.targetIds].filter(Boolean),
            contentIds: batchResult.contentIds,
          });
          throw error;
        }
      };

      if (msg.asyncDispatch) {
        const remoteRun = await createRemoteAuthorRun();
        Promise.resolve()
          .then(() => runAuthorCollection(remoteRun))
          .catch((error) => {
            console.error('[灵感爆爆爆] 远程博主采集失败:', error);
          });
        return {
          success: true,
          accepted: true,
          pending: true,
          collectionRunId: remoteRun?.collectionRunId || '',
        };
      }

      const remoteRun = await createRemoteAuthorRun();
      return runAuthorCollection(remoteRun);
    },

    ...batchMessageHandlers,
  };
}
