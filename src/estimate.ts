export interface PromptTokens {
  readonly input?: number
  readonly cache?: {
    readonly read?: number
    readonly write?: number
  }
}

export interface FileAttachmentLike {
  readonly data?: string
}

export interface ToolContentLike {
  readonly type: string
  readonly text?: string
  readonly uri?: string
}

export interface AssistantPartLike {
  readonly type: string
  readonly text?: string
  readonly state?: {
    readonly input?: unknown
    readonly content?: readonly ToolContentLike[]
  }
}

export interface MessageLike {
  readonly type: string
  readonly text?: string
  readonly files?: readonly FileAttachmentLike[]
  readonly command?: string
  readonly output?: {
    readonly output?: string
  }
  readonly content?: readonly AssistantPartLike[]
}

export interface CategoryEstimate {
  readonly name: string
  readonly tokens: number
  readonly percent: number
}

export interface CompositionEstimate {
  readonly totalTokens: number | undefined
  readonly contextPercent: number | undefined
  readonly categories: readonly CategoryEstimate[]
}

export function promptTokensFromUsage(tokens: PromptTokens | undefined): number | undefined {
  if (!tokens) {
    return undefined
  }

  const total = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)

  return Number.isFinite(total) && total >= 0 ? total : undefined
}

export function collectMessageChars(messages: readonly MessageLike[] | undefined): {
  conversationChars: number
  toolChars: number
} {
  let conversationChars = 0
  let toolChars = 0

  for (const message of messages ?? []) {
    const counts = messageChars(message)

    conversationChars += counts.conversationChars
    toolChars += counts.toolChars
  }

  return { conversationChars, toolChars }
}

function userMessageChars(message: MessageLike): { conversationChars: number; toolChars: number } {
  return {
    conversationChars: message.text?.length ?? 0,
    toolChars: sumChars(message.files ?? [], (file) => file.data?.length ?? 0),
  }
}

function shellMessageChars(message: MessageLike): { conversationChars: number; toolChars: number } {
  return {
    conversationChars: 0,
    toolChars: (message.command?.length ?? 0) + (message.output?.output?.length ?? 0),
  }
}

function messageChars(message: MessageLike): { conversationChars: number; toolChars: number } {
  switch (message.type) {
    case 'user':
    case 'synthetic':
      return userMessageChars(message)
    case 'shell':
      return shellMessageChars(message)
    case 'assistant':
      return assistantMessageChars(message.content ?? [])
    default:
      return { conversationChars: 0, toolChars: 0 }
  }
}

function assistantMessageChars(parts: readonly AssistantPartLike[]): {
  conversationChars: number
  toolChars: number
} {
  let conversationChars = 0
  let toolChars = 0

  for (const part of parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      conversationChars += part.text?.length ?? 0
    } else if (part.type === 'tool') {
      toolChars += toolPartChars(part)
    }
  }

  return { conversationChars, toolChars }
}

function toolPartChars(part: AssistantPartLike): number {
  const inputLength = JSON.stringify(part.state?.input ?? '').length
  const contentLength = sumChars(part.state?.content ?? [], (item) =>
    item.type === 'text' ? (item.text?.length ?? 0) : (item.uri?.length ?? 0),
  )

  return inputLength + contentLength
}

function sumChars<Item>(items: readonly Item[], measure: (item: Item) => number): number {
  let total = 0

  for (const item of items) {
    total += measure(item)
  }

  return total
}

const estimateTokens = (characters: number) =>
  Math.ceil((Number.isFinite(characters) ? Math.max(0, characters) : 0) / 4)

// shortcut: ~4 chars/token approximation instead of a model-specific tokenizer; upgrade if exact per-provider tokenizers are needed.
export function estimateComposition({
  promptTokens,
  contextLimit,
  conversationChars,
  toolChars,
}: {
  readonly promptTokens: number | undefined
  readonly contextLimit: number | undefined
  readonly conversationChars: number
  readonly toolChars: number
}): CompositionEstimate {
  const totalTokens =
    promptTokens !== undefined && Number.isFinite(promptTokens) && promptTokens >= 0
      ? Math.round(promptTokens)
      : undefined
  const contextPercent =
    totalTokens !== undefined &&
    contextLimit !== undefined &&
    Number.isFinite(contextLimit) &&
    contextLimit > 0
      ? Math.round((totalTokens / contextLimit) * 100)
      : undefined

  if (totalTokens === undefined) {
    return { totalTokens, contextPercent, categories: [] }
  }

  const conversationEstimate = estimateTokens(conversationChars)
  const toolEstimate = estimateTokens(toolChars)
  const visibleEstimate = conversationEstimate + toolEstimate
  const scale =
    visibleEstimate > totalTokens && visibleEstimate > 0 ? totalTokens / visibleEstimate : 1
  const conversation = Math.round(conversationEstimate * scale)
  const tools = Math.min(totalTokens - conversation, Math.round(toolEstimate * scale))
  const system = totalTokens - conversation - tools
  const conversationPercent = totalTokens > 0 ? Math.round((conversation / totalTokens) * 100) : 0
  const toolPercent = totalTokens > 0 ? Math.round((tools / totalTokens) * 100) : 0

  return {
    totalTokens,
    contextPercent,
    categories: [
      { name: 'Conversation (estimated)', tokens: conversation, percent: conversationPercent },
      { name: 'Tools and files (estimated)', tokens: tools, percent: toolPercent },
      {
        name: 'System and instructions (estimated)',
        tokens: system,
        percent: totalTokens > 0 ? 100 - conversationPercent - toolPercent : 0,
      },
    ],
  }
}
