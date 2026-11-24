# opencode-context-meter GitHub repository

## Outcome

Create the public `valeriobelli/opencode-context-meter` repository on `main` preserving the existing commit history and following the repository standards from `valeriobelli/opencode-openrouter-budget`, while keeping the local global OpenCode plugin working without modifying unrelated config or publishing to npm.

## Acceptance checks

- Repository `valeriobelli/opencode-context-meter` exists as public with `main` as default branch, matching repo settings (squash merge, no wiki/projects), and full existing history pushed — manual: GitHub API & remote check `#repo-created-and-pushed`
- Package, lint, format, typecheck, fallow, commitlint, and tests match `opencode-openrouter-budget` standards and pass locally (`pnpm run check`) — unit: `pnpm run check` `#repo-checks-pass`
- GitHub Actions workflows (`.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `.github/workflows/actions.lock`) pass `zizmor`, `gh actions-lock --verify`, and GitHub Actions CI on `main` — integration: GitHub Actions `#ci-and-actions-pass`
- Global OpenCode TUI plugin auto-discovery still loads and renders the context meter and `/context` dialog from an unrelated directory (`/tmp`) — manual: OpenCode PTY smoke check `#global-tui-still-loads`

## Approach

- Rename local `master` branch to `main` (done).
- Structure the plugin cleanly like `opencode-openrouter-budget`:
  - Move `estimate.mjs` to `src/estimate.ts`, `tui.tsx` to `src/tui.tsx`, and `estimate.test.mjs` to `test/estimate.check.ts`.
  - Expose `./tui` (`./src/tui.tsx`) and `./package.json` in `package.json` `exports` (verified against OpenCode's `resolve` implementation so directory discovery under `~/.config/opencode/plugins/context-meter/` resolves `opencode-context-meter/tui` to `./src/tui.tsx` without requiring a server entrypoint). Include a root `tui.ts` shim (`export { default } from './src/tui.tsx'`) only if needed for non-exports discovery, and verify with `fallow` + live `opencode`.
- Add `test/estimate.check.ts` using `node:assert/strict` (or `node:test`) matching `test/*.check.ts` in `opencode-openrouter-budget`.
- Add `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `oxfmt.config.ts`, `oxlint.config.ts`, `commitlint.config.mts`, `lefthook.yml`, `.fallowrc.jsonc`, `.editorconfig`, `.gitignore`, `.node-version`, `.vscode/settings.json`, `.changeset/config.json`, `LICENSE`, `README.md`, and `.github/workflows/{ci.yml,release.yml,actions.lock}` matching `opencode-openrouter-budget` (without publishing to npm).
- Keep conventional commit messages (`commitlint`) on all new commits and install/run `lefthook`, `pnpm run check`, `zizmor`, and `gh actions-lock --verify`.
- Create the public GitHub repository `valeriobelli/opencode-context-meter` under the personal account, configure repo settings to match `opencode-openrouter-budget`, push `main`, and verify CI workflows pass.

## Decisions

- Public repository under `valeriobelli/opencode-context-meter`, preserving the two existing commits (`0156f72`, `7313f38`), using `main` as the default branch (user answered on 2026-11-24).
- Match `opencode-openrouter-budget` standards (MIT license, pnpm, oxfmt, oxlint, TypeScript, fallow, commitlint, lefthook, Changesets config, CI + Release workflows, `gh actions-lock`, `zizmor`, `README.md`) without publishing to npm.
- Use single-line `// @jsxImportSource @opentui/solid` and `.ts`/`.tsx` layout matching `opencode-openrouter-budget`, verified with live OpenCode v2.3.2 PTY discovery.

## Tasks

### Start

- [x] Inspect `valeriobelli/opencode-openrouter-budget` standards and local git history `#inspect-standards`

### Plan

- [x] Confirm repository visibility, history, and branch with user `#confirm-repo-options`
- [x] Write repository setup plan `#write-repo-plan`

### Build

- [~] Standardize package structure, source, tests, and tooling `#standardize-repo`
  - [x] Add `package.json`, TypeScript/oxlint/oxfmt/fallow/commitlint/lefthook/changeset/editor configs `#add-repo-configs`
  - [~] Convert plugin source (`src/estimate.ts`, `src/tui.tsx`, `tui.ts`) and tests (`test/estimate.check.ts`) `#structure-source-and-tests`
  - [ ] Add `README.md`, `LICENSE`, `.github/workflows/*`, and lockfiles (`pnpm-lock.yaml`, `actions.lock`) `#add-docs-and-ci`
- [ ] Run local checks and commit with conventional commit `#commit-repo-standards`
- [ ] Create public GitHub repo `valeriobelli/opencode-context-meter`, match settings, and push `main` `#create-and-push-repo`

### Test

- [ ] Run `pnpm run check`, `zizmor`, `gh actions-lock --verify`, and OpenCode PTY smoke test `#verify-local-and-tui`
- [ ] Verify GitHub Actions CI passes on `main` `#verify-github-ci`

### Review

- [ ] User reviews and approves the published repository outcome `#user-review-repo`
