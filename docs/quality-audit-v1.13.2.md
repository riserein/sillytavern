# v1.13.2 质量审计与修复报告

审查基线：main 的 v1.13.1，提交 [`c02ca5084fb3f616de9697e75408e6d09fc8c251`](https://github.com/riserein/sillytavern/commit/c02ca5084fb3f616de9697e75408e6d09fc8c251)。本次修复版本：1.13.2。报告日期：2026-10-17。

本轮确认两项 P1 数据保护缺陷，并修复相关生命周期、存储、文件核对和资源读取问题。没有确认 P0。这里的“没有确认”不代表不存在其他漏洞。未进行大规模 UI 改造，没有改变音乐库或草稿数据库名称、版本、对象仓库和既有歌曲/角色标识。

## 判定口径

- **已复现**：在注明的环境实际观察到错误；受控接口、人工延迟与真实外网严格区分。
- **源码确认**：可根据确定的控制流确认缺陷，但没有实际触发生产事故或资源耗尽。
- **风险/待验证**：条件或后果尚无完整证据，不列入已确认 Bug 数。
- **功能缺口**：用户需要而当前没有的能力，不假称为本轮修复。

P1 为可能破坏已保存内容或随卡分发的高优先级问题；P2 为特定条件下的功能、清理、校验或性能问题。以下源位置均指**修复前基线**，避免新文件插入后行号漂移。回归代码位于 [audit.test.js](../tests/audit.test.js)、[card-audit.e2e.js](../tests/card-audit.e2e.js)、[card-native.e2e.js](../tests/card-native.e2e.js) 与 [player.e2e.js](../tests/player.e2e.js)。

## 确认问题及已完成修复

### A01 · P1 · 元数据保存失败时提前删除旧资源

**位置：**[index.js:771](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/index.js#L771)、796、846、885、1124、1131、1509、1669；[font-picker.js:118](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/font-picker.js#L118)。

**触发/复现：**已有本地歌曲和封面；阻断或令 `/api/settings/save` 失败；更换/移除封面或删除歌曲；刷新。旧设置仍引用旧 ID，但旧 Blob 已删除。封面路径在基线 Chromium 实际复现；同一先删后存模式在背景、字体、歌单及音频删除中源码确认。不能将所有资源类型都描述为逐一真实复现。

**修复：**新增 [asset-retirement.js](../asset-retirement.js)。只在同源设置保存的**实际请求快照**已被确认、服务器和当前页面都不再引用资源时回收旧字节。支持宿主 gzip 请求；并发保存需新的独立确认；失败保留字节。特别核查了 ST 1.19.0 的设置端点：磁盘写入错误可能返回 HTTP 200，所以只看 `response.ok` 不够，必须确认 JSON 的 `result: "ok"`。不改变原设置结构。

**回归：**真实 ST 的 gzip 保存→失败→刷新→旧封面仍存在→成功保存后旧封面回收；真实 IndexedDB 控制实验；单元覆盖 403/500、HTTP 200 错误体、HTML、跨源、请求内容不一致、并发乱序和回收失败重试。见 [基线浏览器失败记录](card-player/audit-baseline-playwright.json) 与 [完整版回归](card-player/full-plugin-audit-v1.13.2.json)。页面关闭前尚未确认的废弃字节可能留存，见 R01。

### A02 · P1 · 本机没有绑定的导入卡被误删随卡播放器

**位置：**[native-export.js:404](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/native-export.js#L404)、510–520；实际删除分支 300–318。

**触发/复现：**导入一张已带 `mode: native` 脚本的角色卡，但当前设备没有它的原始曲库/绑定。保存另一歌单的绑定，或再次原生导出该卡。旧代码扫描全部带标记角色，将“无本机绑定”当成“需要清除”，向服务器写入空脚本/空标记。基线最小执行结果见 [audit-imported-card-before.json](card-player/audit-imported-card-before.json)；两个入口均实际产生删除请求。

**修复：**只管理本机已有绑定和本次会话明确管理过的角色；不再从卡内标记推断删除权限。本机明确解绑/删除歌单仍清理自身脚本；对来源歌单不在本机的卡保留其播放器，导出仍核对角色内容。旧版不可解析的脚本保留并提示“资源未静态验证”，不冒充播放通过。

**回归：**单元验证外来旧脚本保留；真实 ST 新用例创建本机卡和外来卡，分别通过保存绑定、原生导出、明确解绑核对服务器实际卡片和脚本逐字一致。此缺陷能解释类似“导出卡缺脚本”的现象，但没有历史操作记录，不能断定就是此前用户卡片的唯一原因。

### A03 · P2 · 字体导入解码完成后复活已销毁实例

**位置：**[font-picker.js:206](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/font-picker.js#L206)–210。

**触发/复现：**导入字体，解码或 IDB 写入未完成时销毁播放器；恢复异步任务。基线在受控 FontFace 延迟下实际观察到字体重新加入 `document.fonts`、设置被修改。不是用户实体设备事故。

**修复/回归：**在摘要、解码、写入后检查 disposed；清理未提交字节，不再发布字体、设置或后续 UI。受控浏览器测试验证退出后字体和元数据不增加。既有字体预览加载已有清理保护，本轮修的是**新导入**链路，不重复申报 v1.13.0 修复。

### A04 · P2 · 音频/歌词导入在实例销毁后仍写入数据

**位置：**[index.js:781](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/index.js#L781)、1568–1582。

**触发/复现：**本地导入正在读取元数据、写入 Blob 或 `file.text()` 时退出。歌词延迟读取在基线实际复现：[audit-lyrics-late-before.json](card-player/audit-lyrics-late-before.json)；音频缺少检查可由源码确认，修复后的真实 IDB 延迟用例验证其边界。

**修复/回归：**每个提交前异步边界检查失活状态，清除未发布的音频/封面，停止批量导入与设置保存；歌曲/歌单封面写入后同样检查。浏览器延迟恢复后曲目、歌词和 Blob 不复活。此处不把所有角色解码路径都描述为此前有泄漏。

### A05 · P2 · 批量 IDB 操作抛错却提交了前半部分

**位置：**[local-store.js:25](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/local-store.js#L25)。

**触发/复现：**调用 `deleteMany([有效键, undefined])`。第一条删除已排队，第二条同步抛 DataError；Promise 拒绝，但事务没有 abort，第一条删除实际提交。真实 Chromium IndexedDB 基线确认：[audit-idb-atomicity-before.json](card-player/audit-idb-atomicity-before.json)。正常 UI 产生合法键；这里是存储层错误输入/未来调用边界，不宣称普通点击必然触发。

**修复/回归：**先安装事务处理器，捕获同步异常并 abort，保留原错误。真实 IDB 回归确认异常后旧 Blob 仍在；数据库格式不变。

### A06 · P2 · 手动检查将超限脚本错误标成通过

**位置：**[quality.js:156](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/quality.js#L156)–160。

**触发/复现：**读取资源很少、脚本文本却超过 45 MiB 的人工构造卡。基线返回 `static: passed`，同时 problems 内明确写着超限，见 [audit-baseline-capacity.json](card-player/audit-baseline-capacity.json)。这是手动复查遗漏；正常生成器已有容量保护。

**修复/回归：**手动核对也调用现有 `assertCapacity`，不覆盖失败状态。单元以 46 MiB 填充脚本确认拒绝，正常文件继续通过。没有重复修改 v1.13.0 已修好的备用封面计数。

### A07 · P2 · 第三方去掉 Helper 字段后无法解绑

**位置：**[native-export.js:312](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/native-export.js#L312)。

**触发/复现：**本机管理的卡仍有音乐标记，但 `extensions.tavern_helper` 已被第三方编辑器移除；解除本机绑定。基线最小执行抛 TypeError，而非完成移除。

**修复/回归：**删除分支建立缺失对象，保留其他扩展；单元验证显式解绑完成、音乐标记归零。没有假设卸载酒馆助手一定会删除这个字段。

### A08 · P2 · 导出资源请求只限制时间、不限制字节

**位置：**[browser-resources.js:35](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/browser-resources.js#L35)–42。

**触发条件：**导出封面/字库等资源，服务端在 20 秒内返回巨大响应或无长度连续流。源码确认完整 `.blob()` 在容量判断前发生。**未复现浏览器内存耗尽或真实恶意音源**。

**修复/回归：**分块读取并累计字节，超限取消 reader；提前检查 Content-Length。封面上限 10 MiB，通用资源读取默认 64 MiB，保留旧大字体读取兼容性；外部请求不带凭据并去掉 Referer。单元用受控流验证有/无长度、取消、正常读取。音频流和平台 JSON 的限制边界见 R05。

### A09 · P2 · 大型内嵌资源解码产生不必要的大量临时分配

**位置：**[native-entry.js:14](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/native-entry.js#L14)；[quality.js:202](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/quality.js#L202)、260。

**复现：**桌面 Chromium 中挂载 29 MiB 原创合成 PCM 资源。基线 `Uint8Array.from(Base64解码字符串, 回调)` 走通用字符串迭代，测得挂载后 JS 堆约 407 MiB、挂载约 2.44 秒。没有发生崩溃，不能叫已确认 OOM。

**修复/回归：**新增 [base64.js](../base64.js)，预分配 Uint8Array，按 64 KiB Base64 字符块解码；PNG读取/压缩和原生运行时复用。边界字节与错误输入单元测试；真实 Chromium 挂载后堆、播放进度与全部资源归零检查，见下方容量表。测量是单次快照，**不是峰值、RSS 或所有设备承诺**。

### A10 · P2 · 宿主允许 HTML 提示时，导出错误可注入 HTML

**位置：**[native-export.js:494](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/native-export.js#L494)。

**条件/复现：**ST 1.19.0 默认全局 `toastr.options.escapeHtml=true`，默认配置阻断此攻击。若其他扩展改成 false，歌曲标题可来自 MP3 元数据；缺失本地资源时，标题进入导出错误 toast。受控浏览器使用宿主实际 jQuery/Toastr，标题中的 img/onerror 实际执行，见 [audit-toast-before-observed.json](card-player/audit-toast-before-observed.json)。没有将“实际安装某恶意扩展”作为已复现事实。

**修复/回归：**该调用独立指定 `{ escapeHtml: true }`，不依赖全局选项。相同条件下无 img 节点、无处理器执行；界面其他文本插入使用 textContent/既有转义。随卡脚本本身权限是另一边界，见 R04。

### A11 · P2 · Helper 字段排序导致未变更的卡反复整卡写入

**位置：**[native-export.js:293](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/native-export.js#L293)。

**触发条件：**Helper 规范化脚本字段顺序，例如 name/id 与工厂 id/name 相反。旧代码用 JSON.stringify 比较，有语义相同但字符串不同的确定性情况；未变化的 JSON/PNG 导出也重新写入大脚本。源码确认，不以单次计时推断全部性能来源。

**修复/回归：**复用现有 `sameData` 比较。真实 Helper 字段规范化后，首次绑定以及两次未修改导出合计仅一次针对该角色的 merge-attributes 写入；仍重读并校验音频等资源，没有为了缓存跳过失效检查。更换字体仍重新写入。

### A12 · P2 · 外层扩展保留已销毁 fetch 包装器时仍拦截导出

**位置：**[native-export.js:389](https://github.com/riserein/sillytavern/blob/c02ca5084fb3f616de9697e75408e6d09fc8c251/card-player/native-export.js#L389)、525–531。

**触发条件：**另一扩展在音乐插件之后包装 fetch，并持有旧 wrapper；音乐插件销毁时无法恢复顶层 fetch。旧 wrapper 仍匹配有标记角色并进入已取消的导出队列，阻止正常导出。基线受控 Node wrapper 实际返回 422 且没有转发原请求，见 [audit-stale-wrapper-before.json](card-player/audit-stale-wrapper-before.json)；不声称 Helper 默认实现必然采用这种包装。

**修复/回归：**失活 wrapper 立即转发原调用；只在自己仍是顶层时恢复 fetch，不覆盖其他扩展。新增单元覆盖完整链；资源回收 wrapper 也有同样保护并释放实例引用。

## 剩余风险与功能缺口

| 编号 | 类型 / 优先级 | 边界、证据与处理建议 |
| --- | --- | --- |
| R01 | 已知取舍 / P2 | A01 为防误删，保存未确认或页面关闭时保留待回收字节；待回收集合未持久化，可能残留占用配额。尚无跨页面引用索引和完整安全 GC，不建议直接删未知键。 |
| R02 | 功能缺口 / 高 | **没有完整曲库+所有音频/封面/背景原图/字体+所有制作草稿的可移植备份恢复。**设置保存在 ST 服务器，Blob 在浏览器 IDB；ST 设置备份不含这些字节。随卡导出仅携带选定内容，不是制作项目备份，且单首 20 MiB/总 30 MiB 不能覆盖完整版允许的 100 MB 文件。未在本轮冒充完成全量备份。 |
| R03 | 存储风险 / 高 | 浏览器按 origin 分配配额，清站点数据、隐私模式、系统回收或更换域名/协议/端口都可能使本地资源不可用。没有存储耐久申请/容量面板。真实 Chromium QuotaExceededError 实验确认失败写入保留旧 Blob，但不证明不会被系统回收。 |
| R04 | 权限设计边界 / 高 | 已获准运行的 Helper 角色脚本会访问主页面 DOM、上下文、同源请求与存储；资源跟踪器不是安全沙箱。播放器角色检查和失活清理不能限制任意第三方脚本。新增导出脚本说明明确这一点；只读静态卡检查不执行脚本，但也不保证卡内其他脚本无恶意。不要安装不可信角色脚本。 |
| R05 | 网络风险 / P2 | 导出资源读取已加字节上限；浏览器 audio 流、平台 JSON 响应和图片解码后的像素内存没有统一硬上限。URL 字面校验不能防全部 DNS/重定向到私网情形；这些是客户端请求，不是已确认服务端 SSRF。外部文件仍可失效、变更内容或受 CORS/格式限制。不得当作永久可播放保证。 |
| R06 | 隔离风险 / 待真实验证 | 草稿数据库 [project-store.js:10](../card-player/project-store.js#L10)、81 按 origin 全局命名并 getAll，没有 ST 账号命名空间。同源切账号可能看到其他账号草稿；未完成真实多用户切换验收，不报为已复现账户泄漏。后续需显式迁移与归属确认，不能直接改 DB 名导致旧数据不可见。 |
| R07 | 跨系统一致性 / P2 | 设置、浏览器 Blob、服务器角色卡不是单一事务。多标签/多设备旧快照覆盖、服务器已写但响应丢失仍是边界。明确解绑失败后刷新可能保留旧随卡脚本，采取保留数据策略，可重新绑定后再明确解绑；不能从未知卡标记推断删除权。 |
| R08 | 已有共存策略 / 体验限制 | 完整版插件优先，接管并清理随卡实例。A02 保留导入卡数据，但不会自动把外来内嵌曲库合并进本机；未绑定本机歌单时可能看见的是完整版当前曲库。要验收无插件分发，应在独立接收端禁用完整版并刷新。未实现任意运行中热卸载/双播放器同步桥接。 |
| R09 | 兼容性待验收 | 仅有桌面 Chromium、手机视口/触摸模拟；实体 iOS Safari、Android Chrome、Firefox、WebKit、低内存机、后台/BFCache/锁屏恢复未通过实测。本轮不能给这些设备盖“通过”。 |
| R10 | 文件/工具兼容性边界 | PNG 只去除完全相同的双份元数据；冲突的 V2/V3 不静默选一份。实际 ST/Helper 导出再导入通过，不代表所有第三方编辑器都保留扩展。旧外来脚本只能核对角色字段时明确资源未验证。过大或损坏输入仍可能在解析前消耗显著内存；本轮大型流程的进程观测也显示高占用，见下文。 |

**完整备份的后续最小规格（建议新增功能，不算已交付）：**版本化清单、二进制分块资源、字节/哈希、所有曲目/歌单/绑定/外观和草稿；导入先预览、检查容量和冲突、在隔离临时空间验证再提交；失败保留原库；角色 avatar 在另一 ST 实例可能变化，必须提供重新映射。不能只下载 settings JSON 就叫完整备份。

## 实测环境、结果与容量

机器上的真实 ST 1.19.0 和官方 Helper 4.11.3；Chromium 154.0.8037.57，Playwright 1.56.1。使用专用测试角色和原创合成音频；没有复制用户卡片中的歌曲、人物资料或专有实现。测试结果清单、各次执行时间与构建哈希以 [audit-validation-v1.13.2.json](card-player/audit-validation-v1.13.2.json) 为准。历史报告已归档，不能把旧哈希当新产物。

| 验证 | 结果与证明范围 |
| --- | --- |
| 单元 | 113 / 113；数据、脚本、PNG、字体、生命周期、资源上限及新增边界。受控 fetch 不算外网验收。 |
| 审计专项浏览器 | 10 / 10；真实 IDB、真实 QuotaExceededError、失活导入、只读安全检查、条件 HTML 注入回归。部分接口与异步时间受控。 |
| 既有质量专项 | 11 / 11；草稿恢复/复制/冲突、资源副本、容量和生命周期。 |
| 完整版真实 ST | 60 / 60；本地播放、直链替身、曲库/歌单、角色、UI、歌词、背景、字体、队列与保存失败。随后再针对最后的绑定/删除改动补跑 7 / 7 定向用例；完整 60 项早于最后的外来卡保护改动，并非全部在最终源状态重跑，见汇总。 |
| 原生随卡真实 ST | 5 / 5 项完整用例：原生 PNG/JSON 下载、干净接收端导入并播放、角色/多聊天/开场白/AI 回复/停用、失败保护、外来卡保护。详见 [native-validation.json](card-player/native-validation.json) 和原始 runner。 |
| 高级制作页真实 ST | 3 / 3；JSON 生成/导入/真实合成音频播放、桌面和触屏模拟、失败保护。 |
| 大资源 / 旧 Helper | 各 1 / 1 筛选用例通过；近 30 MiB 卡使用官方 Helper 4.11.3，另一次使用官方 Helper 4.9.5。未运行各自其余用例，不能冒充完整套件通过；见对应 runner 和下表。 |
| 外网 | MDN 公开音频实际请求失败 `ERR_TUNNEL_CONNECTION_FAILED`；Openverse 实际请求失败 `ERR_CERT_AUTHORITY_INVALID`。未关闭 TLS 校验。Audius 无维护者应用 Key、未启用。这些项目**未通过真实外网播放**。 |

大型卡实验包含两段 20 MiB、8 MiB 的合成 WAV、选定游趣字体及封面，资源接近 30 MiB。每次内置随机封面不同，字节略有变化，准确值见 [native-large-v1.13.2.json](card-player/native-large-v1.13.2.json)。同时执行实际下载、文件静态复查、全新无插件接收端 PNG/JSON 导入和播放。服务器原始重复 PNG、优化下载 PNG 和 JSON 大小分别记录，不把编码膨胀后的 PNG 大于 30 MiB 当成资源统计错误。


| 大型卡最终一次实际测量 | 字节 / 耗时 |
| --- | ---: |
| 原始内嵌资源合计 | 31,283,226 B（29.83 MiB） |
| 生成脚本 | 41,957,409 B（40.01 MiB） |
| 下载 JSON | 41,959,709 B（40.02 MiB） |
| ST 原始重复 PNG | 111,966,141 B（106.78 MiB） |
| 去除完全重复元数据后的 PNG | 56,021,380 B（53.43 MiB） |
| JSON / PNG 导出，单次 | 24.28 s / 52.97 s |

本轮大型最终跑关闭 Playwright trace，绑定及未修改导出合计仅一次目标角色写入。此前保留的 traced 大型跑属于较早源状态，封面随机且采集开销不同，不能据此宣称导出速度改善了某个百分比。PNG 去重是旧版已有功能，本轮没有声称新发明这项压缩。

| 29 MiB 挂载解码实验 | v1.13.1 基线 | 本轮修复 |
| --- | ---: | ---: |
| 挂载前 JS 堆快照 | 115,304,366 B | 115,304,824 B |
| 挂载后 JS 堆快照 | 426,842,985 B | 114,242,914 B |
| 挂载耗时，单次 | 2,437 ms | 263 ms |
| 实际进度前进 / 退出资源计数 | 通过 / 全部归零 | 通过 / 全部归零 |

完整大型卡流程还观察到单个 Chromium 进程 RSS 为 **1,474,854,912 B（约 1.37 GiB）**，见 [进程快照记录](card-player/audit-large-process-snapshot-v1.13.2.json)。这是同一自动化浏览器含作者和接收端上下文时的 `ps` 单次观测，不能归因为一个播放器；后续完整进程树采集未赶上进程退出，**没有测得整体总量或峰值**。它说明完整 Helper/整卡解析管线仍需较多内存，解码小实验的改善不能代替低内存设备验收。

基线与最终详细数据：[baseline](card-player/audit-stress-baseline.json)、[fixed-final](card-player/audit-stress-fixed-final.json)。隔离桌面 Chromium 的 V8 old-space 限制为 384 MiB，**不是整个进程内存限制**；快照包含 GC 时机影响，不是峰值，也不能据此宣称手机内存下降某个固定百分比。该实验使用受控 scope，生命周期还需以上真实 Helper 用例交叉验证。

**保留失败记录：**容量实验第一次用 Playwright 的 >50 MB 内存 Buffer 上传触发驱动限制，改临时文件路径后再验收；配额实验的初期 override 未真正限制已打开数据库，改冷启动持久 profile、再打开 DB 后实际出现 QuotaExceededError；压力实验初版过早 play 导致测试驱动 AbortError，修正为等待 loadeddata。原始失败 JSON 均保留，不能归为产品缺陷或删除失败后声称从未失败。所有选择执行和复跑的权威状态看 runner JSON；worker 自有摘要不能覆盖全局失败。

## 复测与普通用户操作

开发者从仓库运行：

```bash
npm ci
npm run check
npm test
npm run build:card-native
npm run build:card-demo
# 使用已运行的专用 ST 测试实例；不要对日常账号运行破坏性测试。
CHROMIUM_PATH=/usr/bin/chromium npm run test:card-audit
CHROMIUM_PATH=/usr/bin/chromium npm run test:card-native
CHROMIUM_PATH=/usr/bin/chromium npm run audit:large-player -- fixed-local
```

原生和制作页套件共享测试 ST 设置/角色，必须串行；完整版 suite 需按测试说明暂时禁用 Helper、完成后恢复，不能随意覆盖日常设置。跨浏览器/实体机按 [本轮补充计划](card-player/compatibility-plan-v1.13.2.md) 验收，每台设备实际执行“导入→启用角色脚本→播放→同角色切聊天/开场白/回复→换角色→停用→再启用→重新导出再导入”，分别记录浏览器/系统/Helper 版本、音频进度、错误、残留 DOM/音频和资源。

普通用户：

1. 更新插件并刷新酒馆。原曲库/歌单/绑定无需重建；本轮没有数据库迁移。
2. 原有分发卡的脚本不会被远程替换。作者保留源歌曲/绑定，重新保存绑定并用酒馆原生按钮导出 PNG/JSON；接收端导入新文件，启用该卡的酒馆助手脚本。
3. 更新后导入其他作者的随卡播放器，再保存自己的歌单或原生转发该卡，不再自动移除外来播放器。本机若主动把源歌单绑定到该卡，才按本机配置更新。
4. 保存失败时先保留当前页面及原始卡/音频，检查连接和服务器磁盘后重试。不要清空浏览器存储来“修复”。失败提示下保留旧字节是保护数据的行为，不是完整备份。
5. 换设备前保留原音频、歌词、封面、字体和背景原文件，并另存需要分发的角色卡。**只备份 ST 设置不足以迁移本地音乐和制作草稿**；本版本尚无一键完整备份恢复。
6. 歌词随已保存的歌曲歌词导出；没有内嵌/导入歌词的音频不会自动拥有歌词。联网查询结果须预览确认保存；云环境没有验证真实歌词服务可用。

## 与 v1.13.0 的区别

v1.13.0 已完成草稿持久化、生成路径容量分析、基础解码失败清理、角色作用域、脚本去重和完整版接管等。本轮沿用并回归这些功能；新增修复针对保存确认与 Blob 回收、外来卡所有权误判、**新导入**的异步退出、IDB 同步异常原子性、**手动复查**超限误判、缺字段解绑、字节限流、通用字符串迭代的大分配、条件 toast 注入、字段顺序重复写卡和外层 wrapper 残留拦截。不把旧问题换名后重复计数。
