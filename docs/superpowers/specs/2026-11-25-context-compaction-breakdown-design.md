# Post-compaction usage and detailed context composition

## Outcome

The context footer never reuses pre-compaction usage after a completed compaction. `/context` shows a granular, clearly estimated breakdown and explains whether compaction is worth considering; the footer communicates context pressure with color and text.

## Observed problem

OpenCode v2.4.1 returns general session messages separately from the active post-compaction context. The plugin currently selects assistant usage from the general message list in both the footer and report. Immediately after compaction, that assistant message predates the compaction and its prompt total no longer describes the active context.

A completed compaction message also has token usage, but it describes the summarization request. It must not be displayed as the new active-context size. In the reproduced session, the compaction record had 299,516 cache-write tokens while the next primary assistant request had 32,345 input plus cache-read tokens.

The TUI message store reverses the API's newest-first page into chronological order in `packages/client/src/solid/data.ts`; `findLast()` is therefore appropriate. The bug is crossing the compaction boundary, not the direction of that selector.

Sources:

- [OpenCode TUI plugin API](https://opencode.ai/docs/build/plugins/cli)
- [OpenCode server plugin hooks](https://opencode.ai/docs/build/plugins/server#hooks)
- [OpenCode RPC](https://opencode.ai/docs/build/plugins/rpc)
- [OpenCode v2.4.1 session message conversion](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/runner/to-llm-message.ts)
- [OpenCode v2.4.1 instruction metadata](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/model-request.ts)

## Decisions

- Use category rows rather than per-MCP-server rows (user selected **Category rows (Recommended)**).
- Add a server companion to the existing TUI plugin. A TUI-only implementation cannot reliably isolate MCP and tool definitions.
- After a completed compaction, show `ctx --` until the next assistant message reports prompt usage. Never reuse the pre-compaction total or interpret compaction usage as active-context usage (user approved **Approve behavior (Recommended)**).
- Use six estimated rows when the server snapshot is available: **Conversation**, **Tool outputs & files**, **Skills**, **MCP & tool definitions**, **System & instructions**, and **Unattributed / estimation remainder**.
- Combine MCP and built-in tool definitions because Code Mode aggregates tools and does not support reliable per-server accounting.
- Keep all processing local. Store and return only aggregate character counts, never prompt, skill, message, or tool-schema content.
- Enable the server part through the existing global `opencode.jsonc` plugin list. Preserve the existing TUI-only discovery and provide a local fallback when RPC is unavailable.
- Do not publish to npm, add provider-specific tokenizers, modify compaction, or add a Desktop GUI integration.
- Implement the approved server/TUI design with regression tests and smoke checks (user approved **Approve design (Recommended)**).
- Use advisory, deterministic rules only; do not invoke an AI model or compact automatically (user selected **Advisory only (Recommended)** and **Rules first (Recommended)**).
- Use visual layout B: pressure, auto-compaction threshold, possible benefit, reasons, and composition; pair footer color with text (user: **We can go with B**).
- Warn at 80% and show urgent at 95% of the estimated automatic compaction threshold (user selected **Early (Recommended)**).
- If fixed instructions and tool definitions dominate, preserve the pressure color and explain that compaction may free little, suggesting smaller fixed context (user selected **Warn and explain (Recommended)**).

## Architecture and data flow

### Compaction boundary

Add a pure usage-selection helper that examines chronological session messages:

- Select the latest assistant message with prompt usage only if no completed compaction follows it.
- If a completed compaction is newer, return no prompt tokens while retaining enough model information to resolve the context limit when possible.
- A running or failed compaction does not erase the last valid primary usage.
- The footer reads the reactive TUI message store and therefore changes to `ctx --` when the completed compaction arrives, then recovers on the next assistant usage record.
- `/context` applies the same selection to active messages returned by `session.context`, not to the general pre-compaction history.

### Server snapshot

Add `src/index.ts`, `src/rpc.ts`, and a pure hidden-request estimator:

1. Register a `context` session hook for primary agent-loop requests.
2. Measure the actual outgoing `system` sources and `tools` record. Do not modify the request.
3. Classify `core/skill-guidance` as skill catalog characters; `core/codemode` and `core/mcp-guidance` plus serialized direct tool definitions as MCP/tool-definition characters; all other system sources as system characters.
4. When instruction metadata is present, measure its individual `{ key, text }` entries instead of also measuring the containing system part, avoiding double counting. Measure system parts without source metadata directly.
5. Keep the latest aggregate snapshot per session in memory. Clear a session snapshot when its compaction hook starts so a summarization request cannot become the latest primary snapshot.
6. Expose a `composition(sessionID)` RPC method whose output contains only numeric aggregate counts and an optional snapshot revision/timestamp. Clear in-memory state on plugin unload.

### TUI composition

Extend active-message collection to separate:

- user, synthetic, assistant text/reasoning, and completed compaction summary content into conversation;
- assistant tool calls/results, shell content, and attachments into tool outputs and files;
- active `skill` messages into skills;
- active `system` messages into system instructions.

When the server snapshot is available, add its skill catalog, MCP/tool definitions, and system counts to the corresponding visible counts. Convert characters to estimated tokens with the existing approximate four-characters-per-token rule. Scale category estimates proportionally if their sum exceeds the reported prompt total, assign any remaining tokens to **Unattributed / estimation remainder**, and keep token and percentage totals bounded and consistent.

When RPC is unavailable or no primary snapshot exists, retain a local-only report, omit server-only claims, and state that hidden skill catalogs, MCP/tool definitions, and system sources remain in the unaccounted remainder. RPC failure must not prevent the local report or footer from working.

Update the report explanation to distinguish reported prompt tokens from character-based category estimates. Model-limit lookup, footer formatting, and unrelated plugin behavior stay unchanged.

### Compaction advice

The footer presents a text label and a theme-appropriate green, amber, or red color. With a known automatic threshold, calculate pressure as the latest valid prompt usage divided by the estimated threshold: below 80% is green, 80% to under 95% is amber, and 95% or above is red. The threshold follows the effective location configuration, model input/context limits, and the installed OpenCode version's buffer semantics, including the default minimum reserve and token-count buffers. Automatic compaction disabled is explicitly shown as disabled; never describe an automatic threshold as active in that case. If configuration, limits, or fresh usage are unavailable, show an unknown state instead of inventing a threshold or color classification. These are approximate plugin warnings, not OpenCode's authoritative compaction decision: OpenCode estimates unmeasured recent content and can trigger for provider overflow.

The `/context` modal uses layout B. Show context pressure, estimated automatic threshold when available, a potential-benefit description, and concrete reasons before the category rows. When measured fixed system instructions and tool definitions exceed half of the estimated prompt, say compaction may free little and suggest reducing fixed context. Otherwise, when estimated conversation plus tool output exceeds half of the prompt, say history may shrink and suggest considering compaction if pressure is amber or red. If neither signal is reliable or sufficient, say potential benefit is unknown. These deliberately simple, approximate rules do not imply exact savings, relevance, or a guarantee that compaction will help: OpenCode retains recent content and summary size is unknown. Only evaluate composition-based advice for a fresh, matching primary-request snapshot; otherwise show unknown rather than applying the rules to a stale or incomplete breakdown. The plugin never initiates compaction.

Source: [OpenCode compaction documentation](https://opencode.ai/docs/compaction) and [v2.4.1 compaction estimator](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/session/compaction.ts).

## Configuration and documentation

- Export the package root as `./src/index.ts`, retain `./tui`, and expose `./rpc` as `./src/rpc.ts` in `package.json`.
- Add the absolute local plugin directory to the existing global `opencode.jsonc` `plugins` array without changing unrelated settings. Reload OpenCode through its normal configuration reload behavior.
- Update `README.md` with the optional TUI-only fallback, full server-backed installation, category meanings, compaction behavior, and estimation/privacy limitations.
- Add one minor Changeset covering the compaction fix and detailed composition. Do not add an npm publish step.

## Error handling and privacy

- A failed active-context request keeps the existing cached-message fallback.
- A failed or unavailable RPC request falls back to the local composition without turning the whole `/context` command into an error.
- Compaction and primary-request snapshots are session-scoped. Compaction requests never replace primary snapshots.
- The hook does not mutate request data. RPC schemas allow aggregate numeric fields only; no text from system sources, skills, messages, files, or tool schemas is retained or returned.
- Global configuration edits are limited to adding this plugin's path.

## Acceptance checks

- A completed compaction prevents older assistant usage from being selected, while later assistant usage restores the meter — unit: `test/estimate.check.ts` `#compaction-usage-regression`
- The footer shows `ctx --` after a fresh compaction and a measured percentage after the next assistant response — manual: disposable-session OpenCode PTY smoke check `#compaction-footer-smoke`
- `/context` reports the six approved categories with bounded token and percentage totals when server data is available — unit: `test/estimate.check.ts` and `test/request.check.ts` `#category-accounting`
- The loaded global plugin displays the detailed composition in an active session and retains a usable fallback without the server snapshot — manual: OpenCode PTY smoke checks `#detailed-report-and-fallback`
- RPC output contains aggregate counts only and no prompt, skill, message, file, or tool-schema text — integration: RPC schema and live response inspection `#aggregate-only-rpc`
- The footer uses labeled pressure colors and the modal explains compaction advice, including limited benefit and unknown data — manual: OpenCode PTY smoke checks `#compaction-advice-ui`
- Rules respect effective buffer settings, automatic compaction disabled, threshold boundaries, stale snapshots, and missing inputs — unit: compaction-advice tests `#compaction-advice-rules`
- Formatting, linting, type checking, unit tests, and Fallow pass — unit: `pnpm run check` `#repository-checks`

## Tasks

### Start

- [x] Reproduce the stale post-compaction value and inspect OpenCode v2.4.1 APIs and source `#investigate-compaction`

### Plan

- [x] Confirm category granularity and server/TUI behavior `#confirm-breakdown-design`
- [x] Write and self-review the design `#write-breakdown-design`
- [ ] User reviews the written design `#user-breakdown-spec-review`

### Build

- [ ] Fix the post-compaction usage boundary `#fix-compaction-boundary`
  - [ ] Add a failing completed-compaction regression test first `#compaction-test-first`
  - [ ] Implement shared usage selection and wire footer/report callers `#compaction-selection`
- [ ] Add the aggregate server snapshot `#add-server-snapshot`
  - [ ] Add failing hidden-source classification tests first `#request-test-first`
  - [ ] Implement the primary hook, compaction invalidation, and aggregate RPC `#server-rpc-implementation`
  - [ ] Export package parts and enable the global server plugin `#package-and-global-config`
- [ ] Expand the `/context` composition `#expand-context-report`
  - [ ] Add failing active-message and proportional-allocation tests first `#category-test-first`
  - [ ] Combine active messages with server counts and implement local fallback `#combine-composition`
  - [ ] Update README and add a minor Changeset `#docs-and-changeset`
- [ ] Add compaction advice and accessible pressure colors `#compaction-advice`
  - [ ] Write failing tests for thresholds, benefit signals, and unknown data `#advice-test-first`
  - [ ] Implement rule-based pressure and benefit explanations `#advice-rules`
  - [ ] Render the labeled colored footer and modal advice `#advice-ui`
- [ ] Run preliminary checks and commit the implementation on `main` `#commit-breakdown`

### Test

- [ ] Run `pnpm run check` at the implementation commit `#run-repository-checks`
- [ ] Run active, no-session, freshly compacted, and fallback OpenCode PTY smoke checks `#run-tui-smoke-checks`
- [ ] Inspect the live RPC response and global configuration diff `#verify-privacy-and-config`

### Review

- [ ] User reviews and approves the compaction fix and detailed report `#user-breakdown-outcome-review`

## Verification plan

1. Write focused failing tests for the compaction boundary, hidden-source classification, active-message categories, and allocation edge cases before each implementation change.
2. Run `pnpm run check` and inspect the final diff, ensuring the pre-existing workflow-lock edits remain separate.
3. Exercise the globally loaded plugin from an unrelated directory for an active session and no session.
4. Use a disposable session for compaction so the check does not alter the user's ongoing conversation. Confirm `ctx --` immediately after compaction and restored usage after the next assistant response.
5. Verify detailed `/context` output with the server part enabled and local fallback with it unavailable. Inspect the RPC JSON and global config diff for aggregate-only data and a single plugin entry.
