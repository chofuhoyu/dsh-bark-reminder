/**
 * Push copy: the fixed part of each notification (kind label and detail line)
 * and template rendering. Templates are user-owned; the detail is generated so
 * a notification still reads correctly when a template is replaced.
 *
 * The default copy omits the timestamp: iOS already displays the delivery time,
 * so the body is reserved for the event and its context.
 */

import { truncate } from './config.js'

/** Per-kind fixed copy, one detail builder per event family. */
const KIND_TEXT = {
  zh: {
    approval: {
      label: '有一项操作待确认',
      detail: vars => [`DSH 请求使用 ${vars.tool || '一项工具'}，需要你的确认。`, vars.reason].filter(Boolean).join('\n'),
    },
    review: {
      label: '自动审查拦下了一项操作',
      detail: vars => [
        `自动审查未放行 ${vars.tool || '此项操作'}，需要你决定是否继续。`,
        vars.reason,
      ].filter(Boolean).join('\n'),
    },
    escalation: {
      label: '沙盒权限申请',
      detail: vars => [`模型申请将沙盒权限提升至 ${vars.mode || '更高等级'}。`, vars.reason].filter(Boolean).join('\n'),
    },
    question: {
      label: '问题待回答',
      detail: vars => [
        `DSH 需要你的回答：${vars.question || '一个问题'}`,
        vars.questionCount > 1 ? `另有 ${vars.questionCount - 1} 个问题待回答。` : '',
        vars.requestDetail,
      ].filter(Boolean).join('\n'),
    },
    idle: {
      label: '本轮已结束',
      detail: vars => {
        if (vars.goalPhase === 'complete') return '目标已完成，结果可供查看。'
        if (vars.goalPhase === 'blocked') return `目标受阻：${vars.goalReason || '需要你处理'}`
        if (vars.goalPhase === 'paused') return '目标已暂停，等待你的处理。'
        return 'DSH 正在等待你的下一步。'
      },
    },
    error: {
      label: '运行出错',
      detail: vars => `DSH 因错误停止：${vars.error || '原因不明'}`,
    },
    test: {
      label: '测试通知',
      detail: () => '推送链路正常。当 DSH 需要你时，将以相同方式提醒。',
    },
  },
  en: {
    approval: {
      label: 'Approval requested',
      detail: vars => [`DSH requests to use ${vars.tool || 'a tool'} and is waiting for your approval.`, vars.reason].filter(Boolean).join('\n'),
    },
    review: {
      label: 'Auto review declined a step',
      detail: vars => [
        `Auto review did not approve ${vars.tool || 'this step'}; your decision is required.`,
        vars.reason,
      ].filter(Boolean).join('\n'),
    },
    escalation: {
      label: 'Sandbox escalation requested',
      detail: vars => [`The model requests the ${vars.mode || 'wider'} sandbox mode.`, vars.reason].filter(Boolean).join('\n'),
    },
    question: {
      label: 'Question pending',
      detail: vars => [
        `DSH is waiting for your answer: ${vars.question || 'a question'}`,
        vars.questionCount > 1 ? `${vars.questionCount - 1} additional questions are pending.` : '',
        vars.requestDetail,
      ].filter(Boolean).join('\n'),
    },
    idle: {
      label: 'Turn finished',
      detail: vars => {
        if (vars.goalPhase === 'complete') return 'The goal is complete; the result is ready for review.'
        if (vars.goalPhase === 'blocked') return `The goal is blocked: ${vars.goalReason || 'it requires your attention'}`
        if (vars.goalPhase === 'paused') return 'The goal is paused and awaits your attention.'
        return 'DSH is awaiting your next step.'
      },
    },
    error: {
      label: 'Run failed',
      detail: vars => `DSH stopped with an error: ${vars.error || 'cause unknown'}`,
    },
    test: {
      label: 'Test notification',
      detail: () => 'Push delivery is working. DSH will notify you in the same way when it needs you.',
    },
  },
}

/** Template placeholders offered by the settings page, in reading order. */
export const TEMPLATE_VARIABLES = [
  'kindLabel', 'detail', 'sessionTitle', 'project', 'cwd',
  'tool', 'reason', 'question', 'mode', 'error',
  'time', 'host', 'turn', 'goal',
]

/**
 * Replace `{name}` placeholders; unknown names stay visible so a typo in the
 * page shows up in the preview instead of silently vanishing.
 * @param {string} template - user template.
 * @param {Record<string, unknown>} vars - placeholder values.
 * @returns {string} rendered text.
 */
export function renderTemplate(template, vars) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, name) => {
    const value = vars[name]
    if (value === undefined || value === null) return whole
    return String(value)
  })
}

/**
 * Render one notification from a kind and its event variables.
 * @param {string} kind - event family.
 * @param {Record<string, unknown>} vars - event and session values.
 * @param {{ titleTemplate: string, bodyTemplate: string, messageLocale: 'zh' | 'en' }} config - effective settings.
 * @returns {{ title: string, body: string, kindLabel: string, detail: string }} push payload text.
 */
export function renderNotification(kind, vars, config) {
  const text = KIND_TEXT[config.messageLocale] ?? KIND_TEXT.zh
  const entry = text[kind] ?? text.approval
  const kindLabel = entry.label
  const detail = truncate(entry.detail(vars), 900)
  // Declared variables resolve to empty text for kinds that do not set them,
  // so one template can serve every reminder family. Unknown names stay.
  const all = {
    tool: '', reason: '', question: '', mode: '', error: '', goal: '', turn: '',
    ...vars,
    kind,
    kindLabel,
    detail,
  }
  const title = truncate(renderTemplate(config.titleTemplate, all), 200) || kindLabel
  const body = truncate(renderTemplate(config.bodyTemplate, all), 1800) || detail
  return { title, body, kindLabel, detail }
}

/**
 * Sample values for the page preview, so the preview exercises the real
 * renderer without inventing a session.
 * @param {'zh' | 'en'} locale - push copy language.
 * @param {string} time - formatted sample time.
 * @param {string} host - machine name.
 * @returns {Record<string, unknown>} sample variables.
 */
export function sampleVars(locale, time, host) {
  if (locale === 'en') {
    return {
      sessionTitle: 'Refactor the login flow',
      project: 'dsh-bark-reminder',
      cwd: '/Users/you/Code/dsh-bark-reminder',
      tool: 'bash',
      reason: 'Drops stale rows from the production database',
      question: 'Which database should the migration use?',
      questionCount: 1,
      mode: 'danger-full-access',
      error: 'Model request failed after three retries',
      time,
      host,
      turn: 4,
      goal: 'Ship the notification plugin',
    }
  }
  return {
    sessionTitle: '重构登录流程',
    project: 'dsh-bark-reminder',
    cwd: '/Users/you/Code/dsh-bark-reminder',
    tool: 'bash',
    reason: '删除生产库里的旧数据',
    question: '迁移要使用哪个数据库？',
    questionCount: 1,
    mode: 'danger-full-access',
    error: '模型请求连续三次失败',
    time,
    host,
    turn: 4,
    goal: '完成提醒插件',
  }
}
