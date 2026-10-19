# 稳定渲染与对比度检查

Chromium 桌面与手机尺寸。普通图文检查实际绘制的衬底；歌词没有逐行背景框，对整区遮罩下未知图像采用黑白两端保守检查。不是全图像素或动画每一帧的认证。

旧 / 新配色矩阵：768 个组合、5376 个文字样本，最低 4.500197:1。三模式矩阵：360 个组合、720 个样本，最低 4.546022:1，逐行背景 alpha 均为 0。两矩阵部分场景重叠，不把它们相加称为独立主题数量。

| 布局 | 配色 / 设计配色 | 模式 | 组合数 | 最低对比度 | 结果 |
| --- | --- | --- | ---: | ---: | --- |
| cassette | night/blush | dark | 12 | 6.2796:1 | 通过 |
| cassette | night/blush | light | 12 | 4.5002:1 | 通过 |
| cassette | night/cream | dark | 12 | 6.9530:1 | 通过 |
| cassette | night/cream | light | 12 | 4.5112:1 | 通过 |
| cassette | night/ink | dark | 12 | 8.4181:1 | 通过 |
| cassette | night/ink | light | 12 | 4.5134:1 | 通过 |
| cassette | night/mist-blue | dark | 12 | 6.7092:1 | 通过 |
| cassette | night/mist-blue | light | 12 | 4.5007:1 | 通过 |
| cassette | night/smoke | dark | 12 | 5.8188:1 | 通过 |
| cassette | night/smoke | light | 12 | 4.5025:1 | 通过 |
| cassette | night/walnut | dark | 12 | 6.5472:1 | 通过 |
| cassette | night/walnut | light | 12 | 4.5137:1 | 通过 |
| crystal | night/blush | dark | 12 | 4.5679:1 | 通过 |
| crystal | night/blush | light | 12 | 4.5002:1 | 通过 |
| crystal | night/cream | dark | 12 | 4.5668:1 | 通过 |
| crystal | night/cream | light | 12 | 4.5112:1 | 通过 |
| crystal | night/inherit | dark | 12 | 4.5179:1 | 通过 |
| crystal | night/inherit | light | 12 | 4.5179:1 | 通过 |
| crystal | night/ink | dark | 12 | 4.5109:1 | 通过 |
| crystal | night/ink | light | 12 | 4.5134:1 | 通过 |
| crystal | night/mist-blue | dark | 12 | 4.5557:1 | 通过 |
| crystal | night/mist-blue | light | 12 | 4.5007:1 | 通过 |
| crystal | night/smoke | dark | 12 | 4.5648:1 | 通过 |
| crystal | night/smoke | light | 12 | 4.5025:1 | 通过 |
| crystal | night/walnut | dark | 12 | 4.5325:1 | 通过 |
| crystal | night/walnut | light | 12 | 4.5137:1 | 通过 |
| night | amber/inherit | dark | 12 | 4.5163:1 | 通过 |
| night | amber/inherit | light | 12 | 4.5131:1 | 通过 |
| night | forest/inherit | dark | 12 | 4.5227:1 | 通过 |
| night | forest/inherit | light | 12 | 4.5184:1 | 通过 |
| night | lavender/inherit | dark | 12 | 4.5166:1 | 通过 |
| night | lavender/inherit | light | 12 | 4.5003:1 | 通过 |
| night | night/inherit | dark | 12 | 4.5623:1 | 通过 |
| night | night/inherit | light | 12 | 4.8180:1 | 通过 |
| night | ocean/inherit | dark | 12 | 4.5234:1 | 通过 |
| night | ocean/inherit | light | 12 | 4.5021:1 | 通过 |
| night | pearl/inherit | dark | 12 | 4.5403:1 | 通过 |
| night | pearl/inherit | light | 12 | 4.5040:1 | 通过 |
| night | rose/inherit | dark | 12 | 4.5313:1 | 通过 |
| night | rose/inherit | light | 12 | 4.5043:1 | 通过 |
| pure | night/blush | dark | 12 | 4.5679:1 | 通过 |
| pure | night/blush | light | 12 | 4.5002:1 | 通过 |
| pure | night/cream | dark | 12 | 4.5668:1 | 通过 |
| pure | night/cream | light | 12 | 4.5112:1 | 通过 |
| pure | night/ink | dark | 12 | 4.5109:1 | 通过 |
| pure | night/ink | light | 12 | 4.5134:1 | 通过 |
| pure | night/mist-blue | dark | 12 | 4.5557:1 | 通过 |
| pure | night/mist-blue | light | 12 | 4.5007:1 | 通过 |
| pure | night/smoke | dark | 12 | 4.5648:1 | 通过 |
| pure | night/smoke | light | 12 | 4.5025:1 | 通过 |
| pure | night/walnut | dark | 12 | 4.5325:1 | 通过 |
| pure | night/walnut | light | 12 | 4.5137:1 | 通过 |
| vinyl | night/blush | dark | 12 | 4.5679:1 | 通过 |
| vinyl | night/blush | light | 12 | 4.5002:1 | 通过 |
| vinyl | night/cream | dark | 12 | 4.5668:1 | 通过 |
| vinyl | night/cream | light | 12 | 4.5112:1 | 通过 |
| vinyl | night/ink | dark | 12 | 4.5109:1 | 通过 |
| vinyl | night/ink | light | 12 | 4.5134:1 | 通过 |
| vinyl | night/mist-blue | dark | 12 | 4.5557:1 | 通过 |
| vinyl | night/mist-blue | light | 12 | 4.5007:1 | 通过 |
| vinyl | night/smoke | dark | 12 | 4.5648:1 | 通过 |
| vinyl | night/smoke | light | 12 | 4.5025:1 | 通过 |
| vinyl | night/walnut | dark | 12 | 4.5325:1 | 通过 |
| vinyl | night/walnut | light | 12 | 4.5137:1 | 通过 |
