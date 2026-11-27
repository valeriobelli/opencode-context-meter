import assert from 'node:assert/strict'
import test from 'node:test'
import type { Plugin } from '@opencode/plugin'
import server from '../src/index.ts'
import { estimateRequestChars } from '../src/request.ts'
import { ContextMeter } from '../src/rpc.ts'

await test('classifies instruction sources without counting the containing system part twice', () => {
  const tools = { read: { description: 'private description', input: { type: 'object' } } }
  const request = {
    system: [
      { text: 'ordinary system' },
      {
        text: 'the entire joined instruction part must not be counted',
        metadata: {
          experimental: {
            instructions: [
              { key: 'core/skill-guidance', text: 'catalog' },
              { key: 'core/codemode', text: 'codemode' },
              { key: 'core/mcp-guidance', text: 'mcp' },
              { key: 'core/date', text: 'date' },
            ],
          },
        },
      },
    ],
    tools,
  }
  const before = structuredClone(request)

  assert.deepEqual(estimateRequestChars(request), {
    skillChars: 7,
    toolDefinitionChars: 8 + 3 + JSON.stringify(tools).length,
    systemChars: 'ordinary system'.length + 4,
    contributors: [
      { category: 'MCP & tool definitions', name: 'read', chars: JSON.stringify(tools).length - 2 },
      { category: 'MCP & tool definitions', name: 'Other tool definitions', chars: 2 },
      { category: 'System & instructions', name: 'System instructions', chars: 15 },
      { category: 'Skills', name: 'Other skill catalog', chars: 7 },
      { category: 'MCP & tool definitions', name: 'Other tool definitions', chars: 8 },
      { category: 'MCP & tool definitions', name: 'Other tool definitions', chars: 3 },
      { category: 'System & instructions', name: 'core/date', chars: 4 },
    ],
  })
  assert.deepEqual(request, before)
})

await test('treats system text without source metadata as system and empty tools as zero', () => {
  assert.deepEqual(estimateRequestChars({ system: [{ text: 'raw' }], tools: {} }), {
    skillChars: 0,
    toolDefinitionChars: 0,
    systemChars: 3,
    contributors: [{ category: 'System & instructions', name: 'System instructions', chars: 3 }],
  })
})

await test('RPC output strictly permits aggregates and contributor names, categories, and character counts', () => {
  const schema = ContextMeter.methods.composition.output
  const aggregate = schema.anyOf[1]

  assert.deepEqual(schema.anyOf[0], { type: 'null' })
  assert.equal(aggregate.additionalProperties, false)

  assert.deepEqual(Object.keys(aggregate.properties ?? {}).sort(), [
    'capturedAt',
    'contributors',
    'revision',
    'skillChars',
    'systemChars',
    'toolDefinitionChars',
  ])

  assert.deepEqual(aggregate.properties.contributors, {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['Skills', 'MCP & tool definitions', 'System & instructions'],
        },
        name: { type: 'string', minLength: 1 },
        chars: { type: 'integer', minimum: 0 },
      },
      required: ['category', 'name', 'chars'],
      additionalProperties: false,
    },
  })
  assert.deepEqual(aggregate.required?.toSorted(), Object.keys(aggregate.properties ?? {}).sort())
})

await test('extracts advertised skills without retaining descriptions and groups surrounding text', () => {
  const first =
    '  <skill>\n    <id>review</id>\n    <name>Review</name>\n    <description>secret description</description>\n  </skill>'
  const second =
    '  <skill>\n    <id>build</id>\n    <name>Build</name>\n    <description>another secret</description>\n  </skill>'
  const text = `Skills guidance\n<available_skills>\n${first}\n${second}\n</available_skills>`
  const result = estimateRequestChars({
    system: [
      {
        text,
        metadata: { experimental: { instructions: [{ key: 'core/skill-guidance', text }] } },
      },
    ],
    tools: {},
  })

  assert.equal(result.skillChars, text.length)

  assert.deepEqual(result.contributors, [
    { category: 'Skills', name: 'review (catalog)', chars: first.trimStart().length },
    { category: 'Skills', name: 'build (catalog)', chars: second.trimStart().length },
    {
      category: 'Skills',
      name: 'Other skill catalog',
      chars: text.length - first.trimStart().length - second.trimStart().length,
    },
  ])
  assert.doesNotMatch(JSON.stringify(result), /secret description|another secret/)
})

