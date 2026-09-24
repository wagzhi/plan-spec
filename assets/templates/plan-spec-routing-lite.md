<!-- plan-spec-package:begin -->
## Plan-Spec Routing

- This installation uses plan-spec **lite** mode: no managed subagents and no trigger plugin are installed.
- Use the `plan-spec` skill only after an explicit `plan-spec`, `/plan-spec`, `psw`, or `/psw` request.
- Perform Git inspection directly. In Build Mode, run Git write operations (branch, stage, commit) directly and stage only files that belong to the current task. Never push or create a PR unless the user explicitly asks.
- If a Gitee MCP is available, use it for issue operations. Otherwise produce issue and comment drafts and ask the user to sync them manually.
- Upgrade to standard mode with `plan-spec install --mode standard`; downgrading requires `plan-spec uninstall` first.
<!-- plan-spec-package:end -->
