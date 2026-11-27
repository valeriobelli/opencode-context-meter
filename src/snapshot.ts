import { findAssistantUsage, snapshotMatchesUsage, type PromptTokens } from './estimate.ts'

export async function loadVerifiedSnapshot<
  T extends { readonly capturedAt: number; readonly revision: number },
  M extends {
    readonly type: string
    readonly status?: string
    readonly tokens?: PromptTokens
    readonly time: { readonly created: number }
  },
>(
  messages: readonly M[],
  readSnapshot: () => Promise<T | null>,
  readMessages: () => Promise<unknown>,
  status: () => 'idle' | 'running',
): Promise<T | null | undefined> {
  const snapshot = await readSnapshot().catch(() => null)
  const currentMessages = await readMessages().catch(() => undefined)

  if (
    !Array.isArray(currentMessages) ||
    JSON.stringify(messages) !== JSON.stringify(currentMessages)
  ) {
    return null
  }

  const latest = snapshot ? await readSnapshot().catch(() => null) : null
  const finalMessages = await readMessages().catch(() => undefined)

  if (!Array.isArray(finalMessages) || JSON.stringify(messages) !== JSON.stringify(finalMessages)) {
    return null
  }

  return snapshotMatchesUsage(
    snapshot,
    latest,
    findAssistantUsage(messages)?.time.created,
    status(),
    messages,
    finalMessages,
  )
    ? (snapshot ?? undefined)
    : undefined
}
