export type PressureStatus = 'low' | 'warning' | 'urgent' | 'disabled' | 'unknown'

export interface CompactionConfig {
  readonly auto?: boolean
  readonly buffer?: number | string
}

export function effectiveCompactionConfig(
  entries: readonly {
    readonly type: string
    readonly info?: { readonly compaction?: CompactionConfig }
  }[],
): CompactionConfig {
  const config: { auto?: boolean; buffer?: number | string } = {}

  for (const entry of entries) {
    if (entry.type === 'document') {
      Object.assign(config, entry.info?.compaction)
    }
  }

  return config
}

export interface ModelLimits {
  readonly context?: number
  readonly input?: number
}

export type CompactionPressure =
  | { readonly status: 'disabled'; readonly threshold?: never }
  | { readonly status: 'unknown'; readonly threshold?: number }
  | {
      readonly status: 'low' | 'warning' | 'urgent'
      readonly threshold: number
      readonly percent: number
    }

const validCount = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0

function compactionThreshold(
  window: number,
  buffer: CompactionConfig['buffer'],
): number | undefined {
  if (
    buffer !== undefined &&
    !(typeof buffer === 'number'
      ? Number.isSafeInteger(buffer) && buffer >= 0
      : /^([1-9]\d?(\.\d+)?)%$/u.test(buffer))
  ) {
    return undefined
  }

  // shortcut: mirrors OpenCode v2.4.1's ceiling; revisit when its compaction semantics change.
  const tokens =
    typeof buffer === 'string' ? Math.round((window * Number.parseFloat(buffer)) / 100) : buffer
  const reserve =
    tokens !== undefined && tokens < window
      ? tokens
      : Math.max(Math.floor(window * 0.15), window >= 32_000 ? 16_000 : 0)

  return window - reserve
}

export function compactionPressure({
  config,
  limits,
  promptTokens,
}: {
  readonly config: CompactionConfig | undefined
  readonly limits: ModelLimits | undefined
  readonly promptTokens: number | undefined
}): CompactionPressure {
  if (config?.auto === false) {
    return { status: 'disabled' }
  }

  if (!config || (config.auto !== undefined && config.auto !== true) || !limits) {
    return { status: 'unknown' }
  }

  const { context = 0, input = 0 } = limits

  if (!validCount(context) || !validCount(input)) {
    return { status: 'unknown' }
  }

  const window = context && input ? Math.min(context, input) : context || input

  if (!window) {
    return { status: 'unknown' }
  }

  const threshold = compactionThreshold(window, config.buffer)

  if (threshold === undefined) {
    return { status: 'unknown' }
  }

  if (!validCount(promptTokens)) {
    return { status: 'unknown', threshold }
  }

  const percent = (promptTokens / threshold) * 100

  return {
    status: percent >= 95 ? 'urgent' : percent >= 80 ? 'warning' : 'low',
    threshold,
    percent,
  }
}

export interface BenefitInput {
  readonly promptTokens: number | undefined
  readonly systemTokens: number | undefined
  readonly definitionTokens: number | undefined
  readonly conversationTokens: number | undefined
  readonly toolTokens: number | undefined
  readonly fresh: boolean
  readonly pressure: PressureStatus
}

export interface CompactionBenefit {
  readonly kind: 'fixed' | 'history' | 'unknown'
  readonly reason: string
  readonly suggestion?: string
}

export function compactionBenefit(input: BenefitInput): CompactionBenefit {
  const {
    promptTokens,
    systemTokens,
    definitionTokens,
    conversationTokens,
    toolTokens,
    fresh,
    pressure,
  } = input

  if (
    !fresh ||
    !validCount(promptTokens) ||
    promptTokens === 0 ||
    !validCount(systemTokens) ||
    !validCount(definitionTokens) ||
    !validCount(conversationTokens) ||
    !validCount(toolTokens)
  ) {
    return { kind: 'unknown', reason: 'Potential benefit is unknown.' }
  }

  if (systemTokens + definitionTokens > promptTokens / 2) {
    return {
      kind: 'fixed',
      reason:
        'Fixed system instructions and tool definitions exceed half of the prompt; compaction may free little.',
      suggestion: 'Consider reducing fixed context.',
    }
  }

  if (conversationTokens + toolTokens > promptTokens / 2) {
    return {
      kind: 'history',
      reason: 'Conversation and tool outputs exceed half of the prompt; history may shrink.',
      ...(pressure === 'warning' || pressure === 'urgent'
        ? { suggestion: 'Consider compaction.' }
        : {}),
    }
  }

  return { kind: 'unknown', reason: 'Potential benefit is unknown.' }
}
