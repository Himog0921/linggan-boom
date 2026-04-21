import React from 'react';

export default function FlywheelSection({
  flywheelUrl,
  flywheelStatus,
  stationPairingCode,
  stationStatus,
  onUrlChange,
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

  const stationName = stationStatus.registered
    ? (stationStatus.identity?.displayName || stationStatus.identity?.stationId || '已绑定')
    : '未绑定';
  const stationRole = stationStatus.identity?.role === 'manual' ? 'manual' : 'monitor';
  const stationRoleLabel = stationRole === 'manual' ? '手动采集工位' : '监控工位';

  const accounts = Array.isArray(stationStatus.platformAccounts) ? stationStatus.platformAccounts : [];
  const healthyCount = accounts.filter((a) => a.healthStatus === 'healthy').length;

  return (
    <div className="flywheel-section">
      <div className="context-section flywheel-card">
        <div className="section-heading">
          <h2>飞轮工作台</h2>
          <span id="flywheelStatus" className={`flywheel-status ${flywheelStatus}`}>
            {statusText}
          </span>
        </div>
        <div className="flywheel-url-row">
          <input
            id="flywheelUrl"
            type="text"
            className="flywheel-input"
            placeholder="http://localhost:3000"
            value={flywheelUrl}
            onChange={(e) => onUrlChange(e.target.value)}
          />
          <button id="btnFlywheelTest" className="popup-btn outline small" onClick={onTest}>
            测试连接
          </button>
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
          {stationStatus.registered
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
          />
          <button id="btnStationPair" className="popup-btn primary small" onClick={onPair}>
            绑定工位
          </button>
        </div>
      </div>

      <button id="btnSyncToFlywheel" className="popup-btn primary" onClick={onSync}>
        全部同步到飞轮
      </button>
    </div>
  );
}
