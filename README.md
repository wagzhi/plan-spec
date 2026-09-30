# @wagzhi/plan-spec

[English](README.md) | [简体中文](README.zh-CN.md)

Install a shared project planning and execution skill for OpenCode V2 and Codex. It runs only when explicitly requested; ordinary development requests do not activate it.

## Install

Requires Node.js 20+. From a project directory:

```sh
npx @wagzhi/plan-spec install
```

With no arguments, installation immediately targets the **current working directory**, even when it is a subdirectory of a Git repository. A project installation manages:

```text
<project>/.agents/skills/plan-spec/SKILL.md
<project>/.agents/skills/plan-spec/agents/openai.yaml
<project>/AGENTS.md                         # only the managed block
<project>/.opencode/commands/plan-spec.md  # when project OpenCode markers are found
```

Use `--project-dir packages/web` to select a specific directory in a monorepo. To install **only the OpenCode skill** globally, with no command or global `AGENTS.md` changes:

```sh
npx @wagzhi/plan-spec install --scope global
```

The installer checks only the target project's `.opencode/`, `opencode.json`, and `opencode.jsonc` to decide whether to add the OpenCode command; these markers do not control skill activation. Use `--with-opencode-command` to install `/plan-spec` without a marker, or `--without-opencode-command` to omit it. Explicit choices survive reinstallation, and an installed command is not silently removed when markers disappear. `--config-dir` applies only to global scope and selects the OpenCode global configuration directory. Running `install` again updates unmodified managed files; user edits are never overwritten. The installer does not manage OpenCode configuration, plugins, independent subagents, MCPs, credentials, models, or permissions. The skill's `agents/openai.yaml` is Codex invocation metadata, not a managed subagent.

If SkillHub or another manager already installed the skill in `.agents/skills/plan-spec/`, run the first command from the project directory to add **only** the optional OpenCode command, without taking ownership of the skill or `AGENTS.md`. Run the second command if you later want to remove it:

```sh
npx @wagzhi/plan-spec command install
npx @wagzhi/plan-spec@latest command upgrade  # upgrades only the intact managed command
npx @wagzhi/plan-spec command uninstall  # removes only an intact command managed by this installer
```

These accept `--project-dir <path>`. Installing or loading the skill does not run them automatically; command management requires an explicit user request. `command install` does not install a skill or add the project routing block; the full `install` manages both and cannot take over a SkillHub-installed skill it does not own.

## Use

Use `$plan-spec` to invoke the shared skill explicitly in Codex. Once the OpenCode project command is installed, use:

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
npx @wagzhi/plan-spec@latest upgrade
npx @wagzhi/plan-spec uninstall
```

`upgrade` compares installed resources with the **running package version**; it does not download another release itself. Use `@latest` to obtain the newest npm release. The skill, optional command, and managed `AGENTS.md` block display their package version. An unchanged version is not rewritten; modified or missing resources and downgrades are refused. Old records without version data are treated as unknown and still require hash verification. Upgrades preserve the installed set of components; command-only installations never take ownership of SkillHub skills.

Pass the same `--project-dir` or `--scope global` (and `--config-dir` if applicable) for another installation. Independent manifests live under `~/.plan-spec/installations/`. Upgrading an existing project installation migrates only intact old `.opencode/skills/plan-spec` files; edits block migration and remain untouched. The full `uninstall` removes only intact managed files and `AGENTS.md` blocks, then removes a managed `plan-spec` skill directory if empty. Parent directories and user-added files are preserved; modified resources are reported. To remove only the optional command, use `command uninstall` above.

## Previous installations

Older lite/standard global installations are not changed when installing the new project skill. After reviewing and backing up global OpenCode configuration, explicitly clean up the legacy installation with:

```sh
npx @wagzhi/plan-spec legacy-uninstall
```

User-modified resources and old secret files are preserved. See [DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md) and [PUBLISHING.md](PUBLISHING.md) for development and publishing.
