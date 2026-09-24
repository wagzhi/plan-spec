<!-- plan-spec-package:begin -->
## Plan-Spec Routing

- This installation uses plan-spec **lite** mode: no managed subagents or plugin are installed.
- Use the `plan-spec` skill only when the user explicitly asks to use it. Do not activate it for ordinary planning or implementation requests, or merely because project configuration exists.
- Perform Git inspection directly. In Build Mode, run Git write operations (branch, stage, commit) directly and stage only files that belong to the current task. Never push or create a PR unless the user explicitly asks.
- If a Gitee MCP is available, use it for issue operations. Otherwise produce issue and comment drafts and ask the user to sync them manually.
- Upgrade to standard mode with `plan-spec install --mode standard`; downgrading requires `plan-spec uninstall` first.
<!-- plan-spec-package:end -->
