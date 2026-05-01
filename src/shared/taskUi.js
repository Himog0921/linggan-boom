import {
  taskbarShellStyle as acTaskbarShellStyle,
  toastStyle as acToastStyle,
  TOKENS as AC_TOKENS,
} from '../themes/ac-ui/tokens.js';
import { TASK_STATE } from './constants.js';

const TASK_STATE_VALUES = new Set(Object.values(TASK_STATE));

export const DEFAULT_TOKENS = {
  ink: '#121212',
  surface: '#ffdd57',
  card: '#fffdf7',
  line: '#121212',
  muted: '#4f4f4f',
  running: '#d8f4ff',
  paused: '#fff0a8',
  stopping: '#ffd2a8',
  done: '#d4f5d3',
  error: '#ffd4d4',
  neutral: '#fff6cf',
};

export function normalizeTaskState(taskState, fallback = TASK_STATE.RUNNING) {
  const normalizedState = String(taskState || '').trim();
  return TASK_STATE_VALUES.has(normalizedState) ? normalizedState : fallback;
}

export function resolveTaskState({
  taskState = '',
  status = '',
  fallback = TASK_STATE.RUNNING,
} = {}) {
  const normalizedTaskState = normalizeTaskState(taskState, '');
  if (normalizedTaskState) return normalizedTaskState;
  return normalizeTaskState(status, fallback);
}

export function isPausedTaskState(taskState) {
  return normalizeTaskState(taskState, '') === TASK_STATE.PAUSED;
}

export function isTerminalTaskState(taskState) {
  const normalizedState = normalizeTaskState(taskState, '');
  return normalizedState === TASK_STATE.DONE
    || normalizedState === TASK_STATE.ERROR
    || normalizedState === TASK_STATE.IDLE;
}

export function describeTaskProgress({ current = 0, total = 0 } = {}) {
  const normalizedCurrent = Number.isFinite(Number(current)) ? Math.max(0, Math.floor(Number(current))) : 0;
  const normalizedTotal = Number.isFinite(Number(total)) ? Math.max(0, Math.floor(Number(total))) : 0;

  if (normalizedTotal > 0) {
    return `${normalizedCurrent}/${normalizedTotal}`;
  }
  if (normalizedCurrent > 0) {
    return `已处理 ${normalizedCurrent}`;
  }
  return '进行中';
}

function hasProgressSummaryText(text = '') {
  return /已处理\s*\d+|\d+\s*\/\s*\d+|成功\s*\d+\s*\/\s*\d+|评论\s*\d+\s*条/.test(String(text || ''));
}

export function inferTaskStage({ taskState = '', message = '', current = 0, total = 0 } = {}) {
  const state = normalizeTaskState(taskState);
  const text = String(message || '').trim();

  if (state === TASK_STATE.PAUSED) {
    const progressHint = current > 0 ? `（${describeTaskProgress({ current, total })}）` : '';
    return { label: '已暂停', tone: 'paused', helper: `任务已暂停${progressHint}，可继续或停止。` };
  }
  if (state === TASK_STATE.IDLE) {
    const progressHint = current > 0 ? `（${describeTaskProgress({ current, total })}）` : '';
    return { label: '已停止', tone: 'paused', helper: `任务已停止${progressHint}，可查看当前结果。` };
  }
  if (state === TASK_STATE.STOPPING) {
    return { label: '停止中', tone: 'stopping', helper: '正在完成当前步骤并安全收尾。' };
  }
  if (state === TASK_STATE.DONE) {
    return { label: '已完成', tone: 'done', helper: '任务已经完成，可以查看结果。' };
  }
  if (state === TASK_STATE.ERROR) {
    return { label: '失败', tone: 'error', helper: '任务执行失败，请查看提示后重试。' };
  }
  if (/采集|处理|展开|拉取|写入/.test(text)) {
    return { label: '进行中', tone: 'running', helper: '任务正在执行当前步骤。' };
  }
  if (/打包|下载/.test(text)) {
    return { label: '下载中', tone: 'running', helper: '正在下载或打包本轮结果。' };
  }
  if (/扫描|发现|滚动|定位/.test(text)) {
    return { label: '扫描中', tone: 'running', helper: '正在扫描目标内容，请稍候。' };
  }
  if (/启动|准备/.test(text) || (!text && current === 0 && total > 0)) {
    return { label: '准备中', tone: 'neutral', helper: '任务已发起，正在建立执行上下文。' };
  }
  return { label: '进行中', tone: 'running', helper: '任务正在执行中。' };
}

export function describeTaskDetail({ taskState = '', message = '', current = 0, total = 0 } = {}) {
  const state = normalizeTaskState(taskState);
  const text = String(message || '').trim();
  const progress = current > 0 ? describeTaskProgress({ current, total }) : '';
  const stage = inferTaskStage({ taskState: state, message: text, current, total });

  if ((state === TASK_STATE.PAUSED || state === TASK_STATE.IDLE) && text) {
    if (!progress || hasProgressSummaryText(text)) return text;
    return `${text}（${progress}）`;
  }

  if (text) return text;
  return stage.helper;
}

