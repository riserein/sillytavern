# 跨浏览器与实体手机验收计划

本轮实际执行的浏览器为 Linux Chromium；375 px / touch / isMobile 是模拟。当前执行机没有 Firefox、WebKit 浏览器二进制，也没有实体 iPhone/Android。下列项目均不提前标成通过。

| 环境 | 重点 | 本轮状态 |
| --- | --- | --- |
| Linux Chromium + SillyTavern 1.19.0 + 官方酒馆助手 4.11.3 | PNG/JSON、音频、字体、聊天生命周期 | 见真实酒馆报告 |
| Chromium 375×844 触摸模拟 | 共用界面、窗口、歌词、导出重导入 | 见报告；不是实体手机 |
| Windows/macOS Chrome、Edge | 文件导入、IDB 配额、PNG 保存和 HTTPS 直链 | 待人工验收 |
| Firefox 最新稳定版 | MP3/M4A/OGG、字体、对象 URL、AbortSignal、IDB | 待安装浏览器后执行 |
| macOS Safari 最新稳定版 | 播放手势、FontFace、gzip 还原、PNG/JSON、前后台 | 待真 Safari 验收；Playwright WebKit 不等同 Safari |
| iOS Safari 实体手机 | 文件 App 导入、触摸拖动、裁剪、后台/锁屏、内存压力 | 待实体设备验收 |
| Android Chrome 实体手机 | 下载目录、文件选择、多开角色、触摸与系统省电 | 待实体设备验收 |

## 可重复的桌面验证

在独立酒馆资料目录安装本插件和官方酒馆助手，启动服务。不要用真实用户的角色库进行自动化；测试会创建并清理 `RSCP_Test_` 临时角色。各套件串行执行，避免资料目录及 Playwright 输出目录互相影响。

```sh
npm ci
npm run build:card-native
npm run build:card-demo
npm test
npm run test:card-quality
npm run test:card-native
npm run test:card-export
```

其他浏览器安装后，可使用 Playwright 的 `--browser=firefox` / `--browser=webkit` 运行对应配置；清除 `CHROMIUM_PATH`，避免将 Chromium 路径传给其他引擎。WebKit 自动化结果另列，不写成 iOS Safari 实体机成功。

## 每台实体设备的逐项记录

1. 记录 OS/浏览器、酒馆/助手版本、音频格式、网络方式及文件大小。
2. 制作含三首原创/有权分发音频的卡：本地 MP3、M4A/OGG 和长期 HTTPS 直链各一；准备带词和不带词歌曲、一个背景、两种可选制作端字体。分别导出选中一种字体的 PNG 和 JSON。
3. 在没有完整版插件的独立接收端导入 PNG，允许角色脚本；点播放，观察 `playing`、时间前进且能实际听见声音。JSON 再执行一遍。
4. 同角色发送消息、切换开场白、切 AI 回复、编辑/重新生成、切不同聊天；记录音频实例不变、时间不中断。然后 A/B 切换十轮，检查离开后声音停止、DOM 消失，返回不自动播放。
5. 播放时停用脚本、离开角色、关聊天；在字体加载中立即退出；确认没有残留声音、重复浮球或字体回调重新挂载。
6. 播放进度、音量、四种模式、封面/歌词同步、最近播放/排行、迷你黑胶、拖动/缩放、主题/背景/字体、横竖屏分别操作。
7. 在完整版中验证草稿自动保存、刷新恢复、复制与两个页面修改冲突；尝试超配额/缺失资源，旧项目和旧角色卡仍可用。
8. 测试正常网络、慢网、断网、直链失效、后台、锁屏后恢复。把系统明确禁止后台播放与插件异常分开记录。
9. 上传文件给另一台独立设备重新导入，并核对角色设定、世界书、其他作者脚本、歌词和字体。
10. 保存设备截图、实际文件字节、音频事件日志、清理后的资源计数和失败步骤；失败不改写成“平台问题”除非取得证据。

## 外网验证独立执行

`CHROMIUM_PATH=... node scripts/verify-public-audio.mjs` 默认检查 MDN 的 CC0 音效，使用实际外网音频和时间前进。可用 `ST_PUBLIC_AUDIO_URL` 指定自己有权测试的长期 HTTPS 音频；报告路径通过 `ST_PUBLIC_AUDIO_REPORT` 设置。该探针不证明所有在线音乐平台可用。

Openverse/Audius 使用原有 `npm run test:live`，报告与平台 Key 状态独立保留。本次未取得 Audius Key，不新增需要用户申请凭据的主界面配置。不要为了通过测试关闭 TLS 校验或把路由音频冒充真实外网。
