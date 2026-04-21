import React, { useState, useEffect, useRef } from 'react';
import { mountDialog, unmountDialog, NEO_OVERLAY_STYLE } from './dialogShared.js';

const PANEL_STYLE = {
  width: 'min(456px, 100%)',
  background: '#fff8da',
  border: '3px solid #121212',
  boxShadow: '6px 6px 0 #121212',
  borderRadius: '18px',
  padding: '22px 24px 20px',
  fontFamily: "'Arial Black','Segoe UI',sans-serif",
};

function ActionDialog({
  title = '操作',
  description = '',
  confirmText = '开始',
  cancelText = '取消',
  fields = [],
  onResolve,
}) {
  const [values, setValues] = useState(() => {
    const initial = {};
    fields.forEach((f) => {
      initial[f.name] = f.type === 'checkbox' ? Boolean(f.defaultValue) : String(f.defaultValue ?? '');
    });
    return initial;
  });

  const firstRef = useRef(null);
  const focusTimer = useRef(null);

  useEffect(() => {
    focusTimer.current = setTimeout(() => firstRef.current?.focus(), 50);
    const handleKey = (e) => {
      if (e.key === 'Escape') onResolve(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      clearTimeout(focusTimer.current);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onResolve]);

  const iconText = /评论图片区/.test(title) ? '图' : /评论/.test(title) ? '评' : /批量/.test(title) ? '批' : '采';

  return (
    <div
      style={NEO_OVERLAY_STYLE}
      onClick={(e) => { if (e.target === e.currentTarget) onResolve(null); }}
      aria-hidden="false"
    >
      <div style={PANEL_STYLE} role="dialog" aria-modal="true">
        <div style={{
          width: '56px',
          height: '56px',
          border: '2px solid #121212',
          borderRadius: '16px',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
          fontWeight: 900,
          color: '#121212',
          boxShadow: '2px 2px 0 #121212',
          marginBottom: '12px',
          fontFamily: "'Arial Black','Segoe UI',sans-serif",
        }}>
          {iconText}
        </div>

        <h2 style={{ fontSize: '26px', fontWeight: 900, color: '#121212', lineHeight: 1.15, margin: '0 0 8px' }}>
          {title}
        </h2>

        {description && (
          <p style={{ fontFamily: "'Segoe UI',sans-serif", fontSize: '13px', fontWeight: 700, lineHeight: 1.65, margin: '0 0 16px', color: '#4c4c4c' }}>
            {description}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {fields.map((field, idx) => {
            if (field.type === 'checkbox') {
              return (
                <label
                  key={field.name}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: '10px',
                    padding: '12px 14px',
                    border: '2px solid #121212',
                    borderRadius: '14px',
                    background: '#fff',
                    boxShadow: '2px 2px 0 #121212',
                    fontFamily: "'Segoe UI',sans-serif",
                    cursor: 'pointer',
                  }}
                >
                  <input
                    ref={idx === 0 ? firstRef : null}
                    type="checkbox"
                    checked={Boolean(values[field.name])}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.checked }))}
                    style={{ width: '18px', height: '18px', accentColor: '#3bb8d8', marginTop: '2px', flex: '0 0 auto', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ display: 'block', fontSize: '15px', fontWeight: 900, color: '#121212', lineHeight: 1.3 }}>
                      {field.label || field.name}
                    </span>
                    {field.helpText && (
                      <small style={{ display: 'block', color: '#555', lineHeight: 1.5, fontSize: '12px', fontFamily: "'Segoe UI',sans-serif", fontWeight: 600 }}>
                        {field.helpText}
                      </small>
                    )}
                  </div>
                </label>
              );
            }

            return (
              <div key={field.name} style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontFamily: "'Segoe UI',sans-serif", fontSize: '13px', fontWeight: 700 }}>
                <span style={{ fontSize: '15px', fontWeight: 900, color: '#121212' }}>
                  {field.label || field.name}
                </span>
                <input
                  ref={idx === 0 ? firstRef : null}
                  type={field.type || 'text'}
                  value={String(values[field.name] ?? '')}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                  placeholder={field.placeholder || ''}
                  min={field.min}
                  max={field.max}
                  style={{
                    height: '52px',
                    border: '2px solid #121212',
                    borderRadius: '14px',
                    padding: '0 16px',
                    fontSize: '18px',
                    fontFamily: "'Arial Black','Segoe UI',sans-serif",
                    background: '#fff',
                    boxShadow: '2px 2px 0 #121212',
                    outline: 'none',
                  }}
                  onFocus={(e) => { e.target.style.outline = '3px solid #121212'; e.target.style.outlineOffset = '2px'; }}
                  onBlur={(e) => { e.target.style.outline = 'none'; e.target.style.outlineOffset = '0'; }}
                />
                {Array.isArray(field.quickOptions) && field.quickOptions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
                    {field.quickOptions.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setValues((v) => ({ ...v, [field.name]: value === 0 ? '0' : String(value) }))}
                        style={{
                          minWidth: '52px',
                          height: '34px',
                          padding: '0 12px',
                          border: '2px solid #121212',
                          borderRadius: '999px',
                          background: '#fffdf0',
                          boxShadow: '1px 1px 0 #121212',
                          fontSize: '12px',
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        {value === 0 ? '全部' : value}
                      </button>
                    ))}
                  </div>
                )}
                {field.helpText && (
                  <small style={{ color: '#555', lineHeight: 1.5, fontSize: '12px', fontFamily: "'Segoe UI',sans-serif", fontWeight: 600 }}>
                    {field.helpText}
                  </small>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
          <button
            type="button"
            onClick={() => onResolve(null)}
            style={{
              minWidth: '112px',
              height: '48px',
              background: '#fff',
              color: '#121212',
              border: '2px solid #121212',
              borderRadius: '14px',
              padding: '0 20px',
              fontSize: '15px',
              fontWeight: 900,
              cursor: 'pointer',
              boxShadow: '2px 2px 0 #121212',
            }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={() => onResolve(values)}
            style={{
              minWidth: '152px',
              height: '48px',
              background: '#3bb8d8',
              color: '#121212',
              border: '2px solid #121212',
              borderRadius: '14px',
              padding: '0 22px',
              fontSize: '15px',
              fontWeight: 900,
              cursor: 'pointer',
              boxShadow: '2px 2px 0 #121212',
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function showActionDialog(options = {}) {
  return new Promise((resolve) => {
    const handleResolve = (result) => {
      unmountDialog(container);
      resolve(result);
    };

    const { container } = mountDialog('lgboom-dy-dialog-overlay', <ActionDialog {...options} onResolve={handleResolve} />);
  });
}
