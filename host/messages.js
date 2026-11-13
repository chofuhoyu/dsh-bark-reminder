/**
 * Push copy: the fixed part of each notification (kind label and detail line)
 * and template rendering. Templates are user-owned; the detail is generated so
 * a notification still reads correctly when a template is replaced.
 *
 * The default copy carries no clock: iOS already stamps every notification with
 * its delivery time, so the body spends its lines on what actually happened.
 */

import { truncate } from './config.js'

/** Per-kind fixed copy, one detail builder per event family. */
const KIND_TEXT = {
  zh: {
    approval: {
      label: '有一步需要你确认',
      detail: vars => [`DSH 想用 ${vars.tool || '一个工具'}，等你确认。`, vars.reason].filter(Boolean).join('\n'),
    },
    review: {
      label: '自动审查拦下了一步',
      detail: vars => [
        `自动审查没放行 ${vars.tool || '这一步'}，等你决定要不要继续。`,
        vars.reason,
      ].filter(Boolean).join('\n'),
    },
    escalation: {
      label: '模型想申请更大权限',
      detail: vars => [`模型想申请 ${vars.mode || '更高'} 的沙盒权限。`, vars.reason].filter(Boolean).join('\n'),
    },
    question: {
      label: '有个问题等你回答',
      detail: vars => [
        `DSH 想问你：${vars.question || '一个问题'}`,
        vars.questionCount > 1 ? `还有 ${vars.questionCount - 1} 个问题在排队。` : '',
        vars.requestDetail,
      ].filter(Boolean).join('\n'),
    },
    idle: {
      label: '这一轮结束了',
      detail: vars => {
        if (vars.goalPhase === 'complete') return '目标完成了，结果可以看了。'
        if (vars.goalPhase === 'blocked') return `目标卡住了：${vars.goalReason || '需要你处理一下'}`
        if (vars.goalPhase === 'paused') return '目标暂停了，等你回来处理。'
        return 'DSH 在等你的下一步。'
      },
    },
    error: {
      label: '运行出错了',
      detail: vars => `DSH 因为出错停了下来：${vars.error || '原因不明'}`,
    },
    test: {
      label: '测试通知',
      detail: () => '推送通了。以后 DSH 需要你，就会这样提醒你。',
    },
  },
  en: {
    approval: {
      label: 'A step needs your approval',
      detail: vars => [`DSH wants to use ${vars.tool || 'a tool'} and is waiting for your okay.`, vars.reason].filter(Boolean).join('\n'),
    },
    review: {
      label: 'Auto review stopped a step',
      detail: vars => [
        `Auto review did not clear ${vars.tool || 'this step'}; the call is yours.`,
        vars.reason,
      ].filter(Boolean).join('\n'),
    },
    escalation: {
      label: 'Wider access requested',
      detail: vars => [`The model is asking for ${vars.mode || 'wider'} sandbox access.`, vars.reason].filter(Boolean).join('\n'),
    },
    question: {
      label: 'A question for you',
      detail: vars => [
        `DSH wants to ask: ${vars.question || 'a question'}`,
        vars.questionCount > 1 ? `${vars.questionCount - 1} more waiting.` : '',
        vars.requestDetail,
      ].filter(Boolean).join('\n'),
    },
    idle: {
      label: 'Turn finished',
      detail: vars => {
        if (vars.goalPhase === 'complete') return 'The goal is done; the result is ready to look at.'
        if (vars.goalPhase === 'blocked') return `The goal is stuck: ${vars.goalReason || 'it needs a hand'}`
        if (vars.goalPhase === 'paused') return 'The goal is paused; it will wait for you.'
        return 'DSH is waiting for your next step.'
      },
    },
    error: {
      label: 'Something went wrong',
      detail: vars => `DSH stopped with an error: ${vars.error || 'cause unknown'}`,
    },
    test: {
      label: 'Test notification',
      detail: () => 'Delivery works. This is how DSH will reach you when it needs you.',
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
