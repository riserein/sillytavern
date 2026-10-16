# 阶段一：审查、角色常驻原型和真实助手验收

范围：在现有 1.10.0（`1c290bf`）仓库上增加独立角色播放器原型。先解决生命周期，不开发制作器、不大规模重构 UI，不修改正式插件入口或现有 IndexedDB。

## 参考文件审查

仅分析用户提供的 `10.11Oswin.json` 中名为“播放器悬浮球”的脚本。参考脚本注明作者 Mimi、角色卡中为授权使用；本仓库不收录参考角色卡、其脚本、UI、歌曲、封面或第三方音源配置。

| 研究项 | 观察到的机制 | 本原型的选择 |
| --- | --- | --- |
| 助手脚本结构 | `data.extensions.tavern_helper.scripts` 中的 `type: script` 对象，含 enabled/name/id/content/info/button/data/export_with | 采用经官方类型和真实导入入口验证的对象格式，不发明新格式 |
| 主页面挂载 | 从父/顶层取得主页面 document，创建独立浮层 | 用已验证的助手脚本 iframe 的父 document，挂载到主页面 body；不挂在消息或开场白中 |
| 音频实例 | 浮层里有一个 audio，切歌曲更换音源 | 用主页面 document 创建唯一 audio，避免音频节点属于消息/脚本 iframe 文档 |
| 重复初始化 | 发现旧根节点就调用旧 cleanup 并重新创建 | 同一项目和角色已有实例时直接复用；普通聊天/开场白不重建 |
| 事件 | 监听 CHAT_CHANGED、开场白/消息事件，另有同步轮询 | 只监听 CHAT_CHANGED 后比较角色头像标识；同角色新 chatId 也不清理。不需要订阅每条消息事件 |
| 开场白 | 根据首条消息 swipe 选歌，定时同步 | 不读取开场白、不随 swipe 换歌，保留用户正在听的音乐 |
| 清理 | pagehide 时取消定时器、请求、淡入淡出、媒体会话及 DOM | 角色变更、脚本 pagehide/unload、主页面 pagehide、iframe 移除均进入同一个幂等清理入口 |
| 歌曲存储 | 预置列表在代码中；本地文件在浏览器 IndexedDB，播放时生成 blob URL；状态另存 localStorage | 原型只携带本项目生成的三段 MP3 字节；独立角色命名空间仅存音量，原数据库完全不动 |
| 随卡导出 | 脚本 content 随角色扩展字段保存；export_with 决定脚本变量/按钮是否携带 | 音频已嵌入 content；PNG 真实往返验证其携带。export_with 不会把浏览器 IndexedDB 文件自动打包 |

重要区别：参考脚本能正常显示，不能直接证明它符合本任务“切开场白仍保留同曲同进度”的要求，所以没有直接复制它的初始化与开场白联动逻辑。

## 当前官方接口核查

核查的酒馆助手为 **4.11.3 / `a0f3a180344cff38a4b3e75041d5a94380b877d6`**。下面链接指向固定提交，不依赖随时变化的 main：

