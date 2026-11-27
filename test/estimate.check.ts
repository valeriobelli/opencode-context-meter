import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectMessageChars,
  collectMessageContributors,
  contextComposition,
  rankContributors,
  estimateComposition,
  findAssistantUsage,
  promptMessages,
  snapshotMatchesUsage,
  promptTokensFromUsage,
} from '../src/estimate.ts'

await test('uses the same visible and hidden counts for category totals and contributor scaling', () => {
  const messages = [{ type: 'skill', name: 'review', text: 'body' }]
  const usage = { promptTokens: 20, contextLimit: 100 }
  const snapshot = {
    skillChars: 8,
    systemChars: 8,
    toolDefinitionChars: 4,
    contributors: [{ category: 'Skills', name: 'review (catalog)', chars: 8 }],
  }

  assert.deepEqual(contextComposition(messages, usage, snapshot), {
    report: estimateComposition({
      ...usage,
      conversationChars: 0,
      toolChars: 0,
      skillChars: 12,
      systemChars: 8,
      mcpChars: 4,
    }),
    categoryChars: {
      'Tool outputs & files': 0,
      Skills: 12,
      'MCP & tool definitions': 4,
      'System & instructions': 8,
    },
    contributors: [
      { category: 'Skills', name: 'review · loaded body', chars: 4 },
      ...snapshot.contributors,
    ],
  })
})

await test('only uses assistant usage after the latest completed compaction', () => {
  const prior = { type: 'assistant', tokens: { input: 900 } }
  const completed = { type: 'compaction', status: 'completed' }
  const next = { type: 'assistant', tokens: { input: 100 } }

  assert.equal(findAssistantUsage([prior, completed]), undefined)
  assert.equal(findAssistantUsage([prior, completed, next]), next)
  assert.equal(findAssistantUsage([prior, { type: 'compaction', status: 'failed' }]), prior)
})

await test('accepts only a stable snapshot captured before or at a completed usage record', () => {
  const snapshot = { capturedAt: 10, revision: 2 }

  assert.equal(snapshotMatchesUsage(snapshot, { revision: 2 }, 11, 'idle', [], []), true)
  assert.equal(snapshotMatchesUsage(snapshot, { revision: 2 }, 10, 'idle', [], []), true)
  assert.equal(snapshotMatchesUsage(snapshot, { revision: 3 }, 11, 'idle', [], []), false)
  assert.equal(snapshotMatchesUsage(snapshot, { revision: 2 }, 9, 'idle', [], []), false)
  assert.equal(snapshotMatchesUsage(snapshot, { revision: 2 }, 11, 'running', [], []), false)
  assert.equal(snapshotMatchesUsage(snapshot, undefined, 11, 'idle', [], []), false)
})

await test('estimates only messages sent before the assistant usage record', () => {
  const sent = { type: 'user', text: 'sent' }
  const reply = {
    type: 'assistant',
    tokens: { input: 10 },
    content: [{ type: 'text', text: 'reply' }],
  }
  const later = { type: 'user', text: 'not yet measured' }

  assert.deepEqual(promptMessages([sent, reply, later]), [sent])
  assert.deepEqual(promptMessages([sent, { type: 'compaction', status: 'completed' }]), [])
  const compacted = { type: 'compaction', status: 'completed', summary: 'summary' }

  assert.deepEqual(promptMessages([sent, compacted, reply]), [compacted])
})

await test('attributes a successful skill tool body to skills, not tool outputs', () => {
  const message = {
    type: 'assistant',
    content: [
      {
        type: 'tool',
        name: 'skill',
        state: {
          status: 'completed',
          input: { id: 'review' },
          content: [{ type: 'text', text: 'skill body' }],
        },
      },
    ],
  }

  assert.deepEqual(collectMessageChars([message]), {
    conversationChars: 0,
    toolChars: JSON.stringify({ id: 'review' }).length,
    skillChars: 10,
    systemChars: 0,
  })

  assert.deepEqual(collectMessageContributors([message]), [
    { category: 'Skills', name: 'review · loaded body', chars: 10 },
    {
      category: 'Tool outputs & files',
      name: 'skill · calls & results',
      chars: JSON.stringify({ id: 'review' }).length,
    },
  ])
})

await test('skill-like parts outside assistant messages do not change totals', () => {
  const totals = collectMessageChars([
    {
      type: 'user',
      text: 'hello',
      content: [
        {
          type: 'tool',
          name: 'skill',
          state: { status: 'completed', content: [{ type: 'text', text: 'body' }] },
        },
      ],
    },
  ])

  assert.deepEqual(totals, { conversationChars: 5, toolChars: 0, skillChars: 0, systemChars: 0 })
})

