import React, { useState, useCallback } from 'react';

export default function AddAccountModal({ open, onClose, onConfirm, onExtractCookie, onCookieResult }) {
  const [name, setName] = useState('');
  const [cookieJson, setCookieJson] = useState('');
  const [quota, setQuota] = useState('');
  const [extracting, setExtracting] = useState(false);

  const handleExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const result = await onExtractCookie();
      if (result.success && result.cookies) {
        setCookieJson(JSON.stringify(result.cookies, null, 2));
        if (onCookieResult && result.allResults) {
          onCookieResult(result.allResults);
        }
        if (!name.trim()) {
          setName(`小红书账号-${new Date().toLocaleDateString('zh-CN')}`);
        }
      } else {
        setCookieJson('');
        alert((result.error || '未检测到小红书 Cookie。') + '\n请先在浏览器中打开小红书并确认已经登录，然后重试。');
      }
    } catch (e) {
      setCookieJson('');
      alert('提取失败：' + (e?.message || e));
    } finally {
      setExtracting(false);
    }
  }, [name, onExtractCookie, onCookieResult]);

  const handleConfirm = useCallback(() => {
    const trimmedName = (name || '').trim();
    const cookieRaw = (cookieJson || '').trim();
    const dailyQuotaLimit = parseInt(quota) || 100;

    if (!trimmedName || !cookieRaw) {
      alert('请填写账号名称，并点击「一键提取」获取 Cookie');
      return;
    }

    let parsedCookieJson;
    try {
      const parsed = JSON.parse(cookieRaw);
      parsedCookieJson = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      const pairs = cookieRaw.split(';').map(s => s.trim()).filter(Boolean);
      if (pairs.length > 0 && pairs.every(p => p.includes('='))) {
        parsedCookieJson = pairs.map(p => {
          const eqIdx = p.indexOf('=');
          return {
            name: p.slice(0, eqIdx).trim(),
            value: p.slice(eqIdx + 1).trim(),
            domain: '.xiaohongshu.com',
            path: '/',
            secure: true,
            httpOnly: false,
            sameSite: 'lax',
          };
        });
      } else {
        alert('Cookie 格式不正确。请点击「一键提取」自动获取，或粘贴 JSON 格式的 Cookie。');
        return;
      }
    }

    if (!parsedCookieJson.some(c => c.name)) {
      alert('Cookie 中没有有效字段，请重新提取。');
      return;
    }

    onConfirm({
      name: trimmedName,
      cookieJson: JSON.stringify(parsedCookieJson),
      platform: 'xhs',
      dailyQuotaLimit,
    });

    setName('');
    setCookieJson('');
    setQuota('');
  }, [name, cookieJson, quota, onConfirm]);

  if (!open) return null;

  return (
    <div id="addAccountOverlay" className="batch-settings-overlay" style={{ display: 'flex' }} aria-hidden="false">
      <div className="batch-settings-dialog add-account-dialog" role="dialog" aria-modal="true">
        <h2>添加采集账号</h2>
        <p className="batch-settings-subtitle">手动添加或一键提取 Cookie 作为采集账号</p>

        <label className="batch-label">账号名称</label>
        <input
          id="accountNameInput"
          type="text"
          className="add-account-input"
          placeholder="例如：小红书账号-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          style={{ width: '100%', minHeight: '40px', border: '2px solid #121212', borderRadius: '10px', background: '#fff', boxShadow: '2px 2px 0 #121212', padding: '9px 11px', marginBottom: '10px', fontSize: '14px', fontWeight: 700 }}
        />

        <label className="batch-label">Cookie</label>
        <textarea
          id="accountCookieInput"
          className="add-account-textarea"
          placeholder="点击「一键提取」自动获取"
          rows={6}
          value={cookieJson}
          onChange={(e) => setCookieJson(e.target.value)}
          style={{ width: '100%', border: '2px solid #121212', borderRadius: '10px', background: '#fff', boxShadow: '2px 2px 0 #121212', padding: '9px 11px', marginBottom: '6px', fontSize: '12px', fontWeight: 700, resize: 'vertical' }}
        />
        <button
          id="btnExtractCookie"
          className="popup-btn outline small"
          onClick={handleExtract}
          disabled={extracting}
          style={{ marginBottom: '10px' }}
        >
          {extracting ? '提取中...' : '一键提取'}
        </button>

        <label className="batch-label">每日限额</label>
        <input
          id="accountQuotaInput"
          type="number"
          className="add-account-input"
          placeholder="例如：100"
          value={quota}
          onChange={(e) => setQuota(e.target.value)}
          style={{ width: '100%', minHeight: '40px', border: '2px solid #121212', borderRadius: '10px', background: '#fff', boxShadow: '2px 2px 0 #121212', padding: '9px 11px', marginBottom: '10px', fontSize: '14px', fontWeight: 700 }}
        />

        <div className="batch-dialog-actions">
          <button className="popup-btn outline" id="btnAccountCancel" onClick={onClose}>
            取消
          </button>
          <button className="popup-btn primary" id="btnAccountConfirm" onClick={handleConfirm}>
            确认添加
          </button>
        </div>
      </div>
    </div>
  );
}
