<!-- plan-spec-package:begin -->
## Plan-Spec Routing

- Use the `plan-spec` skill only when the user explicitly asks to use it. Do not activate it for ordinary planning or implementation requests, or merely because project configuration exists.
- Delegate local Git write operations to `@git-agent` and Gitee operations to `@gitee-agent`.
- Delegate third-party documentation to `@doc-agent`; use `@ask-agent` when it also needs project context.
- Use `@web-debug` for browser debugging through Chrome DevTools.

## Managed Subagents

All managed agents use `mode: subagent`.

| Agent | Use for |
| --- | --- |
| `@ask-agent` | Project-aware Q&A that combines third-party documentation with local project exploration. |
| `@doc-agent` | Third-party documentation, SDK/API references, framework docs, examples, and technical specifications. |
| `@git-agent` | Requested local Git operations in the current repository. |
| `@gitee-agent` | Gitee issues, pull requests, reviews, merges, and task progress. |
| `@web-debug` | Frontend web debugging through Chrome DevTools, including the page, DOM, console, network, and performance. |
<!-- plan-spec-package:end -->