- [ScriptTree / Script 对象格式](https://github.com/N0VI028/JS-Slash-Runner/blob/a0f3a180344cff38a4b3e75041d5a94380b877d6/src/type/scripts.ts)。
- [脚本文件真实导入逻辑](https://github.com/N0VI028/JS-Slash-Runner/blob/a0f3a180344cff38a4b3e75041d5a94380b877d6/src/panel/script/Toolbar.vue)：导入会重新分配 ID，并强制设为停用。
- [角色设置读取与导出处理](https://github.com/N0VI028/JS-Slash-Runner/blob/a0f3a180344cff38a4b3e75041d5a94380b877d6/src/store/settings/character.ts)。
- [脚本运行时身份](https://github.com/N0VI028/JS-Slash-Runner/blob/a0f3a180344cff38a4b3e75041d5a94380b877d6/src/store/iframe_runtimes/script.ts) 与 [iframe key](https://github.com/N0VI028/JS-Slash-Runner/blob/a0f3a180344cff38a4b3e75041d5a94380b877d6/src/panel/Script.vue)：角色来源头像 + 脚本 ID + 显式重载标记，没有 chatId 或 messageId。
- [事件注册/移除](https://github.com/N0VI028/JS-Slash-Runner/blob/a0f3a180344cff38a4b3e75041d5a94380b877d6/src/function/event.ts) 与 [脚本 iframe 预定义](https://github.com/N0VI028/JS-Slash-Runner/blob/a0f3a180344cff38a4b3e75041d5a94380b877d6/src/iframe/predefine.js)：eventOn/eventRemoveListener/getScriptId 在脚本 iframe 中提供，不假设父页面 TavernHelper 上有同名未绑定接口。

本原型使用 `getCurrentCharacterId()`、`getScriptId()`、`getScriptTrees({type:'character'})`、`eventOn(tavern_events.CHAT_CHANGED, handler)` 和 `eventRemoveListener(..., handler)`。不是照搬参考里的旧事件移除名称。角色身份使用头像标识，不使用姓名、列表序号或 chatId。

## 实现与资源所有权

- `card-player/entry.js`：助手适配器，拒绝全局脚本/消息脚本，核实当前启用的角色脚本；提供可移除的宿主、iframe 和角色订阅。
- `card-player/lifecycle.js`：角色生命期控制器；初始化失败也回收已注册的资源，一个清理失败不妨碍剩余清理。
- `card-player/runtime.js`：一个主页面 Shadow DOM、一个主页面 audio；复用项目已有 formatTime、playSymbol、clampPosition；无完整版插件运行依赖。
- `scripts/build-card-demo.mjs`：阶段一测试构建器，不是第三阶段制作器；验证没有把完整版入口/存储代码或动态 import 打进独立脚本。
- `card-player/dist/`：独立 JS、助手脚本 JSON、歌曲清单；`demo-assets/` 为原创合成测试音。
- `tests/card-lifecycle.test.js`、`tests/card-player.e2e.js` 和独立 Playwright 配置：状态机及真实助手验收。

实例只登记在自己的根 DOM 属性上，不写通用的父窗口全局变量。角色/项目相同的重复调用复用原实例。界面和音频 DOM 事件使用统一 AbortController；角色事件显式移除；iframe 观察器显式断开。**没有业务轮询或 setInterval/setTimeout 定时器**。

退出时：先停止所有订阅与观察器，再 abort 所有音频/界面/窗口 DOM 监听，暂停音频、移除 src、调用 load 释放资源、移除 audio 与根节点。音量命名空间含项目 ID 和角色 ID，不与完整版设置、参考作品或另一角色混用。

## 验证方式与边界

测试主机是真实 SillyTavern 1.19.0，安装未修改的官方助手 dist。测试页明确禁用完整版音乐插件，并断言 `#stm-player` 不存在；通过助手自己的文件导入和角色脚本开关运行脚本，不用普通网页预览代替角色环境。

聊天、开场白、AI 回复 swipe、编辑、换聊天都经过真实酒馆/助手 API 或 UI。重新生成调用酒馆的真实 `Generate('regenerate')` 路径，**只有 LLM 响应与分词结果是确定性测试替身**，没有连接真实 AI 服务，也没有模拟音乐播放或助手生命周期接口。

每步比较原根 DOM、原 audio、原脚本 iframe 的对象身份，以及同一音源/标题和进度；退出后检查旧音频已暂停、无 src、节点已断开、所拥有资源计数归零。反复 A/B 切换还比较宿主 CHAT_CHANGED 监听数量，不只看屏幕上的节点个数。

手机使用 Chromium 的窄屏 + 真实浏览器触摸模拟，不是实体手机；未验证所有 iOS Safari/Android 浏览器、其他酒馆助手版本、Tauri 或群聊。群聊视为离开单人角色，本阶段不承诺群聊播放器。

### 2026-10-16 验收结果

- `npm run check`：通过。
- `npm test`：65 项通过，其中新增 5 项生命周期单元测试。单元测试使用订阅替身检验失败清理；它们不代表助手环境验收。
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:card`：**3 组真实助手浏览器测试全部通过**，本轮约 1 分 7 秒。结果原始记录见 [browser-validation.json](browser-validation.json)。

- 原播放器关键回归子集：**8 项真实酒馆浏览器测试通过**，覆盖加载、本地音频播放/进度/音量/关闭面板续播、设置与 IndexedDB 重载、多个角色绑定、最近播放与排行、封面和 LRC、临时队列与永久歌单隔离、浏览时续播与歌单管理。

复现该回归子集时使用启用了完整版插件的独立测试配置：

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- tests/player.e2e.js tests/night-ui.e2e.js --grep 'SillyTavern loads|local imports play|settings and IndexedDB|one album binds|missing art uses|recent and ranking pages|B queue edits|B browsing keeps'
```

| 实际操作 | 检查结果 |
| --- | --- |
| 启用 A 的角色脚本，三首测试音分别播放 | 三首均观察到真实 MP3 解码后的播放进度前进；完整版插件未加载 |
| A 内聊天、切开场白、AI 回复 swipe、编辑、重新生成、切新聊天再返回 | 原 audio / 根 DOM / 脚本 iframe 对象不变，歌曲、音源、进度保留 |
| A → B → A、反复进入退出、回主页 | 离开后旧音频无 src、暂停且断开；根节点移除；资源计数归零，CHAT_CHANGED 监听数量不增长；返回新实例不自动播放 |
| 助手文件导入、启用、同一 iframe 重复执行、停用/重新启用 | 采用真实导入按钮和两个脚本开关；重复执行只有一个实例，停用清理，重新启用创建新实例 |
| 真实 PNG 角色卡导出及重新导入 | 新卡携带完整相同脚本及三段测试音，可独立播放；音量不串到另一角色 |
| 手机 375 × 844 触屏模拟 | 收起/展开、切开场白/聊天保留音频；浮层在屏幕内；换角色和主页清理通过 |

手机测试修正了酒馆移动端 body 高度造成的浮层越界，并将唱片旋转限制在装饰层，避免旋转按钮本身影响触控命中。不改动完整版浮窗的定位或动画。

截图均来自上述实际角色脚本环境，不是设计稿：

- [桌面角色内连续播放](desktop.png)
- [通过助手导入后的独立播放器](helper-enabled.png)
- [PNG 角色卡重新导入后播放](reimported.png)
- [手机触屏模拟](mobile.png)

没有使用参考作品的音源或美术资源。上述结果只覆盖指定版本、合成音原型和浏览器测试路径；**未验收实体手机、商业歌曲来源、大文件离线打包、其他助手版本或群聊**。没有将这些结果当成后续完整制作系统已经实现。

## 本机验收清单

1. 用本文档指定版本进入测试角色 A，打开两个脚本开关：播放器应自动出现。
2. 播放第三首测试曲并拖到 8 秒以后。
3. 在 A 内切开场白、聊天、切 AI 回复、编辑和重新生成；换另一段 A 的聊天再切回：曲名/进度不重置。
4. 收起/展开黑胶悬浮球：音乐继续。
5. 切到 B 或主页：A 的播放器和音乐消失；回 A 出现新实例，先不自动播放。
6. 停用该脚本：立即清理；重新启用后重新出现。
7. 导出角色 PNG、重新导入，并在新卡中启用角色脚本：无需完整版插件即可播放三段测试音。
8. 在自己的手机重复以上操作；如有差异，记录酒馆/助手/浏览器版本及具体步骤。

## 下一阶段

本次提交止于生命周期原型。完整播放器核心提取、制作入口/项目管理、正式歌曲资源方案、通用导出器和英伦复古/港式黑金/冷灰艺术/现代极简四主题均尚未实现，不用这三个测试场景的成功宣称整个系统已完成。
