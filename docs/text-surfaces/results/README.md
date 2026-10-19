# 本轮实际测试结果

最终版本 alpha.8，最终原生运行时 SHA-256：`9504f949b7021b6a10de9856344bd22b82a6fcf631ec7d59eced011666f528ac`。

181 项 Node 测试、语法／数据检查通过。以下为最终构建下的独立浏览器用例，初跑／复跑不重复计入：

| 测试组 | 通过 | 失败 | 跳过 | 用时 | 原始结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| text-surfaces | 2 | 0 | 0 | 204.86 s | [JSON](text-surfaces-runner.json) |
| reading | 18 | 0 | 0 | 107.65 s | [JSON](reading-runner.json) |
| modes | 16 | 0 | 0 | 81.96 s | [JSON](modes-runner.json) |
| data | 10 | 0 | 0 | 48.3 s | [JSON](data-runner.json) |
| native | 4 | 0 | 0 | 554.29 s | [JSON](native-runner.json) |
| maker | 4 | 0 | 0 | 217.16 s | [JSON](maker-runner.json) |
| coexist | 1 | 0 | 0 | 11.45 s | [JSON](coexist-runner.json) |

共 55 项浏览器用例。160 个真实酒馆逐页场景、3,320 个普通文字／正文容器样本均无独立底色，最低 4.5458:1。扩展主题矩阵 768 个组合、5376 个颜色样本，最低 4.5109:1。三种歌词模式 720 个样本，最低 4.5460:1。

## 构建体积

| 产物 | 修复前 | 修复后 | 差值（字节） |
| --- | ---: | ---: | ---: |
| card-player/dist/native-runtime.js | 353180 | 352108 | -1072 |
| card-player/dist/shared-ui.js | 314174 | 313101 | -1073 |
| card-player/dist/runtime.js | 71639 | 71614 | -25 |

原生测试实际导出及导入 PNG/JSON，各布局的文件大小记录在 [native-validation.json](native-validation.json)。与旧报告使用的不同测试歌曲、封面和字体的卡片不能直接当成文件体积优化基准；上表仅比较相同运行时代码的字节数。

## 失败与复测

首次 reading 回归有 16 通过、2 失败：设计器隐藏背景组件时，旧 `::after` 隐藏规则使新遮罩不绘制，文字约 1.55:1。原始 [失败日志](reading-initial-failure.log) 保留，修复后专项两项及整套 18 项均通过。此前原生四项初测结果仅作过程记录，不代替本次最终四项。

最早逐页测试脚本的收藏按钮定位不唯一，及把选中歌曲整行当成文字框的误判，均按真实组件边界修正；普通文字、父容器和 4.5:1 阈值没有放宽。

实体 iPhone/Android、Firefox、Safari、旧版 Helper 4.9.5 未在本轮测试。外网第三方音乐来源未在本轮测试。
