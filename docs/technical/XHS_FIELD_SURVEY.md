# 小红书字段与页面结构调研

更新时间：2026-06-01
调研方式：Chrome DevTools Console + 实际页面验证

## 1. 目标

记录小红书页面的内部数据结构（`__INITIAL_STATE__`）和 DOM 选择器验证结论，供后续维护博主采集、笔记采集、评论采集等功能时快速检索。

核心原则：

1. 小红书页面使用 Vue 响应式系统，`__INITIAL_STATE__` 中的部分属性是 Vue ref 包装对象，实际数据藏在 `_rawValue` 里。
2. 博主采集依赖双路数据源：DOM 选择器 + `__INITIAL_STATE__` 注入脚本。两者互为兜底。
3. DOM 选择器有 30 天过期风险，`__INITIAL_STATE__` 结构也可能随版本更新变化。每次采集异常排查应先验证两条路径。

## 2. `__INITIAL_STATE__` 整体结构

在博主页（`/user/profile/{userId}`）验证，`__INITIAL_STATE__` 的顶层结构：

```
window.__INITIAL_STATE__
  └── user (对象)
        ├── loggedIn
        ├── activated
        ├── userInfo       ← Vue ref，实际数据在 ._rawValue
        ├── follow
        ├── userPageData   ← Vue ref，实际数据在 ._rawValue
        ├── activeTab
        ├── notes
        ├── isFetchingNotes
        ├── tabScrollTop
        ├── userFetchingStatus
        ├── userNoteFetchingStatus
        ├── bannedInfo
        ├── firstFetchNote
        ├── noteQueries
        ├── pageScrolled
        ├── activeSubTab
        └── isOwnBoard
```

### 2.1 关键发现：Vue ref 包装

`userInfo` 和 `userPageData` 都是 Vue ref 对象，表面结构为：

```json
{
  "dep": {},
  "__v_isRef": true,
  "__v_isShallow": false,
  "_rawValue": { /* 实际数据 */ },
  "_value": { /* 实际数据（响应式代理） */ }
}
```

**必须通过 `._rawValue` 才能拿到原始数据**，直接读取 `.interactions`、`.basicInfo` 等属性会得到 `undefined`。

验证日期：2026-04-18

### 2.2 `userPageData._rawValue` 结构

```json
{
  "interactions": [
    { "type": "follows", "name": "关注", "count": "134" },
    { "name": "粉丝", "count": "16272", "type": "fans" },
    { "type": "interaction", "name": "获赞与收藏", "count": "35183" }
  ],
  "tags": [ /* 标签对象数组 */ ],
  "tabPublic": {},
  "extraInfo": { /* blockType, fstatus 等 */ },
  "result": {},
  "basicInfo": {
    "imageb": "https://sns-avatar-qc.xhscdn.com/avatar/...",
    "nickname": "博名",
    "images": "https://sns-avatar-qc.xhscdn.com/avatar/...",
    "redId": "42020694788",
    "gender": 0,
    "ipLocation": "北京",
    "desc": "简介文本"
  }
}
```

### 2.3 `userInfo._rawValue` 结构

```json
{
  "guest": false,
  "red_id": "42020694788",
  "user_id": "...",
  "nickname": "博名",
  "desc": "简介文本",
  "gender": 0,
  "images": "https://sns-avatar-qc.xhscdn.com/avatar/...",
  "imageb": "https://sns-avatar-qc.xhscdn.com/avatar/...",
  "userId": "...",
  "redId": "42020694788"
}
```

注意：`userInfo` 里没有 `ipLocation`、`interactions`、`tags`，这些只在 `userPageData` 中。

## 3. 注入脚本拆包规则

注入脚本 `src/injected/user.js` 的职责是读取 `__INITIAL_STATE__` 并通过 `postMessage` 传给 content script。

**当前已知陷阱：** Vue ref 对象必须拆包。拆包规则：