export function shouldDelayTaskbarHide({ taskState = '', badgeText = '' } = {}) {
  if (isTerminalTaskState(taskState)) return true;
  return /已完成|已停止|失败/.test(String(badgeText || ''));
}

export function getBadgeColor(tone = 'neutral', theme = 'default') {
  if (theme === 'ac-ui') {
    switch (tone) {
      case 'running': return '#C0E8F9';
      case 'paused': return '#F6E27F';
      case 'stopping': return '#F6E27F';
      case 'done': return '#ABEDC6';
      case 'error': return '#FFBCB5';
      default: return '#f2f2f2';
    }
  }
  switch (tone) {
    case 'running': return DEFAULT_TOKENS.running;
    case 'paused': return DEFAULT_TOKENS.paused;
    case 'stopping': return DEFAULT_TOKENS.stopping;
    case 'done': return DEFAULT_TOKENS.done;
    case 'error': return DEFAULT_TOKENS.error;
    default: return DEFAULT_TOKENS.neutral;
  }
}

export function applyTaskbarShellStyle(node, { width = 320, theme = 'default' } = {}) {
  if (theme === 'ac-ui') {
    Object.assign(node.style, acTaskbarShellStyle(width));
    return;
  }
  Object.assign(node.style, {
    position: 'fixed',
    right: '20px',
    bottom: '24px',
    zIndex: '2147483646',
    width: `${width}px`,
    minHeight: '182px',
    padding: '12px',
    display: 'none',
    boxSizing: 'border-box',
    background: DEFAULT_TOKENS.surface,
    border: `3px solid ${DEFAULT_TOKENS.line}`,
    borderRadius: '14px',
    boxShadow: `6px 6px 0 ${DEFAULT_TOKENS.line}`,
    color: DEFAULT_TOKENS.ink,
    fontFamily: "'Arial Black','Segoe UI',sans-serif",
  });
}

export function buildTaskbarMarkup(title = '任务控制台', theme = 'default') {
  const isAc = theme === 'ac-ui';
  const lineColor = isAc ? '#ddd' : DEFAULT_TOKENS.line;
  const neutralBg = isAc ? '#f2f2f2' : DEFAULT_TOKENS.neutral;
  const ink = isAc ? AC_TOKENS.text : DEFAULT_TOKENS.ink;
  const muted = isAc ? '#888' : DEFAULT_TOKENS.muted;
  const fontFamily = isAc
    ? "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"
    : "'Arial Black','Segoe UI',sans-serif";
  const btnRadius = isAc ? '5px' : '8px';
  const btnBorder = isAc ? `1px solid ${lineColor}` : `2px solid ${lineColor}`;
  const btnShadow = isAc ? '0 2px 4px rgba(0,0,0,0.06)' : `2px 2px 0 ${lineColor}`;
  const btnHoverShadow = isAc ? '0 4px 8px rgba(0,0,0,0.08)' : `3px 3px 0 ${lineColor}`;
  const progressTrackBg = isAc ? '#e8e8e8' : '#fff';
  const progressTrackBorder = isAc ? '1px solid #ddd' : `2px solid ${lineColor}`;
  const progressFillBg = isAc
    ? 'linear-gradient(90deg,#66C3FF 0%,#ABEDC6 50%,#F5CB5C 100%)'
    : 'linear-gradient(90deg,#3bb8d8 0%,#7dd87a 50%,#ffdd57 100%)';

  return `
    <div class="lgboom-taskbar-head" style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;">
      <div class="lgboom-taskbar-title" style="font-size:13px;font-weight:${isAc ? '700' : '900'};">${title}</div>
      <span class="lgboom-taskbar-badge" style="display:inline-flex;align-items:center;justify-content:center;min-width:64px;height:28px;padding:0 10px;border-radius:999px;border:${btnBorder};background:${neutralBg};box-shadow:${isAc ? 'none' : '1px 1px 0 ' + lineColor};font-size:11px;font-weight:${isAc ? '700' : '900'};line-height:1;">准备中</span>
    </div>
    <div class="lgboom-taskbar-status" style="font-size:12px;font-weight:${isAc ? '700' : '900'};line-height:1.25;margin-bottom:6px;min-height:16px;max-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">空闲中</div>
    <div class="lgboom-taskbar-detail" style="font-size:12px;font-weight:${isAc ? '600' : '700'};line-height:1.4;margin-bottom:10px;min-height:34px;max-height:34px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:${muted};">等待任务启动</div>
    <div class="lgboom-taskbar-progress-wrap" style="background:${progressTrackBg};border:${progressTrackBorder};border-radius:999px;height:12px;overflow:hidden;margin-bottom:10px;box-shadow:inset 1px 1px 2px rgba(0,0,0,0.08);">
      <div class="lgboom-taskbar-progress-fill" style="background:${progressFillBg};height:100%;width:0%;transition:width 0.3s cubic-bezier(0.4, 0, 0.2, 1);box-shadow:1px 0 4px rgba(59,184,216,0.3);"></div>
    </div>
    <div style="display:flex;gap:8px;">
      <button class="lgboom-task-btn lgboom-task-btn-pause" style="flex:1;height:44px;border:${btnBorder};background:#fff;padding:8px 10px;border-radius:${btnRadius};font-weight:${isAc ? '700' : '900'};cursor:pointer;box-shadow:${btnShadow};transition:transform 0.12s ease,box-shadow 0.12s ease,background 0.12s ease;font-family:${fontFamily};" onmouseover="this.style.transform='translate(-1px,-1px)';this.style.boxShadow='${btnHoverShadow}'" onmouseout="this.style.transform='translate(0,0)';this.style.boxShadow='${btnShadow}'">暂停</button>
      <button class="lgboom-task-btn lgboom-task-btn-resume" style="flex:1;height:44px;border:${btnBorder};background:${isAc ? '#ABEDC6' : '#7dd87a'};padding:8px 10px;border-radius:${btnRadius};font-weight:${isAc ? '700' : '900'};cursor:pointer;display:none;box-shadow:${btnShadow};transition:transform 0.12s ease,box-shadow 0.12s ease,background 0.12s ease;font-family:${fontFamily};" onmouseover="this.style.transform='translate(-1px,-1px)';this.style.boxShadow='${btnHoverShadow}'" onmouseout="this.style.transform='translate(0,0)';this.style.boxShadow='${btnShadow}'">继续</button>
      <button class="lgboom-task-btn lgboom-task-btn-stop" style="flex:1;height:44px;border:${btnBorder};background:${isAc ? '#FFBCB5' : '#e03e3e'};padding:8px 10px;border-radius:${btnRadius};font-weight:${isAc ? '700' : '900'};cursor:pointer;box-shadow:${btnShadow};transition:transform 0.12s ease,box-shadow 0.12s ease,background 0.12s ease;font-family:${fontFamily};" onmouseover="this.style.transform='translate(-1px,-1px)';this.style.boxShadow='${btnHoverShadow}'" onmouseout="this.style.transform='translate(0,0)';this.style.boxShadow='${btnShadow}'">停止</button>
    </div>
  `;
}