await test('ranks retained contributors and bounds their estimated tokens to the category', () => {
  const contributors = collectMessageContributors([
    {
      type: 'assistant',
      content: [
        {
          type: 'tool',
          name: 'read',
          state: { input: {}, content: [{ type: 'text', text: 'abcdef' }] },
        },
      ],
    },
    { type: 'skill', name: 'audit', text: 'body' },
    { type: 'system', text: 'rules' },
  ])

  assert.deepEqual(contributors, [
    { category: 'Tool outputs & files', name: 'read · calls & results', chars: 8 },
    { category: 'Skills', name: 'audit · loaded body', chars: 4 },
    { category: 'System & instructions', name: 'Other system messages', chars: 5 },
  ])
  const items = Array.from({ length: 7 }, (_, i) => ({ name: `item-${i}`, chars: i + 1 }))
  const ranked = rankContributors(items, 28, 14)

  assert.equal(ranked.length, 7)

  assert.deepEqual(
    ranked.map((item) => item.name),
    ['item-6', 'item-5', 'item-4', 'item-3', 'item-2', 'item-1', 'item-0'],
  )
  assert.ok(ranked.reduce((sum, item) => sum + item.tokens, 0) <= 14)

  assert.deepEqual(
    rankContributors(
      [
        { name: 'same', chars: 4 },
        { name: 'same', chars: 4 },
      ],
      8,
      2,
    ),
    [{ name: 'same', tokens: 2 }],
  )
})

await test('counts active skill, system and completed summary content separately', () => {
  assert.deepEqual(
    collectMessageChars([
      { type: 'user', text: 'hi', skills: [{ text: 'guide' }] },
      { type: 'skill', text: 'skill text' },
      { type: 'system', text: 'rule' },
      {
        type: 'compaction',
        status: 'completed',
        summary: 'summary',
        metadata: { recent: 'retained' },
      },
      { type: 'compaction', status: 'running', summary: 'ignore' },
    ]),
    { conversationChars: 17, toolChars: 0, skillChars: 15, systemChars: 4 },
  )
})

await test('allocates all six categories without exceeding the reported prompt', () => {
  const result = estimateComposition({
    promptTokens: 3,
    contextLimit: 100,
    conversationChars: 4,
    toolChars: 4,
    skillChars: 4,
    mcpChars: 4,
    systemChars: 4,
  })

  assert.deepEqual(
    result.categories.map((category) => category.name),
    [
      'Conversation',
      'Tool outputs & files',
      'Skills',
      'MCP & tool definitions',
      'System & instructions',
      'Unattributed / estimation remainder',
    ],
  )

  assert.equal(
    result.categories.reduce((total, item) => total + item.tokens, 0),
    3,
  )

  assert.equal(
    result.categories.reduce((total, item) => total + item.percent, 0),
    100,
  )
  assert.ok(result.categories.every((item) => item.tokens >= 0 && item.percent >= 0))
})

await test('allocates reported prompt tokens across visible and residual categories', () => {
  assert.deepEqual(
    estimateComposition({
      promptTokens: 100,
      contextLimit: 200,
      conversationChars: 120,
      toolChars: 80,
    }),
    {
      totalTokens: 100,
      contextPercent: 50,
      categories: [
        { name: 'Conversation', tokens: 30, percent: 30 },
        { name: 'Tool outputs & files', tokens: 20, percent: 20 },
        { name: 'Skills', tokens: 0, percent: 0 },
        { name: 'System & instructions', tokens: 0, percent: 0 },
        { name: 'Unattributed / estimation remainder', tokens: 50, percent: 50 },
      ],
    },
  )
})

await test('does not fabricate a context percentage when usage or the limit is missing', () => {
  assert.equal(
    estimateComposition({
      promptTokens: undefined,
      contextLimit: 200,
      conversationChars: 120,
      toolChars: 80,
    }).contextPercent,
    undefined,
  )

  assert.equal(
    estimateComposition({
      promptTokens: 100,
      contextLimit: undefined,
      conversationChars: 120,
      toolChars: 80,
    }).contextPercent,
    undefined,
  )
})

await test('clamps visible category estimates to the reported prompt total', () => {
  const result = estimateComposition({
    promptTokens: 8,
    contextLimit: 10,
    conversationChars: 400,
    toolChars: 400,
  })

  assert.equal(
    result.categories.reduce((total, category) => total + category.tokens, 0),
    8,
  )

  assert.equal(
    result.categories.reduce((total, category) => total + category.percent, 0),
    100,
  )

  assert.ok(result.categories.every((category) => category.tokens >= 0))
})

await test('collects prompt tokens and visible character counts from active session messages', () => {
  assert.equal(promptTokensFromUsage({ input: 20, cache: { read: 70, write: 10 } }), 100)

  assert.deepEqual(
    collectMessageChars([
      {
        type: 'user',
        text: 'hello',
        files: [
          { data: '1234' },
          { data: 'text', mime: 'text/plain' },
          { data: 'iVBORw0KGgo', mime: 'image/png' },
          { data: 'JVBERi0x', mime: 'application/pdf' },
        ],
      },
      {
        type: 'assistant',
        content: [
          { type: 'text', text: 'world' },
          { type: 'tool', state: { input: { a: 1 }, content: [{ type: 'text', text: 'output' }] } },
        ],
      },
    ]),
    { conversationChars: 10, toolChars: 21, skillChars: 0, systemChars: 0 },
  )
})