| 属性 | 是否需要 `._rawValue` | 状态 |
|------|----------------------|------|
| `userInfo` | 需要 | 已拆包（`user.js` 第 8 行用了 `userInfo?._rawValue`） |
| `userPageData` | 需要 | **之前未拆包**，已在 2026-04-18 调研后修复 |

## 4. DOM 选择器验证记录

以下选择器在 2026-04-18 实际验证通过：

| 选择器 | 用途 | 验证结果 | 示例输出 |
|--------|------|---------|---------|
| `.user-name` | 博主名称 | 正常 | `孙爸养A娃（成长版）` |
| `.user-redId` | 小红书号（含前缀"小红书号："） | 正常 | `小红书号：42020694788` |
| `.user-IP` | IP 属地（含前缀"IP属地："） | 正常 | `IP属地：北京` |
| `.user-desc` | 个人简介 | 正常 | `混合型ADHD清华经管本科爸爸...` |
| `.user-image` | 头像（src 属性） | 正常 | `https://sns-avatar-qc.xhscdn.com/avatar/...` |

## 5. 博主采集数据优先级

`authorCollector.js` 的实际数据获取优先级：

| 字段 | 首选来源 | 兜底来源 | 备注 |
|------|---------|---------|------|
| 名称 | DOM `.user-name` | `basicInfo.nickname` / `userInfo.nickname` | DOM 优先 |
| 小红书号 | DOM `.user-redId` | `basicInfo.redId` / `userInfo.redId` | 需去掉前缀 |
| IP 属地 | `basicInfo.ipLocation` | DOM `.user-IP` | API 数据更可靠，不受 DOM 结构变化影响 |
| 简介 | DOM `.user-desc` | `basicInfo.desc` / `userInfo.desc` | DOM 优先 |
| 头像 | DOM `.user-image` src | `basicInfo.imageb` / `basicInfo.images` | DOM 优先 |
| 粉丝/关注/获赞 | `userPageData.interactions` | 无兜底 | DOM 无此数据，纯依赖 `__INITIAL_STATE__` |
| 标签 | `userPageData.tags` | 无兜底 | DOM 无可靠选择器 |
| 性别 | `basicInfo.gender` | 无 | 0=女, 1=男 |
| 关注关系 | `extraInfo.fstatus` | 无 | |

## 5.1 2026-06-01 搜索页笔记流回归验证

验证页面：`/search_result?keyword=课题分离&source=web_search_result_notes&type=51`

本次验证结论：

| 项目 | 当前结构 | 结论 |
|------|----------|------|
| 笔记流容器 | `.feeds-container` | 仍存在且可见，搜索页首屏 1 个容器 |
| 卡片外壳 | `.feeds-container section` / `section.note-item` | 仍存在；首屏 30 个 section 中 27 个是真实笔记，3 个是“相关搜索” |
| 真实笔记判定 | `section` 内存在 `a.cover`，且 href 能提取 noteId | 仍是更可靠的过滤条件，不能只按 `section.note-item` 计数 |
| 卡片链接 | `a.cover` | 搜索页 href 当前为 `/search_result/{noteId}?xsec_token=...`，打开后进入 `/explore/{noteId}` |
| 卡片标题 | `.title` 或限定在 section 内的 `.footer span` | `.title` 更干净；`.footer span` 全页匹配过宽，必须限定在单卡片内 |
| 卡片点赞 | `.like-wrapper .count` | 搜索页卡片内可用；详情页同名选择器会混入评论点赞，不能跨页面直接全局读 |
| 视频标识 | `.play-icon` | 搜索页可用，本次首屏识别到 3 个视频标识 |
| 详情容器 | `#noteContainer` / `.note-container` | 打开搜索页第一条笔记后可见 |
| 评论容器 | `.comments-container` | 详情页可见，本次样本首屏 10 组主评论、16 条评论项 |
| 详情数据 | `window.__INITIAL_STATE__.note.noteDetailMap[{noteId}]` | 命中当前笔记，含 `interactInfo`、`imageList`、`tagList`、`user` 等字段 |

