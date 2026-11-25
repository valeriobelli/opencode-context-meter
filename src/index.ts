import { Plugin } from '@opencode/plugin'
import { estimateRequestChars, type RequestChars } from './request.ts'
import { ContextMeter } from './rpc.ts'

export interface RequestSnapshot extends RequestChars {
  readonly capturedAt: number
  readonly revision: number
}

export default Plugin.define({
  id: 'context-meter',
  async setup(ctx) {
    const snapshots = new Map<string, RequestSnapshot>()
    let active = true
    let revision = 0

    await ctx.session.hook('context', (event) => {
      if (!active) {
        return
      }

      const capturedAt = Date.now()

      try {
        snapshots.set(event.sessionID, {
          ...estimateRequestChars(event),
          capturedAt,
          revision: ++revision,
        })
      } catch {
        snapshots.delete(event.sessionID)
      }
    })

    await ctx.session.hook('compaction', (event) => {
      snapshots.delete(event.sessionID)
    })

    await ctx.rpc.register(ContextMeter, {
      composition: async (input) =>
        snapshots.get((input as { sessionID: string }).sessionID) ?? null,
    })

    return () => {
      active = false
      snapshots.clear()
    }
  },
})
