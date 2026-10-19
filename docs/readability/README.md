# v2.0.0-alpha.6 文字与歌词可读性专项

2026-10-19。基于 GitHub main `e3d5c4e`（v2.0.0-alpha.5）续开发。保留夜航、玻璃、黑胶、磁带、极简的结构与装饰，不重做播放器，不改变 IndexedDB 结构，不删歌曲、歌单、绑定或草稿。

## 使用方法

在 **外观 → 文字与阅读** 选择：

- **文字显示**：标准 / 清晰 / 高对比度，默认清晰。原主题与自定义原色继续保存在原配置中；显示层必要时调整文字色，原锁定色不会被改写。
- **歌词字号**：18–30px，默认 20px；**行距**：1.5–2.6，默认 1.9。
- **歌词自动跟随**：决定每次打开或换歌后的默认状态。主动滚动、触屏滑动、键盘翻页进入手动阅读；换句仍高亮，但不强制拉回。
- **回到当前歌词**：定位当前句并恢复本次阅读的跟随状态。可以随时再次手动阅读。
- **歌词阅读背景**：自动 / 透明 / 柔和遮罩。透明表示区域透明，文字本身仍有窄的主题色衬底，避免在复杂图片上消失；自动与柔和遮罩再叠加阅读区遮罩。

轻点封面进入歌词，使用顶部 **返回封面** 或 **Esc** 返回。点击歌词、选择文字不会退出。歌曲标题、跟随状态和恢复按钮位于固定工具栏，正文独立滚动。所有操作复用原 Audio，不发起新音频实例。

完整版的设置正常保存；完整 ZIP 备份包含阅读偏好和草稿的阅读配置，恢复时勾选 **同时恢复备份中的外观、阅读偏好、音量、模式和窗口位置**。不勾选时保留当前个人偏好。

新导出的共享播放器、PNG、JSON 及制作器预览包含这些规则。接收端可以个人调整阅读设置，写入自身的角色/脚本偏好，不回写作者脚本。**已分发的旧角色卡不会自动获得新代码**：制作端更新插件后，打开绑定角色，在曲库点击 **检查 / 重建当前角色的随卡播放器**，再从酒馆原生界面重新导出 PNG/JSON。接收端仍需启用酒馆助手角色脚本，不需要安装完整版音乐插件。

## 已确认问题和处理

| 类型 | 源码与触发条件 | 处理 |
| --- | --- | --- |
| 已确认显示缺陷 | `night-ui.css` 原普通歌词 `opacity:.48`，叠加旧 `style.css` 的淡化色；所有布局可能继承 | 普通行不透明正文色，当前行用经检查的强调色和 650 字重，字号一致 |
| 已确认显示缺陷 | `night-ui.css`、`ui/layouts.css` 多处重要文字只有 9–11px，辅助色还含 alpha / 58% 混色 | 重要辅助文字至少 12px，导航与文字按钮 13px，主正文 13–15px；普通文字层级使用实色 |
| 已确认可读性缺口 | 自定义文字/背景同色、低遮罩或高反差图片时，原色没有运行时保护 | 统一语义色计算和局部不透明衬底；不把图片平均颜色当成文字实际背景 |
| 新增阅读体验 | 原 `index.js updateLyrics` 换句总会居中；原阅读区整体点击即退出 | 独立阅读控制器，区分手动和自动；明确返回按钮，键盘及触屏可用 |
| 已复现并修复本轮问题 | 旧制作器手机尺寸下，PageDown 动画在点恢复后继续滚动，再把跟随切回手动 | 控制器接管阅读区的键盘翻页与定位，不让遗留动画覆盖恢复操作；事件记录见诊断目录 |
| 已复现并修复本轮检查漏项 | `.stm-player-controls { display:contents }` 不绘制盒子；首次衬底与首次测试误信该背景，标题实际仍落在图片上 | 改在 `.stm-now-info`、`.stm-eyebrow` 实际盒子绘制衬底；检查器跳过 `display:contents`，保留修复前失败记录和截图 |
| 设计器功能缺口 | 原提示只检查自定义正文与背景 | 检查正文、辅助、歌词、强调色、按钮和文本组件；同时说明原色与显示保护后的比值。模板应用、导入、随机与颜色修改均经预览刷新检查 |

原歌词解析器及时间轴未改动，歌词仍以 `textContent` 渲染。数据兼容测试保留原歌词、音频字节、歌单与角色绑定。不存在“为了修复淡字而统一改成黑底白字”的主题替换。

## 语义色与字号规范