滚动验证：

- 搜索页滚动 6 轮后，DOM 累计发现 57 个唯一笔记 ID。
- `window.__INITIAL_STATE__.search.feeds` 当前有 88 条，其中 `modelType=note` 为 80 条，`modelType=rec_query` 为 8 条。
- `search.feeds[].noteCard` 当前包含 `displayTitle / user / interactInfo / cover / imageList / type`，可作为后续增强“列表发现兜底”的候选数据源。

维护建议：

1. 当前代码继续以 `section + a.cover + noteId` 过滤真实笔记是正确的，可避开“相关搜索”混入。
2. 搜索页批量发现只依赖 DOM 会受可见区域和懒加载影响；后续若要提高稳定性，可增加 `__INITIAL_STATE__.search.feeds` 作为列表发现兜底。
3. 本次只刷新搜索页笔记流与详情页样本，不代表博主页、评论图片样本、子评论展开等旧选择器已全部重新验证。

## 5.2 2026-06-01 搜索页筛选面板调研与落地

验证页面：`/search_result?keyword=A娃的启动困难&source=web_search_result_notes`

筛选面板当前可见分组：

| 分组 | 可见选项 | 本轮插件支持 |
|------|----------|--------------|
| 排序依据 | 综合 / 最新 / 最多点赞 / 最多评论 / 最多收藏 | ✅ 支持 |
| 笔记类型 | 不限 / 视频 / 图文 | ✅ 支持 |
| 发布时间 | 不限 / 一天内 / 一周内 / 半年内 | ✅ 支持 |
| 搜索范围 | 不限 / 已看过 / 未看过 / 已关注 | 不支持，本轮不实现 |
| 位置距离 | 不限 / 同城 / 附近 | 不支持，本轮不实现 |

状态结构：

- 当前页面筛选状态可从 `window.__INITIAL_STATE__.search.filterParams` 读取。
- 本轮只读取并记录三类字段：`sort_type`、`filter_note_type`、`filter_note_time`。
- `filter_note_range` 和 `filter_pos_distance` 只作为页面可见信息记录在调研结论中，不进入插件配置。

实现口径：

1. 小红书搜索页批量采集弹窗新增三组筛选控件。
2. 用户选择明确筛选项后，插件先在搜索页打开筛选面板并点击对应选项。
3. 筛选点击确认后，插件等待笔记流刷新并连续稳定，再开始扫描笔记流。
4. 如果三组都选择“沿用当前”，插件不改动页面，只读取当前筛选快照并写入本轮采集配置。
5. 旧的“按点赞 Top N”本地排序在小红书搜索页不再作为主筛选入口；“最多点赞”改走小红书页面自身的排序依据。

外部 Chrome 验证补充：

- 小红书筛选选项存在重复渲染层，同一个选项会出现外层和内层两个可见节点；点击外层可能不触发页面筛选切换。
- 插件现在会优先点击实际选中样式会变化的内层选项，并在每组筛选后确认目标选项已 active。
- 如果页面未切换成功，批量任务会停在筛选阶段并提示“小红书筛选失败”，不再继续打开笔记造成采集卡住。
- 筛选成功不等于结果列表已经刷新。插件会读取 `.feeds-container` 前若干真实笔记卡片的 noteId、标题、点赞等摘要，等摘要变化且连续稳定后才进入扫描；如果页面迟迟不稳定，会停在筛选阶段并提示刷新后重试。

## 6. 已知问题与修复记录

### 6.1 Vue ref 未拆包导致博主字段全丢（已定位）

