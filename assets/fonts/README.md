# 内置字体（1.12.3）

仅保留两款小于 5 MB 的完整 WOFF2 字库。字体名称及字形未裁剪，按用户选择从当前酒馆加载，不访问字体 CDN。设备字体不附带字体文件，使用者自行导入的字体仍保存在当前浏览器。

| 字体 | 文件大小 | 固定来源 | 授权 |
| --- | ---: | --- | --- |
| 破晓像素 · PoxiaoPixel | 1,266,972 字节 | [Poxiao Labs 官方 Forge](https://forge.poxiao-labs.work/Fonts/fzg)；文件取自 [JiMiDoo 保留的原始字体](https://github.com/TRAfoer/JIMIDOO/tree/371a420f375ced16c7b78d80e130a5c02e62c24d/assets_src/fonts) | [SIL Open Font License 1.1](OFL-PoxiaoPixel.txt) |
| 游趣体 · Child Fun Sans | 1,531,668 字节 | [Des-Magmeta 官方项目固定提交](https://github.com/Des-Magmeta/ChildFunSans/tree/b235bc5554f98252bcb4a1dd7e183e816dbee7ef)，Fonts/ChildFunSans.ttf | [SIL Open Font License 1.1](OFL-ChildFunSans.txt) |

原始字体通过 FontTools 的 WOFF2 容器转换保存，保留完整字形和原始名称。源文件、转换结果的 SHA-256、字符映射数量记录于 [sources.json](sources.json)。对应字体授权不由本仓库应用代码的许可证替代。

本版移除了京华老宋、源雲明體、寒蝉活宋、文鼎楷体、汇文明朝的二进制文件、选项及不再使用的来源/许可附件，共减少 75,924,824 字节。旧的内置字体选择回退为“跟随酒馆”；不删除本地音乐、歌单、绑定或用户自行导入的字体。历史文件及授权记录可在相应 Git 版本中查阅，旧导出角色卡保持原样。
