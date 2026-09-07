# @wagzhi/plan-spec

为 OpenCode 安装 plan-spec 技能、显式触发插件、五个子 agent 及其依赖的 MCP 配置。

```powershell
npx @wagzhi/plan-spec install
npx @wagzhi/plan-spec config
npx @wagzhi/plan-spec doctor
npx @wagzhi/plan-spec uninstall
```

安装器只在用户显式输入 `plan-spec`、`/plan-spec`、`psw` 或 `/psw` 时触发计划规范。项目是否启用仍由
`spec/plan-spec.json` 的 `enabled` 字段决定。

显式触发插件以 `@wagzhi/plan-spec-plugin@^0.2.0` npm 包写入 OpenCode 主配置作为最小引导；五个
agent 的模型配置和三项 MCP 配置统一写入 `~/.config/opencode/plan-spec.jsonc`。OpenCode 会在启动时
用 Bun 安装 npm 插件，因此本机需可用 Bun；技能和 agent 仍复制至 OpenCode 全局配置目录。

密钥保存于 `~/.plan-spec/secrets/` 并以 `{file:...}` 引用；由于 `plan-spec.jsonc` 由插件
加载，插件会在运行时解析受管的 Gitee 与 Context7 密钥引用。设置 `PLAN_SPEC_HOME` 可使用
其他密钥根目录。安装器不会写入 OpenCode 的认证存储。OpenCode Go 请在安装后通过 `/connect` 登录。

`config` 支持 `--disable-mcp context7|gitee|chrome_devtools` 和
`--model agent=provider/model`，仅更新 `plan-spec.jsonc` 的受管字段；不创建也不修改
`opencode-personal.jsonc`。`--config-dir` 可改变 OpenCode 配置根目录，未传时即使用
`~/.config/opencode`。

打包和 npm 发布流程见 [PUBLISHING.md](PUBLISHING.md)。
