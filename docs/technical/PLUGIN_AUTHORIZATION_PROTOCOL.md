# 插件授权协议

> 目标：把“谁能用插件”与“这台浏览器绑定到哪个执行工位”拆成两层，且都以内容工作台为唯一事实源。

## 1. 两层身份

### 1.1 授权码

- 作用：决定某个人 / 某台浏览器是否有资格使用插件
- 管理入口：内容工作台 → 设置 → 插件授权
- 特性：
  - 由管理员生成
  - 先授权，后配对
  - 可撤销、可过期、可限制席位和设备数
  - 未授权时，插件不开放采集、导出、同步、Dashboard、Cookie/账号管理和执行工位绑定

### 1.2 配对码

- 作用：决定一台已授权浏览器要绑定到哪个团队 / 工位 / 角色
- 管理入口：内容工作台 → 设置 / 采集控制台 / 监控中心
- 特性：
  - 一次性、短时有效
  - 只在授权成功后可使用
  - 绑定的是执行关系，不是使用资格

## 2. 内容工作台设置

内容工作台设置页至少需要三个管理区：

1. 插件授权
   - 生成授权码
   - 查看授权码状态（未使用 / 已激活 / 已撤销 / 已过期）
   - 查看归属成员、设备、过期时间、最近活跃时间
2. 执行工位配对
   - 生成手动工位 / 监控工位配对码
   - 查看配对码用途、有效期、是否已使用
3. 设备管理
   - 查看设备 `deviceId / stationId / 浏览器标识 / 最近心跳`
   - 撤销设备授权
   - 清空工位绑定

## 3. 插件侧本地状态

### 3.1 存储键

- `workbenchPluginAuthorization`
  - `deviceId`
  - `authorizationId`
  - `authorizationToken`
  - `status`
  - `teamName`
  - `memberName`
  - `seatName`
  - `expiresAt`
- `workbenchExecutionStation`
  - `stationId`
  - `stationToken`
  - `stationKey`
  - `displayName`
  - `role`

### 3.2 门禁规则

插件必须满足下面条件才算“可用”：

1. 已配置工作台地址
2. 已成功激活授权码
3. 若需要远程执行，再额外绑定执行工位

未满足第 2 条时，Popup、页内按钮、Background 接单都必须拒绝启动任务。

## 4. API

### 4.1 激活授权

```text
POST /api/plugin-authorizations/activate
```

请求：

```json
{
  "authorizationCode": "AUTH-001",
  "deviceId": "browser-device-uuid",
  "pluginVersion": "2.0.0",
  "browserLabel": "Chrome 135 / macOS"
}
```

响应：

```json
{
  "authorizationId": "auth_123",
  "authorizationToken": "pat_123",
  "status": "active",
  "teamId": "team_1",
  "teamName": "内容团队",
  "memberId": "member_1",
  "memberName": "张三",
  "seatId": "seat_1",
  "seatName": "团队授权席位 A",
  "expiresAt": "2026-05-01T00:00:00.000Z"
}
```

### 4.2 执行工位注册

```text
POST /api/execution-stations/register
Authorization: Bearer <authorizationToken>
```

请求体必须同时带：

- `authorizationId`
- `pairingCode`
- `stationKey`

### 4.3 心跳 / 接单 / 续租 / 同步

以下请求都必须携带插件授权 Bearer Token，且服务端同时校验 `authorizationId`：

- `POST /api/execution-stations/sync`
- `POST /api/collection-tasks/:taskId/lease`
- `POST /api/collect/batch`
- `POST /api/media-assets/cover`（上传采集封面图片本体，返回工作台稳定 `publicUrl`）
- `POST /api/collection-tasks/:taskId/ingest`
- `GET /api/collection-tasks/:taskId/control-requests`

执行工位模式下，插件不再调用 `GET /api/collection-tasks` 恢复扫描任务列表，也不再调用旧的 `heartbeat / reconcile / dispatch` 工位接口；旧版本如果继续高频轮询，会被工作台入口层拦截。

普通同步数据归属规则：插件授权只证明“这台浏览器可以使用插件”，不代表普通采集数据应该写入授权者账号。Dashboard 手动同步、批量同步和封面上传在写入前必须先通过 `POST /api/plugin-data-workspace` 绑定当前登录的内容工作台使用者账号，并在后续请求里携带 `X-Plugin-Data-Token`。如果没有使用者登录或绑定失败，工作台应拒绝同步，而不是回退写到授权者、系统所有者或共享执行池。

封面同步规则：插件在批量同步或任务增量回传前，会优先从采集记录里的 `coverImage / cover / coverImg / coverUrl / thumbnail / images / imageCandidates` 找到封面地址，抓取图片本体后用 `multipart/form-data` 上传到 `POST /api/media-assets/cover`。上传成功后，回传给工作台的封面字段改为稳定 `publicUrl`；原第三方链接保留在 `sourceCoverUrl / originalCoverUrl`，用于追溯来源。上传失败不阻断采集数据回传，只标记 `coverAssetUploadStatus=failed`。

## 5. 失效与撤销

当内容工作台撤销授权时，插件下一次 `/sync`、续租或数据同步必须立即失败，并引导用户重新激活授权码。
若用户在插件里主动清除授权，本地必须同时清掉：

1. `authorizationToken`
2. 执行工位绑定
3. 本地任务租约快照

## 6. 当前实现范围（2026-05-01）

本仓库已落地插件执行端：

1. 授权码与配对码分离
2. Popup 配置区新增“插件授权”
3. 授权后才允许绑定执行工位
4. Popup / 页内按钮 / Background 接单链路接入授权门禁
5. 工作台请求在注册 / 心跳 / 租约 / 同步时带授权信息
6. 封面图片本体上传到工作台资产接口，采集记录默认回传稳定封面地址

内容工作台“设置”页面与后端管理界面仍需在工作台仓库完成。
