// @jsxImportSource @opentui/solid
import { Plugin, usePlugin } from '@opencode/plugin/tui'
import { createSignal } from 'solid-js'
import {
  compactionBenefit,
  compactionPressure,
  effectiveCompactionConfig,
  type CompactionConfig,
  type CompactionPressure,
} from './advice.ts'
import {
  contextComposition,
  estimateComposition,
  rankContributors,
  findAssistantUsage,
  promptMessages,
  promptTokensFromUsage,
  reportCategoryTabs,
  type CompositionEstimate,
  type Contributor,
} from './estimate.ts'
import { ContextMeter } from './rpc.ts'
import { loadVerifiedSnapshot } from './snapshot.ts'
import type { RequestSnapshot } from './index.ts'

type TuiContext = ReturnType<typeof usePlugin>

interface ModelRefLike {
  readonly providerID: string
  readonly modelID?: string
  readonly id?: string
}

const DIALOG_TITLE = 'Context composition (estimated)'
const REPORT_TABS = ['Overview', 'Skills', 'Tools', 'System'] as const

type ReportTab = (typeof REPORT_TABS)[number]

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

function usageForMessages(messages: ReturnType<TuiContext['data']['session']['message']['list']>) {
  const assistant = findAssistantUsage(messages)

  return { promptTokens: promptTokensFromUsage(assistant?.tokens), model: assistant?.model }
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

function findModelLimits(
  context: TuiContext,
  modelRef: ModelRefLike | undefined,
  location: TuiContext['location'],
): { readonly context: number; readonly input?: number } | undefined {
  if (!modelRef) {
    return undefined
  }

  const models = context.data.location.model.list(location) ?? []

  return models.find((item) => matchesModelRef(item, modelRef))?.limit
}

function resolveUsageAndLimit(
  context: TuiContext,
  sessionID: string | undefined,
  messages?: ReturnType<TuiContext['data']['session']['message']['list']>,
) {
  if (!sessionID) {
    return {
      promptTokens: undefined,
      contextLimit: undefined,
      limits: undefined,
      modelLabel: undefined,
    }
  }

  const assistant = usageForMessages(messages ?? context.data.session.message.list(sessionID))

  return {
    promptTokens: assistant.promptTokens,
    ...resolveModel(context, sessionID, assistant.model),
  }
}

function resolveModel(
  context: TuiContext,
  sessionID: string,
  assistantModel: ModelRefLike | undefined,
) {
  const { model, location } = context.data.session.get(sessionID) ?? {}
  const modelRef = assistantModel ?? context.ui.model.current() ?? model

  return describeModel(context, modelRef, location)
}

function describeModel(
  context: TuiContext,
  modelRef: ModelRefLike | undefined,
  location?: TuiContext['location'],
) {
  const limits = findModelLimits(context, modelRef, location ?? context.location)

  return { contextLimit: limits?.context, limits, modelLabel: modelLabelFor(modelRef) }
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

function pressureLines(pressure: CompactionPressure): string[] {
  const threshold =
    pressure.status === 'disabled'
      ? 'disabled'
      : pressure.threshold === undefined
        ? 'unknown'
        : `~${formatTokens(pressure.threshold)} tokens`

  return [
    `Compaction pressure: ${pressure.status}${'percent' in pressure ? ` (~${Math.round(pressure.percent)}% of threshold)` : ''}`,
    `Estimated auto-compaction threshold: ${threshold}`,
  ]
}

const categoryHeader = (cat: CompositionEstimate['categories'][number]) =>
  `~ ${cat.name}: ~${formatTokens(cat.tokens)} (${cat.percent}%)`

function categoryLines(
  categories: readonly CompositionEstimate['categories'][number][],
  contributors: readonly Contributor[],
  categoryChars: Readonly<Record<string, number>>,
): string[] {
  return categories.flatMap((cat) => {
    const ranked = rankContributors(
      contributors.filter((item) => item.category === cat.name),
      categoryChars[cat.name] ?? 0,
      cat.tokens,
    )

    return [
      categoryHeader(cat),
      ...ranked.items.map((item) => `    ${item.name}: ~${formatTokens(item.tokens)}`),
      ...(ranked.omitted ? [`    … and ${ranked.omitted} more`] : []),
      '',
    ]
  })
}

function formatReport(
  report: CompositionEstimate,
  modelLabel: string | undefined,
  contextLimit: number | undefined,
  pressure: CompactionPressure,
  fresh: boolean,
  contributors: readonly Contributor[],
  categoryChars: Readonly<Record<string, number>>,
): Record<ReportTab, string> {
  if (report.totalTokens === undefined) {
    const message =
      'No prompt token usage is available yet for this session. Send a prompt or wait for a response, then run /context again.'

    return { Overview: message, Skills: message, Tools: message, System: message }
  }

  const category = (name: string) => report.categories.find((item) => item.name === name)?.tokens
  const benefit = compactionBenefit({
    promptTokens: report.totalTokens,
    systemTokens: category('System & instructions'),
    definitionTokens: category('MCP & tool definitions'),
    conversationTokens: category('Conversation'),
    toolTokens: category('Tool outputs & files'),
    fresh,
    pressure: pressure.status,
  })

  const notes = [
    'Category sizes are character/4 estimates, scaled to reported prompt tokens. Actual compaction may differ and does not guarantee savings.',
    ...(fresh
      ? []
      : [
          'Server snapshot unavailable or stale: hidden skill catalogs, tool definitions and system instructions remain unattributed.',
        ]),
  ]
  const detail = (tab: ReportTab) =>
    [
      ...categoryLines(
        report.categories.filter((category) => reportCategoryTabs(category.name).includes(tab)),
        contributors,
        categoryChars,
      ),
      ...notes,
    ].join('\n')

  return {
    Overview: [
      windowLine(report, modelLabel, contextLimit),
      ...pressureLines(pressure),
      `Potential benefit: ${benefit.kind}`,
      benefit.reason,
      ...(benefit.suggestion ? [benefit.suggestion] : []),
      '',
      ...report.categories.map(categoryHeader),
      '',
      ...notes,
    ].join('\n'),
    Skills: detail('Skills'),
    Tools: detail('Tools'),
    System: detail('System'),
  }
}

function footerLabel(report: CompositionEstimate, pressure: CompactionPressure): string {
  if (report.totalTokens === undefined) {
    return 'ctx --'
  }

  const amount =
    report.contextPercent !== undefined
      ? `${report.contextPercent}% ${bar(report.contextPercent)}`
      : formatTokens(report.totalTokens)

  return `ctx ${amount} ${pressure.status}`
}

const pressureFeedback = {
  low: 'success',
  warning: 'warning',
  urgent: 'error',
  unknown: undefined,
  disabled: undefined,
} as const

function renderFooterStatus(
  context: TuiContext,
  sessionID: string | undefined,
  config: CompactionConfig | undefined,
) {
  try {
    const activeID = sessionID ?? currentSessionID(context)
    const { promptTokens, contextLimit, limits } = resolveUsageAndLimit(context, activeID)
    const report = estimateComposition({
      promptTokens,
      contextLimit,
      conversationChars: 0,
      toolChars: 0,
    })

    const pressure = compactionPressure({ config, limits, promptTokens })
    const feedback = pressureFeedback[pressure.status]
    const color = feedback ? context.theme.text.feedback[feedback].base : context.theme.text.muted

    return <text fg={color}>{footerLabel(report, pressure)}</text>
  } catch {
    return <text fg={context.theme.text.muted}>ctx --</text>
  }
}

async function loadActiveMessages(
  context: TuiContext,
  sessionID: string,
): Promise<ReturnType<TuiContext['data']['session']['message']['list']>> {
  try {
    const res = await context.client.session.context({ sessionID })

    return Array.isArray(res) ? res : []
  } catch {
    return context.data.session.message.list(sessionID)
  }
}

async function loadSnapshot(
  context: TuiContext,
  sessionID: string,
  messages: ReturnType<TuiContext['data']['session']['message']['list']>,
  location: TuiContext['location'],
): Promise<RequestSnapshot | null | undefined> {
  const rpc = context.client.rpc(ContextMeter)

  return loadVerifiedSnapshot(
    messages,
    () => rpc.composition({ sessionID }, { location }) as Promise<RequestSnapshot | null>,
    () => context.client.session.context({ sessionID }),
    () => context.data.session.status(sessionID),
  )
}

function showReport(context: TuiContext, messages: Record<ReportTab, string>) {
  const { dialog } = context.ui

  function ReportDialog() {
    const [selected, setSelected] = createSignal(0)
    let scrollbox: { scrollTo(position: number): void } | undefined

    return (
      <box padding={1} paddingLeft={2} paddingRight={2} gap={1}>
        <text fg={context.theme.text.base}>{DIALOG_TITLE}</text>
        <text fg={context.theme.text.base}>
          {REPORT_TABS.map((tab, index) => (index === selected() ? `[${tab}]` : ` ${tab} `)).join(
            '  ',
          )}
        </text>
        <scrollbox
          ref={(element) => {
            scrollbox = element
          }}
          focused
          maxHeight={Math.max(3, context.renderer.height - 9)}
          onKeyDown={(event) => {
            if (event.name === 'left' || event.name === 'right') {
              setSelected(
                (current) =>
                  (current + (event.name === 'right' ? 1 : REPORT_TABS.length - 1)) %
                  REPORT_TABS.length,
              )
              scrollbox?.scrollTo(0)
              event.preventDefault()
              event.stopPropagation()
            }
          }}
        >
          <text fg={context.theme.text.muted} wrapMode="word">
            {messages[REPORT_TABS[selected()]!]}
          </text>
        </scrollbox>
        <text fg={context.theme.text.muted}>←/→ tabs · ↑/↓ scroll · Esc close</text>
      </box>
    )
  }

  dialog.show(() => <ReportDialog />)
  dialog.set({ size: 'large', centered: true })
}

async function openContextReport(
  context: TuiContext,
  location: NonNullable<TuiContext['location']>,
) {
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
    const { promptTokens, contextLimit, limits, modelLabel } = resolveUsageAndLimit(
      context,
      sessionID,
      activeMessages,
    )
    const sessionLocation = locationFor(context, sessionID, location)
    const [config, snapshot] = await Promise.all([
      context.client.config
        .get({ location: sessionLocation })
        .then(effectiveCompactionConfig)
        .catch(() => undefined),
      loadSnapshot(context, sessionID, activeMessages, sessionLocation).catch(() => null),
    ])

    if (snapshot === null) {
      await context.ui.dialog.alert({
        title: DIALOG_TITLE,
        message: 'The session changed while loading. Run /context again for an updated report.',
      })

      return
    }

    const pressure = compactionPressure({ config, limits, promptTokens })

    showReport(
      context,
      describeContext(
        promptMessages(activeMessages),
        { promptTokens, contextLimit, modelLabel },
        pressure,
        snapshot,
      ),
    )
  } catch {
    context.ui.toast.show({
      title: 'Context meter',
      message: 'Unable to read context usage for this session.',
      variant: 'warning',
    })
  }
}

function describeContext(
  messages: Readonly<ReturnType<TuiContext['data']['session']['message']['list']>>,
  {
    promptTokens,
    contextLimit,
    modelLabel,
  }: Pick<ReturnType<typeof resolveUsageAndLimit>, 'promptTokens' | 'contextLimit' | 'modelLabel'>,
  pressure: CompactionPressure,
  snapshot: RequestSnapshot | undefined,
) {
  const { report, contributors, categoryChars } = contextComposition(
    messages,
    { promptTokens, contextLimit },
    snapshot,
  )

  return formatReport(
    report,
    modelLabel,
    contextLimit,
    pressure,
    snapshot !== undefined,
    contributors,
    categoryChars,
  )
}

function locationFor(
  context: TuiContext,
  sessionID: string | undefined,
  fallback: NonNullable<TuiContext['location']>,
) {
  return (sessionID && context.data.session.get(sessionID)?.location) || fallback
}

export default Plugin.define({
  id: 'valerio.context-meter',
  setup(context) {
    const location = context.location ?? context.data.location.default()
    const [configs, setConfigs] = createSignal<Record<string, CompactionConfig | undefined>>({})
    const pending = new Set<string>()
    let generation = 0

    const configFor = (sessionID: string | undefined) => {
      const current = locationFor(context, sessionID, location)
      const key = current.directory
      const cached = configs()

      if (!(key in cached) && !pending.has(key)) {
        pending.add(key)
        const started = generation

        void context.client.config
          .get({ location: current })
          .then(effectiveCompactionConfig)
          .catch(() => undefined)
          .then((config) => {
            pending.delete(key)

            if (generation === started) {
              setConfigs((previous) => ({ ...previous, [key]: config }))
            }
          })
      }

      return cached[key]
    }

    const stopConfig = context.data.on('config.updated', () => {
      generation += 1
      pending.clear()
      setConfigs({})
    })

    void context.data.location.model.sync(location).catch(() => {})

    const stopSlot = context.ui.slot({
      append: 'prompt.footer.status',
      render: (input) =>
        renderFooterStatus(
          context,
          input.sessionID,
          configFor(input.sessionID ?? currentSessionID(context)),
        ),
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

    return () => {
      generation += 1
      stopConfig()
      stopSlot()
    }
  },
})
