import { COMMENT_DEPTH_MODE } from '../shared/constants.js';
import { getUnifiedAuthorHandle } from '../shared/utils.js';
import {
  MONITOR_RECORD_MODE,
} from '../workbench/protocol/schema.js';
import {
  buildDouyinSurfaceNoteRecords,
  buildXhsSurfaceNoteRecords,
} from '../workbench/runtime/monitorTask.js';
import { buildDouyinSingleCommentRunPatch } from '../platforms/douyin/commentTaskSupport.js';
export function createContentMessageHandlers({
  MSG,
  isDouyinPage,
  collectNote,
  collectComments,
  collectAuthor,
  collectDouyinVideo,
  collectDouyinComments,
  downloadDouyinCommentImages,
  collectDouyinAuthor,
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
  packageWorkbenchResult,
  discoverXhsSurfaceNotes,
  discoverDouyinSurfaceTargets,
} = {}) {
  const normalizeCsvValue = (value) => {
    if (value == null) return '';
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
  };

  const normalizeRemoteTaskMeta = (meta = {}) => ({
    externalTaskId: String(meta.externalTaskId || '').trim(),
    externalTaskType: String(meta.externalTaskType || '').trim(),
    executorInstanceId: String(meta.executorInstanceId || '').trim(),
    protocolVersion: String(meta.protocolVersion || '').trim(),
    monitorMeta: meta.monitorMeta || null,
  });

  const getMonitorMetaFromMessage = (msg = {}) => msg.monitorMeta || msg.externalTaskMeta?.monitorMeta || null;

  const createRemoteRun = async ({
    platform,
    triggerSource,
    remoteTaskMeta,
    taskType,
    config = {},
    meta = {},
  } = {}) => {
    const externalTaskMeta = normalizeRemoteTaskMeta(remoteTaskMeta);
    if (!externalTaskMeta.externalTaskId || !collectionRunStore?.createRun) {
      return null;
    }
    const pageContext = typeof getPageContext === 'function' ? await getPageContext() : null;
    const pageType = String(pageContext?.pageType || pageContext?.mode || '').trim();
    const runMeta = {
      pageUrl: String(globalThis.window?.location?.href || '').trim(),
      ...meta,
    };
    if (remoteTaskMeta?.monitorMeta) {
      runMeta.monitorMeta = remoteTaskMeta.monitorMeta;
    }
    return collectionRunStore.createRun({
      externalTaskId: externalTaskMeta.externalTaskId,
      externalTaskType: externalTaskMeta.externalTaskType,
      executorInstanceId: externalTaskMeta.executorInstanceId,
      protocolVersion: externalTaskMeta.protocolVersion,
      platform: String(platform || pageContext?.platform || '').trim(),
      taskType: String(taskType || '').trim(),
      pageType,
      triggerSource: String(triggerSource || 'workbench_dispatch').trim() || 'workbench_dispatch',
      resultUploadStatus: 'pending_upload',
      lastHeartbeatAt: Date.now(),
      config,
      meta: runMeta,
    });
  };

  const finalizeRemoteRun = async (run, status, patch = {}) => {
    const runId = String(run?.collectionRunId || '').trim();
    if (!runId || !collectionRunStore) return;
    if (status === 'done') {
      await collectionRunStore.markDone(runId, patch);
      return;
    }
    if (status === 'stopped') {
      await collectionRunStore.markStopped(runId, patch);
      return;
    }
    if (status === 'failed') {
      await collectionRunStore.markFailed(runId, patch.error || '博主采集失败', patch);
    }
  };

  return {
    [MSG.COLLECT_SINGLE_NOTE]: async (msg = {}) => {
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
          await finalizeRemoteRun(remoteRun, 'failed', {
            error: String(error?.message || error),
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
          .catch((error) => {
            console.error('[灵感爆爆爆] 远程单篇笔记采集失败:', error);
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
          try {
            const result = await collectDouyinComments({
              maxTotal,
              maxSubComments,
              sortMode,
              triggerSource,
              commentDepthMode,
              collectionRunId: remoteRun?.collectionRunId || '',
              manageCollectionRun: !remoteRun?.collectionRunId,
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

    [MSG.DOWNLOAD_CURRENT_COMMENT_IMAGES]: async (msg = {}) => {
      if (!isDouyinPage()) {
        throw new Error('当前页面暂不支持从 Popup 下载评论图片区');
      }
      const triggerSource = String(msg.triggerSource || 'popup_manual').trim() || 'popup_manual';
      const commentDepthMode = String(msg.commentDepthMode || COMMENT_DEPTH_MODE.TWO_LEVEL) === COMMENT_DEPTH_MODE.ALL_REPLIES
        ? COMMENT_DEPTH_MODE.ALL_REPLIES
        : COMMENT_DEPTH_MODE.TWO_LEVEL;
      const maxTotal = Math.max(0, Number(msg.maxTotal || 0) || 0);
      const maxSubComments = commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : Math.max(0, Number(msg.maxSubComments || 0) || 0);
      const createRemoteImageRun = () => createRemoteRun({
        platform: 'douyin',
        triggerSource,
        remoteTaskMeta: msg.externalTaskMeta,
        taskType: 'commentImageDownload',
        config: {
          maxTotal,
          maxSubComments,
          commentDepthMode,
        },
      });
      const runImageDownload = async (remoteRun = null) => {
        try {
          const result = await downloadDouyinCommentImages({
            maxTotal,
            maxSubComments,
            commentDepthMode,
            collectionRunId: remoteRun?.collectionRunId || '',
          });
          const hasUsefulResult = Boolean(result?.success) || Number(result?.downloaded || 0) > 0 || Number(result?.total || 0) === 0;
          if (!hasUsefulResult && !result?.stopped) {
            throw new Error(result?.message || '评论图片区下载失败');
          }
          await finalizeRemoteRun(remoteRun, result?.stopped ? 'stopped' : 'done', {
            itemsPlanned: result.total || 0,
            itemsSucceeded: result.downloaded || 0,
            itemsFailed: result.failed || 0,
            totalComments: result.note?.totalComments || 0,
            totalImages: result.total || 0,
            scannedImages: result.scannedImages || result.total || 0,
            hdCount: result.hdCount || 0,
            sdCount: result.sdCount || 0,
            contentId: String(result?.note?.contentId || '').trim(),
            targetIds: [String(result?.note?.platformContentId || '').trim()].filter(Boolean),
            noImages: !result?.success && Number(result?.total || 0) === 0,
            zipName: String(result?.zipName || '').trim(),
          });
          return {
            success: true,
            stopped: Boolean(result?.stopped),
            total: result.total || 0,
            downloaded: result.downloaded || 0,
            failed: result.failed || 0,
            hdCount: result.hdCount || 0,
            sdCount: result.sdCount || 0,
            collectionRunId: remoteRun?.collectionRunId || result.collectionRunId || '',
          };
        } catch (error) {
          await finalizeRemoteRun(remoteRun, 'failed', {
            error: String(error?.message || error),
            itemsPlanned: 0,
            itemsSucceeded: 0,
            itemsFailed: 1,
          });
          throw error;
        }
      };

      if (msg.asyncDispatch) {
        const remoteRun = await createRemoteImageRun();
        Promise.resolve()
          .then(() => runImageDownload(remoteRun))
          .catch((error) => {
            console.error('[灵感爆爆爆] 远程抖音评论图片区下载失败:', error);
          });
        return {
          success: true,
          accepted: true,
          pending: true,
          collectionRunId: remoteRun?.collectionRunId || '',
        };
      }

      const remoteRun = await createRemoteImageRun();
      return runImageDownload(remoteRun);
    },

    [MSG.COLLECT_AUTHOR]: async (msg = {}) => {
      const triggerSource = String(msg.triggerSource || 'popup_manual').trim() || 'popup_manual';
      const monitorMeta = getMonitorMetaFromMessage(msg);
      const isMonitorSurface = Boolean(monitorMeta?.surfaceOnly);
      const scanLimit = Math.max(1, Number(msg.count || monitorMeta?.scanLimit || monitorMeta?.limit || 30) || 30);
      const collectAuthorSurfaceRecords = async ({ platform, collectionRunId }) => {
        if (!isMonitorSurface || !collectionRunId) return [];
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
          const cards = await discoverXhsSurfaceNotes('.feeds-container');
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
          surfaceOnly: isMonitorSurface,
          scanLimit,
          monitorMeta: monitorMeta || undefined,
        } : {},
      });
      const runAuthorCollection = async (remoteRun = null) => {
        if (isDouyinPage()) {
          try {
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
            await finalizeRemoteRun(remoteRun, 'done', {
              itemsPlanned: 1 + surfaceRecords.length,
              itemsSucceeded: 1 + surfaceRecords.length,
              itemsFailed: 0,
              targetIds: [String(result?.data?.platformAuthorId || result?.data?.userId || '').trim()].filter(Boolean),
            });
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
        try {
          const author = await collectAuthor({
            collectionRunId: remoteRun?.collectionRunId || '',
            triggerSource,
            externalTaskMeta: msg.externalTaskMeta || {},
            monitorMeta,
          });
          const surfaceRecords = await collectAuthorSurfaceRecords({
            platform: 'xhs',
            collectionRunId: remoteRun?.collectionRunId || '',
          });
          await finalizeRemoteRun(remoteRun, 'done', {
            itemsPlanned: 1 + surfaceRecords.length,
            itemsSucceeded: 1 + surfaceRecords.length,
            itemsFailed: 0,
            targetIds: [String(author?.platformAuthorId || author?.userId || '').trim()].filter(Boolean),
          });
          reportDone('author', 1);
          return {
            success: true,
            author,
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

    [MSG.GET_STATS]: async () => ({
      notes: await noteStore.count(),
      comments: await commentStore.count(),
      authors: await authorStore.count(),
    }),

    [MSG.GET_PAGE_CONTEXT]: async () => ({
      success: true,
      context: typeof getPageContext === 'function' ? await getPageContext() : null,
    }),

    [MSG.WORKBENCH_GET_RESULT_PACKAGE]: async (msg = {}) => {
      const collectionRunId = String(msg.collectionRunId || '').trim();
      const externalTaskId = String(msg.externalTaskId || '').trim();
      if (!collectionRunId && !externalTaskId) {
        return { success: false, error: 'collectionRunId or externalTaskId required' };
      }
      if (typeof packageWorkbenchResult !== 'function') {
        return { success: false, error: 'workbench result packager unavailable' };
      }
      const result = await packageWorkbenchResult({
        collectionRunId,
        externalTaskId,
      });
      return { success: true, result };
    },

    [MSG.GET_ALL_NOTES]: () => noteStore.getAll(),
    [MSG.GET_ALL_COMMENTS]: () => commentStore.getAll(),
    [MSG.GET_ALL_AUTHORS]: () => authorStore.getAll(),

    [MSG.DOWNLOAD_NOTE_MEDIA]: async (msg) => {
      const noteId = msg.noteId || '';
      if (!noteId) return { success: false, error: 'noteId required' };
      const note = await noteStore.getById(noteId);
      if (!note) return { success: false, error: 'note not found' };
      const summary = await downloadNoteMediaFromRecord(note);
      return { success: true, summary };
    },

    [MSG.DELETE_NOTE]: (msg) => noteStore.deleteById(msg.noteId),
    [MSG.DELETE_COMMENT]: (msg) => commentStore.deleteById(msg.id),
    [MSG.DELETE_AUTHOR]: (msg) => authorStore.deleteById(msg.userId),

    [MSG.CLEAR_ALL_NOTES]: () => noteStore.clear(),
    [MSG.CLEAR_ALL_COMMENTS]: () => commentStore.clear(),
    [MSG.CLEAR_ALL_AUTHORS]: () => authorStore.clear(),

    [MSG.EXPORT_CSV]: async (msg) => {
      const type = msg.type || 'notes';
      if (type === 'notes') {
        const notes = await noteStore.getAll();
        const headers = [
          'platform','contentId','platformContentId','noteId','url','canonicalUrl','title','bodyText','hashtags',
          'type','likes','collects','comments','shares','authorEntityId','authorId','authorName','releaseDate',
          'publishedAt','collectedAt','ipLocation','lastUpdateTime','topicIds','atUserList','shareRestricted',
          'authorFollowed','cover','videoDownloadUrl','mediaDownloadStatus','dataSource','triggerSource','shareShortUrl',
          'batchSelectionMode','batchRank','batchLikesSnapshot','searchKeyword','searchPageUrl',
          'collectionRunId','collectorVersion','rawSource','rawUrl','rawShareText','rawDomText','rawPayload',
          'dataQuality','qualityReason','sourceTier',
        ];
        const rows = notes.map((n) => headers.map((h) => normalizeCsvValue(n[h])));
        const csv = generateCsv(headers, rows);
        downloadFile(csv, `灵感爆爆爆_笔记_${Date.now()}.csv`);
      } else if (type === 'comments') {
        const comments = await commentStore.getAll();
        const headers = [
          'platform','commentEntityId','commentId','contentId','noteId','text','author','likes','profileUrl','location',
          'ipLocation','avatarUrl','authorId','parentCommentId','rootCommentId','level','searchKeyword','searchPageUrl',
          'replyToCommentId','replyToUserName','publishedAt','publishedAtText','collectedAt','sortMode','collectionRunId',
          'collectorVersion','rawSource','rawUrl','rawShareText','rawDomText','rawPayload',
          'dataQuality','qualityReason','sourceTier',
        ];
        const rows = comments.map((c) => headers.map((h) => normalizeCsvValue(c[h])));
        const csv = generateCsv(headers, rows);
        downloadFile(csv, `灵感爆爆爆_评论_${Date.now()}.csv`);
      } else if (type === 'authors') {
        const authors = await authorStore.getAll();
        const headers = [
          'platform','authorEntityId','platformAuthorId','userId','profileUrl','handle','secUserId','redId','name',
          'douyinId','fans','follows','interactions','location','description','ipLocation','accountStatus','followedByMe','collectedAt',
          'collectorVersion','rawSource','rawUrl','rawDomText','rawShareText','rawPayload',
          'dataQuality','qualityReason','sourceTier',
        ];
        const rows = authors.map((a) => headers.map((h) => {
          if (h === 'handle') return normalizeCsvValue(getUnifiedAuthorHandle(a));
          return normalizeCsvValue(a[h]);
        }));
        const csv = generateCsv(headers, rows);
        downloadFile(csv, `灵感爆爆爆_博主_${Date.now()}.csv`);
      }
      return { success: true };
    },

    [MSG.EXPORT_JSON]: async () => {
      const data = {
        notes: await noteStore.getAll(),
        comments: await commentStore.getAll(),
        authors: await authorStore.getAll(),
        exportedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(data, null, 2);
      downloadFile(json, `灵感爆爆爆_全部数据_${Date.now()}.json`, 'application/json');
      return { success: true };
    },

    [MSG.RUN_DATA_MAINTENANCE]: async () => {
      if (typeof backfillLegacyAiReadyFields !== 'function') {
        throw new Error('数据维护能力未接入');
      }
      const stats = await backfillLegacyAiReadyFields();
      return { success: true, stats };
    },

    [MSG.TOGGLE_DASHBOARD]: () => ({ success: true, toggleDashboard: true }),

    getDocumentCookie: async () => {
      return { success: true, cookieString: document.cookie || '' };
    },
  };
}
