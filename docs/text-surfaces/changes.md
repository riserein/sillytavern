# 修改文件与位置

| 文件 | 内容 |
| --- | --- |
| [ui/reading.css:1](../../ui/reading.css#L1) | 移除普通文字与正文分组填充，统一壳体保护层；明确组件保留背景 |
| [ui/contrast.js:39](../../ui/contrast.js#L39) | 统一按连续遮罩和实际控件面计算可读色 |
| [ui/reading.js:24](../../ui/reading.js#L24) | 组件自定义文字也检查遮罩下图片极端像素 |
| [ui/layouts.css:41](../../ui/layouts.css#L41) | 移除歌曲信息背景铭牌；两类背景隐藏规则只隐藏图像 |
| [card-player/runtime.js:111](../../card-player/runtime.js#L111) | 经典预览／独立脚本去除普通文字与正文容器底块 |
| [tests/text-surfaces.e2e.js:12](../../tests/text-surfaces.e2e.js#L12) | 真实酒馆五布局八页面及父容器、对比度和控件背景回归 |
| [tests/rendered-reading.js:5](../../tests/rendered-reading.js#L5) | 计算实际绘制层与壳体伪元素，跳过 display:contents |
| [tests/reading.e2e.js:90](../../tests/reading.e2e.js#L90) | 加入隐藏背景时保护层仍绘制的回归，维持 4.5:1 阈值 |
| [tests/reading.test.js:41](../../tests/reading.test.js#L41) | 所有预设的图片像素边界与原配色不变检查 |
| [tests/card-native.e2e.js:669](../../tests/card-native.e2e.js#L669) | 干净接收端校验无标题底块与整体保护层 |
| [tests/lyrics-modes.e2e.js:3](../../tests/lyrics-modes.e2e.js#L3) | 允许独立输出本轮证据，不覆盖旧版本截图 |

另外同步更新：`card-player/quality.js`、`manifest.json`、`package.json`、`package-lock.json` 的版本号；`playwright.text-surfaces.config.js`、默认 Playwright 测试排除项及新测试命令；`README.md`、`CHANGELOG.md`。

重建产物：`card-player/dist/native-runtime.js`、`shared-ui.js`、`runtime.js`、`demo.js`、`demo.tavern-helper.json`。这些是已有开发／导出产物，没有生成离线安装包。

本目录包含原始样式测量、测试报告、失败与复测记录及 80 组前后画面。此前版本的报告与截图未覆盖。
