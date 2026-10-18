# 阶段一验收记录

基线：main `b69ee8d`（v1.13.3）。开发标识：`2.0.0-alpha.1`，不表示整个 2.0 已完成。

| 项目 | 实际结果 | 证据与边界 |
| --- | --- | --- |
| 单元测试 | 154 通过，0 失败/跳过 | [unit.txt](unit.txt)；收藏、实际二进制 ZIP、ID 重映射、虚拟时钟、取消渐变等 |
| 语法与构建 | 通过 | [check.txt](check.txt)、build-native.txt、build-demo.txt；随卡构建仍无 IndexedDB/作者工具运行依赖 |
| 真实酒馆完整版 | 首轮 62 通过、1 失败；该项修正时序断言后单项通过 | [full-runner.json](full-runner.json)、[mini-pause-runner.json](mini-pause-runner.json)；63 个唯一用例均有通过记录，不声称首轮全绿 |
| 三项新功能 | 上表中的 3 项均通过 | 实际 MP3，服务器保存并刷新，真实 ZIP 校验；一分钟实际等待到时暂停，非加速时钟；切歌立即拖进度及快速反向操作 |
| 完整备份与存储 | 9 通过，0 失败/跳过 | [data-browser.json](data-browser.json)；真实 IndexedDB/配额错误；服务器错误、取消及故障为受控注入 |
| 制作器独立脚本 | 3 通过，0 失败/跳过 | [maker-runner.json](maker-runner.json)、maker-validation.json；实际 ST/Helper、独立预览、导出 JSON 并重导入播放，桌面与手机尺寸 |
| 最终原生随卡构建 | 5 通过，0 失败/跳过 | [native-runner.json](native-runner.json)、native-validation.json；真正通过酒馆 PNG/JSON 导出和重导入、官方 Helper 授权；接收端禁用音乐插件并阻断其资源 |
| 质量与生命周期 | 15 通过，0 失败/跳过 | [quality-runner.json](quality-runner.json)、quality-validation.json；受控页面中的真实浏览器/IDB和故障注入，不冒充官方 Helper 测试 |

原生测试还检查了收藏在同一角色重新进入后保留、睡眠任务在角色退出后消失，以及对象 URL、音频、订阅、定时器清理。旧版制作器也复用同一个渐变/计时模块。随卡构建的 SHA-256 见 [build-artifacts.json](build-artifacts.json)，与最终 native-validation.json 的运行时 SHA 对照。

## 环境和体积

Linux、Node 24、Chromium 154、Playwright 1.56.1、ST 1.19.0。官方 Helper 4.11.3，实际提交 `333e8a13dfabca359d0105cd0f3c90e9d341ea52`（测试宿主启动时自动更新了原先的依赖提交，版本号未改变，未将旧提交号冒充本次环境）。

完整版使用专用的 8000 测试 dataRoot；新增 8002 接收端宿主使用 `/workspace/scratch/stm-v2-recipient-test-data`，与前者和日常数据分开。最终各套测试具有独立输出目录。后续宿主配置已另外保存为 `stm-v2-recipient.yaml`，关闭启动时自动更新扩展以便固定依赖。

共享原生运行时从 245,952 增至 263,054 字节，增加 17,102 字节；制作器独立运行时增加 7,235 字节。没有压缩或改写原音频，没有新增媒体资产，没有增加原 30 MiB 资源上限。原生 PNG/JSON 的实际文件字节和资源明细见 native-validation.json 的 exportMetrics；这是本次小型合成音/字体样本，不是大卡内存峰值测试。

## 发现与处理

1. **开发期确认问题：切歌渐出期间仍能拖动旧音频进度。** `index.js`、`card-player/runtime.js` 增加选择中状态，禁止旧源进度交互和旧源结束事件抢先切歌；等待新源准备好再启用。制作器最初的两轮失败保留在 maker-initial-runner.json、maker-seek-race-runner.json。新用例实际执行“下一首后立即拖进度”，原有歌词、自动下一首也重新通过。
2. **行为变更对应的测试更新。** 黑胶条旧断言点击暂停后立刻检查旋转停止。新增柔和暂停会先渐出，再暂停音频；测试现在等待实际 audio.paused，再保留原动画和抽屉几何断言。未删断言、未关闭动画。单项复核通过。
3. **测试准备问题，非产品 Bug。** 8002 首次启动尚未完成时启动了一次测试；全新 ST 默认选择 Horde，而生成回复用例拦截的是 Kobold；分别保留 maker-fixture-startup-runner.json 和 native-clean-profile-setup-runner.json。后续明确设置测试模型、等待服务就绪。
4. **测试记录目录冲突。** 单项复核原先清空父 test-results，删掉了另一套尚在写入的 trace，产生 ENOENT 和清理超时；native-trace-directory-failure.json 保留。默认套件改为 test-results/full，各独立套件使用自己的目录，最终随卡 5 项重跑通过。

## 未验证

实体 iPhone/Android、Firefox、WebKit、Windows/macOS 实机、操作系统挂起与锁屏定时精度尚未验证。手机截图和用例均为 Chromium 视口/触屏模拟。直接在线播放的 HTTPS 音源为受控音频响应，不能视为任何外部音乐平台本次真实联网通过。

本阶段没有进行接近 30 MiB 大卡性能重测，没有宣布已解决 v1.13.3 报告中的高内存边界。四套新布局、悬浮组件和设计器的后续开发证据单独记录，不能计入本阶段已交付功能。
