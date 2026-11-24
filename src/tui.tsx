// @jsxImportSource @opentui/solid
import { Plugin, usePlugin } from '@opencode/plugin/tui'
import {
  collectMessageChars,
  estimateComposition,
  promptTokensFromUsage,
  type CompositionEstimate,
  type MessageLike,
} from './estimate.ts'

type TuiContext = ReturnType<typeof usePlugin>

interface ModelRefLike {
  readonly providerID: string
  readonly modelID?: string
  readonly id?: string
}

const DIALOG_TITLE = 'Context composition (estimated)'

const bar = (percent: number) => {
  const filled = Math.max(0, Math.min(8, Math.round((percent / 100) * 8)))

  return `${'▰'.repeat(filled)}${'▱'.repeat(8 - filled)}`
}

const formatTokens = (tokens: number) => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }

  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }

  return `${tokens}`
}

function modelLabelFor(modelRef: ModelRefLike | undefined): string | undefined {
  if (!modelRef) {
    return undefined
  }

  const modelID = modelRef.modelID ?? modelRef.id

  if (!modelID) {
    return modelRef.providerID
  }

  return modelID.startsWith(`${modelRef.providerID}/`)
    ? modelID
    : `${modelRef.providerID}/${modelID}`
}

function currentSessionID(context: TuiContext): string | undefined {
  const route = context.ui.router.current()

  return route.type === 'session' ? route.sessionID : undefined
}

function findAssistantUsage(
  messages: ReturnType<TuiContext['data']['session']['message']['list']>,
) {
  const assistant = messages.findLast(
    (message) => message.type === 'assistant' && message.tokens !== undefined,
  )

  if (assistant?.type !== 'assistant') {
    return { promptTokens: undefined, model: undefined }
  }

  return {
    promptTokens: promptTokensFromUsage(assistant.tokens),
    model: assistant.model,
  }
}

function matchesModelRef(
  item: { readonly providerID: string; readonly id: string; readonly modelID: string },
  modelRef: ModelRefLike,
): boolean {
  const targetID = modelRef.modelID ?? modelRef.id

  if (!targetID || item.providerID !== modelRef.providerID) {
    return false
  }

  return item.id === targetID || item.modelID === targetID
}

function findContextLimit(
  context: TuiContext,
  modelRef: ModelRefLike | undefined,
): number | undefined {
  if (!modelRef) {
    return undefined
  }

  const models = context.data.location.model.list(context.location) ?? []

  return models.find((item) => matchesModelRef(item, modelRef))?.limit.context
}

function resolveUsageAndLimit(context: TuiContext, sessionID: string | undefined) {
  if (!sessionID) {
    return { promptTokens: undefined, contextLimit: undefined, modelLabel: undefined }
  }

  const session = context.data.session.get(sessionID)
  const assistant = findAssistantUsage(context.data.session.message.list(sessionID))
  const modelRef: ModelRefLike | undefined =
    context.ui.model.current() ?? assistant.model ?? session?.model

  return {
    promptTokens: assistant.promptTokens,
    contextLimit: findContextLimit(context, modelRef),
    modelLabel: modelLabelFor(modelRef),
  }
}

function windowLine(
  report: CompositionEstimate,
  modelLabel: string | undefined,
  contextLimit: number | undefined,
): string {
  const name = modelLabel ?? 'Current model'

  if (
    report.contextPercent === undefined ||
    contextLimit === undefined ||
    report.totalTokens === undefined
  ) {
    return `${name} · ${formatTokens(report.totalTokens ?? 0)} prompt tokens (model limit unavailable)`
  }

  return `${name} · ${formatTokens(report.totalTokens)} / ${formatTokens(contextLimit)} (${report.contextPercent}%)`
}

function formatReport(
  report: CompositionEstimate,
  modelLabel: string | undefined,
  contextLimit: number | undefined,
): string {
  if (report.totalTokens === undefined) {
    return 'No prompt token usage is available yet for this session. Send a prompt or wait for a response, then run /context again.'
  }

  return [
    windowLine(report, modelLabel, contextLimit),
    '',
    ...report.categories.map(
      (cat) => `~ ${cat.name}: ~${formatTokens(cat.tokens)} (${cat.percent}%)`,
    ),
    '',
    'Estimates only: conversation and tool sizes use local character/4 approximations subtracted from the latest reported prompt tokens; hidden system prompts, agent definitions, and skills make up the remainder.',
  ].join('\n')
}

function footerLabel(report: CompositionEstimate): string {
  if (report.contextPercent !== undefined) {
    return `ctx ${report.contextPercent}% ${bar(report.contextPercent)}`
  }

  if (report.totalTokens !== undefined) {
    return `ctx ${formatTokens(report.totalTokens)}`
  }

  return 'ctx --'
}

function renderFooterStatus(context: TuiContext, sessionID: string | undefined) {
  try {
    const activeID = sessionID ?? currentSessionID(context)
    const { promptTokens, contextLimit } = resolveUsageAndLimit(context, activeID)
    const report = estimateComposition({
      promptTokens,
      contextLimit,
      conversationChars: 0,
      toolChars: 0,
    })

    return <text fg={context.theme.text.muted}>{footerLabel(report)}</text>
  } catch {
    return <text fg={context.theme.text.muted}>ctx --</text>
  }
}

async function loadActiveMessages(
  context: TuiContext,
  sessionID: string,
): Promise<readonly MessageLike[]> {
  try {
    const res = await context.client.session.context({ sessionID })

    return Array.isArray(res) ? res : []
  } catch {
    return context.data.session.message.list(sessionID)
  }
}

async function openContextReport(context: TuiContext, location: TuiContext['location']) {
  try {
    const sessionID = currentSessionID(context)

    if (!sessionID) {
      await context.ui.dialog.alert({
        title: DIALOG_TITLE,
        message: 'Open a session first, then run /context.',
      })

      return
    }

    await Promise.allSettled([
      context.data.session.sync(sessionID),
      context.data.session.message.sync(sessionID),
      context.data.location.model.sync(location),
    ])

    const activeMessages = await loadActiveMessages(context, sessionID)
    const { promptTokens, contextLimit, modelLabel } = resolveUsageAndLimit(context, sessionID)
    const { conversationChars, toolChars } = collectMessageChars(activeMessages)
    const report = estimateComposition({
      promptTokens,
      contextLimit,
      conversationChars,
      toolChars,
    })

    await context.ui.dialog.alert({
      title: DIALOG_TITLE,
      message: formatReport(report, modelLabel, contextLimit),
    })
  } catch {
    context.ui.toast.show({
      title: 'Context meter',
      message: 'Unable to read context usage for this session.',
      variant: 'warning',
    })
  }
}

export default Plugin.define({
  id: 'valerio.context-meter',
  setup(context) {
    const location = context.location ?? context.data.location.default()

    void context.data.location.model.sync(location).catch(() => {})

    const stopSlot = context.ui.slot({
      append: 'prompt.footer.status',
      render: (input) => renderFooterStatus(context, input.sessionID),
    })

    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: 'context-meter.show',
          title: 'Show estimated context composition',
          group: 'Context',
          palette: true,
          slash: { name: 'context' },
          run: () => openContextReport(context, location),
        },
      ],
    }))

    return () => stopSlot()
  },
})