export function updateTaskbarView(bar, {
  taskLabel = '任务',
  taskState = TASK_STATE.RUNNING,
  current = 0,
  total = 0,
  message = '',
  theme = 'default',
} = {}) {
  const normalizedTaskState = normalizeTaskState(taskState);
  const stage = inferTaskStage({ taskState: normalizedTaskState, message, current, total });
  const badge = bar.querySelector('.lgboom-taskbar-badge');
  const statusEl = bar.querySelector('.lgboom-taskbar-status');
  const detailEl = bar.querySelector('.lgboom-taskbar-detail');
  const fillEl = bar.querySelector('.lgboom-taskbar-progress-fill');

  if (badge) {
    badge.textContent = stage.label;
    badge.style.background = getBadgeColor(stage.tone, theme);
  }
  if (statusEl) {
    statusEl.textContent = `${taskLabel} · ${describeTaskProgress({ current, total })}`;
  }
  if (detailEl) {
    detailEl.textContent = describeTaskDetail({
      taskState: normalizedTaskState,
      message,
      current,
      total,
    });
  }
  if (fillEl) {
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
    fillEl.style.width = `${pct}%`;
  }
}

export function applyFloatingToastStyle(node, { type = 'info', theme = 'default' } = {}) {
  if (theme === 'ac-ui') {
    Object.assign(node.style, acToastStyle(type));
    return;
  }
  const toneMap = {
    info: DEFAULT_TOKENS.running,
    success: DEFAULT_TOKENS.done,
    warning: DEFAULT_TOKENS.paused,
    error: DEFAULT_TOKENS.error,
  };
  Object.assign(node.style, {
    position: 'fixed',
    top: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '320px',
    minHeight: '52px',
    boxSizing: 'border-box',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    background: toneMap[type] || toneMap.info,
    color: DEFAULT_TOKENS.ink,
    border: `2px solid ${DEFAULT_TOKENS.line}`,
    borderRadius: '10px',
    boxShadow: `4px 4px 0 ${DEFAULT_TOKENS.line}`,
    fontSize: '13px',
    fontWeight: '900',
    lineHeight: '1.35',
    zIndex: '2147483646',
    transition: 'opacity 0.3s',
    fontFamily: "'Arial Black','Segoe UI',sans-serif",
    whiteSpace: 'normal',
  });
}
