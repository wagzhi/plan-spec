# Development Guide

本地构建、测试和隔离安装 OpenCode V2 与 Codex 共享的 plan-spec 技能，无需发布 npm 包。

## 构建与测试

```powershell
npm ci
npm test
npm run pack:check
```

`npm test` 构建 CLI 并运行项目范围、全局范围、OpenCode 命令检测、跨版本升级、重复安装、迁移、受管文件保护及旧版清理测试。发布包只包含共享技能（及 Codex 显式调用元数据）、可选项目命令、项目路由模板和旧版清理所需的模板；旧插件、受管子 agent、MCP 与密钥资源不再分发。

## 隔离冒烟测试

项目安装目标与安装记录是独立的：`--project-dir` 指定项目目录，`PLAN_SPEC_HOME` 指定安装记录目录。global 安装还可以通过 `--config-dir` 指定独立的 OpenCode 全局配置目录。不要在开发测试中使用真实项目或真实用户目录。

```powershell
$testRoot = Join-Path $PWD "temp\test-plan-spec"
$env:PLAN_SPEC_HOME = Join-Path $testRoot "state"
$project = Join-Path $testRoot "project"
New-Item -ItemType Directory -Force $project | Out-Null
Set-Content -Path (Join-Path $project "opencode.jsonc") -Value "{}"  # 验证自动安装 OpenCode 命令

npm run build
node dist/cli.js install --project-dir $project
node dist/cli.js doctor --project-dir $project --json
node dist/cli.js upgrade --project-dir $project  # 同版本不重写
node dist/cli.js uninstall --project-dir $project

Remove-Item Env:PLAN_SPEC_HOME
```

在工作仓库的子目录运行 `install` 且不传 `--project-dir` 时，只安装到该子目录，不自动上溯到 Git 根目录。运行 `/plan-spec <需求>` 和 `/plan-spec 执行 <计划路径>` 的人工验收须在安装后的 OpenCode V2 项目会话中进行：检查前者先规划，后者在只读规划模式下不写入。

另需在隔离项目模拟 SkillHub 安装：自行建立 `.agents/skills/plan-spec/SKILL.md`，运行 `node dist/cli.js command install --project-dir $project`、`node dist/cli.js command upgrade --project-dir $project` 与 `node dist/cli.js command uninstall --project-dir $project`，确认只创建、检查或移除 `.opencode/commands/plan-spec.md`；不更改既有技能与 `AGENTS.md`。此入口必须由用户明确要求执行，不属于技能安装时的自动脚本。

旧版全局安装清单位于 `~/.plan-spec/manifest.json`，新版多目标清单位于 `~/.plan-spec/installations/`。仅在隔离环境或明确要撤销旧版安装时运行 `legacy-uninstall`；它不应由 `install` 自动调用。

## 发布前打包测试

不要先发布到 npm。先运行 `npm test`、`npm run pack:check`，然后将真正的 tarball 安装到隔离目录做冒烟测试：

```powershell
$testRoot = Join-Path $env:TEMP ("plan-spec-pack-" + [guid]::NewGuid().ToString("N"))
$project = Join-Path $testRoot "project"
New-Item -ItemType Directory -Force $project | Out-Null
Set-Content -Path (Join-Path $project "opencode.jsonc") -Value "{}"  # 验证自动安装 OpenCode 命令
$tgz = npm pack --pack-destination $testRoot --silent
npm install --prefix $testRoot --no-save --package-lock=false (Join-Path $testRoot $tgz)
$cli = Join-Path $testRoot "node_modules/@wagzhi/plan-spec/dist/cli.js"
$env:PLAN_SPEC_HOME = Join-Path $testRoot "state"

Push-Location $project
try {
  node $cli install
  node $cli doctor --json
  node $cli upgrade
  node $cli uninstall
} finally {
  Pop-Location
}

Remove-Item Env:PLAN_SPEC_HOME
```

确认 `doctor` 的所有 `ok` 均为 `true`，同版本 `upgrade` 提示未修改；在隔离项目中检查 `.agents/skills/plan-spec/`、`.opencode/commands/plan-spec.md` 及根目录 `AGENTS.md` 的版本号，并确认没有写入真实项目或全局配置。移除 `opencode.jsonc` 标记再安装到新的临时项目时，只应出现共享技能和 `AGENTS.md`。跨版本升级由自动化测试中的隔离包副本验证。测试 tarball 和临时目录按需手动清理。