统一算法见 [ui/contrast.js](../../ui/contrast.js)，显示接入见 [ui/reading.js](../../ui/reading.js)，最终覆盖层见 [ui/reading.css](../../ui/reading.css)。每个主题明暗模式与三种阅读等级的具体 HEX 值见 [colors.json](colors.json)。

| 文字角色 | 显示变量 | 对比度与样式 |
| --- | --- | --- |
| 主标题 | `--read-title` | 不透明，保留主题色方向；标题保持原布局字号 |
| 正文 | `--read-body` | 最低 4.5:1；标准目标 4.5，清晰优先 7；字号 13 / 14 / 15px |
| 辅助文字 | `--read-secondary` | 实色，至少 4.5:1，重要小字至少 12px |
| 说明文字 | `--read-hint` | 不当作禁用状态，不通过整个元素变透明处理 |
| 普通按钮 | `--read-button` | 至少 4.5:1，文字按钮 13px，图标尺寸保持原样 |
| 强调按钮 | `--read-action` / `--read-on-action` | 按钮文字对实际按钮底色至少 4.5:1 |
| 选中项 | `--read-accent` / `--read-selected` | 同时检查对普通衬底及选中背景的对比度 |
| 禁用状态 | `--read-disabled`，既有 disabled 反馈 | 允许弱化真正禁用的控件，不弱化仍需阅读的说明 |
| 歌词正文 | `--read-lyrics` | alpha 1，默认 20px，字重 400，颜色不随当前句而淡出 |
| 当前歌词 | `--read-current` | 强调色，至少 4.5:1，字重 650，不放大其他行的透明度差异 |
| 错误 / 警告 | `--read-error` / `--read-warning` | 按主题衬底校正到至少 4.5:1，保留红 / 暖色方向 |

中灰背景未必能同时达到 7:1 与原始色完全不变：清晰模式以至少 4.5:1 为下限。高对比度模式可在**局部衬底**调整中灰明度，正文/歌词目标至少 9:1，辅助和强调文字至少 7:1；原始配色和锁定值仍保留。

玻璃边缘、封面、黑胶、磁带、背景图和装饰动画继续使用原样式；文字衬底使用当前主题的色相。透明图片上的可读性通过实际绘制的局部实色盒子保护。**没有宣称仅比较两个 HEX，就认证了图片所有位置或所有 glyph 抗锯齿像素。** 不做持续背景像素采样，没有新增 interval 或 MutationObserver。

## 浏览器验收与证据

[逐主题结果](themes.md)列出 64 个“布局 / 配色 / 模式”分组；合计 **768 个渲染状态、5,376 个文字样本**。涵盖 7 种旧配色、4 种新布局各 6 种设计配色、自定义低对比度压力样例，桌面 / 手机尺寸，深 / 浅，雾面 / 毛玻璃 / 清透，以及带 / 不带高反差图片。被测样本全部找到实际绘制的不透明背景，最低对比度约 **4.5002:1**。这是对被测文字的结论，不是整张界面每个像素的认证。

环境：Linux Chromium 154.0.8037.57、Playwright 1.56.1；实际酒馆页面为 SillyTavern 1.19.0，官方酒馆助手 4.11.3；均使用独立测试数据目录。手机尺寸为 Chromium `isMobile/hasTouch` 模拟。

最终冻结构建共 **172 项 Node 测试、52 项浏览器用例通过，零失败、零跳过、零重试后通过**；768 状态属于阅读用例内部的渲染矩阵，不另算 768 个独立浏览器用例。[验收总览](results/acceptance.json)记录本轮串行执行、耗时与构建 SHA-256。以下是明确选定的套件，不声称运行了仓库全部历史测试。

