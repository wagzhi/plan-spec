# @wagzhi/plan-spec

Install a plan-spec skill, its explicit `plan-spec` plugin, five OpenCode agents,
and the MCP configuration those agents use.

## Install

```sh
npx @wagzhi/plan-spec install
```

The installer copies managed assets to OpenCode's global configuration directory,
merges MCP configuration without rewriting unrelated JSONC content, and writes
models only to `opencode-personal.jsonc`. It guides OpenCode Go authentication
through `/connect`; it never writes OpenCode's auth store.

Secrets are stored in `~/.plan-spec/secrets/` and referenced with OpenCode
`{file:...}` variables. Run `npx @wagzhi/plan-spec config` to change MCP choices,
secrets, or the five installed agent model mappings.

```sh
# Keep all managed files but disable the browser MCP and choose a different model.
npx @wagzhi/plan-spec config --disable-mcp chrome_devtools \
  --model ask-agent=opencode-go/deepseek-v4-pro
```

```sh
npx @wagzhi/plan-spec doctor
npx @wagzhi/plan-spec uninstall
```

Use `plan-spec <task>` or `/plan-spec <task>` in OpenCode to explicitly activate
the installed workflow. Per-project `spec/plan-spec.json` still controls whether
the project has enabled the workflow.

See [PUBLISHING.md](PUBLISHING.md) for package and npm publishing instructions.
