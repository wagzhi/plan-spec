# @wagzhi/plan-spec-plugin

OpenCode V2 plugin that provides two capabilities:

1. Expands explicit `plan-spec`, `/plan-spec`, `psw`, and `/psw` requests into the plan-spec workflow instruction.
2. Loads one `plan-spec.jsonc` file and applies it through OpenCode V2 domain transforms.

The plan-spec installer registers the plugin with its managed config path:

```jsonc
{
  "plugins": [
    {
      "package": "@wagzhi/plan-spec-plugin@^0.3.0",
      "options": { "configPath": "~/.config/opencode/plan-spec.jsonc" }
    }
  ]
}
```

`configPath` is optional and defaults to `~/.config/opencode/plan-spec.jsonc`.
The plugin reads only this one JSONC file. It does not load `loader.jsonc`, interpret
file lists, or read any other configuration module.

## How the configuration is applied

OpenCode V2 has no mutable global config object, so each `plan-spec.jsonc` section is
applied through the domain transform that owns it:

- `agents.<id>` — `ctx.agent.transform(...)`, using `AgentEditor.update`, which upserts.
  This is required because agents declared in `opencode.json(c)` or in an `agents/`
  directory are merged after transforms run and are not visible through
  `editor.get`/`editor.list` while the callback executes.
- `mcp.servers.<name>` — `ctx.mcp.transform(...)`, using `MCPEditor.set`, which upserts.
- `permissions` — a V2 ordered `{ action, resource, effect }` array injected into the
  built-in agents and into every agent named by `agents`. A rule is not injected when
  the agent already defines the same `action` + `resource`, so agent-level rules win.

`agents.<id>.model` accepts `provider/model`, `provider/model#variant`, or a structured
`{ providerID, id, variant? }` value. `{file:...}` secret references under
`mcp.servers.<name>.environment` / `mcp.servers.<name>.headers` are resolved from
`~/.plan-spec/secrets` before the definitions are handed to the MCP transform.

A missing or invalid configuration file logs a warning and does not stop OpenCode.

Set `PLAN_SPEC_CONFIG_DEBUG=1` to log configuration loading and transform events.