| 检查 | 结果 / 证据 |
| --- | --- |
| Node 单元测试 | 172 通过；[日志](results/unit.txt) |
| 语法与数据检查 | 通过；[日志](results/check.txt) |
| 阅读专项浏览器 | 18 通过（含语义错误/警告、组件背景与角色退出保存竞态）；[记录](results/browser-runner.json)。包含真正酒馆页面的设置保存并重新加载、设计器锁色提示、真实音频进度、LRC 手动/自动阅读、键盘/触屏、阅读偏好与草稿的实际 IDB+ZIP 恢复、旧制作器阅读 |
| 主题渲染 | 768 状态通过；[桌面](results/matrix-desktop.json)、[手机尺寸](results/matrix-mobile-chromium-emulation.json) |
| 完整数据备份回归 | 10 通过；[记录](results/data-runner.json)。覆盖真实 IndexedDB、实际配额失败、服务器保存失败的受控响应、损坏 ZIP、旧数据、多账号及草稿复制，不把受控失败当成真实外网验证 |
| 原有酒馆功能回归 | 9 通过；[记录](results/legacy-runner.json)。背景、配色保存、歌词导入、字体、系统明暗、最近播放、迷你条及队列 |
| 原生 PNG/JSON 干净接收端 | 最终共享构建 4 项场景通过，含 8 次两格式导入与四布局；[记录](results/native-runner.json)、[资源及版本](results/native-validation.json)。读字号从作者 23px 到接收端个人 27px；角色脚本内容保持不变，返回角色/停用重启后偏好保留。含开场白、回复、编辑、重新生成、同角色聊天与退出资源计数回归 |
| 制作器与独立导出 | 4 通过；[记录](results/maker-runner.json)、[资源及版本](results/maker-validation.json)。含旧制作器 JSON、共享设计的 JS / HTML / Helper JSON，以及资源失败时保护原曲库 |
| 完整版与随卡播放器共存 | 1 通过；[记录](results/coexist-runner.json)、[资源及版本](results/coexist-validation.json)，实际启用完整版插件时没有叠出第二个播放器 |
| 既有设计与布局回归 | 6 通过；[记录](results/design-runner.json)。含真实酒馆页面四布局切换不断音、五种悬浮入口、设计器保存与清理 |

原生接收端阻断完整版插件静态资源，音频字节随卡携带并真正推进播放；在线测试地址属于路由音源夹具，**不代表新增真实外网音源验证**。共享制作器的 HTML/JS/Helper JSON 与原生卡走相同共享样式；保留的旧制作器也复用同一色彩算法和阅读控制器。

## 截图

[截图索引与对照](screenshots.md)及 [完整对照页](gallery.html)。包含 96 对、192 张主题与歌词前后截图，既有桌面也有手机尺寸，深浅模式成对。播放页通过冻结旧运行时与新运行时使用相同资源渲染，不拼接或修饰文字来制造结果。

原生接收端与制作器截图也在索引中；既有设计回归的新截图保存在 `design/`，没有用本轮截图覆盖旧版本的验收图片。

## 失败记录

- 第一轮 6/8 通过：新增测试对设计器的颜色控件发送 `input`，实际监听的是 `change`，因此颜色没有应用。修正测试事件后 8/8 通过；未把它当作产品缺陷。[原始记录](results/browser-initial.json)
- 后续高对比度检查错误地把“当前强调歌词”的至少 7:1 标准当成普通正文的 9:1；改为分别验证两类文字，没有降低各自标准。[记录](results/browser-level-diagnostic.json)
- 真正复现了旧制作器的 PageDown 动画问题，该轮修复前 11/12 通过，修复后 12/12 通过；最终扩充后的阅读专项为 18/18。[失败](diagnostics/browser-keyboard-follow-failure.json)、[事件前](diagnostics/native-keyboard-scroll-before.txt)、[事件后](diagnostics/keyboard-scroll-after-fix.txt)
- 实际截图推翻了首次背景检查器对 `display:contents` 的假设；修正检查器后确实失败，再修复产品的衬底位置，768 状态才重新通过。[失败](diagnostics/matrix-no-painted-box-failure.json)、[问题截图](diagnostics/unpainted-title-example.jpg)
- 一轮原生手机尺寸场景被酒馆“设置保存失败”toast 遮住导航，3/4 通过。随后在真实 iframe 中独立复现了同类异常：角色退出取消待处理的账号检查后，旧包装器尝试访问已销毁 iframe 的 `Response.json`，报相同错误；修复前桌面/手机均失败，修复后两种视口通过，并验证已确认的跨账号保存仍返回 409、没有实际写入。修复捕获宿主构造器；退出取消验证后，以独立的宿主请求重新核对受支持的账号主键与创建时间，只有一致时才交还原请求；无法确认或变化仍返回 409，描述符不写入备份或角色卡，不覆盖外层扩展包装器。最终原生验收重新执行；未绕过账号检查、未强制点击穿透 toast、未加超时或删断言。[原始日志](diagnostics/native-host-toast-failure.txt)、[记录](diagnostics/native-host-toast-native-runner.json)

