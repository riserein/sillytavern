# 网易云、QQ 音乐、酷狗歌单接入调研

核对日期：2026-10-15。以下依据社区项目的接口文档与源代码；未使用真实平台账号完成登录和全曲播放验证。当前播放器 **尚未实现这些服务的连接、登录或歌单导入**，分享链接仍不能填入音频直链输入框。

## 可以做到什么

有技术途径。播放器可以连接用户自己运行的音乐 API 服务，由服务向音乐平台读取公开歌单、歌名、歌手、封面和歌词，播放器再按歌曲标识获取播放地址。需要账号权限的接口由该服务处理登录。部分公开数据无需登录，但能否完整读取取决于平台当前接口。

导入歌单列表与播放整首歌曲是两件事：拿到歌曲名称不代表拿到可播放的音频；账号登录后仍受会员、版权、地区、下架和接口可用性影响。播放地址通常会过期，后续接入必须在播放时获取或刷新，不能把一次取得的地址当成永久直链。

| 平台 | 可评估的社区服务 | 文档中的能力 | 登录方式 |
| --- | --- | --- | --- |
| 网易云音乐 | [NeteaseCloudMusicApiEnhanced](https://github.com/neteasecloudmusicapienhanced/api-enhanced) | `/playlist/detail`、`/playlist/track/all`、`/song/url/v1`、`/lyric` | `/login/qr/key`、`/login/qr/create`、`/login/qr/check` 扫码登录，亦支持会话凭证 |
| QQ 音乐 | [QQMusicApi](https://github.com/jsososo/QQMusicApi) | `/songlist`、`/song/url`、`/lyric` | 文档提供 `/user/setCookie` 设置登录会话；此项目较旧，需要实际验证接口是否仍可用 |
| 酷狗音乐 | [KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) | `/playlist/detail`、`/playlist/track/all`、`/song/url`，歌词搜索与下载 | `/login/qr/key`、`/login/qr/create`、`/login/qr/check` 扫码登录 |

接口来源：[网易云文档](https://github.com/neteasecloudmusicapienhanced/api-enhanced/blob/main/public/docs/home.md)、[QQ 文档](https://github.com/jsososo/QQMusicApi/blob/master/docs/README.md)、[酷狗文档](https://github.com/MakcRe/KuGouMusicApi/blob/main/docs/README.md)。这些是社区项目，并非平台为本插件提供的官方授权接口；平台变化可能导致接口失效。表中的登录方式是所选服务的文档能力，不代表所有服务都采用同一种方式。

## 为什么单独登录音乐 App 不够

电脑或手机 App 的登录状态属于该 App；酒馆中的网页插件无法直接读取。即使浏览器里登录了音乐官网，跨站 Cookie、同源策略和跨域限制也会阻止插件直接共用其会话。后续需要为所选 API 服务做专门的登录流程，支持扫码的服务可由本人扫码确认。账号会话应只交给自己信任的服务，不应提交到插件仓库、聊天或其他安装者共用的公开接口。

## 接入时需要的部署条件

服务可以运行在自己的电脑、与酒馆相同的服务器或独立服务器上，播放器需要一个能够访问的服务地址。手机访问电脑上的服务时应使用电脑的局域网地址，手机的 `localhost` 指手机自身。远程 HTTPS 酒馆还需要可用的 HTTPS 服务地址，或通过酒馆同域代理转发；服务也需要正确配置跨域与会话处理。

后续实现应保留“本地音乐和音频直链无需额外服务”的现有用法，单独提供平台连接设置、登录与退出、歌单导入进度、部分失败结果和播放地址刷新；平台歌曲无法播放时给出原因，不自动替换成其他录音。
