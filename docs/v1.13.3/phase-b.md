# 阶段 B：确认缺陷修复

- N01：草稿删除增加同事务 revision 校验，制作页传入当前 revision。旧页面不能删除新版本。
- N02：原生导出 fetch 包装器只处理同源 POST，第三方域相同路径原样转发，不读取本机角色。
- S02：平台 JSON 改为 4 MiB 流累计上限；超限、取消、响应体挂起时取消 reader，保留超时与失败分类，不影响本地播放。

代码：`card-player/project-store.js`、`card-maker.js`、`card-player/native-export.js`、`bounded-response.js`、`platforms/request.js`。测试见 `phase-b-unit.txt` 和 `phase-b-browser.json`；后者使用真实 IndexedDB、受控网络与时间，不是外网或真实多账号验收。

本阶段不改版本号或数据库。账号隔离和备份仍待后续独立实现。回滚此提交不会造成数据迁移；若回滚则重新暴露上述缺陷。
