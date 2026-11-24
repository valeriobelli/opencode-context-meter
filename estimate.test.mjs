import test from "node:test"
import assert from "node:assert/strict"
import { collectMessageChars, estimateComposition, promptTokensFromUsage } from "./estimate.mjs"

test("allocates reported prompt tokens across visible and residual categories", () => {
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
        { name: "Conversation (estimated)", tokens: 30, percent: 30 },
        { name: "Tools and files (estimated)", tokens: 20, percent: 20 },
        { name: "System and instructions (estimated)", tokens: 50, percent: 50 },
      ],
    },
  )
})

test("does not fabricate a context percentage when usage or the limit is missing", () => {
  assert.equal(
    estimateComposition({ promptTokens: undefined, contextLimit: 200, conversationChars: 120, toolChars: 80 })
      .contextPercent,
    undefined,
  )
  assert.equal(
    estimateComposition({ promptTokens: 100, contextLimit: undefined, conversationChars: 120, toolChars: 80 })
      .contextPercent,
    undefined,
  )
})

test("clamps visible category estimates to the reported prompt total", () => {
  const result = estimateComposition({
    promptTokens: 8,
    contextLimit: 10,
    conversationChars: 400,
    toolChars: 400,
  })

  assert.equal(result.categories.reduce((total, category) => total + category.tokens, 0), 8)
  assert.equal(result.categories.reduce((total, category) => total + category.percent, 0), 100)
  assert.ok(result.categories.every((category) => category.tokens >= 0))
})

test("collects prompt tokens and visible character counts from active session messages", () => {
  assert.equal(promptTokensFromUsage({ input: 20, cache: { read: 70, write: 10 }, output: 9, reasoning: 3 }), 100)
  assert.deepEqual(
    collectMessageChars([
      { type: "user", text: "hello", files: [{ data: "1234" }] },
      {
        type: "assistant",
        content: [
          { type: "text", text: "world" },
          { type: "tool", state: { input: { a: 1 }, content: [{ type: "text", text: "output" }] } },
        ],
      },
    ]),
    { conversationChars: 10, toolChars: 17 },
  )
})
