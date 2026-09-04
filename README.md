# @wagzhi/plan-spec

Install a plan-spec skill, its explicit `plan-spec` plugin, five OpenCode agents,
and the MCP configuration those agents use.

## Install

```sh
npx @wagzhi/plan-spec install
```

The installer copies managed skills and agents to OpenCode's global configuration
directory, registers `@wagzhi/plan-spec-plugin@^0.2.0` as a minimal OpenCode
plugin bootstrap, and writes the managed agent models and MCP definitions only to
`~/.config/opencode/plan-spec.jsonc`. OpenCode installs npm plugins with Bun at
startup, so Bun must be available. It guides OpenCode Go authentication through
`/connect`; it never writes OpenCode's auth store.

Secrets are stored in `~/.plan-spec/secrets/` and referenced with OpenCode
`{file:...}` variables. Run `npx @wagzhi/plan-spec config` to change MCP choices,
secrets, or the five installed agent model mappings. `--config-dir` changes the
OpenCode configuration root for custom deployments and tests; otherwise the managed
file is `~/.config/opencode/plan-spec.jsonc`.

```sh
# Keep all managed files but disable the browser MCP and choose a different model.
npx @wagzhi/plan-spec config --disable-mcp chrome_devtools \
  --model ask-agent=opencode-go/deepseek-v4-pro
```

```sh
npx @wagzhi/plan-spec doctor
npx @wagzhi/plan-spec uninstall
```

Use `plan-spec <task>`, `/plan-spec <task>`, `psw <task>`, or `/psw <task>` in OpenCode to explicitly activate
the installed workflow. Per-project `spec/plan-spec.json` still controls whether
the project has enabled the workflow.

See [PUBLISHING.md](PUBLISHING.md) for package and npm publishing instructions.
