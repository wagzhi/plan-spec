# @wagzhi/plan-spec

[English](README.md) | [简体中文](README.zh-CN.md)

Install and manage a plan-first workflow for OpenCode with one command. The
package installs the plan-spec skill, its explicit-trigger plugin, five focused
subagents, and the MCP configuration used by those agents.

This project replaces the manual configuration-distribution workflow from
[`wagzhi/opencode-config`](https://github.com/wagzhi/opencode-config). You no
longer need to clone a configuration repository into `~/.config/opencode`, copy
personal configuration templates, or maintain the managed MCP secrets in an
`.env` file.

## Requirements

- [OpenCode](https://opencode.ai/) installed and available on `PATH`
- Node.js 20 or later, including `npx`
- [Bun](https://bun.sh/) available to OpenCode when it installs npm plugins at startup
- A Gitee access token for Gitee operations (optional)
- A Context7 API key for third-party documentation lookup (optional)

The default agent models use OpenCode Go. Authenticate after installation with
`/connect` in OpenCode and select **OpenCode Go**.

## Quick Start

1. Run the interactive installer:

   ```sh
   npx @wagzhi/plan-spec install
   ```

   The installer prompts for a Gitee access token and Context7 API key. Either
   value can be left empty and configured later.

2. Start OpenCode, run `/connect`, select **OpenCode Go**, and then restart
   OpenCode so it can load the installed plugin and configuration.

3. Verify the installation:

   ```sh
   npx @wagzhi/plan-spec doctor
   ```

4. In OpenCode, explicitly start a plan-spec request with any supported form:

   ```text
   /plan-spec implement user authentication
   plan-spec fix the checkout regression
   /psw migrate the API client
   psw refactor the configuration loader
   ```

## What Gets Installed

| Resource | Purpose |
| --- | --- |
| `skills/plan-spec/` | Project planning, execution tracking, and result backfilling workflow |
| `@wagzhi/plan-spec-plugin@^0.2.0` | Loads `plan-spec.jsonc` and expands explicit plan-spec requests |
| `@ask-agent` | Project-aware answers using local code and third-party documentation |
| `@doc-agent` | Third-party documentation, SDK, API, and specification lookup |
| `@git-agent` | Requested local Git operations |
| `@gitee-agent` | Gitee issues, pull requests, reviews, merges, and task progress |
| `@web-debug` | Browser debugging through Chrome DevTools |

The installer also manages these MCP definitions:

| MCP | Used for |
| --- | --- |
| `context7` | Third-party library documentation for `@doc-agent` and `@ask-agent` |
| `gitee` | Gitee repository and project operations for `@gitee-agent` |
| `chrome_devtools` | Browser inspection and debugging for `@web-debug` |

Context7 and Chrome DevTools are denied to the main agent by default and
allowed through their focused subagents. This keeps tool routing predictable.

## Project Usage

Installing the package makes the workflow available globally, but it does not
automatically enable plan-spec for every project. Both conditions are required:

1. The request starts with `plan-spec`, `/plan-spec`, `psw`, or `/psw`.
2. The project contains `spec/plan-spec.json` with `enabled` set to `true`.

On the first explicit request in a project without that file, Build Mode asks
whether to enable plan-spec and whether to connect the project to Gitee project
management. Plan Mode only explains the setup steps. A minimal project
configuration is:

```json
{
  "enabled": true,
  "projectManager": { "enabled": false }
}
```

When enabled, implementation plans are stored under `spec/feats/`. Plan Mode
remains read-only; Build Mode can write the plan, implement changes, run checks,
and backfill the result.

## Configuration

Reapply managed configuration, update secrets, disable MCPs, or override agent
models with `config`:

```sh
npx @wagzhi/plan-spec config
```

Disable one or more managed MCPs:

```sh
npx @wagzhi/plan-spec config --disable-mcp chrome_devtools context7
```

Override one or more managed agent models:

```sh
npx @wagzhi/plan-spec config --model ask-agent=opencode-go/deepseek-v4-pro doc-agent=provider/model
```

Supported agent names are `ask-agent`, `doc-agent`, `git-agent`,
`gitee-agent`, and `web-debug`.

| Agent | Default model |
| --- | --- |
| `ask-agent` | `opencode-go/deepseek-v4-flash` |
| `doc-agent` | `opencode-go/deepseek-v4-flash` |
| `git-agent` | `opencode-go/deepseek-v4-flash` |
| `gitee-agent` | `opencode-go/deepseek-v4-flash` |
| `web-debug` | `opencode-go/deepseek-v4-flash-vision-exp` |

Additional installer options:

| Option | Description |
| --- | --- |
| `-y`, `--yes` | Use default choices without prompts; secrets are not requested |
| `--skip-secrets` | Do not request or update secret files |
| `--config-dir <path>` | Use a custom OpenCode global configuration directory |
| `--disable-mcp <names...>` | Disable `context7`, `gitee`, and/or `chrome_devtools` |
| `--model <agent=model...>` | Override a managed agent model |

`OPENCODE_CONFIG_DIR` can also select the OpenCode configuration directory when
`--config-dir` is not provided.

## Managed Files

By default, the installer manages:

```text
~/.config/opencode/
├── opencode.jsonc              # plugin registration only
├── plan-spec.jsonc             # managed agents, MCPs, and permissions
├── AGENTS.md                   # managed routing block
├── agents/                     # five managed subagents
└── skills/plan-spec/           # plan-spec skill

~/.plan-spec/
├── manifest.json               # installation state
└── secrets/
    ├── gitee-access-token
    └── context7-api-key
```

Secrets are referenced with `{file:...}` variables instead of being embedded in
OpenCode configuration. Set `PLAN_SPEC_HOME` to move the installation state and
secret root. The installer never writes OpenCode's authentication store and does
not create or modify `opencode-personal.jsonc`.

Existing unrelated OpenCode configuration and plugins are retained. Paths and
fields managed by this package may be replaced when `install` or `config` is run.

## Verify And Troubleshoot

Run the human-readable checks:

```sh
npx @wagzhi/plan-spec doctor
```

For structured output:

```sh
npx @wagzhi/plan-spec doctor --json
```

The doctor checks the OpenCode executable, installed skill and agents, plugin
registration, managed models, MCP definitions, permissions, and optional secret
files. If OpenCode does not load the new resources, complete `/connect`, restart
OpenCode, and run the doctor again.

## Migrating From `opencode-config`

The installer replaces the old repository's manual distribution process, but
it does not remove every legacy file or configuration entry automatically.

1. Back up your current `~/.config/opencode` directory.
2. Stop using the old repository checkout as the installation/update mechanism.
3. Run `npx @wagzhi/plan-spec install` and provide the Gitee and Context7 secrets.
4. Complete `/connect`, restart OpenCode, and run `doctor`.
5. After verification, remove obsolete duplicate MCP definitions, old routing
   instructions, and other legacy files that are no longer needed.

The installer does not manage legacy `tui.json`, command files, personal provider
templates, or the `opencode-skill-creator` plugin. Keep those separately if you
still use them.

## Uninstall

```sh
npx @wagzhi/plan-spec uninstall
```

Uninstall removes unchanged managed resources, restores previously managed
configuration values where possible, and removes the managed block from
`AGENTS.md`. Modified managed files are preserved and reported. Secret files are
retained so they are not deleted accidentally.

## Development And Publishing

- Local development and test instructions: [DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md)
- npm publishing instructions: [PUBLISHING.md](PUBLISHING.md)
- Source repository: [wagzhi/plan-spec](https://github.com/wagzhi/plan-spec)
