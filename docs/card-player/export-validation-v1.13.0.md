# v1.13.0 独立制作页与角色卡 JSON 验收

当前结果见 [export-validation-v1.13.0.json](export-validation-v1.13.0.json)，使用说明见 [quality-user-guide.md](quality-user-guide.md)。[v1.11 原始报告](export-validation-v1.11.md)与 [原始 JSON](export-validation-v1.11.json)已归档，不再把“不保存草稿”的历史限制当成当前行为。

本轮沿用原有独立制作 UI、四个主题和独立运行时；新增制作草稿、多项目、容量分析、文件静态复查及歌词补全。它与“歌单绑定 → 酒馆原生 PNG/JSON 导出”的共享 UI 流程并存；后者见 [native-validation.md](native-validation.md)。

验收使用实际 SillyTavern 1.19.0 与官方酒馆助手 4.11.3。三个案例分别覆盖桌面制作/导出 JSON/全新接收端重新导入与播放、Chromium 手机视口/触摸模拟，以及资源失败和编辑后禁止旧/部分导出；保留其他脚本与角色字段。

预览页、生成脚本解析或 Mock 解码不是角色环境验收。实际导入后执行播放、消息/开场白/回复切换和清理才计入本报告。手机尺寸模拟仍不等于 iOS Safari 或 Android Chrome 实体机验收。新增草稿、并发退出、配额失败模拟、资源副本与歌词链路详见 [专项浏览器记录](quality-browser-validation.json)和[完整质量审查](quality-review-v1.13.0.md)。
