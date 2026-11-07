/**
 * Push copy: the fixed part of each notification (kind label and detail line)
 * and template rendering. Templates are user-owned; the detail is generated so
 * a notification still reads correctly when a template is replaced.
 */

import { truncate } from './config.js'

/** Per-kind fixed copy, one detail builder per event family. */
const KIND_TEXT = {
  zh: {
    approval: {
      label: '需要你批准',
      detail: vars => [`${vars.tool || '工具调用'} 需要你的批准。`, vars.reason].filter(Boolean).join('\n'),
    },
    review: {
      label: '自动审查有意见',
      detail: vars => [
        `自动审查器拒绝了 ${vars.tool || '一次工具调用'}，需要你决定是否放行。`,
        vars.reason,
      ].filter(Boolean).join('\n'),
    },
    escalation: {
      label: '申请沙盒权限',
      detail: vars => [`模型申请 ${vars.mode || '更高'} 沙盒权限。`, vars.reason].filter(Boolean).join('\n'),
    },
    question: {
      label: '需要你回答',
      detail: vars => [
        `DSH 在等你回答：${vars.question || '一个问题'}`,
        vars.questionCount > 1 ? `（还有 ${vars.questionCount - 1} 个问题）` : '',
        vars.requestDetail,
      ].filter(Boolean).join('\n'),
    },
    idle: {
      label: '会话已结束',
      detail: vars => {
        if (vars.goalPhase === 'complete') return '目标已完成，等你查看结果。'
        if (vars.goalPhase === 'blocked') return `目标受阻：${vars.goalReason || '需要你的处理'}`
        if (vars.goalPhase === 'paused') return '目标已暂停，需要你的处理。'
        return '本轮已经结束，DSH 在等你的下一步。'
      },
    },
    error: {
      label: '会话出错',
      detail: vars => `DSH 出错停止：${vars.error || '未知错误'}`,
    },
    test: {
      label: '测试通知',
      detail: () => 'Bark 推送已经连通，DSH 需要你时就会提醒。',
    },
  },
  en: {
    approval: {
      label: 'Approval needed',
      detail: vars => [`${vars.tool || 'A tool call'} needs your approval.`, vars.reason].filter(Boolean).join('\n'),
    },
    review: {
      label: 'Auto review feedback',
      detail: vars => [
        `Auto review denied ${vars.tool || 'a tool call'}; your decision is required.`,
        vars.reason,
      ].filter(Boolean).join('\n'),
    },
    escalation: {
      label: 'Sandbox access requested',
      detail: vars => [`The model requests ${vars.mode || 'wider'} sandbox access.`, vars.reason].filter(Boolean).join('\n'),
    },
    question: {
      label: 'Question waiting',
      detail: vars => [
        `DSH is waiting for your answer: ${vars.question || 'a question'}`,
        vars.questionCount > 1 ? `(${vars.questionCount - 1} more waiting)` : '',
        vars.requestDetail,
      ].filter(Boolean).join('\n'),
    },
    idle: {
      label: 'Session finished',
      detail: vars => {
        if (vars.goalPhase === 'complete') return 'The goal is complete; the result is ready to review.'
        if (vars.goalPhase === 'blocked') return `The goal is blocked: ${vars.goalReason || 'it needs your attention'}`
        if (vars.goalPhase === 'paused') return 'The goal is paused and needs your attention.'
        return 'This turn is over; DSH is waiting for your next step.'
      },
    },
    error: {
      label: 'Session error',
      detail: vars => `DSH stopped with an error: ${vars.error || 'unknown error'}`,
    },
    test: {
      label: 'Test notification',
      detail: () => 'Bark delivery works; DSH will ping you whenever it needs you.',
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
      project: 'dsh-bark',
      cwd: '/Users/you/Code/dsh-bark',
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
    project: 'dsh-bark',
    cwd: '/Users/you/Code/dsh-bark',
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