- 现象：博主页采集后，粉丝/获赞/关注显示 0，头像/简介在某些页面丢失
- 根因：`user.js` 传递 `userPageData` 时未拆包 `._rawValue`，导致 `interactions` 和 `basicInfo` 全部读到 `undefined`
- 影响：P0 1.1 + P0 2.2（IP 属地被简介污染，因为 basicInfo 丢失后回退到 DOM，DOM 选择器在某些页面偏移）
- 修复：`user.js` 第 5 行改为 `userState.userPageData?._rawValue || userState.userPageData || {}`
- 发现日期：2026-04-18

### 6.2 IP 属地被简介内容污染

- 现象：IP 属地显示为"广东来加入我的原生家庭训练营"（实为简介文本）
- 根因链条：`basicInfo` 因 Vue ref 未拆包而为空 → `ipLocation` 清洗后为空 → Dashboard 渲染时回退读 `location`（来自 DOM `.user-IP`） → 某些页面 `.user-IP` 匹配到错误元素 → `location` 污染
- 与 6.1 同根因，修复 Vue ref 拆包后 `basicInfo.ipLocation` 恢复为首选数据源，问题消除

### 6.3 视频笔记下载失败

- 现象：小红书视频笔记采集后点击媒体下载，视频资源可能下载失败。
- 根因链条：视频文件大，不能稳定通过插件消息搬运成 ZIP；同时旧视频直链过期后，小红书链路没有刷新后重试，且 `h266` / 备用链接未完整进入候选队列。
- 修复：图片笔记继续打包 ZIP；视频笔记改为直接下载视频文件，失败时先刷新当前笔记媒体链接再重试；视频候选流保留 `h266 / h265 / h264 / av1` 和 `backupUrls / urlList` 等备用链接。
- 发现日期：2026-05-09

## 7. 小红书页面维护最佳实践

1. **每次博主页采集异常排查**：先在 Console 运行探查脚本（见下方），确认 `__INITIAL_STATE__` 结构是否变化。
2. **DOM 选择器 30 天过期检查**：小红书前端更新频繁，超过 30 天应重新验证；2026-06-01 已回归搜索页笔记流和单条详情样本，博主页与评论图片样本仍需按各自日期单独复验。
3. **不要假设 `__INITIAL_STATE__` 的属性是原始对象**：Vue ref 包装可能出现在任何新加的属性上，读取时始终考虑 `._rawValue` 兜底。
4. **视频笔记下载不要走大文件 ZIP 搬运**：视频资源应直接下载；如果失败，先刷新笔记媒体链接并重试，再给出失败提示。

## 8. 快速探查脚本

博主页数据结构验证（在 `/user/profile/{userId}` 页面 Console 运行）：

```js
try { console.log(JSON.stringify({
  avatarDom: !!document.querySelector('.user-image'),
  avatarSrc: document.querySelector('.user-image')?.src?.substring(0, 80),
  descDom: !!document.querySelector('.user-desc'),
  descText: document.querySelector('.user-desc')?.textContent?.trim()?.substring(0, 40),
  ipDom: !!document.querySelector('.user-IP'),
  ipText: document.querySelector('.user-IP')?.textContent?.trim(),
  nameDom: !!document.querySelector('.user-name'),
  nameText: document.querySelector('.user-name')?.textContent?.trim(),
  redIdDom: !!document.querySelector('.user-redId'),
  redIdText: document.querySelector('.user-redId')?.textContent?.trim(),
  hasState: !!window.__INITIAL_STATE__,
  updRawKeys: Object.keys(window.__INITIAL_STATE__?.user?.userPageData?._rawValue || {}),
  updInteractions: window.__INITIAL_STATE__?.user?.userPageData?._rawValue?.interactions,
  updBasicInfo: window.__INITIAL_STATE__?.user?.userPageData?._rawValue?.basicInfo,
  uiRawKeys: Object.keys(window.__INITIAL_STATE__?.user?.userInfo?._rawValue || {}),
}, null, 2)) } catch(e) { console.log('ERROR:', e.message) }
```

用途：一次性确认 DOM 选择器是否正常、`__INITIAL_STATE__` 结构是否变化、Vue ref 拆包是否正确。
