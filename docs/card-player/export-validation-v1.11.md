# 1.11.0 角色卡 JSON 独立播放器验收

## 实现范围

本轮在原有插件新增制作/导出入口，并继续使用已经验收的角色生命周期适配器。普通歌单绑定仍保存于完整版插件设置；新制作页明确生成携带播放器和资源的角色卡 JSON 副本。

| 文件 | 实际职责 |
| --- | --- |
| `card-maker.js`、`index.js`、`night-ui.css` | 独立制作面板、歌曲副本编辑、四主题、预览和下载；原播放器 UI 保持 |
| `card-player/config.js` | 只允许可携带的数据与媒体来源，规范化配置 |
| `card-player/export.js` | 本地字节打包、资源预算、许可证、JS/HTML/脚本 JSON、V2/V3 角色 JSON 合并与失败保护 |
| `card-player/browser-resources.js` | 浏览器真实解码检查、可取消的资源读取；检查本身不播放声音、不记入历史 |
| `card-player/runtime.js`、`entry.js` | 独立角色播放器与预览入口，复用本项目播放顺序、格式化、LRC 和图标功能；不依赖完整版运行时 |
| `scripts/build-card-demo.mjs`、`dist/runtime.js` | 固定 esbuild 构建可携带的运行时代码，并保留三曲生命周期回归脚本 |
| `tests/card-export.test.js`、`tests/card-maker.e2e.js` | 打包失败、数据保留、注入防护和真实角色 JSON 往返验收 |

未改 IndexedDB 数据库名称、版本、对象仓库、旧歌曲格式、原歌单 ID 或角色绑定格式。制作只读取歌曲/图片/字体，不用导出结果替换用户库。新独立播放器只在自己的角色/项目命名空间记忆音量。

## 测试环境与证据口径

- 真实 SillyTavern **1.19.0**，官方酒馆助手 **4.11.3**（与阶段一固定提交相同），Chromium。
- 制作端通过完整版插件 UI 选择歌单、编辑歌曲、上传封面、检查、预览、点击下载。测试背景/选中字体的初始状态用已生成的图片和已存在的内置字体构造，实际打包时读取真实 IndexedDB 与字体文件。
- 三首音频为本项目生成的合成 MP3，不使用参考角色卡的歌曲、UI、图片或私有实现。
- 输出实际含音乐角色卡 JSON，然后删除制作端的音乐数据库并关闭其浏览器上下文。
- 接收端是**新的浏览器上下文**，没有原曲库数据库；禁用完整版插件，并阻止其 JS、样式、图片、字体等资源加载。仍运行真实官方酒馆助手，通过酒馆真实 JSON 导入接口导入生成文件，在角色环境点击播放并观察音频进度。
- 接收端比较真实宿主音频对象；验证歌词、播放控制、同角色切开场白/聊天、退出清理、字体卸载，再用酒馆真实 JSON 导出接口导出并重新导入播放。
- 手机为 **375 × 844 的 Chromium 窄屏/触控模拟**，不是实体手机。普通独立 HTML 预览另测，不能代替上述角色环境验收。

## 结果

2026-10-16 验收：

| 检查 | 最终结果 |
| --- | --- |
| `npm run build:card-demo` | 生成独立运行时和三曲回归文件，通过依赖检查；运行时内携带本项目 MIT 原文 |
| `npm run check` | 通过 |
| `npm test` | **75 项通过**；包含 10 项新增导出测试（纯测试的解码依赖使用替身，不把它当真实播放） |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:card` | **3 组通过**；真实角色消息/开场白/AI swipe/编辑/重新生成/换聊天、重复执行、停用、PNG 往返和手机生命周期 |
| `CHROMIUM_PATH=/usr/bin/chromium npm run test:card-export` | **3 组通过**；制作 UI → JSON → 新浏览器独立播放/再次 JSON 往返，桌面与触屏模拟，以及错误/陈旧结果拦截；本轮约 2.8 分钟 |
| 原插件关键回归 | **17 个不同用例最终验证通过**；首轮 16 项通过，涟漪用例的时序断言修正后单独连续 3 次通过 |

新导出测试的机器记录、逐项清理结果和实际运行时代码 SHA-256 见 [export-validation.json](export-validation-v1.11.json)。角色生命周期回归的 AI 重新生成只替换远端 LLM/分词响应，酒馆流程、助手和音乐播放均为真实实现。

涟漪测试原先在两个工具往返之间读取只存在 480 毫秒的节点，节点已移除时计算样式为空。改为在真实点击创建节点的微任务中记录**仍连接于 DOM 的节点的实际计算宽度**，继续要求 30 px、禁用后清理、酒馆外点击不创建动效。未延长动画、未更改应用动效逻辑、未取消原行为断言。

关键回归覆盖原播放器加载、本地音频/进度/音量、四种播放结束模式、IndexedDB 与设置重载、歌单导入/改名/删除、多角色绑定、历史排行、背景裁剪、字体、透明歌词、缩放、点击范围、复选框、自定义歌单封面，以及夜航队列/浏览续播/移动布局。复现命令：

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- tests/player.e2e.js tests/night-ui.e2e.js --grep 'SillyTavern loads|local imports play|manual switching and all four|settings and IndexedDB|import destinations|one album binds|recent and ranking pages|cropping chooses|bundled GenWan font|resizing clamps|checkbox ticks|only player clicks|my music lists|lyrics occupy|B queue edits|B browsing keeps|B layout responds'
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- tests/player.e2e.js --grep 'only player clicks and blank' --repeat-each=3
```

所有浏览器命令只应在独立测试酒馆运行。角色套件会创建/删除带 `RSCP_Test_` 前缀的临时角色并修改测试设置；原插件回归使用自己既有的 `STM_Test_` 前缀。不要指向日常角色与聊天数据。

角色生命周期回归先收起浮层，再使用被它覆盖的聊天编辑按钮；每步仍比较同一个 audio、DOM、iframe 与播放进度。测试不使用强制点击穿过浮层，也没有取消消息操作的连续性断言。

实际截图：

- [制作端独立预览](maker-desktop.png)
- [新浏览器通过角色 JSON 导入后播放（桌面）](json-desktop.png)
- [新浏览器通过角色 JSON 导入后播放（手机触屏模拟）](json-mobile.png)

这些是实际运行截图，未把设计图或普通网页截图冒充角色脚本环境。

## 限制与后续

- 本轮真实独立播放验证使用内嵌 MP3；没有把 HTTPS 地址的静态校验或接口替身当成真实外网全曲播放成功。直链检查只验证当前浏览器可读取/解码，长期在线由音源服务保证。
- 角色卡 JSON 不携带头像，生成文件不自动写回原角色卡。制作面板的未导出草稿不持久化，尚无多项目草稿管理和同步。
- 没有新后端、收费部署或平台私密凭据。受限商业平台的动态音源/官方嵌入不能自动转换成独立可播放文件。
- 自定义字体授权说明由制作人提供，内置字体附带已有许可文本；不把运行时代码的 MIT 许可证套用到歌曲或字体。
- 未验证实体 iOS/Android、其他酒馆/助手版本、群聊或大规模离线曲库。字体与素材预算会明确拦截超限；没有声称可以无限量打包。
