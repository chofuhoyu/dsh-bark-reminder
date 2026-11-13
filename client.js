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
    const { useCallback, useEffect, useRef, useState } = React

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
      intro: 'Push a reminder to your iPhone when DSH needs you or stops.',
      'load.failed': 'Could not read the settings',
      'load.retry': 'Retry',
      'status.enabled': 'Reminders on',
      'status.disabled': 'Reminders off',
      'status.keyConfigured': 'Device key set',
      'status.keyMissing': 'No device key',
      'basic.title': 'Basics',
      'basic.enabled': 'Enable Bark reminders',
      'basic.enabledDesc': 'When off, nothing is pushed; this page still works.',
      'server.label': 'Bark server',
      'server.desc': 'The public server by default; use your own address for a self-hosted bark-server.',
      'server.placeholder': 'https://api.day.app',
      'key.title': 'Device key',
      'key.label': 'Device key',
      'key.desc': 'Copy the push key from the Bark app home screen. It is stored in the DSH credential store, never in configuration.',
      'key.placeholder': 'Paste the Bark push key',
      'key.placeholderConfigured': 'Configured — enter a new key to replace it',
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
      'key.sourceNone': 'not set',
      'key.descConfig': 'This profile composes no credential store, so the key is saved in the plugin configuration (readable by this profile only).',
      'key.refHint': 'Credential name',
      'key.envHint': 'You can also set the same environment variable and restart DSH.',
      'key.missing': 'No device key yet, so nothing will be pushed.',
      'key.readonly': 'The key comes from the environment and cannot be changed here.',
      'key.invalid': 'Enter the key as one token without spaces.',
      'key.looksLikePath': 'That looks like a file path, not a Bark device key. Paste the push key from the Bark app home screen.',
      'key.failed': 'Could not save the key',
      'test.title': 'Test notification',
      'test.desc': 'Send one push with the current settings to confirm the phone receives it.',
      'test.button': 'Send test',
      'test.sending': 'Sending…',
      'test.success': 'Test notification sent — check your iPhone.',
      'test.failed': 'Delivery failed',
      'test.noKey': 'Set the device key first.',
      'triggers.title': 'When to remind',
      'triggers.desc': 'Only the checked events produce a push.',
      'trigger.approval': 'Other approvals',
      'trigger.approvalDesc': 'A tool call is waiting for your approval.',
      'trigger.review': 'Auto review feedback',
      'trigger.reviewDesc': 'Auto review denied a call and left the decision to you.',
      'trigger.escalation': 'Sandbox escalation',
      'trigger.escalationDesc': 'The model asks for a wider sandbox mode.',
      'trigger.question': 'Questions and plans',
      'trigger.questionDesc': 'The agent asked a question and is waiting for an answer.',
      'trigger.idle': 'Session finished',
      'trigger.idleDesc': 'A run ended and will not continue by itself.',
      'trigger.error': 'Run errors',
      'trigger.errorDesc': 'A session stopped because of an error.',
      'trigger.subagents': 'Include subagents',
      'trigger.subagentsDesc': 'Also announce subagent sessions; usually noisy.',
      'idle.delay': 'Finished reminder delay',
      'idle.delayDesc': 'Wait this long after the session goes idle before pushing, so an answer you are already typing does not notify you.',
      'idle.seconds': 's',
      'content.title': 'Message content',
      'content.desc': 'Templates support the variables below; empty fields fall back to the default copy.',
      'content.titleLabel': 'Title template',
      'content.bodyLabel': 'Body template',
      'content.vars': 'Insert into the body',
      'content.preview': 'Preview',
      'content.reset': 'Restore defaults',
      'content.locale': 'Push language',
      'content.localeDesc': 'Language of event labels and generated detail lines; templates are unchanged.',
      'content.langZh': '中文',
      'content.langEn': 'English',
      'var.kindLabel': 'Event label',
      'var.detail': 'Generated detail',
      'var.sessionTitle': 'Session title',
      'var.project': 'Project',
      'var.cwd': 'Working directory',
      'var.tool': 'Tool',
      'var.reason': 'Reason',
      'var.question': 'Question',
      'var.mode': 'Sandbox mode',
      'var.error': 'Error',
      'var.time': 'Time',
      'var.host': 'Host name',
      'var.turn': 'Turn',
      'var.goal': 'Goal',
      'style.title': 'Notification style',
      'style.level': 'Interruption level',
      'style.levelDesc': 'timeSensitive pierces Focus; critical needs the critical-alert permission in the app.',
      'style.sound': 'Sound',
      'style.soundDesc': 'A Bark ringtone name such as minuet; empty uses the app default.',
      'style.group': 'Group',
      'style.groupDesc': 'Pushes in one group stack together in Notification Center.',
      'style.icon': 'Icon URL',
      'style.iconDesc': 'Replaces the Bark icon in the notification; iOS 15 and later.',
      'style.url': 'Open on tap',
      'style.urlDesc': 'Link to open when the push is tapped; variables allowed. Empty opens Bark only.',
      'style.call': 'Repeat the ringtone',
      'style.callDesc': 'Rings for 30 seconds — for things that need immediate attention.',
      'style.archive': 'Save to history',
      'style.archiveDesc': 'Keep this push in the Bark app history.',
      'placeholder.optional': 'Optional',
      'limits.title': 'Rate and de-duplication',
      'limits.dedupe': 'De-duplication window',
      'limits.dedupeDesc': 'Repeated reminders for the same event inside this window are dropped.',
      'limits.rate': 'Per-minute limit',
      'limits.rateDesc': 'Extras beyond this limit are dropped and logged once.',
      'unit.seconds': 's',
      'unit.perMinute': 'pushes',
      'save.saving': 'Saving…',
      'save.pending': 'Saving automatically…',
      'save.failed': 'Could not save',
      'save.invalid': 'Invalid setting',
      'save.clean': 'All changes saved',
      'recent.title': 'Recent pushes',
      'recent.desc': 'Kept for this DSH run only.',
      'recent.empty': 'Nothing pushed yet.',
      'recent.ok': 'sent',
      'recent.fail': 'failed',
      'recent.sent': 'sent',
      'recent.failed': 'failed',
      'recent.skipped': 'skipped',
      'kind.approval': 'Approval',
      'kind.review': 'Auto review',
      'kind.escalation': 'Escalation',
      'kind.question': 'Question',
      'kind.idle': 'Session finished',
      'kind.error': 'Error',
      'kind.test': 'Test',
      'invalid.server': 'The Bark server must be an http or https URL.',
      'invalid.icon': 'The icon must be an http or https URL.',
      'invalid.template': 'Templates are limited to 4000 characters.',
      'invalid.number': 'Check the numeric fields.',
    }

    /** Chinese page copy. */
    const zh = {
      nav: 'Bark 提醒',
      title: 'Bark 提醒',
      intro: '当 DSH 需要你操作或停下来时，把提醒推到 iPhone。',
      'load.failed': '读取设置失败',
      'load.retry': '重试',
      'status.enabled': '提醒已启用',
      'status.disabled': '提醒已停用',
      'status.keyConfigured': '设备密钥已配置',
      'status.keyMissing': '未配置设备密钥',
      'basic.title': '基础',
      'basic.enabled': '启用 Bark 提醒',
      'basic.enabledDesc': '关闭后不会发送任何推送，设置页仍然可以修改。',
      'server.label': 'Bark 服务器',
      'server.desc': '默认使用官方服务器；自建 bark-server 填自己的地址。',
      'server.placeholder': 'https://api.day.app',
      'key.title': '设备密钥',
      'key.label': '推送密钥',
      'key.desc': '在 Bark App 首页复制推送 key。密钥保存在 DSH 凭据库，不写进配置文件。',
      'key.placeholder': '粘贴 Bark 推送 key',
      'key.placeholderConfigured': '已配置，输入新密钥可替换',
      'key.save': '保存密钥',
      'key.saving': '保存中…',
      'key.clear': '清除',
      'key.clearConfirm': '再点一次确认清除',
      'key.saved': '设备密钥已保存',
      'key.cleared': '设备密钥已清除',
      'key.savedFallback': '凭据库拒绝了写入，密钥已改存到插件配置。',
      'key.clearedFallback': '密钥已清除，但凭据库拒绝清理：',
      'key.sourceEnv': '来自环境变量',
      'key.sourceStored': '来自凭据库',
      'key.sourceConfig': '来自插件配置',
      'key.sourceNone': '未设置',
      'key.descConfig': '当前 profile 没有可用的凭据服务，密钥会保存在插件配置里（仅当前 profile 可读）。',
      'key.refHint': '凭据名',
      'key.envHint': '也可以设置同名环境变量后重启 DSH。',
      'key.missing': '还没有设备密钥，Bark 推送不会发出。',
      'key.readonly': '当前密钥来自环境变量，页面上不能修改。',
      'key.invalid': '密钥必须是连续的一段字符，不能包含空格。',
      'key.looksLikePath': '这看起来是文件路径，不是 Bark 设备密钥；请粘贴 Bark App 首页复制的推送 key。',
      'key.failed': '密钥保存失败',
      'test.title': '测试通知',
      'test.desc': '用当前设置发一条测试推送，确认手机能收到。',
      'test.button': '发送测试',
      'test.sending': '发送中…',
      'test.success': '测试通知已发送，请查看 iPhone。',
      'test.failed': '发送失败',
      'test.noKey': '请先配置设备密钥。',
      'triggers.title': '提醒场景',
      'triggers.desc': '只有勾选的场景才会推送。',
      'trigger.approval': '其他审批请求',
      'trigger.approvalDesc': '工具调用等你批准时提醒。',
      'trigger.review': '自动审查器意见',
      'trigger.reviewDesc': '自动审查拒绝一次调用、把决定交给你时提醒。',
      'trigger.escalation': '沙盒权限申请',
      'trigger.escalationDesc': '模型申请提升到更高沙盒权限时提醒。',
      'trigger.question': '提问与计划确认',
      'trigger.questionDesc': 'agent 使用提问工具等待回答时提醒。',
      'trigger.idle': '会话结束',
      'trigger.idleDesc': '一轮工作结束且不会自动继续时提醒。',
      'trigger.error': '运行错误',
      'trigger.errorDesc': '会话出错停止时提醒。',
      'trigger.subagents': '包含子代理',
      'trigger.subagentsDesc': '子代理等待确认或结束也提醒；通常会很吵。',
      'idle.delay': '结束提醒延迟',
      'idle.delayDesc': '会话空闲超过这个时间才提醒，避免你正在输入时被打扰。',
      'idle.seconds': '秒',
      'content.title': '消息内容',
      'content.desc': '标题和正文支持下面的变量；留空时使用默认文案。',
      'content.titleLabel': '标题模板',
      'content.bodyLabel': '正文模板',
      'content.vars': '插入到正文',
      'content.preview': '预览',
      'content.reset': '恢复默认',
      'content.locale': '推送语言',
      'content.localeDesc': '场景名称和自动生成的说明用这个语言；模板不受影响。',
      'content.langZh': '中文',
      'content.langEn': 'English',
      'var.kindLabel': '场景名称',
      'var.detail': '自动说明',
      'var.sessionTitle': '会话标题',
      'var.project': '项目名',
      'var.cwd': '工作目录',
      'var.tool': '工具名',
      'var.reason': '原因',
      'var.question': '问题',
      'var.mode': '沙盒模式',
      'var.error': '错误',
      'var.time': '时间',
      'var.host': '主机名',
      'var.turn': '轮次',
      'var.goal': '目标',
      'style.title': '通知样式',
      'style.level': '提醒级别',
      'style.levelDesc': 'timeSensitive 可以穿透专注模式；critical 需要 App 的紧急通知权限。',
      'style.sound': '铃声',
      'style.soundDesc': '填 Bark 铃声名（如 minuet），留空使用 App 默认铃声。',
      'style.group': '分组',
      'style.groupDesc': '同一分组的推送会在通知中心叠在一起。',
      'style.icon': '图标 URL',
      'style.iconDesc': '替换通知里的 Bark 图标，需要 iOS 15 及以上。',
      'style.url': '点击打开',
      'style.urlDesc': '点击通知时打开的链接，可以包含变量；留空则只打开 Bark。',
      'style.call': '持续响铃',
      'style.callDesc': '响铃 30 秒，适合必须马上处理的事。',
      'style.archive': '保存到历史',
      'style.archiveDesc': '在 Bark App 的历史记录里保留这条推送。',
      'placeholder.optional': '可选',
      'limits.title': '频率与去重',
      'limits.dedupe': '去重窗口',
      'limits.dedupeDesc': '同一事件在这个时间内的重复提醒会被丢弃。',
      'limits.rate': '每分钟上限',
      'limits.rateDesc': '超过后丢弃多余提醒，并在日志里记一条警告。',
      'unit.seconds': '秒',
      'unit.perMinute': '条',
      'save.saving': '保存中…',
      'save.pending': '正在自动保存…',
      'save.failed': '保存失败',
      'save.invalid': '设置有误',
      'save.clean': '所有修改已保存',
      'recent.title': '最近推送',
      'recent.desc': '只保留本次 DSH 运行期间的记录。',
      'recent.empty': '还没有发送过推送。',
      'recent.ok': '成功',
      'recent.fail': '失败',
      'recent.sent': '已发送',
      'recent.failed': '失败',
      'recent.skipped': '已跳过',
      'kind.approval': '审批',
      'kind.review': '自动审查',
      'kind.escalation': '沙盒提权',
      'kind.question': '提问',
      'kind.idle': '会话结束',
      'kind.error': '错误',
      'kind.test': '测试',
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
.bark-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.bark-chip { border:0.5px solid var(--dsw-alias-border-l2); border-radius:999px; background:transparent; color:var(--dsw-alias-label-secondary); font-family:inherit; font-size:12px; line-height:18px; padding:2px 9px; cursor:pointer; }
.bark-chip:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.bark-preview { margin-top:8px; padding:10px 12px; border:0.5px dashed var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-md); background:var(--dsw-alias-bg-layer-1); }
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
.bark-notice { font-size:12px; line-height:18px; }
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
.bark-recent-counts { margin:8px 0 0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary); }
.bark-loading { padding:12px 0; font-size:14px; line-height:22px; color:var(--dsw-alias-label-secondary); }
.bark-error-box { border:0.5px solid var(--dsw-alias-state-error-primary); border-radius:var(--dsw-radius-md); padding:12px; font-size:13px; line-height:20px; }
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
      const bodyRef = useRef(null)
      // Mirrors of the editable state for the debounced writer and for the
      // write still owed when the section unmounts.
      const formRef = useRef(form)
      const savedFormRef = useRef(savedForm)
      const savingRef = useRef(false)
      const failedFormRef = useRef(undefined)
      const mountedRef = useRef(true)
      formRef.current = form
      savedFormRef.current = savedForm

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

      const insertVariable = useCallback((name) => {
        setForm((current) => {
          if (current === undefined) return current
          const token = `{${name}}`
          const element = bodyRef.current
          const start = element !== null && element !== undefined && typeof element.selectionStart === 'number'
            ? element.selectionStart
            : current.bodyTemplate.length
          const end = element !== null && element !== undefined && typeof element.selectionEnd === 'number'
            ? element.selectionEnd
            : start
          const nextBody = `${current.bodyTemplate.slice(0, start)}${token}${current.bodyTemplate.slice(end)}`
          if (element !== null && element !== undefined) {
            requestAnimationFrame(() => {
              element.focus()
              element.setSelectionRange(start + token.length, start + token.length)
            })
          }
          return { ...current, bodyTemplate: nextBody }
        })
        setNotice(undefined)
      }, [])

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
            : ` ${clear === true ? t('key.clearedFallback') : t('key.savedFallback')} ${fallbackReason}`
          setKeyNotice({ kind: fallbackReason === undefined ? 'success' : 'warn', text: `${clear === true ? t('key.cleared') : t('key.saved')}${fallback}` })
        } catch (error) {
          const text = error.code === 'invalid-key'
            ? t('key.invalid')
            : `${t('key.failed')}：${error.message}`
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
            error: error.code === 'no-device-key' ? t('test.noKey') : `${t('test.failed')}：${error.message}`,
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
            ? `${t('save.invalid')}：${details[0].field} ${details[0].message}`
            : `${t('save.failed')}：${error.message}`
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
            h('div', null, `${t('load.failed')}${loadError === undefined ? '' : `：${loadError.message}`}`),
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
                key.configured
                  ? key.source === 'config'
                    ? keySource
                    : `${keySource} · ${t('key.refHint')} ${data.deviceKeyRef ?? 'BARK_DEVICE_KEY'}`
                  : `${t('key.refHint')} ${data.deviceKeyRef ?? 'BARK_DEVICE_KEY'} · ${t('key.envHint')}`),
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
              'aria-label': t('content.titleLabel'),
              onChange: event => update({ titleTemplate: event.target.value }),
            })),
          h(Row, { label: t('content.bodyLabel'), stack: true },
            h('textarea', {
              className: 'bark-textarea',
              rows: 3,
              value: form.bodyTemplate,
              ref: bodyRef,
              'aria-label': t('content.bodyLabel'),
              onChange: event => update({ bodyTemplate: event.target.value }),
            }),
            h('div', {
              style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginTop: '8px' },
            },
            h('span', { className: 'bark-hint' }, t('content.vars')),
            ...VARIABLES.map(name => h('button', {
              key: name,
              type: 'button',
              className: 'bark-chip',
              title: `{${name}}`,
              onClick: () => insertVariable(name),
            }, t(`var.${name}`)))),
            h('div', { className: 'bark-preview' },
              h('div', { className: 'bark-preview-label' }, t('content.preview')),
              h('div', { className: 'bark-preview-title' }, preview?.title ?? ''),
              h('pre', { className: 'bark-preview-body' }, preview?.body ?? '')),
            h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } },
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
            h('option', { value: 'active' }, 'active'),
            h('option', { value: 'timeSensitive' }, 'timeSensitive'),
            h('option', { value: 'passive' }, 'passive'),
            h('option', { value: 'critical' }, 'critical'))),
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
            `${t('recent.sent')} ${counters.sent} · ${t('recent.failed')} ${counters.failed} · ${t('recent.skipped')} ${counters.skipped}`)),

        h('div', { className: 'bark-footer' },
          notice !== undefined
            ? h(Notice, { kind: notice.kind }, notice.text)
            : h('span', { className: 'bark-hint' },
              saving ? t('save.saving') : dirty ? t('save.pending') : t('save.clean'))))
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
