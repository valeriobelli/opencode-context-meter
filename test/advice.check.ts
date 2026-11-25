import assert from 'node:assert/strict'
import test from 'node:test'
import { compactionPressure, compactionBenefit, effectiveCompactionConfig } from '../src/advice.ts'

await test('merges compaction config entries in OpenCode order', () => {
  assert.deepEqual(
    effectiveCompactionConfig([
      { type: 'document', info: { compaction: { auto: false, buffer: 100 } } },
      { type: 'document', info: { compaction: { buffer: '20%' } } },
    ]),
    { auto: false, buffer: '20%' },
  )
  assert.deepEqual(effectiveCompactionConfig([]), {})
})

const limits = { context: 200_000, input: 0 }
const config = {}

await test('uses the effective input window and OpenCode default reserve', () => {
  assert.equal(compactionPressure({ config, limits, promptTokens: 0 }).threshold, 170_000)

  assert.equal(
    compactionPressure({ config, limits: { context: 100_000, input: 80_000 }, promptTokens: 0 })
      .threshold,
    64_000,
  )

  assert.equal(
    compactionPressure({ config, limits: { context: 30_000 }, promptTokens: 0 }).threshold,
    25_500,
  )

  assert.equal(
    compactionPressure({ config, limits: { context: 32_000 }, promptTokens: 0 }).threshold,
    16_000,
  )

  assert.equal(
    compactionPressure({ config, limits: { context: 0, input: 100_000 }, promptTokens: 0 })
      .threshold,
    84_000,
  )
})

await test('respects token and percentage buffers including fallback when too large', () => {
  const threshold = (buffer: number | string) =>
    compactionPressure({ config: { buffer }, limits, promptTokens: 0 }).threshold

  assert.equal(threshold('12.5%'), 175_000)
  assert.equal(threshold('1%'), 198_000)
  assert.equal(threshold(20_000), 180_000)
  assert.equal(threshold(0), 200_000)
  assert.equal(threshold(200_000), 170_000)
  assert.equal(threshold(300_000), 170_000)

  assert.equal(
    compactionPressure({ config: { buffer: '12.5%' }, limits: { context: 101 }, promptTokens: 0 })
      .threshold,
    88,
  )
})

await test('preserves buffer rounding and fallback at the window boundary', () => {
  const threshold = (buffer: number | string) =>
    compactionPressure({ config: { buffer }, limits: { context: 100 }, promptTokens: 0 }).threshold

  assert.equal(threshold('12.5%'), 87)
  assert.equal(threshold('99.9%'), 85)
  assert.equal(threshold(100), 85)
})

await test('classifies unrounded pressure at 80% and 95% boundaries', () => {
  const status = (promptTokens: number) =>
    compactionPressure({ config: { buffer: 0 }, limits: { context: 1000 }, promptTokens }).status

  assert.equal(status(799), 'low')
  assert.equal(status(800), 'warning')
  assert.equal(status(949), 'warning')
  assert.equal(status(950), 'urgent')
  assert.equal(status(1200), 'urgent')
})

await test('reports disabled and unknown instead of inventing classification', () => {
  assert.deepEqual(compactionPressure({ config: { auto: false }, limits, promptTokens: 160_000 }), {
    status: 'disabled',
  })
  assert.equal(compactionPressure({ config: undefined, limits, promptTokens: 1 }).status, 'unknown')
  assert.equal(compactionPressure({ config, limits: undefined, promptTokens: 1 }).status, 'unknown')

  assert.equal(
    compactionPressure({ config, limits: { context: 0, input: 0 }, promptTokens: 1 }).status,
    'unknown',
  )
  assert.equal(compactionPressure({ config, limits, promptTokens: undefined }).status, 'unknown')
  assert.equal(compactionPressure({ config, limits, promptTokens: -1 }).status, 'unknown')

  assert.equal(
    compactionPressure({ config: { buffer: 'banana' }, limits, promptTokens: 1 }).status,
    'unknown',
  )

  assert.equal(
    compactionPressure({ config: { buffer: -1 }, limits, promptTokens: 1 }).status,
    'unknown',
  )
})

