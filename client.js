/**
 * Browser half of the Bark reminder bundle: one settings section that edits the
 * plugin configuration and the device key, previews the push templates, and
 * sends a test notification. It talks to its Host half over the authenticated
 * `/api/bark-reminder` routes; no other Client service is required.
 */

window.__ModuleLoader__.load({
  id: 'dsh-bark-reminder',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useRef, useState } = React

    /** Locale namespace owned by this plugin. */
    const NS = 'bark-reminder'

    /** Route prefix the Host registers; relative to the page document. */
    const API = 'api/bark-reminder'

    /** Quiet period after an edit before the page writes the configuration. */
    const AUTO_SAVE_DELAY_MS = 600

    /** Backoff between retries while the Host restarts through a write. */
    const SAVE_RETRY_DELAYS_MS = [250, 500, 1000]

    /** Template placeholders offered by the page; must match `host/messages.js`. */
    const VARIABLES = [
      'kindLabel', 'detail', 'sessionTitle', 'project', 'cwd',
      'tool', 'reason', 'question', 'mode', 'error',
      'time', 'host', 'turn', 'goal',
    ]

    /** Copy for the page itself. */
    const en = {
      nav: 'Bark reminders',
      title: 'Bark reminders',
      intro: 'When DSH requires your attention, it sends a notification to your iPhone.',
      'load.failed': 'Unable to load the settings',
      'load.retry': 'Retry',
      'status.enabled': 'Reminders enabled',
      'status.disabled': 'Reminders disabled',
      'status.keyConfigured': 'Device key configured',
      'status.keyMissing': 'No device key',
      'basic.title': 'Basics',
      'basic.enabled': 'Enable Bark reminders',
      'basic.enabledDesc': 'When disabled, no notifications are sent; this page remains editable.',
      'server.label': 'Bark server',
      'server.desc': 'The public server is used by default; set your own address for a self-hosted bark-server.',
      'server.placeholder': 'https://api.day.app',
      'key.title': 'Device key',
      'key.label': 'Push key',
      'key.desc': 'Copy the push key from the Bark app home screen and paste it here. The key is stored in the DSH credential store and is never written to the configuration file.',
      'key.placeholder': 'Paste the Bark push key',
      'key.placeholderConfigured': 'Configured; enter a new key to replace it',
      'key.save': 'Save key',
      'key.saving': 'Saving…',
      'key.clear': 'Clear',
      'key.clearConfirm': 'Click again to confirm',
      'key.saved': 'Device key saved',
      'key.cleared': 'Device key removed',
      'key.savedFallback': 'The credential store rejected the write, so the key was saved in the plugin configuration instead.',
      'key.clearedFallback': 'The key was removed, but the credential store rejected the cleanup:',
      'key.sourceEnv': 'from the environment',
      'key.sourceStored': 'from the credential store',
      'key.sourceConfig': 'from the plugin configuration',
      'key.sourceNone': 'not configured',
      'key.descConfig': 'This profile has no credential store, so the key is stored in the plugin configuration. It is readable only by this profile.',
      'key.refHint': 'Credential name',
      'key.envHint': 'Alternatively, set the same environment variable and restart DSH.',
      'key.missing': 'No device key is configured, so notifications will not be sent.',
      'key.readonly': 'The key is provided by the environment and cannot be changed here.',
      'key.invalid': 'The key must be a single continuous value without spaces.',
      'key.looksLikePath': 'This input appears to be a file path, not a Bark push key. Paste the push key from the Bark app home screen.',
      'key.failed': 'Unable to save the key',
      'test.title': 'Test notification',
      'test.desc': 'Send a notification with the current settings to confirm delivery.',
      'test.button': 'Send test',
      'test.sending': 'Sending…',
      'test.success': 'Test notification sent; check your iPhone.',
      'test.failed': 'Delivery failed',
      'test.noKey': 'Configure the device key first.',
      'triggers.title': 'Notification events',
      'triggers.desc': 'Only the selected events produce a notification.',
      'trigger.approval': 'Other approvals',
      'trigger.approvalDesc': 'A tool call is waiting for your approval.',
      'trigger.review': 'Auto review feedback',
      'trigger.reviewDesc': 'Auto review denied a call and left the decision to you.',
      'trigger.escalation': 'Sandbox escalation',
      'trigger.escalationDesc': 'The model requests a wider sandbox mode.',
      'trigger.question': 'Questions and plans',
      'trigger.questionDesc': 'The agent is waiting for your answer.',
      'trigger.idle': 'Turn finished',
      'trigger.idleDesc': 'A run ended and will not continue on its own.',
      'trigger.error': 'Run errors',
      'trigger.errorDesc': 'A session stopped because of an error.',
      'trigger.subagents': 'Include subagents',
      'trigger.subagentsDesc': 'Also notify for subagent sessions; typically noisy, so it is disabled by default.',
      'idle.delay': 'Finished reminder delay',
      'idle.delayDesc': 'Wait for this duration after the session becomes idle before notifying, so an answer currently being typed does not trigger a reminder.',
      'idle.seconds': 's',
      'content.title': 'Message content',
      'content.desc': 'Titles and bodies support the variables below; empty fields use the default copy.',
      'content.titleLabel': 'Title',
      'content.bodyLabel': 'Body',
      'content.vars': 'Insert a variable',
      'content.varsTarget': 'Inserting into',
      'content.targetTitle': 'Title',
      'content.targetBody': 'Body',
      'content.varsHint': 'Click the title or body first, then a variable. It lands at the caret and can be undone with ⌘Z or Ctrl+Z. Hover or focus a variable for its description and example.',
      'content.varsNote': 'Variables render empty when they do not apply; unknown names are kept as typed.',
      'content.example': 'Example',
      'content.preview': 'Preview',
      'content.reset': 'Restore defaults',
      'content.locale': 'Message language',
      'content.localeDesc': 'Language of event labels and generated details; saved templates are unchanged.',
      'content.langZh': '中文',
      'content.langEn': 'English',
      'var.kindLabel': 'Event label',
      'var.kindLabelDesc': 'The event label for this reminder; it follows the message language.',
      'var.kindLabelExample': 'Auto review declined a step',
      'var.detail': 'Generated detail',
      'var.detailDesc': 'The generated detail with the tool, reason, or question; this is the default body.',
      'var.detailExample': 'Auto review did not approve bash; your decision is required.\nDrops stale rows from the production database',
      'var.sessionTitle': 'Session title',
      'var.sessionTitleDesc': 'The session title, falling back to the project folder name.',
      'var.sessionTitleExample': 'Refactor the login flow',
      'var.project': 'Project',
      'var.projectDesc': 'Name of the project folder for this session.',
      'var.projectExample': 'dsh-bark-reminder',
      'var.cwd': 'Working directory',
      'var.cwdDesc': 'Full working directory of the session.',
      'var.cwdExample': '/Users/you/Code/dsh-bark-reminder',
      'var.tool': 'Tool',
      'var.toolDesc': 'Name of the tool that triggered the reminder.',
      'var.toolExample': 'bash',
      'var.reason': 'Reason',
      'var.reasonDesc': 'Approval reason, auto-review note, or escalation explanation.',
      'var.reasonExample': 'Drops stale rows from the production database',
      'var.question': 'Question',
      'var.questionDesc': 'The first pending question.',
      'var.questionExample': 'Which database should the migration use?',
      'var.mode': 'Sandbox mode',
      'var.modeDesc': 'The sandbox mode the model requested.',
      'var.modeExample': 'danger-full-access',
      'var.error': 'Error',
      'var.errorDesc': 'The error that stopped the session.',
      'var.errorExample': 'Model request failed after three retries',
      'var.time': 'Time',
      'var.timeDesc': 'Local time when the notification was rendered; unused by default.',
      'var.timeExample': '2026-11-13 13:54',
      'var.host': 'Host name',
      'var.hostDesc': 'Name of the machine running DSH.',
      'var.hostExample': 'MacBook-Pro',
      'var.turn': 'Turn',
      'var.turnDesc': 'Current turn number.',
      'var.turnExample': '4',
      'var.goal': 'Goal',
      'var.goalDesc': 'Text of the associated goal.',
      'var.goalExample': 'Ship the notification plugin',
      'style.title': 'Notification style',
      'style.level': 'Interruption level',
      'style.levelDesc': 'Normal delivers as usual. Time sensitive can break through Focus. Quiet only adds the notification to Notification Center. Critical ignores mute and Do Not Disturb.',
      'style.sound': 'Sound',
      'style.soundDesc': 'A Bark sound name such as minuet; leave empty to use the app default.',
      'style.group': 'Group',
      'style.groupDesc': 'Notifications in the same group are stacked in Notification Center. iOS always labels the group with the app name (Bark) and provides no way to rename it; this setting only controls which notifications are grouped.',
      'style.icon': 'Icon',
      'style.iconDesc': 'PNG or JPEG image URL. Defaults to the project icon, replacing the Bark icon. Requires iOS 15 or later.',
      'style.url': 'Open on tap',
      'style.urlDesc': 'Link to open when the notification is tapped; variables are supported. If empty, only Bark opens.',
      'style.call': 'Ring for 30 seconds',
      'style.callDesc': 'Rings for 30 seconds; intended for urgent matters.',
      'style.archive': 'Save to history',
      'style.archiveDesc': 'Keep this notification in the Bark history.',
      'placeholder.optional': 'Optional',
      'limits.title': 'Rate and duplicates',
      'limits.dedupe': 'Duplicate window',
      'limits.dedupeDesc': 'Repeated reminders for the same event within this window are dropped.',
      'limits.rate': 'Per-minute limit',
      'limits.rateDesc': 'Notifications beyond the limit are dropped and logged once.',
      'unit.seconds': 's',
      'unit.perMinute': 'notifications',
      'save.saving': 'Saving…',
      'save.pending': 'Saving automatically…',
      'save.failed': 'Unable to save',
      'save.invalid': 'Invalid setting',
      'save.clean': 'All changes saved',
      'recent.title': 'Recent notifications',
      'recent.desc': 'Retained for this DSH run only.',
      'recent.empty': 'No notifications sent yet.',
      'recent.ok': 'sent',
      'recent.fail': 'failed',
      'recent.sent': 'sent',
      'recent.failed': 'failed',
      'recent.skipped': 'skipped',
      'kind.approval': 'Approval',
      'kind.review': 'Auto review',
      'kind.escalation': 'Escalation',
      'kind.question': 'Question',
      'kind.idle': 'Turn finished',
      'kind.error': 'Error',
      'kind.test': 'Test',
      'level.active': 'Normal',
      'level.timeSensitive': 'Time sensitive',
      'level.passive': 'Quiet',
      'level.critical': 'Critical',
      'invalid.server': 'The Bark server must be an http or https URL.',
      'invalid.icon': 'The icon must be an http or https URL.',
      'invalid.template': 'Templates are limited to 4000 characters.',
      'invalid.number': 'Check the numeric fields.',
    }

    /** Chinese page copy. */
    const zh = {
      nav: 'Bark 提醒',
      title: 'Bark 提醒',
      intro: '当 DSH 需要你处理时，会向 iPhone 推送一条通知。',
      'load.failed': '无法读取设置',
      'load.retry': '重试',
      'status.enabled': '提醒已启用',
      'status.disabled': '提醒已停用',
      'status.keyConfigured': '设备密钥已配置',
      'status.keyMissing': '尚未配置设备密钥',
      'basic.title': '基础',
      'basic.enabled': '启用 Bark 提醒',
      'basic.enabledDesc': '关闭后不会发送任何通知，设置页仍可正常使用。',
      'server.label': 'Bark 服务器',
      'server.desc': '默认使用官方服务器；自建 bark-server 可填写自己的地址。',
      'server.placeholder': 'https://api.day.app',
      'key.title': '设备密钥',
      'key.label': '推送密钥',
      'key.desc': '在 Bark App 首页复制推送 key 后粘贴至此。密钥保存在 DSH 凭据库中，不会写入配置文件。',
      'key.placeholder': '粘贴 Bark 推送 key',
      'key.placeholderConfigured': '已配置，输入新密钥可替换',
      'key.save': '保存密钥',
      'key.saving': '保存中…',
      'key.clear': '清除',
      'key.clearConfirm': '再次点击确认',
      'key.saved': '设备密钥已保存',
      'key.cleared': '设备密钥已清除',
      'key.savedFallback': '凭据库拒绝了写入，密钥已改存至插件配置。',
      'key.clearedFallback': '密钥已清除，但凭据库未能完成清理：',
      'key.sourceEnv': '来自环境变量',
      'key.sourceStored': '来自凭据库',
      'key.sourceConfig': '来自插件配置',
      'key.sourceNone': '未配置',
      'key.descConfig': '当前 profile 没有可用的凭据服务，密钥将保存在插件配置中，仅当前 profile 可读取。',
      'key.refHint': '凭据名',
      'key.envHint': '也可设置同名环境变量，然后重启 DSH。',
      'key.missing': '尚未配置设备密钥，通知不会发送。',
      'key.readonly': '密钥来自环境变量，无法在此修改。',
      'key.invalid': '密钥必须为连续字符，不能包含空格。',
      'key.looksLikePath': '该输入疑似为文件路径，而非 Bark 推送 key。请粘贴 Bark App 首页复制的推送 key。',
      'key.failed': '密钥保存失败',
      'test.title': '测试通知',
      'test.desc': '使用当前设置发送一条通知，确认手机可以接收。',
      'test.button': '发送测试',
      'test.sending': '发送中…',
      'test.success': '测试通知已发送，请查看 iPhone。',
      'test.failed': '发送失败',
      'test.noKey': '请先配置设备密钥。',
      'triggers.title': '提醒场景',
      'triggers.desc': '仅对勾选的场景发送通知。',
      'trigger.approval': '其他确认请求',
      'trigger.approvalDesc': '工具调用正在等待你的确认。',
      'trigger.review': '自动审查意见',
      'trigger.reviewDesc': '自动审查拒绝一次调用，需要你决定是否放行。',
      'trigger.escalation': '沙盒权限申请',
      'trigger.escalationDesc': '模型申请更宽的沙盒模式。',
      'trigger.question': '提问与计划确认',
      'trigger.questionDesc': 'agent 正在使用提问工具，等待你的回答。',
      'trigger.idle': '一轮结束',
      'trigger.idleDesc': '一轮工作结束，且不会自动继续。',
      'trigger.error': '运行出错',
      'trigger.errorDesc': '会话因错误停止。',
      'trigger.subagents': '包含子代理',
      'trigger.subagentsDesc': '子代理等待确认或结束时也提醒；通常较为频繁，默认关闭。',
      'idle.delay': '结束提醒延迟',
      'idle.delayDesc': '会话空闲达到该时长后发送提醒，避免在输入过程中被打断。',
      'idle.seconds': '秒',
      'content.title': '消息内容',
      'content.desc': '标题和正文支持以下变量；留空时使用默认文案。',
      'content.titleLabel': '标题',
      'content.bodyLabel': '正文',
      'content.vars': '插入变量',
      'content.varsTarget': '插入到',
      'content.targetTitle': '标题',
      'content.targetBody': '正文',
      'content.varsHint': '先点击标题或正文，再点变量；会插入到光标处，可用 ⌘Z 或 Ctrl+Z 撤销。悬停或聚焦变量可查看说明与示例。',
      'content.varsNote': '变量在不适用的场景中为空；未知变量会原样保留。',
      'content.example': '示例',
      'content.preview': '预览',
      'content.reset': '恢复默认',
      'content.locale': '消息语言',
      'content.localeDesc': '场景名称和自动生成的说明所用语言；已保存的模板不受影响。',
      'content.langZh': '中文',
      'content.langEn': 'English',
      'var.kindLabel': '场景名称',
      'var.kindLabelDesc': '本次提醒的场景名称，随消息语言变化。',
      'var.kindLabelExample': '自动审查拦下了一项操作',
      'var.detail': '自动说明',
      'var.detailDesc': '自动生成的完整说明，包含工具名、理由或问题；默认正文就是它。',
      'var.detailExample': '自动审查未放行 bash，需要你决定是否继续。\n删除生产库里的旧数据',
      'var.sessionTitle': '会话标题',
      'var.sessionTitleDesc': '会话标题；无法获取时回退为项目目录名。',
      'var.sessionTitleExample': '重构登录流程',
      'var.project': '项目名',
      'var.projectDesc': '会话所属项目目录的名称。',
      'var.projectExample': 'dsh-bark-reminder',
      'var.cwd': '工作目录',
      'var.cwdDesc': '会话的完整工作目录。',
      'var.cwdExample': '/Users/you/Code/dsh-bark-reminder',
      'var.tool': '工具名',
      'var.toolDesc': '触发提醒的工具名。',
      'var.toolExample': 'bash',
      'var.reason': '原因',
      'var.reasonDesc': '审批理由、自动审查意见或提权说明。',
      'var.reasonExample': '删除生产库里的旧数据',
      'var.question': '问题',
      'var.questionDesc': '第一个待回答的问题。',
      'var.questionExample': '迁移要使用哪个数据库？',
      'var.mode': '沙盒模式',
      'var.modeDesc': '模型申请的沙盒模式。',
      'var.modeExample': 'danger-full-access',
      'var.error': '错误',
      'var.errorDesc': '导致会话停止的错误信息。',
      'var.errorExample': '模型请求连续三次失败',
      'var.time': '时间',
      'var.timeDesc': '生成通知时的本地时间；默认模板不使用。',
      'var.timeExample': '2026-11-13 13:54',
      'var.host': '主机名',
      'var.hostDesc': '运行 DSH 的机器名。',
      'var.hostExample': 'MacBook-Pro',
      'var.turn': '轮次',
      'var.turnDesc': '当前轮次编号。',
      'var.turnExample': '4',
      'var.goal': '目标',
      'var.goalDesc': '关联目标的文本。',
      'var.goalExample': '完成提醒插件',
      'style.title': '通知样式',
      'style.level': '提醒级别',
      'style.levelDesc': '普通：正常提醒；时效性：可穿透专注模式；静默：仅加入通知中心；紧急：忽略静音与勿扰。',
      'style.sound': '铃声',
      'style.soundDesc': 'Bark 铃声名称（如 minuet）；留空则使用 App 默认铃声。',
      'style.group': '通知分组',
      'style.groupDesc': '同一分组的通知会在通知中心折叠显示。iOS 的分组标题固定显示 App 名称（Bark），无法修改；该设置仅决定哪些通知归为一组。',
      'style.icon': '图标',
      'style.iconDesc': 'PNG 或 JPEG 图片地址。默认使用项目图标替换 Bark 图标。需要 iOS 15 或更高版本。',
      'style.url': '点击打开',
      'style.urlDesc': '点击通知时打开的链接，支持变量；留空则仅打开 Bark。',
      'style.call': '持续响铃',
      'style.callDesc': '持续响铃 30 秒，适用于需要立即处理的事项。',
      'style.archive': '保存到历史',
      'style.archiveDesc': '在 Bark App 的历史记录中保留此通知。',
      'placeholder.optional': '可选',
      'limits.title': '频率与去重',
      'limits.dedupe': '去重窗口',
      'limits.dedupeDesc': '同一事件在该时间窗口内的重复提醒将被丢弃。',
      'limits.rate': '每分钟上限',
      'limits.rateDesc': '超出上限的通知将被丢弃，并在日志中记录一条警告。',
      'unit.seconds': '秒',
      'unit.perMinute': '条',
      'save.saving': '保存中…',
      'save.pending': '正在自动保存…',
      'save.failed': '保存失败',
      'save.invalid': '设置无效',
      'save.clean': '所有修改已保存',
      'recent.title': '最近推送',
      'recent.desc': '仅在本次 DSH 运行期间保留。',
      'recent.empty': '尚未发送过通知。',
      'recent.ok': '成功',
      'recent.fail': '失败',
      'recent.sent': '已发送',
      'recent.failed': '失败',
      'recent.skipped': '已跳过',
      'kind.approval': '确认',
      'kind.review': '自动审查',
      'kind.escalation': '权限申请',
      'kind.question': '提问',
      'kind.idle': '一轮结束',
      'kind.error': '出错',
      'kind.test': '测试',
      'level.active': '普通',
      'level.timeSensitive': '时效性',
      'level.passive': '静默',
      'level.critical': '紧急',
      'invalid.server': 'Bark 服务器必须是 http 或 https 地址。',
      'invalid.icon': '图标必须是 http 或 https 地址。',
      'invalid.template': '模板最多 4000 个字符。',
      'invalid.number': '请检查数字字段。',
    }

    /** Page styles; every color resolves through a theme token. */
    const CSS = `
.bark-page { display:flex; flex-direction:column; gap:14px; max-width:720px; padding:2px 0 0; color:var(--dsw-alias-label-primary); }
.bark-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
.bark-header-copy { display:flex; flex-direction:column; gap:4px; min-width:0; }
.bark-title { margin:0; font-size:16px; line-height:24px; font-weight:500; }
.bark-intro { margin:0; font-size:14px; line-height:22px; color:var(--dsw-alias-label-tertiary); }
.bark-pills { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
.bark-pill { display:inline-flex; align-items:center; gap:6px; padding:2px 10px; border-radius:999px; border:0.5px solid var(--dsw-alias-border-l2); font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.bark-pill::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; opacity:.8; }
.bark-pill.ok { color:var(--dsw-alias-state-success-primary); }
.bark-pill.warn { color:var(--dsw-alias-state-warn-primary); }
.bark-pill.muted { color:var(--dsw-alias-label-tertiary); }
.bark-card { border:0.5px solid var(--dsw-alias-settings-card-stroke); background:var(--dsw-alias-settings-card-fill); border-radius:var(--dsw-radius-xl); padding:0 16px; }
.bark-card-head { padding:14px 0 2px; }
.bark-card-title { margin:0; font-size:14px; line-height:20px; font-weight:500; }
.bark-card-desc { margin:2px 0 0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.bark-row { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:12px 0; border-bottom:0.5px solid var(--dsw-alias-border-l1); }
.bark-row:last-child { border-bottom:none; }
.bark-row-stack { flex-direction:column; align-items:stretch; gap:8px; }
.bark-row-copy { flex:1; min-width:0; }
.bark-row-label { font-size:14px; line-height:20px; }
.bark-row-desc { margin-top:2px; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.bark-row-control { flex:0 0 auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.bark-row-stack .bark-row-control { flex:1 1 auto; flex-direction:column; align-items:stretch; gap:8px; }
.bark-row-stack .bark-input, .bark-row-stack .bark-select { width:100%; }
.bark-input, .bark-select, .bark-textarea { box-sizing:border-box; border:0.5px solid var(--dsw-alias-border-l4); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font-family:inherit; font-size:13px; line-height:20px; padding:6px 10px; min-height:32px; }
.bark-input { width:280px; max-width:100%; }
.bark-input-small { width:92px; text-align:right; }
.bark-select { width:190px; max-width:100%; }
.bark-textarea { width:100%; resize:vertical; min-height:76px; }
.bark-input:focus-visible, .bark-select:focus-visible, .bark-textarea:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:0; border-color:transparent; }
.bark-input::placeholder, .bark-textarea::placeholder { color:var(--dsw-alias-label-dimmed); }
.bark-tiles { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; padding:12px 0; }
.bark-tile { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:10px 12px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); }
.bark-tile-copy { min-width:0; }
.bark-tile-label { font-size:13px; line-height:19px; }
.bark-tile-desc { margin-top:2px; font-size:12px; line-height:17px; color:var(--dsw-alias-label-secondary); }
.bark-vars { padding:12px 0; border-bottom:0.5px solid var(--dsw-alias-border-l1); }
.bark-vars-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.bark-vars-title { font-size:13px; line-height:19px; }
.bark-vars-target { font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.bark-vars-target strong { font-weight:500; color:var(--dsw-alias-label-secondary); }
.bark-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.bark-chip { border:0.5px solid var(--dsw-alias-border-l2); border-radius:999px; background:transparent; color:var(--dsw-alias-label-secondary); font-family:inherit; font-size:12px; line-height:18px; padding:2px 9px; cursor:pointer; }
.bark-chip:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.bark-chip[data-active='true'] { border-color:var(--dsw-alias-state-business-primary); color:var(--dsw-alias-label-primary); }
.bark-chip:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:1px; }
.bark-var { display:inline-flex; }
.bark-var-card { position:fixed; z-index:80; box-sizing:border-box; width:280px; max-width:calc(100vw - 16px); display:flex; flex-direction:column; gap:6px; padding:10px 12px; border:0.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-lg); background:var(--dsw-alias-settings-card-fill); box-shadow:var(--dsw-shadow-lv2); pointer-events:none; }
.bark-var-card-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; }
.bark-var-card-name { font-size:13px; line-height:19px; font-weight:500; color:var(--dsw-alias-label-primary); }
.bark-var-card-desc { margin:0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); }
.bark-var-example { display:flex; flex-direction:column; gap:2px; padding:6px 8px; border:0.5px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
.bark-var-example-label { font-size:11px; line-height:16px; color:var(--dsw-alias-label-tertiary); }
.bark-var-example-value { font-size:12px; line-height:18px; white-space:pre-wrap; word-break:break-word; color:var(--dsw-alias-label-primary); }
.bark-visually-hidden { position:absolute; width:1px; height:1px; margin:-1px; padding:0; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
.bark-vars-note { margin-top:6px; }
.bark-content-tail { padding:12px 0; }
.bark-content-actions { display:flex; justify-content:flex-end; margin-top:8px; }
.bark-preview { padding:10px 12px; border:0.5px dashed var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
.bark-preview-label { font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); margin-bottom:6px; }
.bark-preview-title { font-size:14px; line-height:20px; font-weight:500; }
.bark-preview-body { margin:6px 0 0; font-family:inherit; font-size:13px; line-height:20px; white-space:pre-wrap; word-break:break-word; color:var(--dsw-alias-label-secondary); }
.bark-switch { position:relative; flex:0 0 auto; width:36px; height:20px; padding:2px; border:0; border-radius:999px; background:var(--dsw-alias-border-l3); cursor:pointer; }
.bark-switch[aria-checked='true'] { background:var(--dsw-alias-brand-primary); }
.bark-switch:disabled { opacity:.5; cursor:default; }
.bark-switch:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:2px; }
.bark-switch-thumb { display:block; width:16px; height:16px; border-radius:50%; background:var(--dsw-alias-label-primary-foreground); transition:transform 120ms ease; }
.bark-switch[aria-checked='true'] .bark-switch-thumb { transform:translateX(16px); }
.bark-btn { height:32px; padding:0 12px; border:none; border-radius:var(--dsw-radius-md); background:transparent; color:var(--dsw-alias-label-primary); font-family:inherit; font-size:13px; line-height:20px; cursor:pointer; }
.bark-btn:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.bark-btn:disabled { opacity:.4; cursor:not-allowed; }
.bark-btn.danger { color:var(--dsw-alias-state-error-primary); }
.bark-btn.small { height:28px; padding:0 10px; font-size:12px; }
.bark-notice { font-size:12px; line-height:18px; white-space:pre-wrap; }
.bark-notice.success { color:var(--dsw-alias-state-success-primary); }
.bark-notice.warn { color:var(--dsw-alias-state-warn-primary); }
.bark-notice.error { color:var(--dsw-alias-state-error-primary); }
.bark-hint { font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.bark-warn { color:var(--dsw-alias-state-warn-primary); }
.bark-code { font-family:var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, monospace); font-size:12px; }
.bark-footer { display:flex; align-items:center; gap:12px; padding-top:12px; border-top:0.5px solid var(--dsw-alias-border-l1); }
.bark-recent { list-style:none; margin:0; padding:0; }
.bark-recent-item { display:flex; align-items:baseline; gap:10px; padding:6px 0; border-bottom:0.5px solid var(--dsw-alias-border-l1); font-size:12px; line-height:18px; }
.bark-recent-item:last-child { border-bottom:none; }
.bark-recent-time { color:var(--dsw-alias-label-tertiary); font-variant-numeric:tabular-nums; }
.bark-recent-kind { color:var(--dsw-alias-label-primary); }
.bark-recent-ok { color:var(--dsw-alias-state-success-primary); }
.bark-recent-fail { color:var(--dsw-alias-state-error-primary); }
.bark-recent-error { color:var(--dsw-alias-label-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bark-recent-counts { display:flex; flex-wrap:wrap; gap:12px; margin:8px 0 0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.bark-loading { padding:12px 0; font-size:14px; line-height:22px; color:var(--dsw-alias-label-secondary); }
.bark-error-box { border:0.5px solid var(--dsw-alias-state-error-primary); border-radius:var(--dsw-radius-md); padding:12px; font-size:13px; line-height:20px; white-space:pre-wrap; }
.bark-error-box .bark-btn { margin-top:8px; }
@media (max-width: 620px) {
  .bark-tiles { grid-template-columns:1fr; }
  .bark-row { align-items:flex-start; flex-direction:column; gap:8px; }
  .bark-row-control { width:100%; }
  .bark-input, .bark-select { width:100%; }
  .bark-footer { align-items:flex-start; flex-direction:column; }
}
`

    /**
     * Call one Host route.
     * @param {string} path - route suffix.
     * @param {{ method?: string, body?: unknown, timeout?: number }} [options] - request options.
     * @returns {Promise<any>} decoded response.
     */
    async function api(path, { method = 'GET', body, timeout = 15_000 } = {}) {
      const response = await fetch(`${API}/${path}`, {
        method,
        headers: body === undefined
          ? { accept: 'application/json' }
          : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeout),
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      if (!response.ok) {
        const error = new Error(payload?.message ?? `HTTP ${response.status}`)
        error.code = payload?.code
        error.status = response.status
        error.payload = payload
        throw error
      }
      return payload
    }

    /** Wait between save retries while the Host entry restarts. */
    function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    /** Convert a stored configuration into editable form state. */
    function toForm(config) {
      return {
        enabled: config.enabled === true,
        server: typeof config.server === 'string' ? config.server : '',
        messageLocale: config.messageLocale === 'en' ? 'en' : 'zh',
        triggers: {
          approval: config.triggers?.approval !== false,
          review: config.triggers?.review !== false,
          escalation: config.triggers?.escalation !== false,
          question: config.triggers?.question !== false,
          idle: config.triggers?.idle !== false,
          error: config.triggers?.error !== false,
        },
        notifySubagents: config.notifySubagents === true,
        idleDelaySeconds: String(Math.round((Number(config.idleDelayMs) || 0) / 1000)),
        titleTemplate: typeof config.titleTemplate === 'string' ? config.titleTemplate : '',
        bodyTemplate: typeof config.bodyTemplate === 'string' ? config.bodyTemplate : '',
        level: typeof config.level === 'string' ? config.level : 'active',
        sound: typeof config.sound === 'string' ? config.sound : '',
        group: typeof config.group === 'string' ? config.group : '',
        icon: typeof config.icon === 'string' ? config.icon : '',
        urlTemplate: typeof config.urlTemplate === 'string' ? config.urlTemplate : '',
        call: config.call === true,
        isArchive: config.isArchive !== false,
        dedupeSeconds: String(Math.round((Number(config.dedupeWindowMs) || 0) / 1000)),
        maxPerMinute: String(Number(config.maxPerMinute) || 12),
      }
    }

    /** Clamp one numeric form field. */
    function numberInRange(value, fallback, min, max) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return fallback
      return Math.min(max, Math.max(min, parsed))
    }

    /** Convert editable form state into the Host configuration shape. */
    function toConfig(form) {
      return {
        enabled: form.enabled,
        server: form.server.trim(),
        messageLocale: form.messageLocale,
        triggers: { ...form.triggers },
        notifySubagents: form.notifySubagents,
        idleDelayMs: Math.round(numberInRange(form.idleDelaySeconds, 60, 0, 600) * 1000),
        titleTemplate: form.titleTemplate,
        bodyTemplate: form.bodyTemplate,
        level: form.level,
        sound: form.sound.trim(),
        group: form.group.trim(),
        icon: form.icon.trim(),
        urlTemplate: form.urlTemplate,
        call: form.call,
        isArchive: form.isArchive,
        dedupeWindowMs: Math.round(numberInRange(form.dedupeSeconds, 3, 0, 600) * 1000),
        maxPerMinute: Math.round(numberInRange(form.maxPerMinute, 12, 1, 120)),
      }
    }

    /** Compare two form states by value. */
    function sameForm(left, right) {
      return JSON.stringify(left) === JSON.stringify(right)
    }

    /** Compare two form states by the configuration they would store. */
    function sameConfig(left, right) {
      return JSON.stringify(toConfig(left)) === JSON.stringify(toConfig(right))
    }

    /**
     * Write one configuration, retrying while the restart it triggers is in
     * flight: the Host answers before persisting, then re-registers its routes.
     * A rejected setting is final and is not retried.
     * @param {object} config - validated configuration.
     * @returns {Promise<any>} the Host response.
     */
    async function submitConfig(config) {
      let lastError
      for (let attempt = 0; attempt <= SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          return await api('config', { method: 'POST', body: { config } })
        } catch (error) {
          lastError = error
          const status = error?.status
          const transient = status === undefined || status === 404 || status >= 500
          if (!transient || attempt === SAVE_RETRY_DELAYS_MS.length) throw error
          await delay(SAVE_RETRY_DELAYS_MS[attempt])
        }
      }
      throw lastError
    }

    /** Localize the clock of one recent delivery. */
    function formatClock(epoch) {
      if (!Number.isFinite(epoch)) return ''
      const date = new Date(epoch)
      const pad = value => String(value).padStart(2, '0')
      return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    /** Validate the editable form before it reaches the Host. */
    function validateForm(form, t) {
      const server = form.server.trim()
      try {
        const parsed = new URL(server)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return t('invalid.server')
      } catch {
        return t('invalid.server')
      }
      const icon = form.icon.trim()
      if (icon !== '') {
        try {
          const parsed = new URL(icon)
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return t('invalid.icon')
        } catch {
          return t('invalid.icon')
        }
      }
      if (form.titleTemplate.length > 4000 || form.bodyTemplate.length > 4000) return t('invalid.template')
      return undefined
    }

    /** One labelled settings row. */
    function Row({ label, description, children, stack = false }) {
      return h('div', { className: stack ? 'bark-row bark-row-stack' : 'bark-row' },
        h('div', { className: 'bark-row-copy' },
          h('div', { className: 'bark-row-label' }, label),
          description !== undefined ? h('div', { className: 'bark-row-desc' }, description) : null),
        h('div', { className: 'bark-row-control' }, children))
    }

    /** One card section with a heading. */
    function Card({ title, description, children }) {
      return h('section', { className: 'bark-card' },
        h('div', { className: 'bark-card-head' },
          h('h3', { className: 'bark-card-title' }, title),
          description !== undefined ? h('p', { className: 'bark-card-desc' }, description) : null),
        children)
    }

    /** Accessible on/off switch. */
    function Switch({ checked, label, disabled = false, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        'aria-label': label,
        className: 'bark-switch',
        disabled,
        onClick: () => { onChange(!checked) },
      }, h('span', { className: 'bark-switch-thumb' }))
    }

    /** One trigger toggle tile. */
    function TriggerTile({ label, description, checked, onChange }) {
      return h('div', { className: 'bark-tile' },
        h('div', { className: 'bark-tile-copy' },
          h('div', { className: 'bark-tile-label' }, label),
          h('div', { className: 'bark-tile-desc' }, description)),
        h(Switch, { checked, label, onChange }))
    }

    /** One template variable chip; clicking it inserts, hovering opens a sample. */
    function VariableChip({ name, label, description, example, exampleLabel, active, onOpen, onClose, onInsert }) {
      const buttonRef = useRef(null)
      const token = `{${name}}`
      const descriptionId = `bark-var-desc-${name}`
      const open = useCallback(() => {
        if (buttonRef.current !== null) onOpen(name, buttonRef.current)
      }, [name, onOpen])

      return h('div', {
        className: 'bark-var',
        onMouseEnter: open,
        onMouseLeave: () => onClose(name),
      },
      h('button', {
        ref: buttonRef,
        type: 'button',
        className: 'bark-chip',
        'data-active': active ? 'true' : undefined,
        'aria-describedby': descriptionId,
        onMouseDown: event => event.preventDefault(),
        onFocus: open,
        onBlur: () => onClose(name),
        onClick: () => {
          onInsert(name)
          onClose(name)
        },
      }, label),
      h('span', {
        id: descriptionId,
        className: 'bark-visually-hidden',
      }, `${label} (${token}). ${description} ${exampleLabel}: ${example}`))
    }

    /** One inline notice line. */
    function Notice({ kind = 'success', children }) {
      return h('div', { className: `bark-notice ${kind}`, role: 'status' }, children)
    }

    /** The settings page. */
    function BarkPage(props) {
      const t = props.t
      const [phase, setPhase] = useState('loading')
      const [loadError, setLoadError] = useState(undefined)
      const [data, setData] = useState(undefined)
      const [form, setForm] = useState(undefined)
      const [savedForm, setSavedForm] = useState(undefined)
      const [keyDraft, setKeyDraft] = useState('')
      const [keyBusy, setKeyBusy] = useState(false)
      const [keyNotice, setKeyNotice] = useState(undefined)
      const [clearArmed, setClearArmed] = useState(false)
      const [saving, setSaving] = useState(false)
      const [notice, setNotice] = useState(undefined)
      const [testing, setTesting] = useState(false)
      const [testResult, setTestResult] = useState(undefined)
      const [preview, setPreview] = useState(undefined)
      const [insertTarget, setInsertTarget] = useState('body')
      const [variableHint, setVariableHint] = useState(undefined)
      const titleRef = useRef(null)
      const bodyRef = useRef(null)
      const variableCardRef = useRef(null)
      // The last title/body field to hold a caret, used when the click happens
      // while focus sits somewhere else in the page.
      const lastFieldRef = useRef(null)
      const selectionRef = useRef({ title: null, body: null })
      const insertTargetRef = useRef(insertTarget)
      // Mirrors of the editable state for the debounced writer and for the
      // write still owed when the section unmounts.
      const formRef = useRef(form)
      const savedFormRef = useRef(savedForm)
      const savingRef = useRef(false)
      const failedFormRef = useRef(undefined)
      const mountedRef = useRef(true)
      formRef.current = form
      savedFormRef.current = savedForm
      insertTargetRef.current = insertTarget

      const load = useCallback(async (options) => {
        const keepForm = options === true
        setPhase(current => current === 'ready' ? current : 'loading')
        try {
          const next = await api('config')
          setData(next)
          if (!keepForm) {
            const nextForm = toForm(next.config)
            setForm(nextForm)
            setSavedForm(nextForm)
          }
          setLoadError(undefined)
          setPhase('ready')
        } catch (error) {
          setLoadError(error)
          setPhase('error')
        }
      }, [])

      useEffect(() => { void load() }, [load])

      // The preview follows the templates and the push language, not the rest
      // of the form, so typing in an unrelated field costs no request.
      const previewTitle = form === undefined ? '' : form.titleTemplate
      const previewBody = form === undefined ? '' : form.bodyTemplate
      const previewLocale = form === undefined ? 'zh' : form.messageLocale
      useEffect(() => {
        if (form === undefined) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
          api('preview', {
            method: 'POST',
            body: { titleTemplate: previewTitle, bodyTemplate: previewBody, messageLocale: previewLocale },
          }).then((result) => {
            if (!cancelled) setPreview(result)
          }).catch(() => {})
        }, 260)
        return () => {
          cancelled = true
          clearTimeout(timer)
        }
      }, [previewTitle, previewBody, previewLocale, form === undefined])

      // A two-step clear keeps a stray click from deleting the credential.
      useEffect(() => {
        if (!clearArmed) return undefined
        const timer = setTimeout(() => setClearArmed(false), 4000)
        return () => clearTimeout(timer)
      }, [clearArmed])

      const update = useCallback((patch) => {
        setForm(current => (current === undefined ? current : { ...current, ...patch }))
        setNotice(undefined)
      }, [])

      const updateTrigger = useCallback((kind, value) => {
        setForm(current => (current === undefined ? current : { ...current, triggers: { ...current.triggers, [kind]: value } }))
        setNotice(undefined)
      }, [])

      const rememberSelection = useCallback((field) => {
        const element = field === 'title' ? titleRef.current : bodyRef.current
        if (element === null || typeof element.selectionStart !== 'number') return
        selectionRef.current[field] = {
          start: element.selectionStart,
          end: typeof element.selectionEnd === 'number' ? element.selectionEnd : element.selectionStart,
        }
      }, [])

      const focusVariableTarget = useCallback((field) => {
        lastFieldRef.current = field
        setInsertTarget(field)
        rememberSelection(field)
      }, [rememberSelection])

      // Insert at the caret through the browser's own editing command so the
      // change lands on the native undo stack; React then adopts the DOM value.
      const insertVariable = useCallback((name) => {
        const current = formRef.current
        if (current === undefined) return
        const active = document.activeElement
        const field = active === titleRef.current
          ? 'title'
          : active === bodyRef.current
            ? 'body'
            : insertTargetRef.current
        const element = field === 'title' ? titleRef.current : bodyRef.current
        if (element === null) return
        const previous = field === 'title' ? current.titleTemplate : current.bodyTemplate
        const lastField = lastFieldRef.current
        if (active !== element) {
          const remembered = lastField === field ? selectionRef.current[field] : null
          const start = Math.min(remembered === null ? previous.length : remembered.start, previous.length)
          const end = Math.min(Math.max(remembered === null ? start : remembered.end, start), previous.length)
          element.focus()
          try {
            // Restore the caret the field last held; a field that never held
            // focus gets the token appended instead of landing at offset zero.
            element.setSelectionRange(start, end)
          } catch {
            // Not a text control; nothing to place.
          }
        }
        const token = `{${name}}`
        let inserted = false
        try {
          inserted = document.execCommand('insertText', false, token) === true
        } catch {
          inserted = false
        }
        let next = element.value
        // A successful replacement can leave the value unchanged when the
        // selected text already equals the token; branch on the command result,
        // not on the value, or that click would insert a second copy.
        if (inserted !== true && next === previous) {
          // The editing command is unavailable or refused; insert directly.
          // Only this fallback loses the native undo entry.
          const start = typeof element.selectionStart === 'number' ? element.selectionStart : previous.length
          const end = typeof element.selectionEnd === 'number' ? element.selectionEnd : start
          element.setRangeText(token, start, end, 'end')
          next = element.value
        }
        if (next !== previous) {
          update(field === 'title' ? { titleTemplate: next } : { bodyTemplate: next })
        }
        rememberSelection(field)
      }, [update, rememberSelection])

      const openVariableHint = useCallback((name, element) => {
        const rect = element.getBoundingClientRect()
        const viewportWidth = document.documentElement.clientWidth
        const width = Math.min(280, viewportWidth - 16)
        const left = Math.min(
          Math.max(8, rect.left + rect.width / 2 - width / 2),
          Math.max(8, viewportWidth - width - 8),
        )
        setVariableHint({
          name,
          width,
          left,
          top: 0,
          measured: false,
          anchorTop: rect.top,
          anchorBottom: rect.bottom,
        })
      }, [])

      const closeVariableHint = useCallback((name) => {
        setVariableHint((current) => {
          if (current === undefined) return current
          if (name !== undefined && current.name !== name) return current
          return undefined
        })
      }, [])

      // The card is measured before paint so a tall card flips below its chip
      // instead of running off the top of the viewport.
      useLayoutEffect(() => {
        const card = variableCardRef.current
        if (variableHint === undefined || variableHint.measured || card === null) return
        const height = card.offsetHeight
        const viewportHeight = document.documentElement.clientHeight
        const aboveSpace = variableHint.anchorTop - 8
        const belowSpace = viewportHeight - variableHint.anchorBottom - 8
        const below = aboveSpace < height && belowSpace >= aboveSpace
        const top = below
          ? Math.min(variableHint.anchorBottom + 8, Math.max(8, viewportHeight - height - 8))
          : Math.max(8, variableHint.anchorTop - height - 8)
        setVariableHint((current) => (current === undefined || current.measured
          ? current
          : { ...current, top, measured: true }))
      }, [variableHint])

      const variableHintOpen = variableHint !== undefined
      useEffect(() => {
        if (!variableHintOpen) return undefined
        const dismiss = () => setVariableHint(undefined)
        const onKeyDown = (event) => {
          if (event.key === 'Escape') dismiss()
        }
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        window.addEventListener('keydown', onKeyDown)
        return () => {
          window.removeEventListener('scroll', dismiss, true)
          window.removeEventListener('resize', dismiss)
          window.removeEventListener('keydown', onKeyDown)
        }
      }, [variableHintOpen])

      const saveKey = useCallback(async (clear) => {
        const candidate = keyDraft.trim()
        // The credential store keeps the submitted string verbatim; a path
        // here is a pasted value, not a reference, and can never authenticate.
        if (clear !== true && (/[\\/]/.test(candidate) || candidate.startsWith('~') || candidate.startsWith('.'))) {
          setKeyNotice({ kind: 'error', text: t('key.looksLikePath') })
          return
        }
        setKeyBusy(true)
        setKeyNotice(undefined)
        try {
          const result = clear === true
            ? await api('key', { method: 'POST', body: { clear: true } })
            : await api('key', { method: 'POST', body: { key: keyDraft.trim() } })
          setData(current => (current === undefined ? current : { ...current, key: result.key }))
          setKeyDraft('')
          setClearArmed(false)
          const fallbackReason = result.fallbackReason
          const fallback = fallbackReason === undefined
            ? ''
            : `\n${clear === true ? t('key.clearedFallback') : t('key.savedFallback')}\n${fallbackReason}`
          setKeyNotice({ kind: fallbackReason === undefined ? 'success' : 'warn', text: `${clear === true ? t('key.cleared') : t('key.saved')}${fallback}` })
        } catch (error) {
          const text = error.code === 'invalid-key'
            ? t('key.invalid')
            : `${t('key.failed')}\n${error.message}`
          setKeyNotice({ kind: 'error', text })
        } finally {
          setKeyBusy(false)
        }
      }, [keyDraft, t])

      const runTest = useCallback(async () => {
        setTesting(true)
        setTestResult(undefined)
        try {
          await api('test', { method: 'POST', body: {}, timeout: 20_000 })
          setTestResult({ ok: true })
          setNotice(undefined)
        } catch (error) {
          setTestResult({
            ok: false,
            error: error.code === 'no-device-key' ? t('test.noKey') : `${t('test.failed')}\n${error.message}`,
          })
        } finally {
          setTesting(false)
          try {
            const next = await api('config')
            setData(next)
          } catch {
            // The status refresh is cosmetic; the test result already stands.
          }
        }
      }, [t])

      const save = useCallback(async () => {
        if (savingRef.current) return
        const submitted = formRef.current
        const saved = savedFormRef.current
        if (submitted === undefined || saved === undefined) return
        if (sameForm(submitted, saved)) return
        if (failedFormRef.current !== undefined && sameForm(submitted, failedFormRef.current)) return
        // Whitespace or numeric formatting that normalizes to the stored
        // configuration needs no write and no restart.
        if (sameConfig(submitted, saved)) {
          savedFormRef.current = submitted
          setSavedForm(submitted)
          return
        }
        const invalid = validateForm(submitted, t)
        if (invalid !== undefined) {
          failedFormRef.current = submitted
          setNotice({ kind: 'error', text: invalid })
          return
        }
        savingRef.current = true
        setSaving(true)
        setNotice(undefined)
        try {
          const result = await submitConfig(toConfig(submitted))
          savedFormRef.current = submitted
          setSavedForm(submitted)
          failedFormRef.current = undefined
          if (result?.config !== undefined) {
            setData(current => (current === undefined ? current : { ...current, config: result.config }))
          }
        } catch (error) {
          // Keep the failed draft from retrying on every render; the next edit
          // clears the guard and tries again.
          failedFormRef.current = submitted
          const details = error.payload?.errors
          const detail = Array.isArray(details) && details.length > 0
            ? `${t('save.invalid')}\n${details[0].field} ${details[0].message}`
            : `${t('save.failed')}\n${error.message}`
          setNotice({ kind: 'error', text: detail })
        } finally {
          savingRef.current = false
          setSaving(false)
          // A section that unmounted while this write was in flight still owes
          // the edit that arrived after the submitted one.
          if (!mountedRef.current) void saveRef.current()
        }
      }, [t])

      // Every edit writes itself after a short quiet period, matching the
      // instant-save convention of the other settings sections.
      useEffect(() => {
        if (form === undefined || savedForm === undefined) return undefined
        if (saving || sameConfig(form, savedForm)) return undefined
        if (failedFormRef.current !== undefined && sameForm(form, failedFormRef.current)) return undefined
        const timer = setTimeout(() => { void save() }, AUTO_SAVE_DELAY_MS)
        return () => clearTimeout(timer)
      }, [form, savedForm, saving, save])

      // Leaving the section still writes the last edit; a write already in
      // flight covers the change it was given.
      const saveRef = useRef(save)
      saveRef.current = save
      useEffect(() => {
        mountedRef.current = true
        return () => {
          mountedRef.current = false
          if (savingRef.current) return
          const submitted = formRef.current
          const saved = savedFormRef.current
          if (submitted === undefined || saved === undefined) return
          if (sameConfig(submitted, saved)) return
          if (failedFormRef.current !== undefined && sameForm(submitted, failedFormRef.current)) return
          void saveRef.current()
        }
      }, [])

      if (phase === 'loading') {
        return h('div', { className: 'bark-page' },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          h('div', { className: 'bark-loading' }, t('title'), '…'))
      }

      if (phase === 'error' || form === undefined || data === undefined) {
        return h('div', { className: 'bark-page' },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          h('div', { className: 'bark-error-box' },
            h('div', null, `${t('load.failed')}${loadError === undefined ? '' : `\n${loadError.message}`}`),
            h('button', { type: 'button', className: 'bark-btn small', onClick: () => { void load() } }, t('load.retry'))))
      }

      const dirty = savedForm !== undefined && !sameConfig(form, savedForm)
      const key = data.key ?? { configured: false, source: null, writable: true }
      const recent = Array.isArray(data.status?.recent) ? data.status.recent : []
      const counters = data.status?.counters ?? { sent: 0, failed: 0, skipped: 0 }
      const keySource = key.source === 'env'
        ? t('key.sourceEnv')
        : key.source === 'config' ? t('key.sourceConfig') : key.configured ? t('key.sourceStored') : t('key.sourceNone')
      const keyReadonly = key.configured && key.writable === false
      const keyDescription = key.store === 'config' ? t('key.descConfig') : t('key.desc')

      return h('div', { className: 'bark-page' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),

        h('header', { className: 'bark-header' },
          h('div', { className: 'bark-header-copy' },
            h('h2', { className: 'bark-title' }, t('title')),
            h('p', { className: 'bark-intro' }, t('intro')),
            h('div', { className: 'bark-pills' },
              h('span', { className: `bark-pill ${data.config.enabled ? 'ok' : 'muted'}` },
                data.config.enabled ? t('status.enabled') : t('status.disabled')),
              h('span', { className: `bark-pill ${key.configured ? 'ok' : 'warn'}` },
                key.configured ? t('status.keyConfigured') : t('status.keyMissing'))))),

        notice === undefined ? null : h(Notice, { kind: notice.kind }, notice.text),

        h(Card, { title: t('basic.title') },
          h(Row, { label: t('basic.enabled'), description: t('basic.enabledDesc') },
            h(Switch, {
              checked: form.enabled,
              label: t('basic.enabled'),
              onChange: value => update({ enabled: value }),
            })),
          h(Row, { label: t('server.label'), description: t('server.desc') },
            h('input', {
              className: 'bark-input',
              type: 'url',
              inputMode: 'url',
              spellCheck: false,
              value: form.server,
              placeholder: t('server.placeholder'),
              'aria-label': t('server.label'),
              onChange: event => update({ server: event.target.value }),
            }))),

        h(Card, { title: t('key.title'), description: keyDescription },
          h('div', { className: 'bark-row' },
            h('div', { className: 'bark-row-copy' },
              h('div', { className: key.configured ? 'bark-row-label' : 'bark-row-label bark-warn' },
                key.configured ? t('status.keyConfigured') : t('key.missing')),
              h('div', { className: 'bark-row-desc' },
                h('div', null, key.configured ? keySource : `${t('key.refHint')} ${data.deviceKeyRef ?? 'BARK_DEVICE_KEY'}`),
                key.configured && key.source !== 'config' && key.source !== 'env'
                  ? h('div', null, `${t('key.refHint')} ${data.deviceKeyRef ?? 'BARK_DEVICE_KEY'}`)
                  : null,
                key.configured ? null : h('div', null, t('key.envHint'))),
              keyReadonly ? h('div', { className: 'bark-hint' }, t('key.readonly')) : null)),
          h(Row, { label: t('key.label'), stack: true },
            h('input', {
              className: 'bark-input',
              type: 'password',
              autoComplete: 'off',
              spellCheck: false,
              value: keyDraft,
              disabled: keyReadonly || keyBusy,
              placeholder: key.configured ? t('key.placeholderConfigured') : t('key.placeholder'),
              'aria-label': t('key.label'),
              onChange: event => setKeyDraft(event.target.value),
            }),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px' } },
              keyNotice === undefined ? null : h(Notice, { kind: keyNotice.kind }, keyNotice.text),
              h('button', {
                type: 'button',
                className: 'bark-btn small',
                disabled: keyReadonly || keyBusy || keyDraft.trim() === '',
                onClick: () => { void saveKey(false) },
              }, keyBusy ? t('key.saving') : t('key.save')),
              key.configured && !keyReadonly
                ? h('button', {
                  type: 'button',
                  className: 'bark-btn small danger',
                  disabled: keyBusy,
                  onClick: () => {
                    if (clearArmed) void saveKey(true)
                    else setClearArmed(true)
                  },
                }, clearArmed ? t('key.clearConfirm') : t('key.clear'))
                : null)),
          h(Row, { label: t('test.title'), description: t('test.desc') },
            h('button', {
              type: 'button',
              className: 'bark-btn small',
              disabled: testing || !key.configured,
              onClick: () => { void runTest() },
            }, testing ? t('test.sending') : t('test.button')),
            testResult === undefined
              ? null
              : testResult.ok
                ? h(Notice, { kind: 'success' }, t('test.success'))
                : h(Notice, { kind: 'error' }, testResult.error))),

        h(Card, { title: t('triggers.title'), description: t('triggers.desc') },
          h('div', { className: 'bark-tiles' },
            ...[
              ['approval', t('trigger.approval'), t('trigger.approvalDesc')],
              ['review', t('trigger.review'), t('trigger.reviewDesc')],
              ['escalation', t('trigger.escalation'), t('trigger.escalationDesc')],
              ['question', t('trigger.question'), t('trigger.questionDesc')],
              ['idle', t('trigger.idle'), t('trigger.idleDesc')],
              ['error', t('trigger.error'), t('trigger.errorDesc')],
            ].map(([kind, label, description]) => h(TriggerTile, {
              key: kind,
              label,
              description,
              checked: form.triggers[kind],
              onChange: value => updateTrigger(kind, value),
            }))),
          h(Row, { label: t('trigger.subagents'), description: t('trigger.subagentsDesc') },
            h(Switch, {
              checked: form.notifySubagents,
              label: t('trigger.subagents'),
              onChange: value => update({ notifySubagents: value }),
            })),
          h(Row, { label: t('idle.delay'), description: t('idle.delayDesc') },
            h('input', {
              className: 'bark-input bark-input-small',
              type: 'number',
              min: 0,
              max: 600,
              step: 1,
              value: form.idleDelaySeconds,
              'aria-label': t('idle.delay'),
              onChange: event => update({ idleDelaySeconds: event.target.value }),
            }),
            h('span', { className: 'bark-hint' }, t('idle.seconds')))),

        h(Card, { title: t('content.title'), description: t('content.desc') },
          h(Row, { label: t('content.locale'), description: t('content.localeDesc') },
            h('select', {
              className: 'bark-select',
              value: form.messageLocale,
              'aria-label': t('content.locale'),
              onChange: event => update({ messageLocale: event.target.value }),
            },
            h('option', { value: 'zh' }, t('content.langZh')),
            h('option', { value: 'en' }, t('content.langEn')))),
          h(Row, { label: t('content.titleLabel'), stack: true },
            h('input', {
              className: 'bark-input',
              type: 'text',
              value: form.titleTemplate,
              ref: titleRef,
              'aria-label': t('content.titleLabel'),
              onFocus: () => focusVariableTarget('title'),
              onSelect: () => rememberSelection('title'),
              onChange: event => update({ titleTemplate: event.target.value }),
            })),
          h(Row, { label: t('content.bodyLabel'), stack: true },
            h('textarea', {
              className: 'bark-textarea',
              rows: 3,
              value: form.bodyTemplate,
              ref: bodyRef,
              'aria-label': t('content.bodyLabel'),
              onFocus: () => focusVariableTarget('body'),
              onSelect: () => rememberSelection('body'),
              onChange: event => update({ bodyTemplate: event.target.value }),
            })),
          h('div', { className: 'bark-vars' },
            h('div', { className: 'bark-vars-head' },
              h('span', { className: 'bark-vars-title' }, t('content.vars')),
              h('span', { className: 'bark-vars-target', role: 'status', 'aria-live': 'polite' },
                `${t('content.varsTarget')} `,
                h('strong', null, insertTarget === 'title' ? t('content.targetTitle') : t('content.targetBody')))),
            h('div', { className: 'bark-hint bark-vars-note' }, t('content.varsHint')),
            h('div', { className: 'bark-chips' },
              ...VARIABLES.map(name => h(VariableChip, {
                key: name,
                name,
                label: t(`var.${name}`),
                description: t(`var.${name}Desc`),
                example: t(`var.${name}Example`),
                exampleLabel: t('content.example'),
                active: variableHint?.name === name,
                onOpen: openVariableHint,
                onClose: closeVariableHint,
                onInsert: insertVariable,
              }))),
            h('div', { className: 'bark-hint bark-vars-note' }, t('content.varsNote'))),
          h('div', { className: 'bark-content-tail' },
            h('div', { className: 'bark-preview' },
              h('div', { className: 'bark-preview-label' }, t('content.preview')),
              h('div', { className: 'bark-preview-title' }, preview?.title ?? ''),
              h('pre', { className: 'bark-preview-body' }, preview?.body ?? '')),
            h('div', { className: 'bark-content-actions' },
              h('button', {
                type: 'button',
                className: 'bark-btn small',
                onClick: () => update({
                  titleTemplate: data.defaults.titleTemplate,
                  bodyTemplate: data.defaults.bodyTemplate,
                }),
              }, t('content.reset'))))),

        h(Card, { title: t('style.title') },
          h(Row, { label: t('style.level'), description: t('style.levelDesc') },
            h('select', {
              className: 'bark-select',
              value: form.level,
              'aria-label': t('style.level'),
              onChange: event => update({ level: event.target.value }),
            },
            h('option', { value: 'active' }, t('level.active')),
            h('option', { value: 'timeSensitive' }, t('level.timeSensitive')),
            h('option', { value: 'passive' }, t('level.passive')),
            h('option', { value: 'critical' }, t('level.critical')))),
          h(Row, { label: t('style.sound'), description: t('style.soundDesc') },
            h('input', {
              className: 'bark-input',
              type: 'text',
              value: form.sound,
              placeholder: 'minuet',
              'aria-label': t('style.sound'),
              onChange: event => update({ sound: event.target.value }),
            })),
          h(Row, { label: t('style.group'), description: t('style.groupDesc') },
            h('input', {
              className: 'bark-input',
              type: 'text',
              value: form.group,
              placeholder: 'DSH',
              'aria-label': t('style.group'),
              onChange: event => update({ group: event.target.value }),
            })),
          h(Row, { label: t('style.icon'), description: t('style.iconDesc') },
            h('input', {
              className: 'bark-input',
              type: 'url',
              inputMode: 'url',
              value: form.icon,
              placeholder: t('placeholder.optional'),
              'aria-label': t('style.icon'),
              onChange: event => update({ icon: event.target.value }),
            })),
          h(Row, { label: t('style.url'), description: t('style.urlDesc') },
            h('input', {
              className: 'bark-input',
              type: 'text',
              value: form.urlTemplate,
              placeholder: t('placeholder.optional'),
              'aria-label': t('style.url'),
              onChange: event => update({ urlTemplate: event.target.value }),
            })),
          h(Row, { label: t('style.call'), description: t('style.callDesc') },
            h(Switch, {
              checked: form.call,
              label: t('style.call'),
              onChange: value => update({ call: value }),
            })),
          h(Row, { label: t('style.archive'), description: t('style.archiveDesc') },
            h(Switch, {
              checked: form.isArchive,
              label: t('style.archive'),
              onChange: value => update({ isArchive: value }),
            }))),

        h(Card, { title: t('limits.title') },
          h(Row, { label: t('limits.dedupe'), description: t('limits.dedupeDesc') },
            h('input', {
              className: 'bark-input bark-input-small',
              type: 'number',
              min: 0,
              max: 600,
              step: 1,
              value: form.dedupeSeconds,
              'aria-label': t('limits.dedupe'),
              onChange: event => update({ dedupeSeconds: event.target.value }),
            }),
            h('span', { className: 'bark-hint' }, t('unit.seconds'))),
          h(Row, { label: t('limits.rate'), description: t('limits.rateDesc') },
            h('input', {
              className: 'bark-input bark-input-small',
              type: 'number',
              min: 1,
              max: 120,
              step: 1,
              value: form.maxPerMinute,
              'aria-label': t('limits.rate'),
              onChange: event => update({ maxPerMinute: event.target.value }),
            }),
            h('span', { className: 'bark-hint' }, t('unit.perMinute')))),

        h(Card, { title: t('recent.title'), description: t('recent.desc') },
          recent.length === 0
            ? h('div', { className: 'bark-recent-item' }, h('span', { className: 'bark-hint' }, t('recent.empty')))
            : h('ul', { className: 'bark-recent' },
              ...recent.slice(0, 6).map((entry, index) => h('li', { key: `${entry.at}-${index}`, className: 'bark-recent-item' },
                h('span', { className: 'bark-recent-time' }, formatClock(entry.at)),
                h('span', { className: 'bark-recent-kind' }, t(`kind.${entry.kind}`)),
                h('span', { className: entry.ok ? 'bark-recent-ok' : 'bark-recent-fail' },
                  entry.ok ? t('recent.ok') : t('recent.fail')),
                entry.error ? h('span', { className: 'bark-recent-error' }, entry.error) : null))),
          h('div', { className: 'bark-recent-counts' },
            h('span', null, `${t('recent.sent')} ${counters.sent}`),
            h('span', null, `${t('recent.failed')} ${counters.failed}`),
            h('span', null, `${t('recent.skipped')} ${counters.skipped}`))),

        h('div', { className: 'bark-footer' },
          notice !== undefined
            ? h(Notice, { kind: notice.kind }, notice.text)
            : h('span', { className: 'bark-hint' },
              saving ? t('save.saving') : dirty ? t('save.pending') : t('save.clean'))),

        variableHint === undefined ? null : h('div', {
          ref: variableCardRef,
          className: 'bark-var-card',
          'aria-hidden': 'true',
          style: {
            width: `${variableHint.width}px`,
            left: `${variableHint.left}px`,
            top: `${variableHint.top}px`,
            visibility: variableHint.measured ? 'visible' : 'hidden',
          },
        },
        h('div', { className: 'bark-var-card-head' },
          h('span', { className: 'bark-var-card-name' }, t(`var.${variableHint.name}`)),
          h('code', { className: 'bark-code' }, `{${variableHint.name}}`)),
        h('p', { className: 'bark-var-card-desc' }, t(`var.${variableHint.name}Desc`)),
        h('div', { className: 'bark-var-example' },
          h('span', { className: 'bark-var-example-label' }, t('content.example')),
          h('span', { className: 'bark-var-example-value' }, t(`var.${variableHint.name}Example`)))))
    }

    /** Nav glyph for the settings section. */
    function BellIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: 16,
        height: 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', { d: 'M6 9a6 6 0 1 1 12 0c0 3.1.7 4.7 1.5 5.9.4.7 0 1.6-.9 1.6H5.4c-.8 0-1.3-.9-.9-1.6C5.3 13.7 6 12.1 6 9Z' }),
      h('path', { d: 'M10 19a2 2 0 0 0 4 0' }))
    }

    /**
     * Mount the settings page and its navigation icon.
     * @param {object} ctx - Client plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'bark-reminder: dictionaries')
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'bark-reminder',
        order: 26,
        label: () => t('nav'),
        locale: NS,
      }, BarkPage)), 'bark-reminder: settings page')
      ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: 'bark-reminder',
      }, BellIcon)), 'bark-reminder: settings icon')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
