export interface PromptTokens {
  readonly input?: number
  readonly cache?: {
    readonly read?: number
    readonly write?: number
  }
}

export interface FileAttachmentLike {
  readonly data?: string
  readonly mime?: string
}

export interface ToolContentLike {
  readonly type: string
  readonly text?: string
  readonly uri?: string
}

export interface AssistantPartLike {
  readonly type: string
  readonly name?: string
  readonly text?: string
  readonly state?: {
    readonly status?: string
    readonly input?: unknown
    readonly content?: readonly ToolContentLike[]
  }
}

export interface MessageLike {
  readonly type: string
  readonly name?: string
  readonly text?: string
  readonly skills?: readonly { readonly name?: string; readonly text?: string }[]
  readonly status?: string
  readonly summary?: string
  readonly metadata?: { readonly recent?: unknown }
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

export function findAssistantUsage<
  T extends { readonly type: string; readonly tokens?: PromptTokens; readonly status?: string },
>(messages: readonly T[]): (T & { readonly type: 'assistant' }) | undefined {
  const boundary = messages.findLastIndex(
    (message) => message.type === 'compaction' && message.status === 'completed',
  )

  return messages
    .slice(boundary + 1)
    .findLast(
      (message): message is T & { readonly type: 'assistant' } =>
        message.type === 'assistant' && message.tokens !== undefined,
    )
}

export function snapshotMatchesUsage(
  snapshot: { readonly capturedAt: number; readonly revision: number } | null,
  latest: { readonly revision: number } | null | undefined,
  assistantCreated: number | undefined,
  status: 'idle' | 'running',
): boolean {
  return (
    status === 'idle' &&
    snapshot !== null &&
    latest?.revision === snapshot.revision &&
    assistantCreated !== undefined &&
    assistantCreated >= snapshot.capturedAt
  )
}

export function promptMessages<
  T extends { readonly type: string; readonly tokens?: PromptTokens; readonly status?: string },
>(messages: readonly T[]): readonly T[] {
  const assistant = findAssistantUsage(messages)

  if (!assistant) {
    return []
  }

  const boundary = messages.findLastIndex(
    (message) => message.type === 'compaction' && message.status === 'completed',
  )

  return messages.slice(Math.max(0, boundary), messages.indexOf(assistant))
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
  skillChars: number
  systemChars: number
} {
  let conversationChars = 0
  let toolChars = 0
  let skillChars = 0
  let systemChars = 0

  for (const message of messages ?? []) {
    const counts = messageChars(message)

    conversationChars += counts.conversationChars
    const loadedSkillChars =
      message.type === 'assistant' ? sumChars(message.content ?? [], skillToolChars) : 0

    toolChars += counts.toolChars - loadedSkillChars
    skillChars += loadedSkillChars
    skillChars += message.type === 'skill' ? (message.text?.length ?? 0) : 0
    skillChars += sumChars(message.skills ?? [], (skill) => skill.text?.length ?? 0)
    systemChars += message.type === 'system' ? (message.text?.length ?? 0) : 0
  }

  return { conversationChars, toolChars, skillChars, systemChars }
}

function fileAttachmentChars(file: FileAttachmentLike): number {
  if (file.mime && file.mime !== 'text/plain' && file.mime !== 'application/x-directory') {
    return 0
  }

  return file.data?.length ?? 0
}

function userMessageChars(message: MessageLike): { conversationChars: number; toolChars: number } {
  return {
    conversationChars: message.text?.length ?? 0,
    toolChars: sumChars(message.files ?? [], fileAttachmentChars),
  }
}

function shellMessageChars(message: MessageLike): { conversationChars: number; toolChars: number } {
  return {
    conversationChars: 0,
    toolChars: (message.command?.length ?? 0) + (message.output?.output?.length ?? 0),
  }
}

interface MessageChars {
  conversationChars: number
  toolChars: number
}

const messageCharHandlers = new Map<string, (message: MessageLike) => MessageChars>([
  ['user', userMessageChars],
  ['synthetic', userMessageChars],
  ['shell', shellMessageChars],
  ['compaction', compactionMessageChars],
  ['assistant', (message) => assistantMessageChars(message.content ?? [])],
])

function messageChars(message: MessageLike): MessageChars {
  return messageCharHandlers.get(message.type)?.(message) ?? { conversationChars: 0, toolChars: 0 }
}

function compactionMessageChars(message: MessageLike): MessageChars {
  return {
    conversationChars:
      message.status === 'completed'
        ? (message.summary?.length ?? 0) +
          (typeof message.metadata?.recent === 'string' ? message.metadata.recent.length : 0)
        : 0,
    toolChars: 0,
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

function skillToolChars(part: AssistantPartLike): number {
  return part.type === 'tool' && part.name === 'skill' && part.state?.status === 'completed'
    ? sumChars(part.state.content ?? [], (item) =>
        item.type === 'text' ? (item.text?.length ?? 0) : 0,
      )
    : 0
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

export interface Contributor {
  readonly category: string
  readonly name: string
  readonly chars: number
}

type AddContributor = (category: string, name: string, chars: number) => void

export function collectMessageContributors(messages: readonly MessageLike[]): Contributor[] {
  const entries = new Map<string, Contributor>()

  const add: AddContributor = (category, name, chars) => {
    if (chars <= 0) {
      return
    }

    const key = JSON.stringify([category, name])

    entries.set(key, { category, name, chars: (entries.get(key)?.chars ?? 0) + chars })
  }

  for (const message of messages) {
    addMessageContributors(message, add)
  }

  return [...entries.values()]
}

function addMessageContributors(message: MessageLike, add: AddContributor): void {
  addSkillMessageContributor(message, add)
  addLoadedSkillContributors(message, add)
  addSystemMessageContributor(message, add)
  addFileMessageContributor(message, add)
  addShellMessageContributor(message, add)

  if (message.type === 'assistant') {
    addAssistantMessageContributors(message, add)
  }
}

function addSkillMessageContributor(message: MessageLike, add: AddContributor): void {
  if (message.type === 'skill') {
    add('Skills', `${message.name ?? 'Other skills'} · loaded body`, message.text?.length ?? 0)
  }
}

function addLoadedSkillContributors(message: MessageLike, add: AddContributor): void {
  for (const skill of message.skills ?? []) {
    add('Skills', `${skill.name ?? 'Other skills'} · loaded body`, skill.text?.length ?? 0)
  }
}

function addSystemMessageContributor(message: MessageLike, add: AddContributor): void {
  if (message.type === 'system') {
    add('System & instructions', 'Other system messages', message.text?.length ?? 0)
  }
}

function addFileMessageContributor(message: MessageLike, add: AddContributor): void {
  if (message.type === 'user' || message.type === 'synthetic') {
    add(
      'Tool outputs & files',
      'Attached files',
      sumChars(message.files ?? [], fileAttachmentChars),
    )
  }
}

function addShellMessageContributor(message: MessageLike, add: AddContributor): void {
  if (message.type === 'shell') {
    add('Tool outputs & files', 'shell · calls & results', messageChars(message).toolChars)
  }
}

function addAssistantMessageContributors(message: MessageLike, add: AddContributor): void {
  for (const part of message.content ?? []) {
    if (part.type === 'tool') {
      addToolPartContributors(part, add)
    }
  }
}

function addToolPartContributors(part: AssistantPartLike, add: AddContributor): void {
  const skillChars = skillToolChars(part)

  add('Skills', `${skillContributorName(part.state?.input)} · loaded body`, skillChars)

  add(
    'Tool outputs & files',
    `${part.name ?? 'Other tools'} · calls & results`,
    toolPartChars(part) - skillChars,
  )
}

function skillContributorName(input: unknown): string {
  if (
    typeof input === 'object' &&
    input !== null &&
    'id' in input &&
    typeof input.id === 'string'
  ) {
    return input.id
  }

  return 'Other skills'
}

export function rankContributors(
  items: readonly Pick<Contributor, 'name' | 'chars'>[],
  categoryChars: number,
  categoryTokens: number,
): { items: { name: string; tokens: number }[]; omitted: number } {
  const grouped = new Map<string, number>()

  for (const item of items) {
    if (item.chars > 0) {
      grouped.set(item.name, (grouped.get(item.name) ?? 0) + item.chars)
    }
  }

  const sorted = [...grouped]
    .map(([name, chars]) => ({ name, chars }))
    .toSorted((a, b) => b.chars - a.chars)
  const denominator = Math.max(
    categoryChars,
    sorted.reduce((sum, item) => sum + item.chars, 0),
  )

  return {
    items: sorted.slice(0, 6).map((item) => ({
      name: item.name,
      tokens: denominator > 0 ? Math.floor((item.chars / denominator) * categoryTokens) : 0,
    })),
    omitted: Math.max(0, sorted.length - 6),
  }
}

export function contextComposition(
  messages: readonly MessageLike[],
  usage: { promptTokens: number | undefined; contextLimit: number | undefined },
  snapshot:
    | {
        skillChars: number
        systemChars: number
        toolDefinitionChars: number
        contributors: readonly Contributor[]
      }
    | undefined,
) {
  const visible = collectMessageChars(messages)
  const skillChars = visible.skillChars + (snapshot?.skillChars ?? 0)
  const systemChars = visible.systemChars + (snapshot?.systemChars ?? 0)
  const mcpChars = snapshot?.toolDefinitionChars

  return {
    report: estimateComposition({ ...usage, ...visible, skillChars, systemChars, mcpChars }),
    categoryChars: {
      'Tool outputs & files': visible.toolChars,
      Skills: skillChars,
      'MCP & tool definitions': mcpChars ?? 0,
      'System & instructions': systemChars,
    },
    contributors: [...collectMessageContributors(messages), ...(snapshot?.contributors ?? [])],
  }
}

const estimateTokens = (characters: number) =>
  Math.ceil((Number.isFinite(characters) ? Math.max(0, characters) : 0) / 4)

// shortcut: ~4 chars/token approximation instead of a model-specific tokenizer; upgrade if exact per-provider tokenizers are needed.
export function estimateComposition({
  promptTokens,
  contextLimit,
  conversationChars,
  toolChars,
  skillChars = 0,
  mcpChars,
  systemChars = 0,
}: {
  readonly promptTokens: number | undefined
  readonly contextLimit: number | undefined
  readonly conversationChars: number
  readonly toolChars: number
  readonly skillChars?: number
  readonly mcpChars?: number
  readonly systemChars?: number
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

  const rows: [string, number][] = [
    ['Conversation', estimateTokens(conversationChars)],
    ['Tool outputs & files', estimateTokens(toolChars)],
    ['Skills', estimateTokens(skillChars)],
    ...(mcpChars === undefined
      ? []
      : [['MCP & tool definitions', estimateTokens(mcpChars)] as [string, number]]),
    ['System & instructions', estimateTokens(systemChars)],
  ]
  const visible = rows.reduce((sum, [, tokens]) => sum + tokens, 0)
  const scaled =
    visible > totalTokens
      ? distribute(
          rows.map(([, value]) => value),
          totalTokens,
        )
      : rows.map(([, value]) => value)
  const remainder = totalTokens - scaled.reduce((sum, value) => sum + value, 0)

  rows.push(['Unattributed / estimation remainder', remainder])
  const tokens = [...scaled, remainder]
  const percents = distribute(tokens, totalTokens > 0 ? 100 : 0)

  return {
    totalTokens,
    contextPercent,
    categories: rows.map(([name], index) => ({
      name,
      tokens: tokens[index] ?? 0,
      percent: percents[index] ?? 0,
    })),
  }
}

function distribute(values: readonly number[], total: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0)

  if (sum === 0) {
    return values.map(() => 0)
  }

  const exact = values.map((value) => (value / sum) * total)
  const result = exact.map(Math.floor)
  let remaining = total - result.reduce((a, b) => a + b, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)

  for (const item of order) {
    if (remaining <= 0) {
      break
    }

    result[item.index] = (result[item.index] ?? 0) + 1
    remaining -= 1
  }

  return result
}
