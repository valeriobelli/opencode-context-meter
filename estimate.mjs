export function promptTokensFromUsage(tokens) {
  if (!tokens) return undefined
  const total = (tokens.input ?? 0) + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
  return Number.isFinite(total) && total >= 0 ? total : undefined
}

export function collectMessageChars(messages) {
  let conversationChars = 0
  let toolChars = 0

  for (const message of messages ?? []) {
    if (!message || typeof message !== "object") continue
    if (message.type === "user" || message.type === "synthetic") {
      conversationChars += (message.text ?? "").length
      for (const file of message.files ?? []) toolChars += (file?.data ?? "").length
      continue
    }
    if (message.type === "shell") {
      toolChars += (message.command ?? "").length + (message.output?.output ?? "").length
      continue
    }
    if (message.type !== "assistant") continue
    for (const part of message.content ?? []) {
      if (part?.type === "text" || part?.type === "reasoning") {
        conversationChars += (part.text ?? "").length
      } else if (part?.type === "tool") {
        toolChars += JSON.stringify(part.state?.input ?? "").length
        for (const item of part.state?.content ?? []) {
          toolChars += item?.type === "text" ? (item.text ?? "").length : (item?.uri ?? "").length
        }
      }
    }
  }

  return { conversationChars, toolChars }
}

const estimateTokens = (characters) => Math.ceil((Number.isFinite(characters) ? Math.max(0, characters) : 0) / 4)

// shortcut: ~4 chars/token approximation instead of a model-specific tokenizer; upgrade if exact per-provider tokenizers are needed.
export function estimateComposition({ promptTokens, contextLimit, conversationChars, toolChars }) {
  const totalTokens = Number.isFinite(promptTokens) && promptTokens >= 0 ? Math.round(promptTokens) : undefined
  const contextPercent =
    totalTokens !== undefined && Number.isFinite(contextLimit) && contextLimit > 0
      ? Math.round((totalTokens / contextLimit) * 100)
      : undefined

  if (totalTokens === undefined) return { totalTokens, contextPercent, categories: [] }

  const conversationEstimate = estimateTokens(conversationChars)
  const toolEstimate = estimateTokens(toolChars)
  const visibleEstimate = conversationEstimate + toolEstimate
  const scale = visibleEstimate > totalTokens && visibleEstimate > 0 ? totalTokens / visibleEstimate : 1
  const conversation = Math.round(conversationEstimate * scale)
  const tools = Math.min(totalTokens - conversation, Math.round(toolEstimate * scale))
  const system = totalTokens - conversation - tools
  const conversationPercent = totalTokens > 0 ? Math.round((conversation / totalTokens) * 100) : 0
  const toolPercent = totalTokens > 0 ? Math.round((tools / totalTokens) * 100) : 0

  return {
    totalTokens,
    contextPercent,
    categories: [
      { name: "Conversation (estimated)", tokens: conversation, percent: conversationPercent },
      { name: "Tools and files (estimated)", tokens: tools, percent: toolPercent },
      {
        name: "System and instructions (estimated)",
        tokens: system,
        percent: totalTokens > 0 ? 100 - conversationPercent - toolPercent : 0,
      },
    ],
  }
}
