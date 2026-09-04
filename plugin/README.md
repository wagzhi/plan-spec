# @wagzhi/plan-spec-plugin

OpenCode plugin that provides two capabilities:

1. Expands explicit `plan-spec`, `/plan-spec`, `psw`, and `/psw` requests into the plan-spec workflow instruction.
2. Loads one `plan-spec.jsonc` file and deep-merges it into the OpenCode runtime config.

The plan-spec installer registers the plugin with its managed config path:

```jsonc
{
  "plugin": [
    [
      "@wagzhi/plan-spec-plugin@^0.2.0",
      { "configPath": "~/.config/opencode/plan-spec.jsonc" }
    ]
  ]
}
```

`configPath` is optional and defaults to `~/.config/opencode/plan-spec.jsonc`.
The plugin reads only this one JSONC file. It does not load `loader.jsonc`, interpret
file lists, or read any other configuration module.

Objects are merged recursively; arrays and scalar values replace the current value.
A missing or invalid configuration file logs a warning and does not stop OpenCode.

Set `PLAN_SPEC_CONFIG_DEBUG=1` to log configuration loading and merge events.