账号竞态的最小复现：同源子 iframe 创建账号保护 → 外层扩展保留 fetch 包装 → 发起宿主设置保存并挂起账号读取 → 退出并移除角色 iframe → 释放/取消待处理检查。P1：会阻断宿主保存；源码 [data/identity.js](../../data/identity.js#L34)，修复前后证据 [失败](diagnostics/iframe-guard-failure.json)、[通过与跨账号保护](diagnostics/iframe-guard-revalidated-security.json)，Node 安全测试见 `tests/identity.test.js`。并发账号测试使用受控 `/me` 返回与真实 iframe 移除，不称为服务器多账号登录 UI 验收。退休请求仅用于完成宿主保存的账号确认，限 5 秒和 16 MiB，不能视为音乐播放器残留请求；音乐自身仍按角色退出释放。一次原生 toast 的全部因果链不据此作唯一归因，但该确定的退出竞态已经修复。

首次截图夹具曾复用接收端偏好，导致标注浅色的样例仍沿用前一次模式；现已给截图作用域隔离偏好并重新生成全套。诊断截图仅用于展示漏衬底，不作为某个明暗预设的验收结果。

## 资源、兼容边界与回滚

共享运行时由 `scripts/build-native-player.mjs` 将 `style.css`、`night-ui.css`、`ui/layouts.css`、`ui/reading.css` 与相同的 `index.js` 编入；不只更新完整版 CSS。旧制作器由 `scripts/build-card-demo.mjs` 重建。没有增加第三方运行依赖。

基线共享运行时 315,814 字节；本轮 334,018 字节，增加 **18,204 字节（约 17.78 KiB，5.76%）**。没有复制其他字体、音频或背景；仍保留原 20 MiB 单曲、30 MiB 内嵌资源和 45 MiB 脚本上限。本轮没有把一次 JS 堆值称作峰值，也没有声称降低了大卡内存；近 30 MiB 卡的既有内存限制仍适用。

尚未验证：实体 iPhone/Android、iOS Safari 锁屏/后台、Firefox/WebKit、新版完整 Helper 4.9.5 矩阵、真实外网平台、真实服务器的账号登录切换界面及本轮大型卡专项峰值。此前 WebKit 下载受云网络策略限制；本轮不把 Chromium 模拟替代这些结果。对比度矩阵检查稳定渲染状态，未认证配色过渡的每一帧。第三方扩展若保留已退出脚本的 fetch 包装器，正常退出后保留无监听器的转发路径，不能仅凭跟踪计数为零就宣称浏览器堆已全部归还。

回滚可撤销本次提交或回到 `e3d5c4e`，旧歌曲、资源、草稿及绑定不因本次新增 `reading` 字段改变存储格式。回滚前先导出完整 ZIP；旧版忽略新阅读字段。已导出的新卡内嵌代码不会因制作端回滚自动变化，需重新导出才能替换。

## 修改文件

- 颜色与阅读核心：`ui/contrast.js`、新增 `ui/reading.js` / `ui/reading.css` / `ui/lyric-reader.js`，`appearance.js` 复用同一亮度算法。
- 完整版与样式：`index.js`、`core.js`、`style.css`、`night-ui.css`、`ui/layouts.css`、`ui/player.css`、`ui/editor.js`、`ui/editor.css`。
- 分发与备份：`card-player/config.js` / `native-entry.js` / `native-export.js` / `shared-export.js` / `runtime.js`，`card-maker.js`、`data/backup.js`、`data/panel.js`，共享构建脚本及生成产物。`data/identity.js`、`bounded-response.js` 修复退出时待处理账号检查与其他 fetch 包装器的竞态，新增对应隔离安全回归。
- 测试与版本：新增 `tests/reading.test.js` / `tests/reading.e2e.js` / `playwright.reading.config.js`；更新现有返回按钮及原生接收端断言；`scripts/capture-reading.mjs`、版本文件、README 与更新日志。

## 复验命令

需要独立酒馆测试目录及已安装的官方酒馆助手，接收端测试会创建并清理 `RSCP_Test_*` 测试角色，**不要对日常角色目录运行**。环境中 8000、8002 都是专用测试服务器。

```bash
npm test
npm run check
npm run build:card-demo
npm run build:card-native
CHROMIUM_PATH=/usr/bin/chromium npm run test:reading
ST_BASE_URL=http://127.0.0.1:8002 CHROMIUM_PATH=/usr/bin/chromium npm run test:card-native -- --grep 'native PNG and JSON carry'
ST_BASE_URL=http://127.0.0.1:8002 CHROMIUM_PATH=/usr/bin/chromium npm run test:card-export
CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-reading.mjs
```

截图与测试输出应指定新目录或先备份，避免覆盖历史验收记录。不要同时让多个原生卡或制作器验收向同一测试账号写入。
