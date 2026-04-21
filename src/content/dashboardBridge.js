import { normalizeCompatResponse } from '../shared/responseEnvelope.js';

export function createDashboardBridge({
  MSG,
  noteStore,
  commentStore,
  authorStore,
  downloadNoteMediaFromRecord,
} = {}) {
  let dashboardIframe = null;
  let dashboardOverlay = null;

  function toggleDashboard() {
    if (dashboardIframe && document.body.contains(dashboardIframe)) {
      dashboardIframe.remove();
      dashboardOverlay?.remove();
      dashboardIframe = null;
      dashboardOverlay = null;
      return;
    }

    dashboardOverlay = document.createElement('div');
    Object.assign(dashboardOverlay.style, {
      position: 'fixed',
      top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.4)',
      zIndex: '2147483640',
    });
    dashboardOverlay.addEventListener('click', toggleDashboard);

    dashboardIframe = document.createElement('iframe');
    dashboardIframe.src = chrome.runtime.getURL('dashboard.html');
    Object.assign(dashboardIframe.style, {
      position: 'fixed',
      top: '2%',
      left: '3%',
      width: '94%',
      height: '96%',
      border: 'none',
      borderRadius: '16px',
      boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
      zIndex: '2147483641',
      background: '#fff',
    });

    document.body.appendChild(dashboardOverlay);
    document.body.appendChild(dashboardIframe);
  }

  const dashboardMessageHandlers = {
    [MSG.GET_ALL_NOTES]: () => noteStore.getAll(),
    [MSG.GET_ALL_COMMENTS]: () => commentStore.getAll(),
    [MSG.GET_ALL_AUTHORS]: () => authorStore.getAll(),
    [MSG.DOWNLOAD_NOTE_MEDIA]: async (data) => {
      const noteId = data.noteId || '';
      if (!noteId) return { success: false, error: 'noteId required' };
      const note = await noteStore.getById(noteId);
      if (!note) return { success: false, error: 'note not found' };
      const summary = await downloadNoteMediaFromRecord(note);
      return { success: true, summary };
    },
    [MSG.CLEAR_ALL_NOTES]: () => noteStore.clear(),
    [MSG.CLEAR_ALL_COMMENTS]: () => commentStore.clear(),
    [MSG.CLEAR_ALL_AUTHORS]: () => authorStore.clear(),
    [MSG.DELETE_NOTE]: (data) => noteStore.deleteById(data.noteId),
    [MSG.DELETE_COMMENT]: (data) => commentStore.deleteById(data.id),
    [MSG.DELETE_AUTHOR]: (data) => authorStore.deleteById(data.userId),
    [MSG.SYNC_TO_WORKBENCH]: async (data) => {
      // 转发到 background script 进行实际同步
      // dashboard 无法直接访问外部 API（CORS限制）
      try {
        const result = await chrome.runtime.sendMessage({
          action: MSG.SYNC_TO_WORKBENCH,
          notes: Array.isArray(data.notes) ? data.notes : [],
          comments: Array.isArray(data.comments) ? data.comments : [],
          authors: Array.isArray(data.authors) ? data.authors : [],
        });
        return result || { success: false, error: 'No response from background' };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  };

  function normalizeDashboardMessageResponse(action, result) {
    const normalizedAction = String(action || '').trim();
    if (
      normalizedAction === MSG.GET_ALL_NOTES ||
      normalizedAction === MSG.GET_ALL_COMMENTS ||
      normalizedAction === MSG.GET_ALL_AUTHORS
    ) {
      return normalizeCompatResponse(result, {
        dataValue: Array.isArray(result) ? result : [],
      });
    }
    return normalizeCompatResponse(result);
  }

  async function handleDashboardMessageEvent(event) {
    if (event.data?.source !== 'lgboom-dashboard') return false;

    const { action, ...data } = event.data;
    const port = event.ports?.[0];
    if (!port) return true;

    const handler = dashboardMessageHandlers[action];
    if (handler) {
      try {
        const result = await handler(data);
        console.log(`[DashboardBridge] ${action} →`, Array.isArray(result) ? `${result.length} items` : result);
        port.postMessage(normalizeDashboardMessageResponse(action, result));
      } catch (err) {
        console.error(`[DashboardBridge] ${action} error:`, err);
        port.postMessage(normalizeDashboardMessageResponse(action, {
          success: false,
          error: err.message,
        }));
      }
    } else {
      console.warn(`[DashboardBridge] unknown action: ${action}`);
      port.postMessage(normalizeDashboardMessageResponse(action, {
        success: false,
        error: 'unknown_action',
      }));
    }
    return true;
  }

  function registerDashboardBridge() {
    window.addEventListener('message', handleDashboardMessageEvent);
  }

  return {
    toggleDashboard,
    registerDashboardBridge,
    handleDashboardMessageEvent,
  };
}
