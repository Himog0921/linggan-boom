import React, { useState, useEffect } from 'react';
import { COMMENT_DEPTH_MODE } from '../../shared/constants.js';
import { PLATFORM } from '../utils.js';

const COUNT_OPTIONS = [5, 10, 20, 50];

export default function BatchSettingsModal({
  open,
  type,
  platform,
  mode,
  commentLimitOptions,
  onConfirm,
  onCancel,
}) {
  const [count, setCount] = useState(10);
  const [topByLikes, setTopByLikes] = useState(false);
  const [commentLimit, setCommentLimit] = useState('');
  const [commentDepthMode, setCommentDepthMode] = useState(COMMENT_DEPTH_MODE.TWO_LEVEL);

  const isDouyin = platform === PLATFORM.DOUYIN;
  const isDyCommentBatch = isDouyin && type === 'comments';
  const isSingleComment = mode === 'single';
  const showTopByLikes = (type === 'notes' || isDyCommentBatch) && !isSingleComment;
  const showCommentDepth = type === 'comments';
  const showCommentLimit = type === 'comments';
  const showCountOptions = !isSingleComment;

  const dialogTitle = commentLimitOptions?.title || (type === 'comments'
    ? '批量采集评论'
    : (isDouyin ? '批量采集视频' : '批量采集笔记'));

  const dialogSubtitle = commentLimitOptions?.subtitle || (type === 'comments'
    ? (isDyCommentBatch ? '选择采集数量、选取方式、评论上限与采集深度' : '选择采集数量、评论上限与采集深度')
    : '选择采集数量和排序方式');

  const confirmText = commentLimitOptions?.confirmText || '开始采集';

  useEffect(() => {
    if (open) {
      setCount(10);
      setTopByLikes(false);
      setCommentLimit('');
      setCommentDepthMode(COMMENT_DEPTH_MODE.TWO_LEVEL);
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = () => {
    onConfirm({
      count,
      topByLikes: showTopByLikes ? topByLikes : false,
      commentLimit: showCommentLimit ? Math.max(0, parseInt(String(commentLimit).trim(), 10) || 0) : 0,
      commentDepthMode: showCommentDepth ? commentDepthMode : COMMENT_DEPTH_MODE.TWO_LEVEL,
      maxTotal: isSingleComment ? Math.max(0, parseInt(String(commentLimit).trim(), 10) || 0) : undefined,
    });
  };

  return (
    <div id="batchSettingsOverlay" className="batch-settings-overlay" style={{ display: 'flex' }} aria-hidden="false">
      <div className="batch-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="batchSettingsTitle">
        <h2 id="batchSettingsTitle">{dialogTitle}</h2>
        <p className="batch-settings-subtitle">{dialogSubtitle}</p>

        {showCountOptions && (
          <>
            <label className="batch-label" id="selectionModeLabel">采集数量</label>
            <div className="count-options" id="countOptions">
              {COUNT_OPTIONS.map((c) => (
                <button
                  key={c}
                  className={count === c ? 'active' : ''}
                  data-count={c}
                  onClick={() => setCount(c)}
                  style={{ display: (isDyCommentBatch && c === 50) ? 'none' : undefined }}
                >
                  {c}
                </button>
              ))}
            </div>
          </>
        )}

        {showTopByLikes && (
          <>
            <label className="batch-checkbox" id="topLikesWrap">
              <input
                id="topLikesInput"
                type="checkbox"
                checked={topByLikes}
                onChange={(e) => setTopByLikes(e.target.checked)}
              />
              <span id="topLikesLabel">
                {isDyCommentBatch
                  ? '勾选后按点赞 Top N 选取；不勾选则按当前页面顺位逐条采集评论'
                  : '勾选后按点赞 Top N 选取；不勾选则按当前页面顺位采集'}
              </span>
            </label>
            <small className="batch-helper" id="topLikesHint">
              {isDyCommentBatch
                ? '顺位模式更贴近你当前看到的作品顺序；Top N 更适合优先分析高互动作品。'
                : '顺位模式更贴近页面浏览顺序；Top N 更适合快速抓高互动内容。'}
            </small>
          </>
        )}

        {showCommentDepth && (
          <>
            <label className="batch-label" id="commentDepthLabel">评论深度</label>
            <div className="comment-depth-options" id="commentDepthWrap">
              <button
                className={commentDepthMode === COMMENT_DEPTH_MODE.TWO_LEVEL ? 'active' : ''}
                onClick={() => setCommentDepthMode(COMMENT_DEPTH_MODE.TWO_LEVEL)}
              >
                只采一级+二级
              </button>
              <button
                className={commentDepthMode === COMMENT_DEPTH_MODE.ALL_REPLIES ? 'active' : ''}
                onClick={() => setCommentDepthMode(COMMENT_DEPTH_MODE.ALL_REPLIES)}
              >
                尽量全部回复
              </button>
            </div>
            <small className="batch-helper" id="commentDepthHint">
              一级+二级更快；尽量全部回复会继续展开更多回复。
            </small>
          </>
        )}

        {showCommentLimit && (
          <>
            <label className="batch-label" id="commentLimitWrap">每条视频评论上限（留空=全部）</label>
            <input
              id="commentLimitInput"
              type="number"
              placeholder="例如 20"
              min="0"
              value={commentLimit}
              onChange={(e) => setCommentLimit(e.target.value)}
            />
          </>
        )}

        <div className="batch-dialog-actions">
          <button className="popup-btn outline" id="btnBatchCancel" onClick={onCancel}>
            取消
          </button>
          <button className="popup-btn primary" id="btnBatchConfirm" onClick={handleConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
