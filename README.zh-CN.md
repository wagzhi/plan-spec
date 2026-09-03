# @wagzhi/plan-spec

为 OpenCode 安装 plan-spec 技能、显式触发插件、五个子 agent 及其依赖的 MCP 配置。

```powershell
npx @wagzhi/plan-spec install
npx @wagzhi/plan-spec config
npx @wagzhi/plan-spec doctor
npx @wagzhi/plan-spec uninstall
```

安装器只在用户显式输入 `plan-spec` 或 `/plan-spec` 时触发计划规范。项目是否启用仍由
`spec/plan-spec.json` 的 `enabled` 字段决定。

密钥保存于 `~/.plan-spec/secrets/` 并通过 OpenCode 的 `{file:...}` 引用；安装器不会写入
OpenCode 的认证存储。OpenCode Go 请在安装后通过 `/connect` 登录。

`config` 支持 `--disable-mcp context7|gitee|chrome_devtools` 和
`--model agent=provider/model`，其余个人配置字段会保留不变。

打包和 npm 发布流程见 [PUBLISHING.md](PUBLISHING.md)。
