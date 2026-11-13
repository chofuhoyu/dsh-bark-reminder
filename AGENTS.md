# AGENTS.md — 发布规则

## 发布必须打 tag

发布某个版本时，必须在 `package.json` 声明该版本的那个提交上创建并推送 tag。

- tag 名格式：`v<version>`，`<version>` 与 `package.json` 的 `version` 完全一致（如 `v0.1.5`）。
- 推送命令：`git push origin v<version>`。
- 已发布的 tag 永远不要移动或删除；修正版本只能发新版本、打新 tag。

原因：DSH 插件市场索引按 git tag 枚举版本。旧版本没有 tag 就会从索引里消失；版本号没有对应
tag 时，该版本可能被后来提交移动或覆盖，安装到的内容与声明的版本不一致。

## 发布清单

1. 修改 `package.json` 的 `version`。
2. 提交这次版本变更。
3. 在声明该版本的提交上创建 annotated tag：`git tag -a v<version> -m "v<version>"`。
4. 推送分支和 tag：`git push origin main`，然后 `git push origin v<version>`。
5. 用 `git ls-remote --tags origin` 与 `git show v<version>:package.json` 确认两者版本一致。
