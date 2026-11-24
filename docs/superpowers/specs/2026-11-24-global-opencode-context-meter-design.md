# Global OpenCode Context Meter — Design

**Status:** Implemented; running final verification on `master`.

## Goal

Add a globally available OpenCode TUI context meter and an on-demand `/context` report with an estimated composition similar to Claude Desktop's context display.

## User decisions

- UI: selected **A**, a compact status meter plus an on-demand report.
- Accuracy: category composition may be **estimated**, like Claude Desktop.
- Scope: global OpenCode installation.

## Proposed implementation

Create a small native OpenCode v2 TUI-only plugin under the global config directory:

`~/.config/opencode/plugins/context-meter/tui.tsx`

Use the supported TUI plugin interfaces to add a compact usage indicator in the TUI footer and a `/context` slash command that presents the category estimates as counts and percentages. Follow the installed OpenCode v2.3.2 APIs and the current global plugin discovery rules. Do not add a Desktop GUI part or change unrelated configuration.

## Breakdown and limitations

Show estimates for:

- system, project, and skill instructions;
- conversation history;
- tool output and attached/file context.

Use the current session data and available model usage metadata. Where OpenCode does not expose a prompt section directly, report an estimate rather than implying exact accounting. State the basis/limitations in `/context`. No session contents are sent outside the local OpenCode process.

## Out of scope

- Desktop GUI integration.
- Context pruning, compaction, or prompt modification.
- Exact accounting of hidden provider/OpenCode prompt sections.
- Telemetry, remote services, or new broad configuration options.

## Acceptance checks

- The plugin loads from the user's global OpenCode configuration and is available across projects — manual: global plugin load `#the-plugin-loads-from-the-user-s-global-opencode`
- The TUI footer shows a compact current-session context meter when usage data is available, with a safe fallback when it is not — manual: footer meter `#the-tui-footer-shows-a-compact-current-session-c`
- `/context` displays estimated category counts and percentages and clearly identifies them as estimates — manual: context report `#context-displays-estimated-category-counts-and-p`
- The estimates are calculated locally; no external service is called — code-changes: local estimator `#the-estimates-are-calculated-locally-no-external`
- Focused tests cover category estimation and missing/empty usage data — unit: estimate.test.mjs `#focused-tests-cover-category-estimation-and-miss`

## Decisions

- Use the global TUI plugin surface only; mockup A was selected and Desktop integration was not requested.
- Present category composition as estimates because OpenCode does not expose every hidden prompt section directly.
- Keep all processing local and avoid unrelated global configuration changes.
- Rely on OpenCode v2 automatic discovery of `~/.config/opencode/plugins/context-meter/tui.tsx` without modifying `~/.config/opencode/cli.json`.
- Use `context.client.session.context({ sessionID })` (post-compaction active messages) with fallback to `context.data.session.message.list(sessionID)`.

## Tasks

### Start
- [x] Inspect the global OpenCode setup and current version `#inspect-installation`
### Plan
- [x] Compare the mockups and confirm estimated breakdown behavior `#confirm-design`
- [x] Write and self-review the design spec `#write-design-spec`
### Build
- [x] Implement the estimator and global TUI plugin `#implement-plugin`
  - [x] Add a failing focused estimator test first `#estimator-test-first`
  - [x] Add footer meter and `/context` report `#ui-and-command`
- [x] Commit the plugin and spec `#commit-plugin`
### Test
- [~] Run focused tests and global TUI smoke checks `#verify-plugin`
### Review
- [ ] User reviews the installed plugin and approves the outcome `#user-outcome-review`

## Verification plan

- Add a focused test for the category-estimation helper before implementing it.
- Run the focused test, plugin type-check/build validation available for the installed OpenCode SDK, and a TUI load/command smoke check.
- Inspect the final diff to confirm only the new plugin and its local config are touched.
