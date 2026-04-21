# 小红书字段与页面结构调研

更新时间：2026-04-18
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

## 7. 小红书页面维护最佳实践

1. **每次博主页采集异常排查**：先在 Console 运行探查脚本（见下方），确认 `__INITIAL_STATE__` 结构是否变化。
2. **DOM 选择器 30 天过期检查**：虽然 2026-04-18 验证通过，但小红书前端更新频繁，超过 30 天应重新验证。
3. **不要假设 `__INITIAL_STATE__` 的属性是原始对象**：Vue ref 包装可能出现在任何新加的属性上，读取时始终考虑 `._rawValue` 兜底。

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
