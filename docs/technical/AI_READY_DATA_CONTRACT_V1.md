# AI Ready 数据契约 v1

> 目标：让小红书与抖音采集到的数据，不只是“能展示”，而是能稳定地进入 AI 大模型分析链路。
> 本文是后续数据结构重构、批量采集、评论采集、二次下载能力的统一设计基线。

## 1. 设计目标

AI 可用的数据契约，必须同时满足 4 件事：

1. 能明确知道“这条数据是谁、来自哪里、何时采到”
2. 能保留平台原始结构，方便后续重算
3. 能跨平台统一字段语义，方便模型直接比较
4. 能表达关系结构，尤其是评论树与作者-内容关系

## 2. 数据分层

后续所有采集结果，建议按 3 层理解：

### 2.1 Raw 原始层

保留平台原始证据，便于追溯与重算：

- `rawPayload`
- `rawDomText`
- `rawShareText`
- `rawUrl`
- `collectorVersion`

### 2.2 Canonical 标准层

对小红书与抖音做统一命名：

- `platform`
- `contentId`
- `platformContentId`
- `authorEntityId`
- `platformAuthorId`
- `publishedAt`
- `collectedAt`
- `updatedAt`

### 2.3 Derived 分析层

为后续 AI 分析直接提供特征：

- `contentType`
- `normalizedGeo`
- `engagementRate`
- `commentDepth`
- `language`
- `riskFlags`

## 3. 核心表建议

## 3.1 contents

一条内容就是一条笔记或视频。

| 字段 | 说明 |
|------|------|
| `contentId` | 全局主键，建议格式：`{platform}_{platformContentId}` |
| `platform` | `xhs` / `douyin` |
| `platformContentId` | 平台原始内容 ID |
| `url` | 当前内容链接 |
| `canonicalUrl` | 去噪后的标准链接 |
| `contentType` | `image_post` / `video_post` / `mixed_post` |
| `title` | 清洗后的标题 |
| `bodyText` | 清洗后的正文 |
| `hashtags` | 话题列表 |
| `mentions` | @对象列表 |
| `keywords` | 平台原始关键词 |
| `topicIds` | 平台原始话题 ID |
| `authorEntityId` | 关联到 authors 表 |
| `authorName` | 作者名快照 |
| `coverUrl` | 稳定封面图。同步到内容工作台前，插件会尽量把第三方封面图片上传为工作台资产，并把这里替换为稳定 `publicUrl` |
| `sourceCoverUrl` | 原第三方封面链接，仅用于来源追溯，不作为长期展示地址 |
| `originalCoverUrl` | 采集时拿到的原始封面链接，便于排查与回溯 |
| `coverMediaAssetId` | 工作台封面资产 ID；上传失败或未上传时可为空 |
| `coverStorageProvider` | 封面资产存储服务，例如 `vercel_blob` |
| `coverAssetUploadStatus` | 封面上传状态；失败时为 `failed`，采集记录仍可正常回传 |
| `coverAssetUploadError` | 封面上传失败原因，限制为排查摘要 |
| `imageUrls` | 图片列表；首图应尽量与稳定封面地址保持一致 |
| `videoPlayUrl` | 当前播放直链 |
| `videoDownloadUrl` | 当前下载直链 |
| `videoStreams` | 备选流列表 |
| `stats.likes` | 点赞数 |
| `stats.comments` | 评论数 |
| `stats.collects` | 收藏数 |
| `stats.shares` | 分享数 |
| `stats.plays` | 播放数 |
| `location.ipLocation` | 内容展示 IP 属地 |
| `location.genderTaggedLocation` | 类似“广东男”这种原始值，单独保存 |
| `publishedAt` | 标准发布时间戳 |
| `publishedAtText` | 原始展示时间 |
| `collectedAt` | 采集时间戳 |
| `updatedAt` | 最近更新时间 |
| `dataSource` | `dom` / `api` / `render` / `share` |
| `triggerSource` | `manual` / `native_share` / `batch_profile` |
| `collectionRunId` | 归属的采集任务 |
| `mediaDownloadStatus` | `无媒体` / `待下载` / `下载中` / `已完成` / `部分失败` / `失败` |
| `rawRef` | 指向 raw 证据的引用 |

## 3.2 comments

评论表必须支持分析评论树，而不只是平铺文本。

| 字段 | 说明 |
|------|------|
| `commentEntityId` | 全局主键，建议：`{platform}_{contentId}_{commentId}` |
| `platform` | 平台标识 |
| `commentId` | 平台原始评论 ID |
| `contentId` | 关联 contents |
| `contentTitle` | 当前内容标题快照 |
| `contentUrl` | 当前内容链接 |
| `authorEntityId` | 评论作者统一 ID |
| `authorName` | 评论作者名称 |
| `text` | 评论文本 |
| `likeCount` | 评论点赞数 |
| `ipLocation` | 评论 IP 属地 |
| `publishedAt` | 评论发布时间戳 |
| `publishedAtText` | 原始时间文案 |
| `parentCommentId` | 直接父评论 ID |
| `rootCommentId` | 所属主评论 ID |
| `level` | `1` 主评论 / `2` 二级评论 |
| `replyToCommentId` | 回复目标评论 ID |
| `replyToUserName` | 回复目标用户名 |
| `positionIndex` | 在当前抓取结果中的顺序 |
| `sortMode` | `hot` / `latest` / `unknown` |
| `collectedAt` | 采集时间 |
| `collectionRunId` | 所属批量任务 |
| `rawRef` | 原始证据引用 |

