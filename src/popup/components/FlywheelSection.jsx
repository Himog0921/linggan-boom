import React from 'react';

export default function FlywheelSection({
  flywheelUrl,
  flywheelStatus,
  authorizationCode,
  authorizationStatus = {},
  stationPairingCode,
  stationStatus,
  presetUrls = {},
  testing = false,
  authorizing = false,
  clearingAuthorization = false,
  pairing = false,
  syncing = false,
  onUrlChange,
  onUsePresetUrl,
  onAuthorizationCodeChange,
  onAuthorize,
  onClearAuthorization,
  onPairingCodeChange,
  onTest,
  onPair,
  onSync,
}) {
  const statusText = {
    unconfigured: '未配置',
    configured: '已配置',
    testing: '测试中...',
    connected: '已连接',
    disconnected: '连接失败',
  }[flywheelStatus] || flywheelStatus;

  const authorization = authorizationStatus.authorization || {};
  const authorizationState = authorizationStatus.authorized
    ? 'connected'
    : (authorization.status === 'expired' || authorization.status === 'revoked' ? 'disconnected' : 'unconfigured');
  const authorizationLabel = authorizationStatus.authorized
    ? (authorization.memberName || authorization.teamName || authorization.authorizationId || '已授权')
    : '未授权';
  const authorizationHint = authorizationStatus.authorized
    ? `当前浏览器已授权给${authorization.memberName || '团队成员'}使用${authorization.teamName ? `，归属 ${authorization.teamName}` : ''}${authorization.expiresAt ? `，有效期至 ${authorization.expiresAt}` : ''}。`
    : (authorizationStatus.authorizationMessage || '先去内容工作台设置生成授权码，再回到插件激活；未授权时插件不会开放采集、同步和工位绑定。');

  const stationName = stationStatus.registered
    ? (stationStatus.identity?.displayName || stationStatus.identity?.stationId || '已绑定')
    : '未绑定';
  const stationRole = stationStatus.identity?.role === 'manual' ? 'manual' : 'monitor';
  const stationRoleLabel = stationRole === 'manual' ? '手动采集工位' : '监控工位';

  const accounts = Array.isArray(stationStatus.platformAccounts) ? stationStatus.platformAccounts : [];
  const healthyCount = accounts.filter((a) => a.healthStatus === 'healthy').length;
  const presets = [
    { key: 'production', label: '线上正式站', url: presetUrls.production || 'https://lingganboom.fun' },
    { key: 'local', label: '本地 3000', url: presetUrls.local || 'http://localhost:3000' },
  ];
  const normalizeUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');
  const currentUrl = normalizeUrl(flywheelUrl);

  return (
    <div className="flywheel-section">
      <div className="context-section flywheel-card">
        <div className="section-heading">
          <h2>内容工作台</h2>
          <div className="flywheel-heading-side">
            <div className="flywheel-preset-row">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={`flywheel-preset-chip${currentUrl === normalizeUrl(preset.url) ? ' active' : ''}`}
                  onClick={() => {
                    if (typeof onUsePresetUrl === 'function') {
                      void onUsePresetUrl(preset.url);
                      return;
                    }
                    onUrlChange?.(preset.url);
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <span id="flywheelStatus" className={`flywheel-status ${flywheelStatus}`}>
              {statusText}
            </span>
          </div>
        </div>
        <div className="flywheel-url-row">
          <input
            id="flywheelUrl"
            type="text"
            className="flywheel-input"
            placeholder="https://lingganboom.fun"
            value={flywheelUrl}
            onChange={(e) => onUrlChange(e.target.value)}
          />
          <button
            id="btnFlywheelTest"
            className={`popup-btn outline small${testing ? ' is-busy' : ''}`}
            onClick={onTest}
            disabled={testing}
          >
            {testing ? '测试中...' : '测试连接'}
          </button>
        </div>
        <p className="station-hint">
          支持线上正式站和本地 `3000`，插件会记住你最近一次使用的地址。
        </p>
      </div>

      <div className="station-panel">
        <div className="station-title-row">
          <span style={{ fontSize: '12px', fontWeight: 900 }}>插件授权</span>
          <span id="pluginAuthorizationStatus" className={`flywheel-status ${authorizationState}`}>
            {authorizationLabel}
          </span>
        </div>
        <p id="pluginAuthorizationHint" className="station-hint">
          {authorizationHint}
        </p>
        <div className="flywheel-url-row">
          <input
            id="pluginAuthorizationCode"
            type="text"
            className="flywheel-input"
            placeholder="输入授权码"
            value={authorizationCode}
            onChange={(e) => onAuthorizationCodeChange(e.target.value)}
            disabled={authorizing || clearingAuthorization}
          />
          <button
            id="btnPluginAuthorize"
            className={`popup-btn primary small${authorizing ? ' is-busy' : ''}`}
            onClick={onAuthorize}
            disabled={authorizing || clearingAuthorization}
          >
            {authorizing ? '激活中...' : '激活授权'}
          </button>
          {authorizationStatus.authorized && typeof onClearAuthorization === 'function' ? (
            <button
              id="btnPluginAuthorizationClear"
              className={`popup-btn outline small${clearingAuthorization ? ' is-busy' : ''}`}
              onClick={onClearAuthorization}
              disabled={authorizing || clearingAuthorization}
            >
              {clearingAuthorization ? '清除中...' : '清除'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="station-panel">
        <div className="station-title-row">
          <span style={{ fontSize: '12px', fontWeight: 900 }}>执行工位</span>
          <span id="stationStatus" className={`flywheel-status ${stationStatus.registered ? 'connected' : 'unconfigured'}`}>
            {stationStatus.registered ? `${stationName} · ${stationRoleLabel}` : stationName}
          </span>
        </div>
        <p id="stationHint" className="station-hint">
          {!authorizationStatus.authorized
            ? '先完成插件授权，再使用内容工作台设置里生成的配对码绑定执行工位。'
            : stationStatus.registered
            ? (healthyCount > 0
              ? `已发现 ${healthyCount} 个可用账号，这个浏览器现在会只接${stationRole === 'manual' ? '手动采集' : '监控'}任务。`
              : `已绑定${stationRoleLabel}；请先在 Cookie & 账号里保存可用账号，才能领取任务。`)
            : '把内容工作台给的配对码填进来：来自采集控制台的是手动工位，来自监控中心的是监控工位。'}
        </p>
        <div className="flywheel-url-row">
          <input
            id="stationPairingCode"
            type="text"
            className="flywheel-input"
            placeholder="输入配对码"
            value={stationPairingCode}
            onChange={(e) => onPairingCodeChange(e.target.value)}
            disabled={!authorizationStatus.authorized || pairing}
          />
          <button
            id="btnStationPair"
            className={`popup-btn primary small${pairing ? ' is-busy' : ''}`}
            onClick={onPair}
            disabled={!authorizationStatus.authorized || pairing}
          >
            {pairing ? '绑定中...' : '绑定工位'}
          </button>
        </div>
      </div>

      <button
        id="btnSyncToFlywheel"
        className={`popup-btn primary${syncing ? ' is-busy' : ''}`}
        onClick={onSync}
        disabled={!authorizationStatus.authorized || syncing}
      >
        {syncing ? '同步中...' : '全部同步到工作台'}
      </button>
    </div>
  );
}
