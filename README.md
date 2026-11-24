# opencode-context-meter

An [OpenCode v2](https://opencode.ai) TUI plugin that shows how much of the model's context window the current session is using and gives an estimate of what takes up that space.

## What it does

- **Prompt footer** — shows a compact meter, for example `ctx 13% ▰▱▱▱▱▱▱▱`. If OpenCode knows the prompt token count but not the model limit, it shows the count instead. Before the first reported usage, it shows `ctx --`.
- **`/context`** — opens a report with the prompt token count, model limit when known, and estimated shares for conversation, tools and files, and system and instructions. Press `Esc` to close.

## Install

Clone the repository into your global OpenCode plugins directory. OpenCode discovers it without a config change:

```sh
git clone https://github.com/valeriobelli/opencode-context-meter.git \
  "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/opencode-context-meter"
```

Run `/reload` in a running OpenCode TUI, then open a session and type `/context`.

If you keep the checkout elsewhere, add its absolute path to the `plugins` array in [`cli.json`](https://opencode.ai/docs/cli/plugins):

```json
{
  "plugins": ["/absolute/path/to/opencode-context-meter"]
}
```

### Requirements

OpenCode v2 TUI (tested on v2.3.2). There is no Desktop GUI integration. The npm package is not yet published; use a Git checkout.

## How it works

The meter uses the latest reported assistant prompt tokens, including cache reads and writes, and the selected model's context limit from OpenCode. The report asks the connected OpenCode server for the active context and falls back to the TUI's cached messages if that fails.

The report estimates visible conversation and tool content at roughly one token per four characters. It assigns the remaining tokens to system and instructions. That remainder also includes estimation error; it is not a direct count of hidden prompts. The latest reported usage is not a live count of unsent input, and routed models can have a different limit from the selected alias.

## Privacy

The plugin computes estimates in the TUI. It reads session data from the connected OpenCode server and does not send session content to a separate service or collect telemetry.

## Development

```sh
pnpm install --frozen-lockfile
pnpm run check
```

Use Node 24. The check runs formatting, linting, TypeScript, unit tests, and Fallow. Use `pnpm changeset` to document user-facing changes.

## License

[MIT](./LICENSE)