## 3.3 authors

作者表既要满足展示，也要满足后续画像分析。

| 字段 | 说明 |
|------|------|
| `authorEntityId` | 全局主键，建议：`{platform}_{platformAuthorId}` |
| `platform` | 平台标识 |
| `platformAuthorId` | 平台作者原始 ID |
| `profileUrl` | 作者主页链接 |
| `handle` | 平台账号名，如小红书号 / 抖音号 |
| `secUserId` | 抖音 sec_user_id（如适用） |
| `name` | 作者昵称 |
| `badge` | 认证/身份标记 |
| `ipLocation` | IP 属地 |
| `gender` | 标准化性别 |
| `stats.fans` | 粉丝数 |
| `stats.follows` | 关注数 |
| `stats.interactions` | 总互动数 / 总获赞 |
| `stats.postCount` | 发帖数 |
| `followedByMe` | 当前账号是否关注 |
| `accountStatus` | 账号状态 |
| `collectedAt` | 采集时间 |
| `rawRef` | 原始证据引用 |

字段语义补充约定：

- `handle` 是跨平台统一字段，后续 UI、导出、分析默认都应优先消费它。
- `redId` 仅作为小红书历史兼容字段保留，不再作为跨平台展示主字段。
- `douyinId` 仅作为抖音历史兼容字段保留，不再作为跨平台展示主字段。

## 3.4 collection_runs

这张表非常关键，用来回答“这批数据是怎么采来的”。

| 字段 | 说明 |
|------|------|
| `collectionRunId` | 主键 |
| `platform` | 平台 |
| `taskType` | `single_video` / `single_comments` / `batch_videos` / `batch_comments` / `author` |
| `pageType` | `profile` / `detail` / `modal` / `search` |
| `triggerSource` | `manual` / `native_share` / `batch_profile` |
| `targetCount` | 目标采集数 |
| `commentLimitPerContent` | 每条内容评论上限 |
| `commentSortMode` | 评论排序模式 |
| `status` | `running` / `paused` / `done` / `partial_failed` / `failed` |
| `successCount` | 成功数 |
| `failedCount` | 失败数 |
| `startedAt` | 开始时间 |
| `finishedAt` | 结束时间 |
| `failureItems` | 失败明细 |

## 3.5 media_assets

用于“批量采集后，数据面板还能二次下载”。

| 字段 | 说明 |
|------|------|
| `assetId` | 主键 |
| `contentId` | 关联 contents |
| `assetType` | `cover` / `image` / `video` / `comment_image` |
| `role` | `primary` / `fallback` |
| `url` | 当前可用链接 |
| `candidateUrls` | 候选链接列表 |
| `quality` | `HD` / `SD` / `unknown` |
| `downloadStatus` | 下载状态 |
| `lastResolvedAt` | 最近一次重新解析直链时间 |

## 4. 当前版本与目标版本的差距

### 4.1 已具备

- `notes / comments / authors` 三张主表
- 平台区分字段 `platform`
- 小红书笔记的 `topicIds / atUserList / hashtags`
- 抖音视频的 `shareShortUrl / triggerSource / dataSource`
- 基础评论父子关系 `parentCommentId`

### 4.2 尚未完全具备

- 历史记录的 AI-ready 字段持久化回填仍未全量执行
- `collection_runs` 已落地，但成功/失败明细和更细粒度任务阶段仍有深化空间
- `media_assets` 已落地，但仍在从评论图片区扩展到更多内容媒体
- 统一作者主键语义已在新数据与导出层开始收口，旧记录和部分 UI 仍有兼容负担
- 原始证据层已接入核心采集器，但更多平台媒体与历史记录尚未完全补齐
- 标准化发布时间戳已进入主链路，但旧记录与部分评论/作者场景仍需继续清洗

## 5. 与当前业务需求的直接关系

本轮讨论里确认的功能，都依赖这份契约：

- 抖音单条评论采集
- 抖音批量评论采集（前 5 / 10 / 20 条视频）
- 评论上限由用户填写，不填表示全部
- 包含二级评论
- 必须知道每条评论属于哪条视频
- 必须保留父评论与子评论层级
- 抖音评论区图片高清下载
- 抖音批量视频采集后，数据面板要支持二次下载视频

## 6. 实施优先级

### P0

- `contents` 与 `comments` 的统一主键与关系字段
- `collection_runs`
- 评论层级字段
- `media_assets` 的最小实现（至少覆盖视频与评论图片）

### P1

- 原始证据层
- 更完整的时间标准化
- 跨平台作者实体清洗
- 历史记录批量回填与一致性校验

### P2

- 派生分析字段自动计算
- AI 分析专用导出模板
