# @wagzhi/plan-spec

[English](README.md) | [简体中文](README.zh-CN.md)

通过一条命令为 OpenCode 安装和管理计划先行的工作流。本包会安装 plan-spec 技能、显式触发插件、
五个职责明确的子 agent，以及这些 agent 使用的 MCP 配置。

本项目替代了 [`wagzhi/opencode-config`](https://github.com/wagzhi/opencode-config)
通过配置仓库手工分发 OpenCode 配置的方式。现在无需再将配置仓库克隆到
`~/.config/opencode`、复制个人配置模板，或使用 `.env` 维护受管 MCP 的密钥。

## 前置条件

- 已安装 [OpenCode](https://opencode.ai/)，并可从 `PATH` 调用
- Node.js 20 或更高版本，包含 `npx`
- OpenCode 启动时可使用 [Bun](https://bun.sh/) 安装 npm 插件
- 用于 Gitee 操作的 Gitee Access Token（可选）
- 用于查询第三方文档的 Context7 API Key（可选）

默认 agent 模型使用 OpenCode Go。安装后请在 OpenCode 中执行 `/connect`，并选择
**OpenCode Go** 完成认证。

## 快速开始

1. 运行交互式安装程序：

   ```sh
   npx @wagzhi/plan-spec install
   ```

   安装器会提示输入 Gitee Access Token 和 Context7 API Key。两项都可以留空，稍后再配置。

2. 启动 OpenCode，执行 `/connect` 并选择 **OpenCode Go**，然后重启 OpenCode，使其加载新安装的
   插件和配置。

3. 验证安装结果：

   ```sh
   npx @wagzhi/plan-spec doctor
   ```

4. 在 OpenCode 中使用任一支持的形式显式发起 plan-spec 请求：

   ```text
   /plan-spec 实现用户认证
   plan-spec 修复结算回归问题
   /psw 迁移 API 客户端
   psw 重构配置加载器
   ```

## 安装内容

| 资源 | 用途 |
| --- | --- |
| `skills/plan-spec/` | 项目计划、执行追踪和结果回填工作流 |
| `@wagzhi/plan-spec-plugin@^0.2.0` | 加载 `plan-spec.jsonc` 并展开显式 plan-spec 请求 |
| `@ask-agent` | 结合本地代码和第三方文档回答项目问题 |
| `@doc-agent` | 查询第三方文档、SDK、API 和技术规范 |
| `@git-agent` | 执行用户请求的本地 Git 操作 |
| `@gitee-agent` | 处理 Gitee Issue、Pull Request、审查、合并和任务进度 |
| `@web-debug` | 通过 Chrome DevTools 调试浏览器页面 |

安装器还会管理以下 MCP：

| MCP | 用途 |
| --- | --- |
| `context7` | 供 `@doc-agent` 和 `@ask-agent` 查询第三方库文档 |
| `gitee` | 供 `@gitee-agent` 操作 Gitee 仓库和项目 |
| `chrome_devtools` | 供 `@web-debug` 检查和调试浏览器 |

默认禁止主 agent 直接调用 Context7 和 Chrome DevTools，仅允许对应的专用子 agent 调用，
从而保持工具路由清晰、可预测。

## 项目中使用

安装本包只会让工作流在全局可用，不会自动为所有项目启用 plan-spec。必须同时满足以下条件：

1. 请求以 `plan-spec`、`/plan-spec`、`psw` 或 `/psw` 开头。
2. 项目包含 `spec/plan-spec.json`，且 `enabled` 为 `true`。

如果某个项目尚无该文件，第一次显式调用时，Build Mode 会询问是否启用 plan-spec，以及是否关联
Gitee 项目管理；Plan Mode 只说明后续配置步骤。最小项目配置如下：

```json
{
  "enabled": true,
  "projectManager": { "enabled": false }
}
```

启用后，实现计划保存在 `spec/feats/`。Plan Mode 始终保持只读；Build Mode 可以写入计划、
修改实现、运行检查并回填执行结果。

## 配置管理

使用 `config` 重新应用受管配置、更新密钥、禁用 MCP 或覆盖 agent 模型：

```sh
npx @wagzhi/plan-spec config
```

禁用一个或多个受管 MCP：

```sh
npx @wagzhi/plan-spec config --disable-mcp chrome_devtools context7
```

覆盖一个或多个受管 agent 模型：

```sh
npx @wagzhi/plan-spec config --model ask-agent=opencode-go/deepseek-v4-pro doc-agent=provider/model
```

支持的 agent 名称为 `ask-agent`、`doc-agent`、`git-agent`、`gitee-agent` 和
`web-debug`。

| Agent | 默认模型 |
| --- | --- |
| `ask-agent` | `opencode-go/deepseek-v4-flash` |
| `doc-agent` | `opencode-go/deepseek-v4-flash` |
| `git-agent` | `opencode-go/deepseek-v4-flash` |
| `gitee-agent` | `opencode-go/deepseek-v4-flash` |
| `web-debug` | `opencode-go/deepseek-v4-flash-vision-exp` |

其他安装参数：

| 参数 | 说明 |
| --- | --- |
| `-y`、`--yes` | 不提示并使用默认选项；不会请求密钥 |
| `--skip-secrets` | 不请求或更新密钥文件 |
| `--config-dir <path>` | 使用自定义 OpenCode 全局配置目录 |
| `--disable-mcp <names...>` | 禁用 `context7`、`gitee` 和/或 `chrome_devtools` |
| `--model <agent=model...>` | 覆盖受管 agent 的模型 |

未传入 `--config-dir` 时，也可以通过 `OPENCODE_CONFIG_DIR` 指定 OpenCode 配置目录。

## 受管文件

默认情况下，安装器管理以下内容：

```text
~/.config/opencode/
├── opencode.jsonc              # 仅注册插件
├── plan-spec.jsonc             # 受管 agent、MCP 和权限
├── AGENTS.md                   # 受管路由区块
├── agents/                     # 五个受管子 agent
└── skills/plan-spec/           # plan-spec 技能

~/.plan-spec/
├── manifest.json               # 安装状态
└── secrets/
    ├── gitee-access-token
    └── context7-api-key
```

密钥通过 `{file:...}` 变量引用，不会直接写入 OpenCode 配置。设置 `PLAN_SPEC_HOME` 可以改变安装
状态和密钥的根目录。安装器不会写入 OpenCode 的认证存储，也不会创建或修改
`opencode-personal.jsonc`。

现有的无关 OpenCode 配置和插件会被保留。本包管理的路径和字段可能在再次运行 `install` 或
`config` 时被替换。

## 验证与排障

运行适合人工阅读的检查：

```sh
npx @wagzhi/plan-spec doctor
```

获取结构化输出：

```sh
npx @wagzhi/plan-spec doctor --json
```

`doctor` 会检查 OpenCode 可执行文件、已安装的技能和 agent、插件注册、受管模型、MCP 定义、
权限和可选密钥文件。如果 OpenCode 没有加载新资源，请完成 `/connect`、重启 OpenCode，然后再次
运行 `doctor`。

## 从 `opencode-config` 迁移

安装器替代了旧仓库的手工分发流程，但不会自动删除所有旧文件或旧配置项。

1. 备份当前的 `~/.config/opencode` 目录。
2. 停止将旧仓库工作区作为安装和更新机制。
3. 运行 `npx @wagzhi/plan-spec install`，并配置 Gitee 和 Context7 密钥。
4. 完成 `/connect`，重启 OpenCode，然后运行 `doctor`。
5. 验证通过后，删除不再需要的重复 MCP 定义、旧路由说明和其他遗留文件。

安装器不管理旧方案中的 `tui.json`、command 文件、个人 provider 模板或
`opencode-skill-creator` 插件。如果仍需使用，请单独保留和维护。

## 卸载

```sh
npx @wagzhi/plan-spec uninstall
```

卸载程序会删除未修改的受管资源，尽可能恢复原有配置值，并从 `AGENTS.md` 中移除受管区块。
已被修改的受管文件会保留并报告。密钥文件也会保留，避免意外删除。

## 开发与发布

- 本地开发和测试说明：[DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md)
- npm 发布说明：[PUBLISHING.md](PUBLISHING.md)
- 源码仓库：[wagzhi/plan-spec](https://github.com/wagzhi/plan-spec)
