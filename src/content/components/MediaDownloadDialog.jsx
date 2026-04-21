import React, { useEffect } from 'react';
import { mountDialog, unmountDialog } from './dialogShared.js';

const OVERLAY_STYLE = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: '2147483647',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const PANEL_STYLE = {
  background: '#fff',
  borderRadius: '16px',
  padding: '32px 36px',
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  maxWidth: '380px',
  width: '90%',
  fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
};

function MediaDownloadDialog({ mediaCount, noteType, onResolve }) {
  const typeLabel = noteType === 'video' ? '视频' : '图片';

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onResolve(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onResolve]);

  return (
    <div style={OVERLAY_STYLE} onClick={(e) => { if (e.target === e.currentTarget) onResolve(false); }}>
      <div style={PANEL_STYLE} role="dialog" aria-modal="true">
        <div style={{ fontSize: '20px', fontWeight: 700, color: '#333', marginBottom: '8px' }}>下载媒体文件</div>
        <div style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
          该笔记包含 <strong>{mediaCount}</strong> 个{typeLabel}文件，是否下载？
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => onResolve(false)}
            style={{
              background: '#f0f0f0',
              color: '#555',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 22px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            不用了
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            style={{
              background: '#ff4757',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 22px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            下载全部
          </button>
        </div>
      </div>
    </div>
  );
}

export function showMediaDownloadDialog(mediaCount, noteType) {
  return new Promise((resolve) => {
    const handleResolve = (result) => {
      unmountDialog(container);
      resolve(result);
    };

    const { container } = mountDialog('lgboom-limit-overlay', <MediaDownloadDialog mediaCount={mediaCount} noteType={noteType} onResolve={handleResolve} />);
  });
}
