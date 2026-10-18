# v2.0.0-alpha.5 手机虚拟验证补充

2026-10-18，在 `d0351ed` 上补充执行。Chromium 154.0.8037.57、Playwright 1.56.1、SillyTavern 1.19.0、Linux；播放器产品代码和数据格式没有修改。

## 本次结果

**6 项通过，0 项失败，0 项跳过。** 原始记录：[final-runner.json](final-runner.json)。

| Chromium 触摸配置 | 实际酒馆完整版操作 | 受控随卡运行时 |
| --- | --- | --- |
| 320 × 568，DPR 2 | 通过 | 通过 |
| 390 × 844，DPR 2，iPhone 尺寸 | 通过 | 通过 |
| 412 × 915，DPR 2，Android 尺寸 | 通过 | 通过 |

三个配置均启用 `isMobile`、`hasTouch`，实际使用 `tap` 和 Chromium 触摸输入协议产生触摸指针。这里运行的都是 Linux Chromium，没有运行 iOS、Android 或 Safari，也没有通过改 User-Agent 声称运行其他浏览器。

完整版测试打开实际 SillyTavern 页面，以文件导入两首原创合成 MP3，使用真实 IndexedDB 和浏览器音频解码；以音频进度推进和暂停状态核对播放。检查四套新布局在各配置的竖屏、横屏尺寸中切换，Audio 实例、音源及播放进度持续；轻触歌词、播放队列、暂停与继续、进度条；实际触摸拖动悬浮球后窗口不误开、音乐不断、入口仍在可视范围，再轻触重新展开。窗口横竖尺寸切换通过 `setViewportSize` 完成，不包含实体传感器或操作系统旋转。截图在本目录。

该测试仅在独立测试服务器及隔离浏览器上下文中执行。设置读取注入测试配置，设置保存请求被拦截，避免覆盖测试服务器账号设置；因此本次不宣称验证了服务器设置持久化。文件选择使用自动化文件输入，不包含手机系统文件选择器。

随卡测试使用正式构建产物，页面不加载完整版插件，核对没有导入入口；轻触开始播放、相同角色与脚本重复执行复用单实例，同角色通知不断音，切换角色销毁 DOM、停止旧音频、移除音源，全部受跟踪资源计数归零。**生命周期订阅由测试夹具触发，不是本次新增的真实酒馆助手角色切换验收。** 真实 Helper 验收仍参见上一轮 [最终报告](../final-report.md)。

本次产物：`card-player/dist/native-runtime.js`，315,814 字节，SHA-256 `70a4831794f2363b3567db723b4795d9d25b0e000cb82cf654a95db5588f2116`，与此前验收的构建相同。

## 失败记录与限制

首次执行为 3 项通过、3 项失败，详见 [initial-runner.json](initial-runner.json)。原因是新测试使用了整个酒馆页面的 `audio` 选择器，匹配了宿主通知、TTS 等 6 个元素；改成 `#stm-player audio` 后完整重跑 6 项通过。没有因此修改产品代码、放宽断言或跳过项目，这不是播放器重复创建 6 个音频的缺陷。

尝试安装 Playwright WebKit 26.0 / Firefox 142.0.1。WebKit 官方下载及官方备用地址被当前云网络策略以 `403 Domain forbidden` 拒绝，安装命令在 WebKit 阶段终止，Firefox 尚未进入安装阶段；记录见 [browser-install-blocked.txt](browser-install-blocked.txt)。这两种引擎本次均**未运行**。没有关闭 TLS 校验或绕过网络策略。

未验证：实体 iPhone/Android、真正 Safari/Firefox、系统软键盘、锁屏及后台播放、系统挂起后的睡眠定时器、系统音量限制、手机扬声器听感、手机系统文件导入、移动系统存储回收及低内存杀进程。本轮没有重新执行近 30 MiB 卡的性能测试，也没有新增真实外网音源验证。已通过的虚拟测试不能推导这些项目通过。

## 重跑

使用独立 SillyTavern 测试数据目录，安装本仓库扩展，确认服务已启动；不要使用日常数据做测试。沿用已有依赖及 Chromium 即可：

```bash
ST_BASE_URL=http://127.0.0.1:8000 CHROMIUM_PATH=/usr/bin/chromium \
  npx playwright test --config playwright.mobile-virtual.config.js
```

如机器 Chromium 路径不同，修改环境变量即可。测试仅补充代码和验收记录，不改变版本号、音乐库、草稿、角色绑定或已导出的播放器；回滚只需撤销本次测试与文档提交。