await test('keeps invalid inputs unknown and retains a valid threshold without prompt usage', () => {
  assert.deepEqual(
    compactionPressure({ config: { auto: false }, limits: undefined, promptTokens: -1 }),
    {
      status: 'disabled',
    },
  )

  assert.deepEqual(
    compactionPressure({ config: { auto: null as unknown as boolean }, limits, promptTokens: 1 }),
    { status: 'unknown' },
  )

  for (const context of [-1, NaN, Infinity]) {
    assert.deepEqual(compactionPressure({ config, limits: { context }, promptTokens: 1 }), {
      status: 'unknown',
    })
  }

  for (const buffer of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '0%', '100%', '1.']) {
    assert.deepEqual(compactionPressure({ config: { buffer }, limits, promptTokens: 1 }), {
      status: 'unknown',
    })
  }

  for (const promptTokens of [undefined, -1, NaN, Infinity]) {
    assert.deepEqual(compactionPressure({ config, limits, promptTokens }), {
      status: 'unknown',
      threshold: 170_000,
    })
  }
})

const composition = {
  promptTokens: 100,
  systemTokens: 30,
  definitionTokens: 21,
  conversationTokens: 20,
  toolTokens: 20,
  fresh: true,
}

await test('fixed context above half takes precedence and suggests reducing it', () => {
  assert.deepEqual(
    compactionBenefit({ ...composition, conversationTokens: 80, pressure: 'urgent' }),
    {
      kind: 'fixed',
      reason:
        'Fixed system instructions and tool definitions exceed half of the prompt; compaction may free little.',
      suggestion: 'Consider reducing fixed context.',
    },
  )
})

await test('history above half can shrink, suggesting compaction only under pressure', () => {
  const input = {
    ...composition,
    systemTokens: 10,
    definitionTokens: 10,
    conversationTokens: 30,
    toolTokens: 21,
  }

  assert.deepEqual(compactionBenefit({ ...input, pressure: 'warning' }), {
    kind: 'history',
    reason: 'Conversation and tool outputs exceed half of the prompt; history may shrink.',
    suggestion: 'Consider compaction.',
  })

  assert.equal(
    compactionBenefit({ ...input, pressure: 'urgent' }).suggestion,
    'Consider compaction.',
  )
  assert.equal(compactionBenefit({ ...input, pressure: 'low' }).suggestion, undefined)
  assert.equal(compactionBenefit({ ...input, pressure: 'unknown' }).suggestion, undefined)
  assert.equal(compactionBenefit({ ...input, pressure: 'disabled' }).suggestion, undefined)
})

await test('benefit is unknown for exactly half, stale snapshots and incomplete or invalid counts', () => {
  assert.equal(
    compactionBenefit({
      ...composition,
      systemTokens: 30,
      definitionTokens: 20,
      conversationTokens: 30,
      toolTokens: 20,
      pressure: 'warning',
    }).kind,
    'unknown',
  )

  assert.equal(
    compactionBenefit({ ...composition, fresh: false, pressure: 'urgent' }).kind,
    'unknown',
  )

  assert.equal(
    compactionBenefit({ ...composition, promptTokens: 0, pressure: 'urgent' }).kind,
    'unknown',
  )

  assert.equal(
    compactionBenefit({ ...composition, systemTokens: undefined, pressure: 'urgent' }).kind,
    'unknown',
  )

  assert.equal(
    compactionBenefit({ ...composition, toolTokens: NaN, pressure: 'urgent' }).kind,
    'unknown',
  )

  assert.equal(
    compactionBenefit({ ...composition, definitionTokens: -1, pressure: 'urgent' }).kind,
    'unknown',
  )
})