await test('extracts visible Code Mode namespaces and multiline listings but groups unknown text', () => {
  const alpha =
    '- alpha (2 tools, 1 shown) // private namespace description\n  - tools.alpha.lookup({\n  /** secret parameter */\n  id: string,\n}): Promise<{\n  value: string,\n}> // private tool description'
  const beta = '- beta (1 tool, none shown)'
  const text = `# Code Mode\n\n## Code Mode tools (call only inside \`execute\`)\n\n${alpha}\n${beta}\n\nUnknown trailing secret`
  const result = estimateRequestChars({
    system: [
      { text, metadata: { experimental: { instructions: [{ key: 'core/codemode', text }] } } },
    ],
    tools: {},
  })

  assert.equal(result.toolDefinitionChars, text.length)

  assert.deepEqual(result.contributors, [
    { category: 'MCP & tool definitions', name: 'alpha (Code Mode)', chars: alpha.length },
    { category: 'MCP & tool definitions', name: 'beta (Code Mode)', chars: beta.length },
    {
      category: 'MCP & tool definitions',
      name: 'Other tool definitions',
      chars: text.length - alpha.length - beta.length,
    },
  ])
  assert.doesNotMatch(JSON.stringify(result), /private|secret|Unknown trailing/)
})

await test('groups unrecognized catalog formats and malformed skill blocks without leaking content', () => {
  const skills = '<skill><id>bad id with secret</id><name>secret</name></skill> trailing private'
  const codemode = 'server alpha: private tool list\n- alpha (maybe tools)\n  - private'
  const result = estimateRequestChars({
    system: [
      {
        text: 'joined',
        metadata: {
          experimental: {
            instructions: [
              { key: 'core/skill-guidance', text: skills },
              { key: 'core/codemode', text: codemode },
            ],
          },
        },
      },
    ],
    tools: {},
  })

  assert.deepEqual(result.contributors, [
    { category: 'Skills', name: 'Other skill catalog', chars: skills.length },
    { category: 'MCP & tool definitions', name: 'Other tool definitions', chars: codemode.length },
  ])
  assert.doesNotMatch(JSON.stringify(result), /secret|private|bad id/)
})

await test('does not attribute malformed catalog fragments as valid entries', () => {
  const skills =
    '<skill><id>broken</id><name>Broken</name><description>private\n<skill><id>valid</id><name>Valid</name><description>secret</description></skill>'
  const codemode =
    '- fake (1 tool) not a heading\n  - tools.fake.secret(): void\n- valid (1 tool)\n  - tools.valid.safe(): void'
  const result = estimateRequestChars({
    system: [
      {
        text: 'joined',
        metadata: {
          experimental: {
            instructions: [
              { key: 'core/skill-guidance', text: skills },
              { key: 'core/codemode', text: codemode },
            ],
          },
        },
      },
    ],
    tools: {},
  })

  assert.deepEqual(
    result.contributors.filter((item) => item.name.endsWith('(catalog)')).map((item) => item.name),
    ['valid (catalog)'],
  )

  assert.deepEqual(
    result.contributors
      .filter((item) => item.name.endsWith('(Code Mode)'))
      .map((item) => item.name),
    ['valid (Code Mode)'],
  )

  for (const [category, total] of [
    ['Skills', result.skillChars],
    ['MCP & tool definitions', result.toolDefinitionChars],
  ] as const) {
    assert.equal(
      result.contributors
        .filter((item) => item.category === category)
        .reduce((sum, item) => sum + item.chars, 0),
      total,
    )
  }
})

await test('accounts for JSON punctuation and omitted direct tool entries without retaining schemas', () => {
  const tools = {
    read: { description: 'private-schema', input: { type: 'object' } },
    hidden: undefined,
    'write-tool': { value: 'private-value' },
  }
  const result = estimateRequestChars({ system: [], tools })
  const read = JSON.stringify({ read: tools.read }).length - 2
  const write = JSON.stringify({ 'write-tool': tools['write-tool'] }).length - 2

  assert.equal(result.toolDefinitionChars, JSON.stringify(tools).length)

  assert.deepEqual(result.contributors, [
    { category: 'MCP & tool definitions', name: 'read', chars: read },
    { category: 'MCP & tool definitions', name: 'write-tool', chars: write },
    {
      category: 'MCP & tool definitions',
      name: 'Other tool definitions',
      chars: result.toolDefinitionChars - read - write,
    },
  ])
  assert.doesNotMatch(JSON.stringify(result), /private|hidden/)
})

