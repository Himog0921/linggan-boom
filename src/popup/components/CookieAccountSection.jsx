import React from 'react';

export default function CookieAccountSection({ cookieStatus, accounts, onGetCookies, onOpenAddAccount, onRemoveAccount }) {
  const xhsData = cookieStatus?.xhs;
  const dyData = cookieStatus?.douyin;
  const accountCount = Array.isArray(accounts) ? accounts.length : 0;

  const formatCookieTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="cookie-bottom-section">
      <div className="data-subsection">
        <div className="section-heading compact">
          <div>
            <h2>Cookie 状态</h2>
            <p>最新抓取时间会影响当前页面是否能直接执行采集与同步。</p>
          </div>
        </div>
        <div className="cookie-status-row">
          <div className="cookie-platform-status">
            <span className="cookie-platform-label">小红书</span>
            <span id="cookieXhsBadge" className={`cookie-platform-badge ${xhsData?.count > 0 ? 'captured' : 'not-captured'}`}>
              {xhsData?.count > 0 ? `${xhsData.count} 条 ${formatCookieTime(xhsData.capturedAt)}` : '未获取'}
            </span>
          </div>
          <div className="cookie-platform-status">
            <span className="cookie-platform-label">抖音</span>
            <span id="cookieDouyinBadge" className={`cookie-platform-badge ${dyData?.count > 0 ? 'captured' : 'not-captured'}`}>
              {dyData?.count > 0 ? `${dyData.count} 条 ${formatCookieTime(dyData.capturedAt)}` : '未获取'}
            </span>
          </div>
        </div>
        <button id="btnGetCookies" className="popup-btn primary" onClick={onGetCookies}>
          一键获取 Cookie
        </button>
      </div>

      <div className="data-subsection">
        <div className="section-heading compact">
          <div>
            <h2>采集账号</h2>
            <p>已保存账号会参与监控与执行，配额与状态会在这里持续更新。</p>
          </div>
          <span className="section-count-badge">{accountCount} 个账号</span>
        </div>

        <div id="accountList">
          {accountCount === 0 ? (
            <div className="empty-inline-note">暂无采集账号</div>
          ) : (
            accounts.map((a) => {
              const statusText = a.status === 'cooldown'
                ? `冷却中（${new Date(a.cooldownUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 恢复）`
                : a.status === 'disabled'
                  ? '已禁用'
                  : '可用';
              const statusColor = a.status === 'available' ? '#22c55e' : a.status === 'cooldown' ? '#f59e0b' : '#999';
              return (
                <div key={a.accountId} className="account-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="account-item-name">{a.name || '未命名'}</div>
                    <div className="account-item-meta">
                      {a.dailyQuotaUsed || 0}/{a.dailyQuotaLimit || 100} · <span style={{ color: statusColor }}>{statusText}</span>
                    </div>
                  </div>
                  <div className="account-item-actions">
                    <button className="delete" onClick={() => onRemoveAccount(a.accountId)}>删除</button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <button id="btnAddAccount" className="popup-btn outline" onClick={onOpenAddAccount}>
          + 手动添加账号
        </button>
      </div>
    </div>
  );
}
