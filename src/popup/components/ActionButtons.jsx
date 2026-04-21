import React from 'react';
import { PLATFORM } from '../utils.js';

export default function ActionButtons({ platform, capabilities, onCollectNote, onCollectSecondary, onCommentImages }) {
  const isDouyin = platform === PLATFORM.DOUYIN;
  const hasCurrentContentActions = Boolean(capabilities.canCollectPrimary || capabilities.canCollectSecondary);
  const primaryText = isDouyin
    ? (capabilities.canCollectPrimary ? '采集当前视频' : '当前页不支持')
    : (capabilities.canCollectPrimary ? '采集当前笔记' : '先打开笔记页');
  const secondaryText = isDouyin
    ? (capabilities.canCollectSecondary
      ? (capabilities.secondaryAction === 'author' ? '采集当前博主' : '采集当前评论')
      : '当前页不支持')
    : (capabilities.canCollectSecondary ? '采集当前评论' : '先打开笔记页');

  if (!hasCurrentContentActions) {
    return (
      <div className="action-empty-state" id="actionEmptyState">
        {isDouyin
          ? '当前内容暂不支持单条操作，请切到作品详情或作者主页。'
          : '当前内容暂不支持单条操作，请先打开笔记页。'}
      </div>
    );
  }

  return (
    <>
      <div className="btn-row">
        <button
          id="btnCollectNote"
          className="popup-btn primary"
          disabled={!capabilities.canCollectPrimary}
          onClick={onCollectNote}
        >
          {primaryText}
        </button>
        <button
          id="btnCollectComment"
          className="popup-btn secondary"
          disabled={!capabilities.canCollectSecondary}
          onClick={onCollectSecondary}
        >
          {secondaryText}
        </button>
      </div>
      {isDouyin && capabilities.canDownloadCommentImages && (
        <div className="btn-row">
          <button
            id="btnCommentImages"
            className="popup-btn secondary"
            disabled={!capabilities.canDownloadCommentImages}
            onClick={onCommentImages}
          >
            评论图片区
          </button>
        </div>
      )}
    </>
  );
}
