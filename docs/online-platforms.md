# 在线音乐升级：能力、实现与验证边界

> 这是 **1.8.0 历史调查**。1.9.0 已重新核查接口、平台条款与功能缺口；当前状态以 [后续阶段报告](v1.9-audit.md)、[真实验证记录](online-validation.md) 和 [默认库维护说明](default-library-guide.md) 为准。原记录保留以区分当时证据。

核对日期：2026-10-15。开始开发前核对的仓库版本为 **1.7.1 / 345ce79**。本次升级为 1.8.0，保留前端扩展的安装方式和原有界面，不引入第三方播放器 UI。

## 结论

可建立统一的多平台架构，逐步增加获准的接口。**目前没有经本次验证、无需应用注册、无需账号授权、无需运营服务，就能完整播放所有商业平台音乐的通用方案。** 普通用户免配置与开发者免维护是不同目标。

本版本默认提供 Openverse 公开许可音频的搜索与单曲链接读取代码；Audius 适配器只在维护者配置公开应用 Key 后启用。其他平台可以识别下表所列的完整分享链接，歌曲可明确作为“来源书签”保存，并前往官方平台收听；无法读取的平台歌单不会导入成空歌单或虚报成功。

Openverse 包含音乐、环境声、音效等，不能把它说成网易云或 QQ 商业曲库的替代来源。不会自动跨平台替换录音。

## 平台能力调查

表中“调查能力”不等于本版本已启用。涉及账号的部分未用真实账号验证；SDK资格、配额及平台政策在正式接入时仍需重新核对。

| 平台 | 关键词搜索 | 歌曲分享链接与信息 | 公开歌单 | 插件内完整播放 | 1.8.0 默认状态 |
| --- | --- | --- | --- | --- | --- |
| 网易云音乐 | Meting/社区接口有实现 | 可识别歌曲 ID；社区服务能读元数据 | 社区接口有实现，完整列表需分页 | 受账号、曲目权限及服务可用性限制；代码开源不等于播放获授权 | 完整歌曲链接保存来源书签；歌单读取未启用 |
| QQ 音乐 | Meting/社区接口有实现 | 可识别 songmid；社区服务能读元数据 | 社区接口有实现 | 部分接口需用户会话，VIP/数字专辑权限不能绕过 | 来源书签；歌单读取未启用 |
| 酷狗音乐 | Meting/社区接口有实现 | 可识别完整歌曲 hash 链接 | 社区接口有实现 | 社区项目含扫码登录，仍需验证曲目权限、授权与实际音源 | 来源书签；歌单读取未启用 |
| 酷我音乐 | Meting 声明支持 | 可识别 play_detail 链接 | Meting 声明支持 | 本次未确认获准、稳定的完整播放接入 | 来源书签；歌单读取未启用 |
| 咪咕音乐 | 本次未确认合适的公开接入 | 可识别标准歌曲路径 | 可识别标准歌单路径，未实现读取 | 未确认 | 来源书签；歌单读取未启用 |
| Spotify | 官方 Web API 需开发者应用、相应授权 | 可识别歌曲 ID；元数据接入仍需按官方流程 | 官方 API 有相应能力，受权限和应用模式限制 | Web Playback SDK、账号授权及符合条件的账号；通常有 Premium 等资格要求，未实测 | 来源书签，不假装已接入 SDK |
| YouTube Music | 不能假设存在开放的通用音乐 API；YouTube Data API 的视频搜索是另一项能力 | 可识别 watch/youtu.be 的视频 ID | 可识别 playlist 的 list ID；读取需相应 API 接入 | 使用获准的官方视频播放器；不能提取音频直链或隐藏必需的视频/品牌展示 | 来源书签，不抽取音频 |
| Apple Music | Music API 需开发者接入；iTunes 搜索是另一服务 | 可识别歌曲 ID，专辑链接必须含歌曲 i 参数或使用 song 路径 | Music API 有条件读取 | MusicKit、开发者 token、用户授权及相应订阅资格 | 来源书签；不把试听当完整歌曲 |
| SoundCloud | 官方 API 有应用接入条件 | 可识别完整 user/track 路径；短链需先展开 | 可识别 user/sets/list 路径 | 根据曲目和平台条件使用官方 API/Widget，不能保证全曲库可播 | 来源书签；未隐藏嵌入播放器冒充原生音源 |
| Audius | 官方 SDK 提供，当前文档要求开发者 API Key | 官方 resolve 接口提供 | 官方歌单/曲目接口提供 | 仅允许可直接流播、非门控的曲目；不绕过购买或访问条件 | 适配器已实现，维护者未配置 Key，默认不显示为可搜索 |
| Openverse | 公开许可音频 API 有匿名读取方式 | 音频 UUID 可读取详情 | 不是通用音乐平台歌单服务 | 对具有明确 CC0、PDM、CC BY、CC BY-SA 许可和原站音频 URL 的记录尝试播放；原站失效、浏览器格式和网络仍可能使其不可播 | 搜索、单曲读取及播放解析代码已接入；真实外网实测受本次环境限制 |