await test('groups unsafe tool and instruction names without changing category totals', () => {
  const tools = { 'private content\nnot-a-name': { description: 'private tool' } }
  const text = 'private instruction'
  const result = estimateRequestChars({
    system: [
      { text, metadata: { experimental: { instructions: [{ key: 'bad key\nprivate', text }] } } },
    ],
    tools,
  })

  assert.equal(result.toolDefinitionChars, JSON.stringify(tools).length)

  assert.deepEqual(result.contributors, [
    {
      category: 'MCP & tool definitions',
      name: 'Other tool definitions',
      chars: result.toolDefinitionChars,
    },
    { category: 'System & instructions', name: 'System instructions', chars: text.length },
  ])
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

await test('falls back to anonymous system text for malformed instruction metadata', () => {
  const result = estimateRequestChars({
    system: [
      {
        text: 'private joined',
        metadata: { experimental: { instructions: [null, { key: 'x', text: 10 }] } },
      },
    ],
    tools: {},
  })

  assert.equal(result.systemChars, 'private joined'.length)

  assert.deepEqual(result.contributors, [
    { category: 'System & instructions', name: 'System instructions', chars: result.systemChars },
  ])
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

await test('stores only session-scoped primary aggregates and clears them on compaction and unload', async () => {
  const hooks: Record<string, (event: never) => void> = {}
  let composition: ((input: { sessionID: string }) => Promise<unknown>) | undefined
  const registration = { dispose: async () => {} }
  const context = {
    session: {
      hook: async (name: string, hook: (event: never) => void) => {
        hooks[name] = hook

        return registration
      },
    },
    rpc: {
      register: async (_definition: unknown, handlers: { composition: typeof composition }) => {
        composition = handlers.composition

        return registration
      },
    },
  } as unknown as Plugin.Context
  const cleanup = await server.setup(context)

  assert.ok(composition)
  assert.ok(hooks.context)
  assert.ok(hooks.compaction)
  const input = { sessionID: 'a', system: [{ text: 'secret-system' }], tools: {} }

  const beforeCapture = Date.now()

  hooks.context(input as never)
  const snapshot = await composition({ sessionID: 'a' })

  assert.deepEqual(snapshot, {
    skillChars: 0,
    toolDefinitionChars: 0,
    systemChars: 13,
    contributors: [{ category: 'System & instructions', name: 'System instructions', chars: 13 }],
    capturedAt: (snapshot as { capturedAt: number }).capturedAt,
    revision: (snapshot as { revision: number }).revision,
  })
  assert.ok((snapshot as { capturedAt: number }).capturedAt >= beforeCapture)
  assert.ok((snapshot as { capturedAt: number }).capturedAt <= Date.now())
  assert.equal(typeof (snapshot as { revision: number }).revision, 'number')
  hooks.context(input as never)
  const newer = (await composition({ sessionID: 'a' })) as { revision: number }

  assert.ok(newer.revision > (snapshot as { revision: number }).revision)
  assert.equal(JSON.stringify(snapshot).includes('secret-system'), false)
  assert.equal(await composition({ sessionID: 'b' }), null)
  const privateCatalog =
    '<skill><id>review</id><name>Review</name><description>secret-skill</description></skill>'

  hooks.context({
    sessionID: 'detail',
    system: [
      {
        text: 'secret-instructions',
        metadata: {
          experimental: {
            instructions: [
              { key: 'core/skill-guidance', text: privateCatalog },
              {
                key: 'core/codemode',
                text: '- docs (1 tool)\n  - tools.docs.find(): void // secret-tool',
              },
              { key: 'core/date', text: 'secret-date' },
            ],
          },
        },
      },
    ],
    tools: { read: { input: { properties: { secretSchema: 'value' } } } },
  } as never)
  const detailed = await composition({ sessionID: 'detail' })

  assert.doesNotMatch(
    JSON.stringify(detailed),
    /secret-skill|secret-tool|secret-date|secretSchema|secret-instructions/,
  )
  assert.match(JSON.stringify(detailed), /review \(catalog\)|docs \(Code Mode\)/)
  const circular: Record<string, unknown> = {}

  circular.self = circular
  assert.doesNotThrow(() => hooks.context!({ ...input, tools: circular } as never))
  assert.equal(await composition({ sessionID: 'a' }), null)
  hooks.context(input as never)
  hooks.context({ sessionID: 'b', system: [{ text: 'other' }], tools: {} } as never)
  hooks.compaction({ sessionID: 'a', system: [{ text: 'summary-secret' }], tools: {} } as never)
  assert.equal(await composition({ sessionID: 'a' }), null)
  assert.equal(((await composition({ sessionID: 'b' })) as { systemChars: number }).systemChars, 5)
  hooks.context(input as never)
  assert.ok(await composition({ sessionID: 'a' }))
  assert.ok(cleanup)
  await cleanup()
  hooks.context(input as never)
  assert.equal(await composition({ sessionID: 'a' }), null)
})
