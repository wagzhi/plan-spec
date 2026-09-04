# Development Guide

本地开发与测试指南。核心原则：**不发布 npm 包即可在本地完成全部 CLI / 插件验证**。

## 前置条件

- 已安装依赖：根目录执行 `npm install`（CLI 运行时依赖 `@clack/prompts`、`commander` 都在根 `node_modules`）。
- 构建产物：先 `npm run build`（`tsc -p tsconfig.json` 输出到 `dist/`）。

## 为什么本地测试需要隔离两个目录

CLI 有两个独立的状态目标，`--config-dir` 只能隔离其中一个：

1. **OpenCode 配置目录**（`--config-dir` 指定，默认 `~/.config/opencode`）——写入 skill / agent / `opencode.json(c)`。
2. **安装清单目录**（`~/.plan-spec/manifest.json`）——安装状态。**不受 `--config-dir` 控制**，只能通过环境变量 `PLAN_SPEC_HOME` 隔离（见 `src/lib.ts` 的 `planSpecHome()`）。

> 注意：本机若已通过 0.1.x 安装过，`~/.plan-spec/manifest.json` 版本为 `0.1.0`。0.2.x 检测到该旧清单会直接拒绝安装（`loadManifest` 的版本校验）。因此本地测试必须设置 `PLAN_SPEC_HOME` 指向一个全新目录，否则会被旧清单阻断。

## OpenCode 配置与插件规则

安装、升级和卸载都会先检查目标目录的 OpenCode 配置文件：

1. 同时存在 `opencode.jsonc` 与 `opencode.json` 时，始终读写 `opencode.jsonc`。
2. 仅存在其中一个时，读写该文件。
3. 两者都不存在时，创建 `opencode.jsonc`。

只管理 `@wagzhi/plan-spec-plugin` 这一项：已有该插件则原位置替换，不存在则追加；卸载时只删除或恢复这一项，不影响其他插件。

默认目录 `~/.config/opencode` 使用插件自身的默认配置路径，因此写入：

```jsonc
"plugin": ["@wagzhi/plan-spec-plugin@^0.2.0"]
```

使用非默认 `--config-dir` 时，插件需要显式读取该目录的 `plan-spec.jsonc`，因此写入带 `configPath` 的插件项。

安装器还会在 `plan-spec.jsonc` 的根级 `permission` 写入以下全局 deny 规则：

```jsonc
"permission": {
  "context7_*": "deny",
  "chrome_devtools_*": "deny"
}
```

插件会将其深度合并到 OpenCode runtime config。agent 自身的权限优先于全局规则，因此 `@doc-agent`、`@ask-agent` 的 Context7 allow 与 `@web-debug` 的 Chrome DevTools allow 仍然可用；主 agent 则不能直接调用这些工具。

## AGENTS 路由模板

`assets/templates/plan-spec-routing.md` 是受管 `AGENTS.md` 区块的唯一来源，包含 plan-spec 触发规则和五个 subagent 的职责说明。安装或升级仅替换该文件中 `plan-spec-package` 标记包围的区块；卸载只移除该区块，保留区块外的用户内容且不创建备份。

## CLI 冒烟测试（隔离目录）

同时隔离配置目录与安装状态目录，任何情况都不会污染真实 `~/.config/opencode` 或 `~/.plan-spec`：

```powershell
$env:PLAN_SPEC_HOME = "$PWD\temp\test-plan-spec-home"

# install：--yes --skip-secrets 避免交互式输入 Gitee / Context7 密钥
node dist/cli.js install `
  --config-dir "$PWD\temp\test-opencode" `
  --yes `
  --skip-secrets

# doctor：校验安装结果
node dist/cli.js doctor `
  --config-dir "$PWD\temp\test-opencode" `
  --json

# uninstall：清理
node dist/cli.js uninstall `
  --config-dir "$PWD\temp\test-opencode"

Remove-Item Env:PLAN_SPEC_HOME
```

对应一条命令验证版本 / 产物：

```powershell
node dist/cli.js --version
npm pack --dry-run   # 或 npm pack，检查 tarball 内容，不发布
```

## 插件层测试（纯 node，不依赖 opencode）

`plugin/index.js` 的 `PlanSpecPlugin` 是纯函数，可直接 import 单测：

- `chat.message`：喂入 `"plan-spec 处理某任务"`，断言输出被注入「请使用 plan-spec 技能」指令；
- `config`：构造一个含合并内容的临时 `plan-spec.jsonc`，断言其被 `deepMerge` 进 runtime config；
- 缺配置文件：断言只打 warning、不抛错。

仓库已有 `tests/**/*.test.mjs`，普通单测可并入 `npm test`（它只跑 `tsc + node --test`，不会发布）。

## 在 opencode 中实测插件（不发布）

推荐通过本地 tgz 验证发布产物。OpenCode 会从 `file:` 规范安装插件，因此无需发布到 npm。

```powershell
# 在仓库根目录生成插件 tarball
pnpm pack ./plugin
```

该命令生成 `wagzhi-plan-spec-plugin-<version>.tgz`。在目标 OpenCode 配置的 `plugin` 数组中，用 `file:` 前缀引用它。不要直接写 `./wagzhi-plan-spec-plugin-<version>.tgz`，否则 OpenCode 会将 tgz 当作可直接 import 的源码路径。

默认配置目录 `~/.config/opencode` 中，插件使用默认 `plan-spec.jsonc` 路径：

```jsonc
{
  "plugin": [
    "file:./wagzhi-plan-spec-plugin-0.2.0.tgz"
  ]
}
```

使用隔离目录时，保留 `configPath`，使插件读取对应的受管配置：

```jsonc
{
  "plugin": [
    [
      "file:./wagzhi-plan-spec-plugin-0.2.0.tgz",
      {
        "configPath": "E:/workspace/plan-spec/temp/test-opencode/plan-spec.jsonc"
      }
    ]
  ]
}
```

- `file:./...` 相对于启动 `opencode` 时的当前工作目录，而不是相对于配置文件。以上示例应从仓库根目录启动 `opencode`。
- 替换安装器写入的 `@wagzhi/plan-spec-plugin@^0.2.0`，不要同时保留 npm 包和本地 tgz，否则两个来源都可能被加载。
- 当前 `plugin/index.js` 未导出本地路径插件所需的 `id`，因此不要把 `plugin/` 目录或 `file:///.../plugin` 直接加入配置；本项目的本地测试应使用 tgz。
- 修改插件后重新打包。为避免使用相同文件名时的安装缓存，建议提升 `plugin/package.json` 的本地预发布版本，例如 `0.2.1-local.1`，并更新配置中的 tgz 文件名。

重启 OpenCode 后，可执行 `opencode debug config` 检查配置解析结果；输入 `/plan-spec <task>`、`psw <task>` 或 `/psw <task>`，确认消息被改写为 skill 指令。设置 `PLAN_SPEC_CONFIG_DEBUG=1` 可输出插件加载与配置合并日志。

## 从 0.1.x 真实环境升级（会改真实配置，谨慎）

真实环境若要升级，需先用**旧包**卸载，因为 0.2.x 的 `uninstall` 同样先做版本校验，无法卸载 0.1.0：

```powershell
npm exec --package=.\wagzhi-plan-spec-0.1.0.tgz -- plan-spec uninstall
```

再用 0.2.x 安装。此操作会修改真实 OpenCode 配置与安装清单，执行前务必确认。