“歌曲链接识别”只解析平台和资源标识，不会把分享网页交给 HTML Audio。没有真实元数据时显示“来源书签”，允许手动给书签起名；未加载的封面与歌手不会伪造。链接短域、重定向、私密歌单和非标准路径不保证可识别，会提示先在官方页面打开完整地址。

## Meting 三个项目的核查

- [Meting](https://github.com/metowolf/Meting)：本次读到的 master 是 Node.js 的 `@meting/core`，package.json 为 1.6.2，README 与 LICENSE 为 MIT。声明支持网易云、QQ、酷狗、百度、酷我；**没有因此推断它支持咪咕或所有国际平台**。
- [Meting-API](https://github.com/metowolf/Meting-API)：当前 README 描述 Hono 服务，包装统一接口；搜索、歌曲和歌单返回列表，url/pic/lrc 等接口有服务鉴权设计，部分来源使用服务端 Cookie。它是需要运营的后端，不是把一段 JS 引入扩展就能获得稳定授权音源。
- [MetingJS](https://github.com/metowolf/MetingJS)：是配合 APlayer 的前端组件，源码中包含公共 API 示例地址。它不提供音乐版权，也不能证明第三方公共服务允许本插件长期、大量使用。本扩展未引入 APlayer 或复制其界面。

对 `api.i-meto.com` 与 `api.injahow.cn` 的探测被当前云环境的出口代理拦截，未获得源站响应。因此本次**不能确认**公共服务在线状态、CORS、搜索、歌单完整性、实际音频、请求配额、使用许可或可用性承诺；也不能把代理 403 写成“接口已经关闭”。它们没有被硬编码为默认服务。现有代码不共享任何会员 Cookie，不请求私人密钥。

四项权利必须分别核对：开源代码许可证、API 服务使用条件、平台服务条款、录音/词曲等内容使用条件。HTTP 200 或开源许可证均不能代替后几项。

## 本次实际完成的模块

| 文件 | 职责 |
| --- | --- |
| `platforms/catalog.js` | 平台名称、稳定复合 ID、歌曲/许可/来源元数据校验 |
| `platforms/links.js` | 分享文字提取和十一平台标准歌曲、歌单路径识别 |
| `platforms/request.js` | 有界请求超时、AbortSignal、结果缓存、429/Retry-After、权限和网络错误；不无限重试 |
| `platforms/providers.js` | Openverse 与条件启用的 Audius；解析时保留许可，不拿试听或受限曲目冒充完整歌曲 |
| `platforms/service.js` | 能力注册、并行搜索和单来源失败隔离、预览、播放时解析 |
| `platforms/library.js` | 默认曲库独立查询、导入前容量检查、复用来源歌单 |
| `online-panel.js` | 原风格内的导入方式、搜索、分享预览、取消、确认、署名与站外链接 |
| `builtin-tracks.js` | 随版本分发的默认元数据，目前为空 |
| `platforms/builtin-maintenance.js`、`scripts/update-builtin.mjs` | 开发者读取正式来源并原子生成默认数据；失败不覆盖旧数据 |
| `core.js` | `platform` 曲目、旧数据保留、默认曲库与用户副本、来源歌单标识、播放记录兼容 |
| `index.js`、`player-components.js`、`style.css` | 与现有播放、曲库、角色、封面、黑胶条和磨砂界面衔接 |

搜索来源选项仅显示实际启用的搜索适配器；当前默认只有 Openverse。“全部来源”指全部已启用的来源。跨平台名称相同并不保证同一录音，故不按名称自动合并；相同平台 ID 则复用。暂不提供商业平台的账号登录入口，既不读取音乐 App 的登录状态，也不让用户手工提交 Cookie。

## 默认曲库与开发者维护

用户尚未确定正式歌曲，本版本 `builtin-tracks.js` 保持空。不会把测试音频、测试歌单或任意挑选的曲目变成正式预设。

1. 开发者确定获准的歌曲或公开歌单完整链接。当前生成器可用来源为 Openverse 单曲，以及开发者接入后的 Audius 歌曲/歌单。
2. 对需要开发者接入的来源，由维护者完善 `platforms/config.js`。Audius 文档区分可公开的应用 API Key 与仅供后端使用的 Bearer Token；只允许配置前者，**不把 Bearer Token、Cookie、Spotify client secret 或 Apple 私钥放入扩展**。普通安装者不填写 Key。
3. 在仓库运行，例如：

   ```sh
   node scripts/update-builtin.mjs --source "正式歌曲或歌单完整链接" --name "默认曲库"
   ```

   可重复使用 `--source` 合并多个来源；可用 `--out /tmp/builtin-review.js` 先生成供审查的文件。
4. 生成器保留顺序、按平台 ID 去重，只保存元数据；书签、未完整读取的歌单或请求失败会让整个生成失败，旧文件保留。不会暗中选取其他平台的录音。
5. 检查作品来源、许可、署名、数量、权限和实际播放，再提交 `builtin-tracks.js`，发布新版本。

启动插件读取随版本附带的 JS 数据，不重新请求开发者歌单。默认曲库不占 50 个自建歌单名额；可在外观页隐藏。加入自建歌单会保存自己的曲目副本，后续默认曲库新增、删曲、改名不会覆盖该副本和角色绑定。默认数据不重复塞进酒馆用户设置。浏览器本地音频数据库及 blob ID 不变。

若正式来源是当前尚未接入的网易云、QQ 或 Spotify 歌单，生成器会说明能力缺失并停止，而不是生成一个看似成功、实际上没有音乐的默认库。后续需先补齐获准的服务接入。

## 是否需要后端

- 本地音乐、音频直链与当前 Openverse 适配器不要求安装者部署额外后端。
- Audius 当前文档允许前端使用公开应用 Key；维护者申请与配置后可启用相应适配器，不把敏感 Bearer Token发给前端。
- 若希望普通用户免配置地使用商业平台搜索和完整歌单读取，通常需要维护者提供已获准的服务、应用凭证及配额管理；不能把成本和授权从架构中抹掉。
- Spotify 的秘密凭证和 Apple token 签发等适合维护者控制的服务；PKCE、回调地址、账号授权和公开分发资格还需单独设计。当前没有部署这些服务、申请应用或实现账号登录。用户无需为本次升级安装服务端插件。

## 重要限制与测试口径

- **真实外网尚未通过本次验证。** 外部文档和 API 的连接出现出口代理 `Tunnel connection failed: 403 Forbidden`；GitHub 上的官方源码、SDK README 与 Meting 文档可以读取。测试所需域名已保存云环境网络配置草稿；草稿保存不等于已应用运行时配置。没有把代理响应算成平台 HTTP 错误，也没有声称完成真实账号登录或商业全曲播放测试。
- Openverse 源码给出的匿名限额默认值为 `5/hour`、`100/day`；实际生产也可能由网关和配置管理，当前配额未实测。客户端缓存查询及近期音频元数据，遵守 429/Retry-After，不能保证无限搜索。
- 音频来自 Openverse 记录指向的原站，可能存在失效、访问限制、格式或 HTTPS 问题；不代理或搬运文件。搜索查询会发送到所选服务；原站会收到图片/音频请求。许可及作者归属随元数据保留并在界面中显示。
- 自有总曲库维持 **200 首**上限；整个导入超出容量就明确拒绝，**不保存前 20 首或前 200 首后虚报全量成功**。Audius 歌单适配器分页读取，有重复页、声明数量不符、无效记录或超过 2000 条保护上限时停止，不给成功预览。
- 单元测试覆盖 URL/主机欺骗、元数据、限流、超时、取消、分页、去重、默认库升级和旧数据。浏览器测试使用明确的接口响应替身及本项目生成的 WAV，实际运行 HTML Audio 验证播放、暂停和时长；**这些不是外部 API 或商业歌曲的在线实测**。
- 曲目必须触发真实 `playing` 事件才进入历史和排行；纯来源书签不会伪造播放成功。角色切换保持手动播放；离开聊天取消仍在解析的音源并暂停。

## 可核对的来源

已读取的 GitHub 文件：

- [Meting README](https://github.com/metowolf/Meting/blob/master/README.md)、[package.json](https://github.com/metowolf/Meting/blob/master/package.json)、[MIT LICENSE](https://github.com/metowolf/Meting/blob/master/LICENSE)。
- [Meting-API README](https://github.com/metowolf/Meting-API/blob/master/README.md)、[MetingJS 源码](https://github.com/metowolf/MetingJS/blob/master/src/Meting.js)。
- [网易云社区接口文档](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/public/docs/home.md)、[QQ 社区接口文档](https://github.com/jsososo/QQMusicApi/blob/master/docs/README.md)、[酷狗社区接口文档](https://github.com/MakcRe/KuGouMusicApi/blob/main/docs/README.md)。
- [Audius 官方 SDK 文档](https://github.com/AudiusProject/audius-protocol/blob/main/packages/sdk/README.md)：当前 Key、Bearer Token、前后端和 OAuth 的区别。
- [Spotify 官方 TypeScript SDK](https://github.com/spotify/spotify-web-api-ts-sdk)、[官方 Web Playback 示例](https://github.com/spotify/spotify-web-playback-sdk-example)。
- [Openverse 音频接口](https://github.com/WordPress/openverse/blob/main/api/api/views/audio_views.py)、[音频字段及毫秒时长](https://github.com/WordPress/openverse/blob/main/api/api/models/audio.py)、[限流默认值](https://github.com/WordPress/openverse/blob/main/api/conf/settings/rest_framework.py)。源码描述能力不等于本次访问到了生产服务。

需在网络可用时进一步核对的官方文档：

[Spotify Web API](https://developer.spotify.com/documentation/web-api)、[Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk)、[YouTube Data API](https://developers.google.com/youtube/v3/docs)、[IFrame API](https://developers.google.com/youtube/iframe_api_reference)、[YouTube 政策](https://developers.google.com/youtube/terms/developer-policies)、[Apple MusicKit](https://developer.apple.com/musickit/)、[SoundCloud API](https://developers.soundcloud.com/docs/api/guide)、[SoundCloud Widget](https://developers.soundcloud.com/docs/api/html5-widget)、[Openverse API](https://api.openverse.org/v1/)。本次未将无法访问的页面当作已现场核验的依据。
