// @jsxImportSource @opentui/solid
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { SessionMessageInfo } from "@opencode/client"
import { collectMessageChars, estimateComposition, promptTokensFromUsage } from "./estimate.mjs"

type TuiContext = ReturnType<typeof usePlugin>

const bar = (percent: number) => {
  const filled = Math.max(0, Math.min(8, Math.round((percent / 100) * 8)))
  return `${"▰".repeat(filled)}${"▱".repeat(8 - filled)}`
}

const formatTokens = (tokens: number) =>
  tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : tokens >= 1000
      ? `${(tokens / 1000).toFixed(1)}k`
      : `${tokens}`

function modelLabelFor(modelRef?: { readonly providerID: string; readonly modelID?: string; readonly id?: string }) {
  if (!modelRef) return undefined
  const modelID = modelRef.modelID ?? modelRef.id
  if (!modelID) return modelRef.providerID
  return modelID.startsWith(`${modelRef.providerID}/`) ? modelID : `${modelRef.providerID}/${modelID}`
}

function currentSessionID(context: TuiContext) {
  const route = context.ui.router.current()
  return route.type === "session" ? route.sessionID : undefined
}

function resolveUsageAndLimit(context: TuiContext, sessionID: string | undefined) {
  if (!sessionID) return {}
  const session = context.data.session.get(sessionID)
  const messages = context.data.session.message.list(sessionID)
  let assistant: Extract<SessionMessageInfo, { readonly type: "assistant" }> | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.type === "assistant" && message.tokens) {
      assistant = message
      break
    }
  }
  const promptTokens = promptTokensFromUsage(assistant?.tokens)
  const modelRef: { readonly providerID: string; readonly modelID?: string; readonly id?: string } | undefined =
    context.ui.model.current() ?? assistant?.model ?? session?.model
  const modelID = modelRef?.modelID ?? modelRef?.id
  const models = context.data.location.model.list(context.location) ?? []
  const model =
    modelRef && modelID
      ? models.find(
          (item) =>
            item.providerID === modelRef.providerID && (item.id === modelID || item.modelID === modelID),
        )
      : undefined
  return {
    session,
    messages,
    promptTokens,
    contextLimit: model?.limit?.context,
    modelLabel: modelLabelFor(modelRef),
  }
}

function formatReport(
  report: ReturnType<typeof estimateComposition>,
  modelLabel: string | undefined,
  contextLimit: number | undefined,
) {
  if (report.totalTokens === undefined) {
    return "No prompt token usage is available yet for this session. Send a prompt or wait for a response, then run /context again."
  }
  const windowInfo =
    report.contextPercent !== undefined && contextLimit
      ? `${formatTokens(report.totalTokens)} / ${formatTokens(contextLimit)} (${report.contextPercent}%)`
      : `${formatTokens(report.totalTokens)} prompt tokens (model limit unavailable)`
  const lines = [
    `${modelLabel ?? "Current model"} · ${windowInfo}`,
    "",
    ...report.categories.map(
      (cat) => `~ ${cat.name}: ~${formatTokens(cat.tokens)} (${cat.percent}%)`,
    ),
    "",
    "Estimates only: conversation and tool sizes use local character/4 approximations subtracted from the latest reported prompt tokens; hidden system prompts, agent definitions, and skills make up the remainder.",
  ]
  return lines.join("\n")
}

export default Plugin.define({
  id: "valerio.context-meter",
  setup(context) {
    const location = context.location ?? context.data.location.default()
    void context.data.location.model.sync(location).catch(() => {})

    const stopSlot = context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        try {
          const sessionID = input.sessionID ?? currentSessionID(context)
          const { promptTokens, contextLimit } = resolveUsageAndLimit(context, sessionID)
          const report = estimateComposition({ promptTokens, contextLimit, conversationChars: 0, toolChars: 0 })
          const label =
            report.contextPercent !== undefined
              ? `ctx ${report.contextPercent}% ${bar(report.contextPercent)}`
              : report.totalTokens !== undefined
                ? `ctx ${formatTokens(report.totalTokens)}`
                : "ctx --"
          return <text fg={context.theme.text.muted}>{label}</text>
        } catch {
          return <text fg={context.theme.text.muted}>ctx --</text>
        }
      },
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "context-meter.show",
          title: "Show estimated context composition",
          group: "Context",
          palette: true,
          slash: { name: "context" },
          run: async () => {
            try {
              const sessionID = currentSessionID(context)
              if (!sessionID) {
                await context.ui.dialog.alert({
                  title: "Context composition (estimated)",
                  message: "Open a session first, then run /context.",
                })
                return
              }
              await Promise.allSettled([
                context.data.session.sync(sessionID),
                context.data.session.message.sync(sessionID),
                context.data.location.model.sync(location),
              ])
              let activeMessages: SessionMessageInfo[] = []
              try {
                const res = await context.client.session.context({ sessionID })
                activeMessages = Array.isArray(res) ? res : []
              } catch {
                activeMessages = context.data.session.message.list(sessionID)
              }
              const { promptTokens, contextLimit, modelLabel } = resolveUsageAndLimit(context, sessionID)
              const { conversationChars, toolChars } = collectMessageChars(activeMessages)
              const report = estimateComposition({ promptTokens, contextLimit, conversationChars, toolChars })
              await context.ui.dialog.alert({
                title: "Context composition (estimated)",
                message: formatReport(report, modelLabel, contextLimit),
              })
            } catch {
              context.ui.toast.show({
                title: "Context meter",
                message: "Unable to read context usage for this session.",
                variant: "warning",
              })
            }
          },
        },
      ],
    }))

    return () => stopSlot()
  },
})
