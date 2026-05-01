import { collectionRunStore } from '../db/collectionRunStore.js';
import { BATCH_CONFIG, COMMENT_DEPTH_MODE } from '../shared/constants.js';
import { createCollectionRunHeartbeatReporter } from '../workbench/runtime/heartbeat.js';

export function createCommentCollectTaskController({
  collectComments,
  extractNoteId,
  showToast,
  syncTaskUI,
  startBatchTask,
  toggleStopButton,
  hideTaskControlBar,
  setActiveTaskType,
} = {}) {
  let task = null;
  const reportHeartbeat = createCollectionRunHeartbeatReporter({ collectionRunStore });

  function cleanup() {
    task = null;
    hideTaskControlBar();
    setActiveTaskType(null);
    toggleStopButton(false);
  }

  function buildProgress(partial = {}) {
    if (!task) return null;
    return {
      taskType: 'singleComments',
      taskState: partial.taskState || (task.isPaused ? 'paused' : 'running'),
      current: Number(partial.current ?? task.current ?? 0),
      total: Number(partial.total ?? task.total ?? 0),
      message: partial.message || '',
    };
  }

  async function markRun(status, payload = {}) {
    const runId = String(task?.collectionRunId || '').trim();
    if (!runId) return;
    if (status === 'done') {
      await collectionRunStore.markDone(runId, payload);
      return;
    }
    if (status === 'stopped') {
      await collectionRunStore.markStopped(runId, payload);
      return;
    }
    if (status === 'failed') {
      await collectionRunStore.markFailed(runId, payload.error || '评论采集任务失败', payload);
    }
  }

  return {
    isRunning() {
      return Boolean(task?.isRunning);
    },

    pause() {
      if (!task?.isRunning) return;
      task.isPaused = true;
      const progress = buildProgress({
        taskState: 'paused',
        message: `评论采集已暂停：已采集 ${task.current || 0} 条`,
      });
      if (progress) syncTaskUI(progress);
    },

    resume() {
      if (!task?.isRunning) return;
      task.isPaused = false;
      if (task.pauseResolve) {
        task.pauseResolve();
        task.pauseResolve = null;
      }
      const progress = buildProgress({
        taskState: 'running',
        message: `继续采集评论：已采集 ${task.current || 0} 条`,
      });
      if (progress) syncTaskUI(progress);
    },

    stop() {
      if (!task?.isRunning) return;
      task.stopRequested = true;
      task.isRunning = false;
      if (task.pauseResolve) {
        task.pauseResolve();
        task.pauseResolve = null;
      }
      const progress = buildProgress({
        taskState: 'running',
        message: '正在停止评论采集...',
      });
      if (progress) syncTaskUI(progress);
    },

    async start(settings = {}) {
      if (task?.isRunning) {
        showToast('评论采集进行中，可在右下角暂停或停止', 'warning');
        return { success: false, error: 'task_already_running' };
      }

      const noteId = extractNoteId(window.location.href) || '';
      const maxTotal = Math.max(0, Number(settings.maxComments || 0) || 0);
      const commentDepthMode = String(settings.commentDepthMode || COMMENT_DEPTH_MODE.TWO_LEVEL).trim() || COMMENT_DEPTH_MODE.TWO_LEVEL;
      const maxSubComments = commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 0 : BATCH_CONFIG.maxSubComments;
      const run = await collectionRunStore.createRun({
        platform: 'xhs',
        taskType: 'singleComments',
        pageType: 'noteDetail',
        triggerSource: 'manual_comment_collect',
        config: {
          noteId,
          maxTotal,
          commentDepthMode,
          maxSubComments,
        },
        meta: { pageUrl: window.location.href },
      });

      task = {
        collectionRunId: run.collectionRunId,
        isRunning: true,
        isPaused: false,
        stopRequested: false,
        pauseResolve: null,
        current: 0,
        total: maxTotal,
      };

      startBatchTask('singleComments');
      let lastToastAt = 0;
      const waitIfPaused = async () => {
        if (!task?.isPaused) return;
        await new Promise((resolve) => {
          if (task) task.pauseResolve = resolve;
        });
      };
      const shouldStop = () => Boolean(task?.stopRequested);

      try {
        const result = await collectComments({
          noteId,
          noteUrl: window.location.href,
          maxTotal,
          maxSubComments,
          commentDepthMode,
          collectionRunId: run.collectionRunId,
          shouldStop,
          waitIfPaused,
          onProgress: (progress) => {
            if (!task) return;
            task.current = Number(progress.current || task.current || 0);
            const next = buildProgress({
              current: task.current,
              total: maxTotal,
              message: progress.message || `已采集 ${task.current} 条评论`,
            });
            if (next) syncTaskUI(next);
            if (Date.now() - lastToastAt > 1400) {
              showToast(progress.message || `已采集 ${task.current} 条评论`, 'info');
              lastToastAt = Date.now();
            }
            void reportHeartbeat.report(run.collectionRunId, {
              taskState: task.isPaused ? 'paused' : 'running',
              stage: 'collecting',
              current: task.current,
              total: maxTotal,
              message: progress.message || `已采集 ${task.current} 条评论`,
            }).catch(() => {});
          },
        });

        if (shouldStop()) {
          await markRun('stopped', {
            itemsPlanned: maxTotal || task.current || 0,
            itemsSucceeded: 0,
            itemsFailed: 0,
            totalComments: result.total || 0,
            contentId: noteId ? `xhs_${noteId}` : '',
            targetIds: [noteId].filter(Boolean),
          });
          cleanup();
          showToast(`评论采集已停止：共 ${result.total || 0} 条`, 'warning');
          return { success: true, stopped: true, total: result.total || 0 };
        }

        await markRun('done', {
          itemsPlanned: 1,
          itemsSucceeded: 1,
          itemsFailed: 0,
          totalComments: result.total || 0,
          contentId: noteId ? `xhs_${noteId}` : '',
          targetIds: [noteId].filter(Boolean),
        });
        cleanup();
        showToast(`评论采集完成：共 ${result.total || 0} 条`, 'success');
        return { success: true, total: result.total || 0, comments: result.comments || [] };
      } catch (err) {
        await markRun('failed', {
          error: String(err?.message || err),
          itemsPlanned: 1,
          itemsSucceeded: 0,
          itemsFailed: 1,
          totalComments: task?.current || 0,
          contentId: noteId ? `xhs_${noteId}` : '',
          targetIds: [noteId].filter(Boolean),
        });
        cleanup();
        throw err;
      }
    },
  };
}
