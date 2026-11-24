# Global OpenCode Context Meter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a globally discovered OpenCode v2 TUI plugin with a compact context meter and an estimated `/context` report.

**Architecture:** Keep the plugin as a local TUI entrypoint at the global plugin discovery path. Put the pure text-to-token estimate in a dependency-free `.mjs` helper so Node's built-in test runner can check it. The TUI entry reads the active session/model data exposed by OpenCode, derives visible conversation and tool-output estimates, and presents provider usage totals when available; it labels category counts as estimates and does not transmit data.

**Tech Stack:** OpenCode v2 TUI plugin API, TypeScript/TSX plugin entrypoint, dependency-free JavaScript helper, Node.js `node:test`.

---

## File structure

- Create `tui.tsx` — register a status contribution in the active prompt footer and a `/context` slash command using the OpenCode TUI plugin API.
- Create `estimate.mjs` — pure estimate and formatting-data helper, independent of OpenCode APIs.
- Create `estimate.test.mjs` — focused tests with `node:test` and `node:assert/strict`.
- Modify `docs/superpowers/specs/2026-11-24-global-opencode-context-meter-design.md` only when implementation decisions or status change.

No package installation or unrelated `cli.json` / `opencode.jsonc` changes: OpenCode v2 discovers global local plugins from `~/.config/opencode/plugins/<name>/tui.ts[x]`.

### Task 1: Add and test the estimator

**Files:** Create `estimate.test.mjs`, `estimate.mjs`.

- [ ] **Step 1: Write the failing test** in `estimate.test.mjs`:

```js
import test from "node:test"
import assert from "node:assert/strict"
import { estimateComposition } from "./estimate.mjs"

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
        { name: "Conversation", tokens: 30, percent: 30 },
        { name: "Tools and files", tokens: 20, percent: 20 },
        { name: "System and instructions (estimated)", tokens: 50, percent: 50 },
      ],
    },
  )
})

test("returns no meter percentage when usage or the context limit is unavailable", () => {
  assert.equal(
    estimateComposition({ promptTokens: undefined, contextLimit: undefined, conversationChars: 0, toolChars: 0 })
      .contextPercent,
    undefined,
  )
})
```

- [ ] **Step 2: Verify the test fails because the helper is missing**

Run: `node --test estimate.test.mjs`
Expected: non-zero exit with `ERR_MODULE_NOT_FOUND` for `./estimate.mjs`.

- [ ] **Step 3: Implement the minimal pure helper** in `estimate.mjs`.

Export `estimateComposition({ promptTokens, contextLimit, conversationChars, toolChars })`. Estimate visible text tokens as `Math.ceil(chars / 4)`, clamp reported visible categories to the reported prompt total, assign the remaining prompt tokens to the system/instructions estimate, and calculate whole-number percentages against the prompt total. If provider usage or a positive context limit is missing, return undefined meter percentage; do not fabricate a total. Guard zero-total input and keep returned category percentages bounded and summing to 100 when a positive prompt total exists.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test estimate.test.mjs`
Expected: both named tests pass.

- [ ] **Step 5: Add an edge-case test before extending the helper**

Add an assertion that conversation/tool estimates are clamped when their rough character estimate exceeds the reported prompt tokens, then run the test and confirm it fails before changing `estimate.mjs`.

- [ ] **Step 6: Implement the smallest clamp/rounding correction**

Keep the helper's three categories non-negative and ensure their integer percentages sum to 100 for a positive total. Re-run `node --test estimate.test.mjs`; expected: all tests pass.

### Task 2: Add the global TUI meter and command

**Files:** Create `tui.tsx`; import `estimateComposition` from `./estimate.mjs`.

- [ ] **Step 1: Read the installed OpenCode v2 TUI plugin declarations and confirm the exact message/model usage fields** exposed by `context.data.session.message.list/get` and `context.data.location.model.list`. Do not add an SDK dependency; the runtime resolves `@opencode/plugin/tui`.
- [ ] **Step 2: Implement the plugin entrypoint** using `Plugin.define` from `@opencode/plugin/tui`:
  - Append a compact `context NN%` status string to `prompt.footer.status` when the active session has a reported prompt-token total and selected-model context limit; otherwise show a short unavailable marker without throwing.
  - Register a `/context` slash command through `context.keymap.layer`.
  - For `/context`, read the active session's available messages, group visible user/assistant text as conversation and tool-result text as tools/files, and pass their character counts plus the latest assistant usage total/context limit to `estimateComposition`.
  - Show the three estimated categories, total/window usage, and the `~` estimate marker. If session, usage, or model metadata is absent, explain that complete category estimates are unavailable rather than displaying fabricated numbers.
  - Catch data lookup failures within the plugin command/status path so they do not break the TUI; keep session text in memory only and never log or send it externally.
- [ ] **Step 3: Run `node --test estimate.test.mjs`**; expected: all estimator tests pass.
- [ ] **Step 4: Inspect `tui.tsx` against the installed declarations** and run the OpenCode plugin load/type validation available in v2.3.2; resolve all import/API/type errors before committing.

### Task 3: Verify and commit

**Files:** `tui.tsx`, `estimate.mjs`, `estimate.test.mjs`, and the approved design spec.

- [ ] **Step 1: Run the focused test suite**

Run: `node --test estimate.test.mjs`
Expected: all tests pass with exit code 0.

- [ ] **Step 2: Smoke-test the global plugin**

Start OpenCode in the TUI and confirm the global footer contribution appears, `/context` is listed/runs, output marks composition as estimated, and missing-data behavior is safe. Check the OpenCode log for plugin load/runtime errors without copying or exposing session contents.

- [ ] **Step 3: Inspect the diff**

Run: `git status --short` and `git diff --check`.
Expected: only the plugin entry, estimator/helper tests, and design documentation are changed; `git diff --check` prints no errors.

- [ ] **Step 4: Commit the verified plugin**

```sh
git add tui.tsx estimate.mjs estimate.test.mjs docs/superpowers/specs/2026-11-24-global-opencode-context-meter-design.md docs/superpowers/plans/2026-11-24-global-opencode-context-meter.md
git commit -m "feat: add global OpenCode context meter"
```

## Self-review

- Spec coverage: global plugin discovery, compact footer meter, `/context`, estimated categories, local-only processing, missing-usage fallback, tests, and a global TUI smoke check are covered above.
- Placeholder scan: no TBD/TODO or unspecified implementation task remains; the one v2.3.2 API inspection step is required before selecting exact fields.
- Type consistency: `estimateComposition` receives provider prompt tokens, context limit, and character counts; the TUI adapter owns extraction and formatting.
