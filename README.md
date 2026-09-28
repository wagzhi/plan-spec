# @wagzhi/plan-spec

[English](README.md) | [简体中文](README.zh-CN.md)

Install a shared project planning and execution skill for OpenCode V2 and Codex. It runs only when explicitly requested; ordinary development requests do not activate it.

## Install

Requires Node.js 20+. From a project directory:

```sh
npx @wagzhi/plan-spec install
```

With no arguments, installation immediately targets the **current working directory**, even when it is a subdirectory of a Git repository. It installs:

```text
<project>/.agents/skills/plan-spec/SKILL.md
<project>/.agents/skills/plan-spec/agents/openai.yaml
<project>/AGENTS.md                  # only the managed block
<project>/.opencode/commands/plan-spec.md  # when project OpenCode markers are found
```

Use `--project-dir packages/web` to select a specific directory in a monorepo. To install **only the skill** globally, with no command or global `AGENTS.md` changes:

```sh
npx @wagzhi/plan-spec install --scope global
```

The installer checks only the target project's `.opencode/`, `opencode.json`, and `opencode.jsonc` for OpenCode usage. Use `--with-opencode-command` to install `/plan-spec` without a marker, or `--without-opencode-command` to omit it. Explicit choices survive reinstallation, and an installed command is not silently removed when markers disappear. `--config-dir` applies only to the global scope, which remains an OpenCode-only global skill install. Running `install` again updates unmodified managed files; user edits are never overwritten. The installer does not manage OpenCode configuration, plugins, agents, MCPs, credentials, models, or permissions.

If SkillHub or another manager already installed the skill in `.agents/skills/plan-spec/`, add **only** the optional OpenCode command from the project directory without taking ownership of the skill or `AGENTS.md`:

```sh
npx @wagzhi/plan-spec command install
npx @wagzhi/plan-spec command uninstall  # removes only an intact command managed by this installer
```

These accept `--project-dir <path>`. Installing or loading the skill does not run them automatically; command setup requires an explicit user request.

## Use

Use `$plan-spec` to invoke the shared skill explicitly in Codex. When the OpenCode command was installed, use:

```text
/plan-spec implement user authentication
/plan-spec
/plan-spec 开始
/plan-spec 补充登录失败时的错误处理
/plan-spec 执行 spec/feats/001-auth-20260928.md
```

In read-only planning mode, a requirement produces a draft; no requirement prompts for one. In the same session, switching to a write-enabled mode and invoking the skill or `/plan-spec 开始` continues and executes a complete, uniquely identified plan created by this skill, saving a draft first if needed. A clearly new requirement starts a new plan, while a request to refine one updates it without implementation. An explicit plan path takes precedence. Read-only mode never writes; missing or ambiguous context requires clarification, never an automatic choice of the latest plan. A global-only installation must be invoked explicitly without a project command.

Newly installed project files count as working-tree changes. Review and commit them yourself, or decide how to proceed when the skill asks about pre-existing changes. Existing project configuration files are not an activation gate and are never deleted by the installer.

## Verify and uninstall

```sh
npx @wagzhi/plan-spec doctor
npx @wagzhi/plan-spec doctor --json
npx @wagzhi/plan-spec uninstall
```

Pass the same `--project-dir` or `--scope global` (and `--config-dir` if applicable) for another installation. Independent manifests live under `~/.plan-spec/installations/`. Upgrading an existing project installation migrates only intact old `.opencode/skills/plan-spec` files; edits block migration and remain untouched. Uninstall removes only intact managed files and blocks, then removes the `plan-spec` skill directory if empty. Parent directories and user-added files are preserved; modified resources are reported.

## Previous installations

Older lite/standard global installations are not changed when installing the new project skill. After reviewing and backing up global OpenCode configuration, explicitly clean up the legacy installation with:

```sh
npx @wagzhi/plan-spec legacy-uninstall
```

User-modified resources and old secret files are preserved. See [DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md) and [PUBLISHING.md](PUBLISHING.md) for development and publishing.
