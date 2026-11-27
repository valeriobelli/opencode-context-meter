# opencode-context-meter

An [OpenCode v2](https://opencode.ai) TUI plugin that shows how much of the model's context window the current session is using and gives an estimate of what takes up that space.

## What it does

- **Prompt footer** — shows context usage and a labeled pressure level: low, warning, urgent, disabled, or unknown. Warning starts at 80% of the estimated auto-compaction threshold; urgent starts at 95%. Before usage is reported, and immediately after compaction, it shows `ctx --`.
- **`/context`** — shows reported usage, estimated compaction pressure and possible benefit, and an estimated composition. Use left and right to switch between Overview, Skills, Tools, and System; use up and down to scroll and `Esc` to close. Advice is informational: the plugin never calls a model or compacts a session.

## Install

Clone the repository into your global OpenCode plugins directory:

```sh
git clone https://github.com/valeriobelli/opencode-context-meter.git \
  "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/opencode-context-meter"
```

For the detailed breakdown, add the absolute checkout path to the `plugins` array in global [`opencode.jsonc`](https://opencode.ai/docs/config):

```json
{
  "plugins": ["/absolute/path/to/opencode-context-meter"]
}
```

OpenCode discovers the TUI plugin automatically in the global plugins directory. Elsewhere, add the same path to the `plugins` array in [`cli.json`](https://opencode.ai/docs/cli/plugins) as well. Config changes reload automatically; run `/reload` to force a reload. Then open a session and type `/context`.

Without the server entry, the TUI still works but omits hidden tool-definition estimates and cannot assess composition-based benefit.

### Requirements

OpenCode v2 TUI (targeted at v2.4.1). There is no Desktop GUI integration. The npm package is not yet published; use a Git checkout.

## How it works

The meter uses the latest reported assistant prompt tokens, including cache reads and writes, and the selected model's context limit from OpenCode. The report asks the connected OpenCode server for the active context and falls back to the TUI's cached messages if that fails.

When the server snapshot matches the latest usage, the report separates conversation, tool outputs and files, skills, MCP and tool definitions, system and instructions, and an unattributed remainder. It shows all identifiable contributors per category, largest first: catalog entries are distinct from loaded skill bodies, and tool definitions are distinct from retained calls and results. Connected tools that are not visible in the prompt are not counted. Category and contributor sizes use roughly one token per four characters and are scaled to the reported total; they are not exact token counts. The remainder includes unmeasured content and estimation error. When the server snapshot is unavailable or stale, the report falls back to visible messages.

Compaction pressure follows the effective location configuration and the model limits using the v2.4.1 buffer rules. It is an approximation: OpenCode may consider newer unmeasured content or provider overflow. Advice about possible savings is a simple rule, not a guarantee. The latest usage excludes unsent input, and routed models may have a different limit from their alias.

## Privacy

The server companion retains session-scoped character counts and contributor names in memory, and exposes these with timestamps through its RPC. It does not retain instruction text, tool schemas, arguments, or results. The TUI reads session data from the connected server. The plugin does not send content to a separate service or collect telemetry.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Use Node 24. The check runs formatting, linting, TypeScript, unit tests, and Fallow. Use `pnpm changeset` to document user-facing changes.

### Release setup

Before enabling the release workflow:

1. Configure the GitHub `release` environment with required reviewers. Referencing an environment in a workflow does not create an approval rule. The workflow can publish on a push to `main` or a manual run. See [GitHub's environment instructions](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
2. In repository settings, allow GitHub Actions to create pull requests. A version PR created with the default GitHub token may need a maintainer to approve its CI runs. See [Changesets automation](https://changesets.dev/guide/automating#prerequisites).
3. If the package has not been published, follow [Changesets' first-publication instructions](https://changesets.dev/guide/versioning-and-publishing#trusted-publishing) before configuring trusted publishing. Treat that initial manual publication as a separate release.
4. Configure the npm trusted publisher for `valeriobelli/opencode-context-meter`, workflow `release.yml`, and environment `release`, with direct `npm publish` allowed. A new trusted publisher must complete its first successful publication within two days. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers).

A repository administrator can install the [Changesets bot](https://github.com/apps/changeset-bot) to post non-blocking changeset reminders on pull requests, including those from forks. No PR-comment workflow or bot installation is included in this repository.

## License

[MIT](./LICENSE)
