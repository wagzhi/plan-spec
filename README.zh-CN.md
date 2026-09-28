# @wagzhi/plan-spec

[English](README.md) | [简体中文](README.zh-CN.md)

为 OpenCode V2 和 Codex 安装共享的项目任务规划与执行技能。仅在用户明确要求使用技能时调用；不会自动接管普通开发请求。

## 安装

需要 Node.js 20+。在项目目录中运行：

```sh
npx @wagzhi/plan-spec install
```

不传参数时无需选择范围，直接安装到执行命令的**当前目录**（即使当前目录位于 Git 仓库的子目录）。安装目标包括：

```text
<项目>/.agents/skills/plan-spec/SKILL.md
<项目>/.agents/skills/plan-spec/agents/openai.yaml
<项目>/AGENTS.md                  # 只管理本工具的标记区块
<项目>/.opencode/commands/plan-spec.md  # 检测到项目使用 OpenCode 时安装
```

指定具体项目（例如 monorepo 中的包）：

```sh
npx @wagzhi/plan-spec install --project-dir packages/web
```

仅全局安装技能（**不安装命令，不改任何 AGENTS.md**）：

```sh
npx @wagzhi/plan-spec install --scope global
```

安装器只检测目标目录下的 `.opencode/`、`opencode.json` 或 `opencode.jsonc`，以决定是否安装 OpenCode 命令。没有项目级标记但仍需命令时用 `--with-opencode-command`；不希望安装时用 `--without-opencode-command`。显式选择会在后续重复安装中保留；不会仅因标记消失就移除已安装的命令。

如果技能已通过 SkillHub 等方式安装到 `.agents/skills/plan-spec/`，只想补装 OpenCode 命令而不让 npm 安装器接管技能或 `AGENTS.md`，请在项目目录明确执行：

```sh
npx @wagzhi/plan-spec command install
npx @wagzhi/plan-spec command uninstall  # 只撤销本安装器管理且未修改的命令
```

技能本身不会在安装或加载时自动运行上述命令；只有用户明确要求配置命令时才执行。两条命令支持 `--project-dir <path>` 指定项目目录。

`--config-dir <path>` 仅适用于 global 范围，仍按原方式仅为 OpenCode 全局安装技能；项目范围使用 `--project-dir <path>`。重复执行 `install` 会更新未被修改的受管文件；不会覆盖用户改过的技能、命令或项目指令区块。安装器不写 OpenCode 配置、服务配置或密钥文件。

## 使用

在 Codex 中明确调用 `$plan-spec`；若检测到 OpenCode 项目（或显式要求安装命令），可在 OpenCode 中使用：

```text
/plan-spec 实现用户登录
/plan-spec
/plan-spec 开始
/plan-spec 补充登录失败时的错误处理
/plan-spec 执行 spec/feats/001-login-20260928.md
```

只读规划模式中输入需求会生成草案；不带需求时会询问需求。切换到同一会话的允许写入模式后，若存在本技能形成且可唯一识别的未完成计划，直接调用技能或执行 `/plan-spec 开始` 会续接；未落盘的草案会先按规范落盘。明确的新需求开启新计划，“补充/完善”则迭代当前计划而不直接实现。也可用计划路径明确指定执行目标。只读模式始终不写入；跨会话或目标不唯一时先询问，不自动挑选最新计划。仅做 global 安装时请直接明确要求使用技能。

工作区检查、任务前修改的保护、测试与结果回填由技能负责。安装技能产生的未提交文件也算原有工作区变更，建议先审阅并自行提交项目配置，或在被询问时确认如何继续。

本包**不管理**插件、子 agent、MCP、Gitee、Context7、令牌、模型或权限。已有项目配置文件不再是技能启用条件；安装器不会删除这些既有文件。

## 检查与卸载

```sh
npx @wagzhi/plan-spec doctor
npx @wagzhi/plan-spec doctor --json
npx @wagzhi/plan-spec uninstall
```

为其他项目或 global 安装运行这些命令时，传入相同的 `--project-dir` 或 `--scope global`（以及必要的 `--config-dir`）。安装记录按范围和项目路径分别保存于 `~/.plan-spec/installations/`；多个项目可以独立安装和卸载。升级已有的项目安装时，仅迁移未被用户修改的旧 `.opencode/skills/plan-spec` 技能；修改过的旧技能会阻止覆盖并保留。卸载只删除未修改的受管文件，只移除 `AGENTS.md` 中未被修改的受管区块；技能的 `plan-spec` 目录为空时一并删除，保留父目录及用户添加的文件。改过的文件会被保留并报告。

## 从旧版迁移

旧版 lite/standard 全局安装不会因新版项目安装而自动撤销。确认要清理后，显式运行：

```sh
npx @wagzhi/plan-spec legacy-uninstall
```

该操作按旧版清单清理能确认归属的全局资源；修改过的内容会保留并报告。旧密钥文件不会自动删除。建议先备份旧版全局 OpenCode 配置，并在完成清理后执行 `doctor` 验证新的项目安装。

开发和发布说明见 [DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md) 与 [PUBLISHING.md](PUBLISHING.md)。
