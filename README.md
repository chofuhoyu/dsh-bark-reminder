# dsh-bark-reminder

把 DeepSeek Harness 需要你处理的事情，通过 [Bark](https://bark.day.app) 推送到 iPhone。
它是一个普通的 DSH bundle：Host 端监听会话事件，Client 端在「设置」里提供一个配置页。

## 会提醒什么

| 场景 | 触发来源 | 说明 |
| --- | --- | --- |
| 自动审查器意见 | `approval/request` | Auto review 拒绝一次工具调用、把决定交给你时 |
| 沙盒权限申请 | `approval/request` | 模型用 `sandbox_permissions` 申请更宽的沙盒模式时 |
| 其他审批请求 | `approval/request` | hook、用户拒绝重试等任何等待批准的调用 |
| 提问与计划确认 | `user-questions/request` | `ask_user_question`、计划评审等待回答时 |
| 会话结束 | `agent/status` → idle | 一轮工作结束、且不会自动继续时 |
| 运行错误 | `agent/error` | 会话因错误停止时 |

「会话结束」不是简单地在每次 turn 结束后推送：

- 默认延迟 60 秒再检查，避免你正在输入时被打扰（可设为 0）。
- 检查时如果 agent 又在运行、还有排队输入、turn 尚未关闭，或者存在一个 `armed` 的 active goal（会自动继续下一轮），就不推送。
- 同一个 turn 只提醒一次；因错误停止的 turn 不会再补一条「会话结束」。
- 默认不提醒子代理会话（可开启）；goal 完成、受阻、暂停会在正文里说明。

## 安装

在 DSH 的「设置 → 插件」里添加本地目录，或在本仓库目录执行：

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-bark
```

安装后重启不是必须的：Host 行和浏览器半会随 Plugin Manager 的安装流程激活。

## 配置

打开「设置 → Bark 提醒」。

1. **设备密钥**：在 Bark App 首页复制推送 key，粘贴并保存。
   - 优先写入 DSH 凭据库，凭据名 `BARK_DEVICE_KEY`，不会出现在配置文件里。
   - 当前 profile 没有凭据服务时，会退回保存在插件配置行里（profile patch 权限为 `0600`，且页面不会回显密钥）。
   - 也可以设置同名环境变量 `BARK_DEVICE_KEY`；环境变量来源只读。
2. **Bark 服务器**：默认 `https://api.day.app`；自建 bark-server 填自己的地址（支持带路径的反代）。
3. **提醒场景**：按场景开关；可包含子代理。
4. **消息内容**：标题/正文模板、推送语言、变量插入、实时预览、恢复默认。
5. **通知样式**：级别、铃声、分组、图标、点击打开的链接、持续响铃、保存到历史。
6. **频率与去重**：去重窗口、每分钟上限。
7. **发送测试**：用当前设置真实发送一条推送。

页面顶部和底部各有一个保存按钮；保存走 `configEditor`，写入 profile patch 并立即生效。

### 模板变量

标题和正文都支持占位符，未知占位符会原样保留（方便发现拼写错误）：

| 变量 | 内容 |
| --- | --- |
| `{kindLabel}` | 场景名称（随推送语言） |
| `{detail}` | 自动生成的说明（含工具名、审查理由、问题等） |
| `{sessionTitle}` | 会话标题，取不到时用目录名 |
| `{project}` / `{cwd}` | 目录名 / 完整工作目录 |
| `{tool}` | 工具名 |
| `{reason}` | 审批理由、审查意见或提权说明 |
| `{question}` | 第一个问题 |
| `{mode}` | 申请到的沙盒模式 |
| `{error}` | 错误信息 |
| `{time}` / `{host}` | 本地时间 / 机器名 |
| `{turn}` / `{goal}` | 轮次 / 目标文本 |

推送正文最终会截断到 1800 字符、标题 200 字符。

## 凭据与隐私

- 设备密钥不会出现在 `GET /api/bark-reminder/config` 的响应里，只返回 `configured`、`source`、`writable`。
- 页面的保存接口对密钥单独处理，不经过设置表单，页面提交无法覆盖它。
- 记录推送失败的日志只包含 Bark 的返回信息，不含设备密钥。
- 「最近推送」只在本次 DSH 进程内保留，重启即清空。

### 凭据库写入失败时

凭据库是 `~/.dsh/.credentials.yaml`（`@deepseek-ai/dsh-credentials-local`），
写入被拒时页面会显示真实原因，并把密钥改存到插件配置行；之后成功写入凭据库时会自动清掉这份回退副本。

常见的一条：`Expected YAML collection at refs. Remaining path: BARK_DEVICE_KEY`。
这说明凭据文档里有一个**空的** `refs:` 节点（冒号后没有缩进条目），读取时被当成空表，
但写入时无法往一个 null 节点里塞 `refs.BARK_DEVICE_KEY`。把那一行改成 `refs: {}`（或删掉这一行）即可，
不要动其它条目。插件本身不受影响：回退密钥已经能用。

`refs` 是「名字 → 值」的普通映射，值就是提交的字符串本身，不会解析 `~`、相对路径或任何文件引用。
因此把 `~/.dsh/.credentials.yaml` 这样的路径填进设备密钥框，只会存下这个字符串，Bark 也不会认；
设置页现在会拦下包含 `/`、`\` 或以 `~`、`.` 开头的输入并提示粘贴真正的推送 key。

- 设备密钥不会出现在 `GET /api/bark-reminder/config` 的响应里，只返回 `configured`、`source`、`writable`。
- 页面的保存接口对密钥单独处理，不经过设置表单，页面提交无法覆盖它。
- 记录推送失败的日志只包含 Bark 的返回信息，不含设备密钥。
- 「最近推送」只在本次 DSH 进程内保留，重启即清空。

## Host 行为细节

- 审批与提问监听挂在 answerer waterfall 的最前面，但永远调用 `next()`：提醒不改变任何决定，也不抢占 UI 的回答通道。
- 通知发送不阻塞事件：失败只记日志和状态，不影响工具调用或 turn。
- 会话结束的定时器在 agent 重新运行时取消；agent 被 dispose 时清理。
- 同一事件在去重窗口内只发一次；超过每分钟上限的提醒丢弃，并每分钟最多记一条警告。
- 先取凭据库，再取 `BARK_DEVICE_KEY` 环境变量，最后取配置行里的回退密钥。

## 路由

Host 通过 Connection 注册认证路由（只有本机 owner peer 可访问）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET / POST | `/api/bark-reminder/config` | 读取设置 / 保存设置 |
| POST | `/api/bark-reminder/key` | 写入或清除设备密钥 |
| POST | `/api/bark-reminder/test` | 发送测试通知 |
| POST | `/api/bark-reminder/preview` | 渲染模板预览 |

## 开发与检查

没有构建步骤：Host 是 ESM，浏览器半是手写的 `client.js`，通过 `window.__ModuleLoader__.load` 注册。
插件刻意不导出 Loader `Config` schema：本仓库以链接目录安装，Host 端因此不依赖任何 DSH 包，
只导入 Node 内置模块和相对文件；配置的默认值、校验和页面保存共用 `host/config.js`。

```sh
node scripts/check-client.mjs   # 解析 client.js，校验两种语言的关键字与变量、注册数量
node scripts/smoke.mjs          # 假服务下跑审批/提问/结束/错误/路由的端到端逻辑
node --check index.js           # 其余文件逐个 node --check
```

`scripts/smoke.mjs` 覆盖：配置默认值与严格校验、四种场景的文案渲染、审批分类、
审批/提问/错误提醒的实际请求体、同一审批在去重窗口内不再发送、关闭场景不发送、
armed goal 抑制结束提醒、错误后不再补结束提醒、重复 turn 去重、无凭据服务时的密钥回退、
配置/预览/密钥路由、保存在响应之后才发生。

## 已知限制

- Bark 的 `badge`、`ttl`、加密推送没有暴露；需要时可直接在 Bark API 层补。
- 只对 root session 提醒；子代理默认静默。
- 需要 iOS Bark App；自建服务器必须实现 `POST /push`。
- 提醒延迟以 Host 进程存活为前提；DSH 退出后不会补发。

## License

MIT
