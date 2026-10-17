# v1.13.3 测试结果与失败记录

以各 runner JSON 为准，失败、中断、未运行和仅选定测试均单列；不根据某个 worker 的局部总结宣称全套通过。

| 检查 | 最终实际结果 | 范围/证据 |
| --- | --- | --- |
| 单元测试 | 149 通过，0 失败/跳过 | [final-unit.txt](final-unit.txt)；内存 Store 不冒充 IDB |
| 完整版旧功能 | 60 通过，0 失败/跳过 | [full-plugin-runner.json](full-plugin-runner.json)；真实 ST，Helper 在专用资料中临时停用并 finally 恢复；远程音频为受控响应 |
| 原生随卡 | 5 通过，0 失败/跳过 | [native-runner.json](native-runner.json)；真实 ST 1.19.0 + 官方 Helper 4.11.3；接收端禁用音乐插件并阻断其资源；含手机尺寸模拟 |
| 制作页 | 3 通过，0 失败/跳过 | [maker-runner.json](maker-runner.json)；真实 ST/Helper、独立预览及重新导入；手机为 Chromium 模拟 |
| 质量/生命周期 | 15 通过，0 失败/跳过 | [quality-runner.json](quality-runner.json)；控制页面、真实浏览器与 IDB，延迟/失败为注入；不冒充 Helper |
| 数据安全审计 | 11 通过，0 失败/跳过 | [audit-runner.json](audit-runner.json)；真实 IDB、配额与受控请求/退出时序 |
| 备份迁移清理 | 9 通过，0 失败/跳过 | [data-browser.json](data-browser.json)；实际二进制 ZIP/IDB，服务器故障为路由注入；含恢复操作锁 |
| 同源多账号 | 1 通过，0 失败/跳过 | [accounts-browser.json](accounts-browser.json)；8133 独立 dataRoot；真实账号和服务器保存/回读，A 的 ZIP 恢复 B 后实际解码播放 |
| Helper 4.9.5 选定回归 | 1 通过，0 失败/跳过 | [helper-495-runner.json](helper-495-runner.json)；官方保留版本、原生 PNG/JSON/固定字体重导入；只算该一项，未跑其完整矩阵 |
| 最终构建随卡复核 | 1 通过，0 失败/跳过 | [native-final-target-runner.json](native-final-target-runner.json)；最终 bundle 的选定真实 ST/Helper 回归，不与完整套件重复计数 |

[check.txt](check.txt) 为语法检查；构建见 [build-native.txt](build-native.txt)、[build-demo.txt](build-demo.txt)。最终运行时 SHA 在 [build-artifacts.json](build-artifacts.json)。二进制 ZIP 还通过 Python 标准 zipfile 互读及独立 Node SHA 对照，见 [zip-python-interoperability.json](zip-python-interoperability.json)。

最终收尾流水见 [regression-release-stages.json](regression-release-stages.json)。中间流水与失败报告保留，不作为最终通过记录。

## 初次失败与处理

- 真实账号初次失败：/me 的默认头像超过原 64 KiB 上限；修为有界 16 MiB；旧页销毁后转发保存的回归修为保留拒绝保存保护。见 accounts-browser-initial.json、accounts-browser-stale-save-failure.json。
- 欢迎弹窗和 reload 后测试变量丢失属于测试准备问题，分别保留 welcome-fixture-failure 与 reload-fixture-failure；只在独立测试账号初始化完整设置。
- 数据初次 4 通过/2 失败：未展开折叠区、模拟远端对象被本地共享引用，修正测试隔离；之后资源计数把内部归属标记算为文件的开发期回归也已修复。原报告 data-browser-initial.json、data-browser-resource-count-failure.json 保留。
- 新平台备份测试最初缺 fixture id，保留 backup-platform-fixture-failure.txt；随后用合法输入执行旧备份序列化器，确认平台 ID 丢失问题，独立证据 backup-platform-confirmed.json，修复并验证当前版本及默认目录变更。
- 原生套件初次 3 通过/2 失败是读取了官方 Helper 异步恢复前的临时状态。测试现在等待并核对服务器最终内容，保留 native-initial-runner.json；未通过关页/断网模拟宣称第三方永久丢失已解决。
- 制作页初次 1 通过/2 失败确认预览 opaque origin 读取 localStorage 抛错，修复偏好降级，保留 maker-initial-runner.json。
- 完整旧功能初次 18 通过/4 失败/1 中断/37 未运行，发现可复现的选择菜单滚动关闭，主动停止并修复；记录 full-plugin-initial-interrupted.json。中间完整运行 56 通过/4 失败，含键盘焦点滚动、两项未等动画完成的几何检查，以及默认曲库用例在 reload 前未持久化空前置、读回前例 199 条的隔离问题；记录 full-plugin-middle-runner.json。没有移除断言或关闭动画：修复菜单后，等待动画 finished，再原样检查最终几何；通过酒馆完整设置保存确认空前置。受影响四项另行通过，最终全 60 重跑见主 runner。
- 构建曾因默认 npm 缓存路径不可写失败；明确使用 /tmp/stm-ui-build-cache 后成功，不关闭 TLS/校验。8133 测试准备时 8001 已被无关服务占用，保留该服务，改用独立 8133 及严格 dataRoot/PID 标记，未算产品 Bug。

## 未执行/受阻

真实外网探测见 [external-network.json](external-network.json)，没有真实外网浏览器播放通过结论。实体 iPhone/Android、Firefox/WebKit、桌面 Windows/macOS、后台锁屏、多 GiB 备份及真实系统内存峰值均未验证；见 [兼容性计划](compatibility.md)。大卡所有内存数字是有间隔采样，音频来源是原创合成样本，不是商业平台全曲验证。
