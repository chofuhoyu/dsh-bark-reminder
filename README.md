# dsh-bark-reminder

将 DeepSeek Harness 需要你处理的事项，通过 [Bark](https://bark.day.app) 推送到 iPhone。
本项目是一个常规的 DSH bundle：Host 端监听会话事件，Client 端在「设置」中提供配置页。

## 提醒场景

| 场景 | 触发来源 | 说明 |
| --- | --- | --- |
| 自动审查意见 | `approval/request` | 自动审查拒绝一次工具调用、将决定交给你时 |
| 沙盒权限申请 | `approval/request` | 模型通过 `sandbox_permissions` 申请更宽的沙盒模式时 |
| 其他确认请求 | `approval/request` | hook、拒绝后重试等任何等待确认的调用 |
| 提问与计划确认 | `user-questions/request` | `ask_user_question` 或计划评审等待回答时 |
| 一轮结束 | `agent/status` → idle | 一轮工作结束且不会自动继续时 |
| 运行错误 | `agent/error` | 会话因错误停止时 |

「一轮结束」并非在每次 turn 结束后立即推送：

- 默认延迟 60 秒再检查，避免在输入期间发送提醒（可设为 0）。
- 检查时，如果 agent 正在运行、存在排队输入、turn 尚未关闭，或存在会自动继续下一轮的 `armed` active goal，则不发送提醒。
- 同一个 turn 仅提醒一次；因错误停止的 turn 不会补发「一轮结束」提醒。
- 默认不提醒子代理会话（可开启）；goal 完成、受阻或暂停会在正文中说明。

## 默认推送示例

默认标题由 `[DSH]` 和会话标题组成，正文只包含自动生成的说明。一次自动审查拦截的示例如下：

```
[DSH] 重构登录流程
自动审查未放行 bash，需要你决定是否继续。
删除生产库里的旧数据
```

- 不显示时间：iOS 通知本身即显示送达时间，默认模板不写入 `{time}`。
- 会话标题只出现在标题行；正文不追加落款，也不使用空行分隔。
- 默认提醒级别为普通（`active`），不会穿透专注模式；如需时效性通知，可在设置中改为 `timeSensitive`。
- 默认模板的标题为 `[DSH] {sessionTitle}`，正文为 `{detail}`，可在设置页修改。

### 通知分组

Bark 的 `group` 参数设置 iOS 的线程标识：同一组的通知会在通知中心折叠显示，
Bark App 的历史记录也可按组筛选。但 iOS 的分组标题固定显示 App 名称（此处为 `Bark`），
线程标识本身不会显示，也没有可配置的分组名。默认 `group` 为 `DSH`，仅影响折叠方式与历史筛选。
因此无法将分组标题改为 `DSH`；
默认标题以 `[DSH]` 开头，通知内可直接识别来源。

### 通知图标

默认使用本仓库的 [icon.png](https://raw.githubusercontent.com/chofuhoyu/dsh-bark-reminder/main/icon.png)，
Bark 会在设备上下载该地址，并替换通知中默认的 Bark 图标（需要 iOS 15 及以上）。
图标按 URL 缓存在本机，同一地址只下载一次；首次下载失败或超过 10 秒时，退回 Bark 原生图标。

- 地址必须是图片直链。Bark 在 iOS 上解码的是位图，PNG、JPEG 等常见格式可用；SVG 不会被解码，
  因此默认地址指向 `icon.png`，而不是设置页导航使用的 `icon.svg`。
- 清空设置中的「图标」即可恢复 Bark 原生图标。
- 默认地址指向本仓库 `main` 分支的 raw 链接；仓库公开后 Bark 才能匿名拉取。

## 安装

在 DSH 的「设置 → 插件」里添加本地目录，或在本仓库目录执行：

```sh
dsh plugin --profile <profile> add /absolute/path/to/dsh-bark-reminder
```

安装后无需重启：Host 行和浏览器端会随 Plugin Manager 的安装流程激活。

## 配置

打开「设置 → Bark 提醒」。

1. **设备密钥**：在 Bark App 首页复制推送 key 后粘贴并保存。
   - 优先写入 DSH 凭据库，凭据名 `BARK_DEVICE_KEY`，不会出现在配置文件里。
   - 当前 profile 无凭据服务时，将改存至插件配置行中（profile patch 权限为 `0600`，页面不会回显密钥）。
   - 也可设置同名环境变量 `BARK_DEVICE_KEY`；环境变量来源为只读。
2. **Bark 服务器**：默认 `https://api.day.app`；自建 bark-server 请填写自己的地址（支持带路径的反向代理）。
3. **提醒场景**：按场景启用；可包含子代理。
4. **消息内容**：标题与正文模板、消息语言、变量插入、实时预览、恢复默认。默认标题为 `[DSH]` 加会话标题，正文只包含自动生成的说明，不包含时间。
5. **通知样式**：提醒级别（默认普通）、铃声、分组、图标（默认项目图标，清空可恢复 Bark 原生图标）、点击打开的链接、持续响铃、保存到历史。
6. **频率与去重**：去重窗口、每分钟上限。
7. **发送测试**：使用当前设置发送一条测试通知。

配置项修改后自动保存：停止输入约 0.6 秒后写入，离开本页时仍会补写最后一次修改；
保存通过 `configEditor` 写入 profile patch 并立即生效。设备密钥单独处理，粘贴后点击「保存密钥」写入。

### 模板变量

标题和正文均支持占位符，未知占位符会原样保留（便于发现拼写错误）：

| 变量 | 内容 |
| --- | --- |
| `{kindLabel}` | 场景名称（随推送语言） |
| `{detail}` | 自动生成的说明（含工具名、审查理由、问题等） |
| `{sessionTitle}` | 会话标题，无法获取时使用目录名 |
| `{project}` / `{cwd}` | 目录名 / 完整工作目录 |
| `{tool}` | 工具名 |
| `{reason}` | 审批理由、审查意见或提权说明 |
| `{question}` | 第一个问题 |
| `{mode}` | 申请到的沙盒模式 |
| `{error}` | 错误信息 |
| `{time}` / `{host}` | 本地时间 / 机器名；默认模板不使用 `{time}`，iOS 通知已包含送达时间 |
| `{turn}` / `{goal}` | 轮次 / 目标文本 |

推送正文最终会截断到 1800 字符、标题 200 字符。

## 凭据与隐私

- 设备密钥不会出现在 `GET /api/bark-reminder/config` 的响应中，仅返回 `configured`、`source`、`writable`。
- 页面的保存接口对密钥单独处理，不经过设置表单，页面提交无法覆盖它。
- 推送失败日志仅包含 Bark 的返回信息，不包含设备密钥。
- 「最近推送」仅在本次 DSH 进程内保留，重启后清空。

### 凭据库写入失败时

凭据库是 `~/.dsh/.credentials.yaml`（`@deepseek-ai/dsh-credentials-local`），
写入被拒时，页面会显示具体原因，并将密钥改存至插件配置行；之后成功写入凭据库时，会自动清除这份回退副本。

常见错误：`Expected YAML collection at refs. Remaining path: BARK_DEVICE_KEY`。
这说明凭据文档中存在一个**空的** `refs:` 节点（冒号后没有缩进条目），读取时被视作空表，
但写入时无法向 null 节点写入 `refs.BARK_DEVICE_KEY`。将该行改为 `refs: {}`（或删除该行）即可，
不要修改其他条目。插件本身不受影响：回退密钥仍可正常使用。

`refs` 是「名字 → 值」的普通映射，值即提交的字符串本身，不会解析 `~`、相对路径或任何文件引用。
因此将 `~/.dsh/.credentials.yaml` 这类路径填入设备密钥框时，仅会保存该字符串，Bark 无法识别；
设置页会拒绝包含 `/`、`\` 或以 `~`、`.` 开头的输入，并提示粘贴有效的推送 key。

- 设备密钥不会出现在 `GET /api/bark-reminder/config` 的响应中，仅返回 `configured`、`source`、`writable`。
- 页面的保存接口对密钥单独处理，不经过设置表单，页面提交无法覆盖它。
- 推送失败日志仅包含 Bark 的返回信息，不包含设备密钥。
- 「最近推送」仅在本次 DSH 进程内保留，重启后清空。

## Host 行为细节

- 审批与提问监听挂载在 answerer waterfall 的最前面，但始终调用 `next()`：提醒不改变任何决定，也不抢占 UI 的回答通道。
- 通知发送不阻塞事件：失败仅记录日志与状态，不影响工具调用或 turn。
- 一轮结束的定时器在 agent 重新运行时取消；agent 被 dispose 时清理。
- 同一事件在去重窗口内仅发送一次；超过每分钟上限的提醒将被丢弃，并每分钟最多记录一条警告。
- 依次读取凭据库、`BARK_DEVICE_KEY` 环境变量和配置行中的回退密钥。

## 路由

Host 通过 Connection 注册认证路由（仅本机 owner peer 可访问）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET / POST | `/api/bark-reminder/config` | 读取设置 / 保存设置 |
| POST | `/api/bark-reminder/key` | 写入或清除设备密钥 |
| POST | `/api/bark-reminder/test` | 发送测试通知 |
| POST | `/api/bark-reminder/preview` | 渲染模板预览 |

## 开发与检查

本项目没有构建步骤：Host 为 ESM，浏览器端为手写的 `client.js`，通过 `window.__ModuleLoader__.load` 注册。
插件不导出 Loader `Config` schema：本仓库以链接目录安装，Host 端因此不依赖任何 DSH 包，
仅导入 Node 内置模块和相对文件；配置的默认值、校验和页面保存共用 `host/config.js`。

```sh
node scripts/check-client.mjs   # 解析 client.js，校验两种语言的关键字与变量、注册数量
node scripts/smoke.mjs          # 在模拟服务下运行审批/提问/一轮结束/错误/路由的端到端逻辑
node --check index.js           # 逐个检查其余文件的语法
```

`scripts/smoke.mjs` 覆盖：配置默认值与严格校验（含默认级别 `active` 和显式级别）、多场景的文案渲染、默认模板使用 `[DSH]` 标题、正文只使用 `{detail}` 且不含空行、时间或 `·`、审批分类、
审批/提问/错误提醒的实际请求体、同一审批在去重窗口内不再发送、关闭场景不发送、
armed goal 抑制一轮结束提醒、错误后不再补发一轮结束提醒、重复 turn 去重、无凭据服务时的密钥回退、
配置/预览/密钥路由、保存在响应之后才发生。

## 已知限制

- Bark 的 `badge`、`ttl` 与加密推送尚未暴露；如需使用，可在 Bark API 层补充。
- 仅对 root session 提醒；子代理默认静默。
- 需要 iOS Bark App；自建服务器必须实现 `POST /push`。
- 提醒依赖 Host 进程存活；DSH 退出后不会补发。
- iOS 通知的分组标题为 App 名称（Bark），无法重命名；`group` 仅决定折叠方式，并在 Bark 历史记录中用于筛选。

## License

MIT
