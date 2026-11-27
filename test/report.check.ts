import assert from 'node:assert/strict'
import { test } from 'node:test'
import { snapshotMatchesUsage } from '../src/estimate.ts'
import * as estimate from '../src/estimate.ts'
import { categoryRows } from '../src/report.ts'

await test('keeps labels and estimated values separate for aligned rows', async () => {
  const path = '../src/report.ts'
  const report = await import(path).catch(() => ({}))

  assert.equal(typeof report.categoryRows, 'function')

  assert.deepEqual(
    report.categoryRows(
      [{ name: 'Skills', tokens: 1000, percent: 25 }],
      [
        { category: 'Skills', name: 'review · loaded body', chars: 40 },
        { category: 'Skills', name: 'docs (catalog)', chars: 20 },
      ],
      { Skills: 100 },
    ),
    [
      {
        name: 'Skills',
        value: '~1.0k · 25%',
        items: [
          { name: 'review · loaded body', value: '~400' },
          { name: 'docs · catalog', value: '~200' },
        ],
      },
    ],
  )
})

await test('includes every contributor in report rows', () => {
  const contributors = Array.from({ length: 8 }, (_, i) => ({
    category: 'Skills',
    name: `skill-${i}`,
    chars: i + 1,
  }))
  const rows = categoryRows([{ name: 'Skills', tokens: 36, percent: 100 }], contributors, {
    Skills: 36,
  })

  assert.deepEqual(
    rows[0]?.items.map((item) => item.name),
    ['skill-7', 'skill-6', 'skill-5', 'skill-4', 'skill-3', 'skill-2', 'skill-1', 'skill-0'],
  )
})

await test('groups report categories under the correct tabs', () => {
  const tabs = (estimate as unknown as { reportCategoryTabs?: (name: string) => string[] })
    .reportCategoryTabs

  assert.equal(typeof tabs, 'function')
  assert.deepEqual(tabs!('Conversation'), ['Overview'])
  assert.deepEqual(tabs!('Skills'), ['Overview', 'Skills'])
  assert.deepEqual(tabs!('Tool outputs & files'), ['Overview', 'Tools'])
  assert.deepEqual(tabs!('MCP & tool definitions'), ['Overview', 'Tools'])
  assert.deepEqual(tabs!('System & instructions'), ['Overview', 'System'])
  assert.deepEqual(tabs!('Unattributed / estimation remainder'), ['Overview'])
})

await test('stops the whole report if compaction occurs while the snapshot loads', async () => {
  const modulePath = '../src/snapshot.ts'
  const { loadVerifiedSnapshot } = await import(modulePath)
  const before = [{ type: 'assistant', time: { created: 11 }, tokens: { input: 100 } }]
  const after = [...before, { type: 'compaction', status: 'completed' }]
  const snapshot = { capturedAt: 10, revision: 2 }
  const result = await loadVerifiedSnapshot(
    before,
    async () => snapshot,
    async () => after,
    () => 'idle',
  )

  assert.equal(result, null)
  let reads = 0
  const late = await loadVerifiedSnapshot(
    before,
    async () => snapshot,
    async () => (++reads === 1 ? before : after),
    () => 'idle',
  )

  assert.equal(late, null)

  assert.deepEqual(
    await loadVerifiedSnapshot(
      before,
      async () => snapshot,
      async () => before,
      () => 'idle',
    ),
    snapshot,
  )
})

await test('a verification error never turns a changed or unverified report into a fallback', async () => {
  const { loadVerifiedSnapshot } = await import('../src/snapshot.ts')
  const before = [{ type: 'assistant', time: { created: 11 }, tokens: { input: 100 } }]
  const after = [...before, { type: 'compaction', status: 'completed' }]
  const snapshot = { capturedAt: 10, revision: 2 }
  let snapshots = 0

  const unreliable = async () => {
    if (++snapshots > 1) {
      throw new Error('RPC unavailable')
    }

    return snapshot
  }

  assert.equal(
    await loadVerifiedSnapshot(
      before,
      unreliable,
      async () => after,
      () => 'idle',
    ),
    null,
  )

  assert.equal(
    await loadVerifiedSnapshot(
      before,
      async () => {
        throw new Error('RPC unavailable')
      },
      async () => before,
      () => 'idle',
    ),
    undefined,
  )

  assert.equal(
    await loadVerifiedSnapshot(
      before,
      async () => snapshot,
      async () => {
        throw new Error('context unavailable')
      },
      () => 'idle',
    ),
    null,
  )
})

await test('rejects a previously matching snapshot when the active context changes', () => {
  const snapshot = { capturedAt: 10, revision: 2 }
  const before = [{ type: 'assistant', id: 'old', tokens: { input: 100 } }]
  const compacted = [...before, { type: 'compaction', status: 'completed' }]
  const nextTurn = [...before, { type: 'assistant', id: 'new', tokens: { input: 200 } }]

  assert.equal(snapshotMatchesUsage(snapshot, snapshot, 11, 'idle', before, before), true)
  assert.equal(snapshotMatchesUsage(snapshot, snapshot, 11, 'idle', before, compacted), false)
  assert.equal(snapshotMatchesUsage(snapshot, snapshot, 11, 'idle', before, nextTurn), false)
  assert.equal(snapshotMatchesUsage(snapshot, snapshot, 11, 'idle', before, undefined), false)
})
