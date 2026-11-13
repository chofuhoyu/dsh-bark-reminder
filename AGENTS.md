# AGENTS.md — 发布规则

## 发布必须打 tag

发布某个版本时，必须在 `package.json` 声明该版本的那个提交上创建并推送 tag。

- tag 名格式：`v<version>`，`<version>` 与 `package.json` 的 `version` 完全一致（如 `v0.1.5`）。
- 推送命令：`git push origin v<version>`。
- 已发布的 tag 永远不要移动或删除；修正版本只能发新版本、打新 tag。

原因：DSH 插件市场索引列出打了 tag 的版本和默认分支上的当前版本。没有 tag 的旧版本会从索引
里消失；当前版本没有 tag 时，版本号会随默认分支前进漂移到更晚的提交，安装到的内容与声明的
版本不一致。

## 发布清单

1. 修改 `package.json` 的 `version`。
2. 提交这次版本变更。
3. 在声明该版本的提交上创建 annotated tag：`git tag -a v<version> -m "v<version>"`。
4. 推送分支和 tag：`git push origin main`，然后 `git push origin v<version>`。
5. 用 `git ls-remote --tags origin` 与 `git show v<version>:package.json` 确认两者版本一致。
