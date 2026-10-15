# 内置源雲明體

- 字体：GenWanMin2 TC R，Regular。
- 官方项目：https://github.com/ButTaiwan/genwan-font
- 固定来源提交：`25e718615173a3b51099ecc9a6bf4fa558c03fbc`。
- 原始文件：[`otf/TC/GenWanMin2TC-R.otf`](https://github.com/ButTaiwan/genwan-font/blob/25e718615173a3b51099ecc9a6bf4fa558c03fbc/otf/TC/GenWanMin2TC-R.otf)。
- 授权：[SIL Open Font License 1.1](OFL-GenWanMin.txt)，来自官方同名授权文件。

使用 FontTools 和 Brotli 将完整 OTF 字库转换为 WOFF2 容器，未裁剪字形、未修改字体名称。原始文件与本文件均保留 35349 个 Unicode 字符映射。字体按用户选择加载，由用户的酒馆直接提供，不访问外部字体 CDN。

`GenWanMin2TC-R.woff2` SHA-256：

```text
dd377f6db8cb98f5570b0087263435b94b600e565fdf85b8ccd752555ce03288
```


# 新增的六款字体（1.6.0）

全部采用完整字库，不裁剪字符。每个文件的固定来源、原始家族名称、字符映射数量和 SHA-256 记录在 [sources.json](sources.json)。对应授权不受本仓库应用代码许可证替代。

| 字体 | 获取来源 | 授权 |
| --- | --- | --- |
| PoxiaoPixel | [Poxiao Labs 官方 Forge](https://forge.poxiao-labs.work/Fonts/fzg)；本次文件及版权声明取自 [JiMiDoo 保留的原始字体](https://github.com/TRAfoer/JIMIDOO/tree/371a420f375ced16c7b78d80e130a5c02e62c24d/assets_src/fonts) | [SIL OFL 1.1](OFL-PoxiaoPixel.txt) |
| ChillHuoSong_F Regular | [ChillType 官方发布 HuoSongv1.000](https://github.com/Warren2060/ChillMovableType/releases/tag/HuoSongv1.000) 的 ChillHuoSong_F.zip → ChillHuoSong_F_Regular.otf | [SIL OFL 1.1](OFL-ChillMovableType.txt) |
| AR PL UKai CN | [CJK Unifonts](https://www.freedesktop.org/wiki/Software/CJKUnifonts)；[Debian 发行包](https://deb.debian.org/debian/pool/main/f/fonts-arphic-ukai/fonts-arphic-ukai_0.2.20080216.2-6_all.deb) 内 ukai.ttc 的第 0 个字体 | [ARPHIC PUBLIC LICENSE](ARPHICPL.TXT) 及 [版权说明](UKai-copyright.txt) |
| Child Fun Sans | [Des-Magmeta 官方项目](https://github.com/Des-Magmeta/ChildFunSans/tree/b235bc5554f98252bcb4a1dd7e183e816dbee7ef)，Fonts/ChildFunSans.ttf | [SIL OFL 1.1](OFL-ChildFunSans.txt) |
| KingHwaOldSong 3.000 | 特里王制作，[非官方 AUR 打包仓库](https://github.com/BH1PHL/ttf-terrywang-hot-metal-fonts/tree/57a12f5d6b9087c907c8facd04fef89a717d911c)；**原始 TTF 原样分发，无修改、无格式转换** | [作者免费嵌入、复制传播条款](LICENSE-TerryWang.txt)，非开源，禁止修改和售卖字体 |
| Huiwen-mincho | 特里王原字体的 [符号修正版](https://github.com/bosswnx/huiwenmincho-improved/tree/40b9dbb9bfa51bc4979b62d0dcd3bc064c5ea049)，修正常用标点宽度 | [该项目 CC0 声明](CC0-Huiwen.txt) |

转换使用 FontTools 的 `TTFont` 与 Brotli：读取完整字体，设置 `font.flavor = 'woff2'`，保存；字体名称和字形保持不变，所有默认 Unicode 字符映射保留。寒蝉活宋原文件的 cmap format 14 中有 117 条指向 .notdef 的无效变体映射，会被 Chromium 的 OTS 拒绝；仅移除这些无效引用（没有移除字形或普通字符映射），输出按原 SIL OFL 1.1 分发。UKai 的处理说明如下。UKai 使用 `TTFont('ukai.ttc', fontNumber=0)` 提取 CN 字体，并在输出文件的 name ID 10 中明确记载于 2026-10-15 从 TTC 转为 WOFF2、完整保留字形、按 ARPHIC PUBLIC LICENSE 自由分发。原文授权保留在 ARPHICPL.TXT，转换后的完整文件公开提供于本仓库。

字体按选择或预览时的可见区域加载，通过当前酒馆提供，不访问外部 CDN；预览使用实际字体文件，无截图替代或系统字体冒充。
