export interface RequestChars {
  readonly skillChars: number
  readonly toolDefinitionChars: number
  readonly systemChars: number
  readonly contributors: readonly {
    readonly category: 'Skills' | 'MCP & tool definitions' | 'System & instructions'
    readonly name: string
    readonly chars: number
  }[]
}

type Contributor = RequestChars['contributors'][number]

interface InstructionSource {
  readonly key?: unknown
  readonly text: string
}

interface Totals {
  skillChars: number
  toolDefinitionChars: number
  systemChars: number
}

const safeName = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w./:@$-]{1,200}$/.test(value)

function add(
  contributors: Contributor[],
  category: Contributor['category'],
  name: string,
  chars: number,
) {
  if (chars > 0) {
    contributors.push({ category, name, chars })
  }
}

function estimateToolDefinitions(serializedTools: string, contributors: Contributor[]): number {
  if (!serializedTools) {
    return 0
  }

  const tools: unknown = JSON.parse(serializedTools)
  let namedChars = 0

  if (tools && typeof tools === 'object' && !Array.isArray(tools)) {
    for (const [name, value] of Object.entries(tools)) {
      if (!safeName(name)) {
        continue
      }

      const chars = JSON.stringify(name).length + 1 + JSON.stringify(value).length

      namedChars += chars
      add(contributors, 'MCP & tool definitions', name, chars)
    }
  }

  add(
    contributors,
    'MCP & tool definitions',
    'Other tool definitions',
    serializedTools.length - namedChars,
  )

  return serializedTools.length
}

function instructionSources(metadata: unknown): InstructionSource[] | undefined {
  const instructions = (metadata as { experimental?: { instructions?: unknown } } | undefined)
    ?.experimental?.instructions

  return Array.isArray(instructions) &&
    instructions.every(
      (source) => source && typeof source === 'object' && typeof source.text === 'string',
    )
    ? (instructions as InstructionSource[])
    : undefined
}

function addSkillCatalog(text: string, contributors: Contributor[]) {
  let namedChars = 0
  // shortcut: only the v2 XML catalog format is recognized, update when the catalog format changes.
  const entries = text.matchAll(
    /<skill>\s*<id>([\w./:@$-]{1,200})<\/id>\s*<name>[^<>\r\n]*<\/name>\s*<description>(?:(?!<skill>|<\/skill>|<\/description>)[\s\S])*<\/description>\s*<\/skill>/g,
  )

  for (const entry of entries) {
    namedChars += entry[0].length
    add(contributors, 'Skills', `${entry[1]} (catalog)`, entry[0].length)
  }

  add(contributors, 'Skills', 'Other skill catalog', text.length - namedChars)
}

function addToolGuidance(
  key: 'core/codemode' | 'core/mcp-guidance',
  text: string,
  contributors: Contributor[],
) {
  let namedChars = 0

  if (key === 'core/codemode') {
    // shortcut: only v2 namespace headings and their visible listings are recognized, update for new catalog formats.
    const sections = text.matchAll(
      /^- ([\w.$-]{1,200}) \(\d+ tools?(?:, (?:\d+ shown|none shown))?\)(?: \/\/ [^\r\n]*)?(?=\r?$)(?:\r?\n  - tools(?:\.|\[)[^\r\n]*(?:\r?\n(?: {2,}[^\r\n]*|}[^\r\n]*))*)*/gm,
    )

    for (const section of sections) {
      namedChars += section[0].length
      add(contributors, 'MCP & tool definitions', `${section[1]} (Code Mode)`, section[0].length)
    }
  }

  add(contributors, 'MCP & tool definitions', 'Other tool definitions', text.length - namedChars)
}

function addInstruction(source: InstructionSource, totals: Totals, contributors: Contributor[]) {
  if (source.key === 'core/skill-guidance') {
    totals.skillChars += source.text.length
    addSkillCatalog(source.text, contributors)
  } else if (source.key === 'core/codemode' || source.key === 'core/mcp-guidance') {
    totals.toolDefinitionChars += source.text.length
    addToolGuidance(source.key, source.text, contributors)
  } else {
    totals.systemChars += source.text.length

    add(
      contributors,
      'System & instructions',
      safeName(source.key) ? source.key : 'System instructions',
      source.text.length,
    )
  }
}

export function estimateRequestChars(request: {
  readonly system: readonly { readonly text: string; readonly metadata?: unknown }[]
  readonly tools: Readonly<Record<string, unknown>>
}): RequestChars {
  const totals: Totals = { skillChars: 0, toolDefinitionChars: 0, systemChars: 0 }
  const contributors: Contributor[] = []
  const serializedTools = Object.keys(request.tools).length ? JSON.stringify(request.tools) : ''

  totals.toolDefinitionChars = estimateToolDefinitions(serializedTools, contributors)

  for (const part of request.system) {
    if (!part || typeof part.text !== 'string') {
      continue
    }

    const sources = instructionSources(part.metadata)

    if (!sources) {
      totals.systemChars += part.text.length
      add(contributors, 'System & instructions', 'System instructions', part.text.length)
      continue
    }

    for (const source of sources) {
      addInstruction(source, totals, contributors)
    }
  }

  return { ...totals, contributors }
}
