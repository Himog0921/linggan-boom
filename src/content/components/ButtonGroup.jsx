import React from 'react';
import { createRoot } from 'react-dom/client';
import { icon } from '../../shared/icons.js';
import { getCurrentTheme } from '../../themes/themeManager.js';
import { DEFAULT_TOKENS } from '../../shared/taskUi.js';
import { AC_COLORS } from '../../themes/ac-ui/tokens.js';

function ButtonGroup({
  buttons = [],
  platform = 'xhs',
  compact = false,
  containerStyle = {},
  brandStyle = {},
  buttonStyle = {},
}) {
  const theme = getCurrentTheme();
  const isAc = theme === 'ac-ui';
  const isDy = platform === 'douyin';
  const btnPrefix = isDy ? 'lgboom-dy-btn' : 'lgboom-btn';

  const groupBase = isAc
    ? {
        display: 'flex',
        gap: compact ? '6px' : '8px',
        padding: compact ? '10px 12px' : '12px 16px',
        background: '#f2f2f2',
        borderRadius: '5px',
        border: '1px solid #ddd',
        alignItems: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }
    : {
        display: 'flex',
        gap: compact ? '6px' : '8px',
        padding: compact ? '10px 12px' : '12px 16px',
        background: DEFAULT_TOKENS.surface,
        borderRadius: '12px',
        border: `3px solid ${DEFAULT_TOKENS.line}`,
        alignItems: 'center',
        boxShadow: compact ? '3px 3px 0 #121212' : '5px 5px 0 #121212',
      };

  const brandBase = isAc
    ? {
        fontWeight: 700,
        fontSize: compact ? 13 : 14,
        color: '#4f4f4f',
        fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif",
        marginRight: compact ? 6 : isDy ? 0 : 12,
      }
    : {
        fontWeight: 900,
        fontSize: compact ? 13 : 14,
        color: '#121212',
        fontFamily: "'Arial Black','Segoe UI',sans-serif",
        marginRight: compact ? 6 : isDy ? 0 : 12,
      };

  return (
    <div
      className={isDy ? 'lgboom-dy-btn-group' : 'lgboom-btn-group'}
      style={{ ...groupBase, ...containerStyle }}
    >
      <div style={{ ...brandBase, ...brandStyle }}>
        {isDy ? (
          <>
            <span style={{ display: 'block', marginBottom: '2px', fontSize: '11px', fontWeight: isAc ? 700 : 900 }}>
              灵感爆爆爆
            </span>
            <span style={{ fontSize: '9px', color: isAc ? '#888' : '#999', fontFamily: 'sans-serif', fontWeight: 400 }}>
              抖音
            </span>
          </>
        ) : (
          '灵感爆爆爆'
        )}
      </div>
      {buttons.map(({ text, action, style = 'secondary', data, icon: iconName, hidden }) => {
        if (hidden) return null;
        const btnClass = `${btnPrefix} ${btnPrefix}-${style}`;

        if (isAc) {
          const cm = AC_COLORS[style] || AC_COLORS.secondary;
          return (
            <button
              key={action}
              className={btnClass}
              data-action={action}
              data-params={data ? JSON.stringify(data) : undefined}
              style={{
                border: `1px solid ${cm.border}`,
                borderRadius: '5px',
                padding: isDy ? '8px 14px' : '8px 16px',
                fontSize: isDy ? '12px' : '13px',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'background-position 300ms ease,transform 0.15s ease,box-shadow 0.15s ease',
                boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
                color: '#4f4f4f',
                backgroundImage: `linear-gradient(to right, ${cm.grad}, white)`,
                backgroundSize: '200% 100%',
                backgroundPosition: 'right 0 top 0',
                fontFamily: "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif",
                whiteSpace: 'nowrap',
                ...buttonStyle,
              }}
              onMouseEnter={(e) => {
                e.target.style.backgroundPosition = 'right 40% top 0';
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={(e) => {
                e.target.style.backgroundPosition = 'right 0 top 0';
                e.target.style.transform = 'translateY(0)';
                e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.06)';
              }}
              onMouseDown={(e) => {
                e.target.style.backgroundPosition = 'right 100% top 0';
                e.target.style.transform = 'translateY(0)';
              }}
              onMouseUp={(e) => {
                e.target.style.backgroundPosition = 'right 40% top 0';
                e.target.style.transform = 'translateY(-1px)';
              }}
            >
              {iconName && (
                <span
                  dangerouslySetInnerHTML={{ __html: icon(iconName, { size: 14 }) }}
                  style={{ marginRight: '4px', verticalAlign: 'middle' }}
                />
              )}
              <span style={{ verticalAlign: 'middle' }}>{text}</span>
            </button>
          );
        }

        const bg = style === 'primary' ? '#3bb8d8' : style === 'danger' ? '#e03e3e' : '#fff';
        return (
          <button
            key={action}
            className={btnClass}
            data-action={action}
            data-params={data ? JSON.stringify(data) : undefined}
            style={{
              border: `2px solid ${DEFAULT_TOKENS.line}`,
              borderRadius: '9px',
              padding: isDy ? '8px 14px' : '8px 16px',
              fontSize: isDy ? '12px' : '13px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'transform 0.12s ease,box-shadow 0.12s ease,background 0.12s ease',
              boxShadow: `2px 2px 0 ${DEFAULT_TOKENS.line}`,
              background: bg,
              color: DEFAULT_TOKENS.ink,
              fontFamily: "'Arial Black','Segoe UI',sans-serif",
              whiteSpace: 'nowrap',
              ...buttonStyle,
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translate(-1px,-1px)';
              e.target.style.boxShadow = '3px 3px 0 #121212';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translate(0,0)';
              e.target.style.boxShadow = '2px 2px 0 #121212';
            }}
            onMouseDown={(e) => {
              e.target.style.transform = 'translate(1px,1px)';
              e.target.style.boxShadow = '1px 1px 0 #121212';
            }}
            onMouseUp={(e) => {
              e.target.style.transform = 'translate(-1px,-1px)';
              e.target.style.boxShadow = '3px 3px 0 #121212';
            }}
          >
            {iconName && (
              <span
                dangerouslySetInnerHTML={{ __html: icon(iconName, { size: 14 }) }}
                style={{ marginRight: '4px', verticalAlign: 'middle' }}
              />
            )}
            <span style={{ verticalAlign: 'middle' }}>{text}</span>
          </button>
        );
      })}
    </div>
  );
}

const buttonGroupRoots = new Map();

export function renderButtonGroup(container, props) {
  let root = buttonGroupRoots.get(container);
  if (!root) {
    root = createRoot(container);
    buttonGroupRoots.set(container, root);
  }
  root.render(<ButtonGroup {...props} />);
}

export function unmountButtonGroup(container) {
  const root = buttonGroupRoots.get(container);
  if (root) {
    root.unmount();
    buttonGroupRoots.delete(container);
  }
}
