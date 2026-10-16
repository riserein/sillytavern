# v1.13.1 原生 PNG / JSON 随卡播放器验收

本轮共 4 个不同用例在两次执行中通过：首轮 3 通过、1 个新增测试因未切到曲库页而失败，修正测试交互后单独重跑 1 通过。汇总、构建 SHA-256、资源及体积见 [distribution-validation-v1.13.1.json](distribution-validation-v1.13.1.json)。[native-validation.json](native-validation.json)仅为最后一次单用例重跑；[首轮记录](native-initial-v1.13.1.json)保留三个通过项及不完整状态，不能当作全通过。质量审查与完整边界见 [quality-review-v1.13.0.md](quality-review-v1.13.0.md)，汇总见 [quality-validation-v1.13.0.json](quality-validation-v1.13.0.json)。

测试使用实际 SillyTavern 1.19.0、官方酒馆助手 4.11.3：角色绑定、原生导出按钮、浏览器文件下载、PNG/JSON 导入、脚本启用、真实合成 MP3 播放、同角色聊天/开场白/回复切换/编辑/重新生成、多聊天、反复角色切换、停用再启用脚本、资源清理与失败保护。接收端禁用并阻断完整版插件代码与资源，不创建完整版音乐数据库。

HTTPS 直链提供合成音频的受控网络响应；LLM/分词也使用固定响应。它们验证播放器/酒馆集成，不证明第三方音乐站点或商业模型服务可用。移动端案例为 Chromium 触摸/视口模拟，不是真手机。已选字体本体按哈希核对，接收端无换字体入口。

[1.12.3 的完整历史记录](native-validation-v1.12.3.md)及其 [JSON](native-validation-v1.12.3.json)单独保留，不把旧的体积、字体或构建哈希当作本版本结果。更早的大字体记录仍在 1.12.2 归档内。

[1.13.0 原生验收历史](native-validation-v1.13.0.md)及其 [JSON](native-validation-v1.13.0.json)已归档。当前用户报告的接收端卡片尚未提供，具体故障未确诊，测试通过不替代该文件验收。
