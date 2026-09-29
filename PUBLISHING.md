# 打包与发布

本文档说明如何将 `@wagzhi/plan-spec` 打包并发布到 npm。旧插件包不再发布。发布前请确认 npm 账号拥有 `@wagzhi` scope 的公开包发布权限。

## 前置条件

- Node.js 20 或更高版本。
- npm 已登录目标账号：`npm whoami`。
- 已启用 npm 要求的双因素认证或可信发布方式。
- 工作目录不包含真实密钥、旧版 `~/.plan-spec/secrets/` 内容或 OpenCode 认证文件。

首次使用该 scope 时，可检查权限：

```powershell
npm access ls-packages @wagzhi
```

如果 scope 尚不存在或没有权限，npm 会在发布时返回 `E404`、`E403` 或权限相关错误。GitHub 用户名不会自动授予同名 npm scope。

## 发布前检查

1. 更新根目录 `package.json` 中待发布包的 `version`，遵循语义化版本。
2. 安装锁定依赖并运行完整检查：

```powershell
npm ci
npm test
npm audit --omit=dev
npm run pack:check
```

3. 创建本地 tarball：

```powershell
npm pack
```

4. 在隔离目录中验证 tarball。以下示例不会修改真实 OpenCode 配置：

```powershell
$testRoot = Join-Path $env:TEMP ("plan-spec-publish-test-" + [guid]::NewGuid().ToString("N"))
$project = Join-Path $testRoot "project"
New-Item -ItemType Directory -Force $project | Out-Null
Set-Content -Path (Join-Path $project "opencode.jsonc") -Value "{}"  # 验证可选 OpenCode 命令
$env:PLAN_SPEC_HOME = Join-Path $testRoot "home"
$tgz = npm pack --pack-destination $testRoot --silent
npm install --prefix $testRoot --no-save --package-lock=false (Join-Path $testRoot $tgz)
$cli = Join-Path $testRoot "node_modules/@wagzhi/plan-spec/dist/cli.js"

Push-Location $project
try {
  node $cli install
  node $cli doctor --json
  node $cli uninstall
} finally {
  Pop-Location
}

Remove-Item Env:PLAN_SPEC_HOME
```

确认 tarball 只包含 `dist/`、共享技能及其 Codex 元数据、可选命令/路由模板、许可证、README 和 `package.json`；不应包含插件、受管子 agent、MCP 配置、测试产物、`node_modules`、本地密钥或真实配置。

## 用 npm exec 调试本地 tarball

已在项目目录执行 `npm pack`，生成 `wagzhi-plan-spec-0.5.0.tgz` 后，可直接用 tarball 的绝对路径测试 CLI，无须先发布到 npm，也无须在目标项目安装 npm 依赖。以下示例在隔离项目中运行，避免修改真实项目；更换版本时同步修改文件名。

```powershell
$tgz = (Resolve-Path .\wagzhi-plan-spec-0.5.0.tgz).Path
$testRoot = Join-Path $env:TEMP ("plan-spec-exec-test-" + [guid]::NewGuid().ToString("N"))
$project = Join-Path $testRoot "project"
New-Item -ItemType Directory -Force $project | Out-Null
Set-Content -Path (Join-Path $project "opencode.jsonc") -Value "{}"  # 验证可选 OpenCode 命令
$env:PLAN_SPEC_HOME = Join-Path $testRoot "state"

Push-Location $project
try {
  npm exec --yes --package="$tgz" -- plan-spec install
  npm exec --yes --package="$tgz" -- plan-spec doctor --json
  npm exec --yes --package="$tgz" -- plan-spec uninstall
} finally {
  Pop-Location
  Remove-Item Env:PLAN_SPEC_HOME
}
```

`$tgz` 是打包文件的绝对路径，`npm exec --package` 会将它作为 npm 包执行，不会调用系统关联的压缩软件。`install`、`doctor` 和 `uninstall` 均作用于命令执行时的当前目录。确认 `doctor --json` 所有检查项的 `ok` 为 `true`；卸载后仅清理共享技能的 `plan-spec` 目录，不删除 `.agents/skills`、`.opencode/commands` 等父目录。测试产生的临时目录可在确认后自行清理。

## 发布

包的 `package.json` 已设置 `publishConfig.access` 为 `public`。先执行 dry-run：

```powershell
npm publish --dry-run
```

确认输出的包名、版本和文件清单正确后，发布安装器：

```powershell
npm publish
```

不要使用 `--force`。npm 不允许重新发布同一版本；发布失败后应修正问题并递增版本。

### 中国大陆网络与 TLS 重置

直连 `registry.npmjs.org`（Cloudflare CDN）时可能偶发 TLS 握手被重置，表现为：

```text
npm error code ECONNRESET
npm error network request to <url> failed, reason: Client network socket disconnected before secure TLS connection was established
```

这是瞬时连接重置，不是持续被封，通常重试即可恢复。可开启自动重试并放宽超时：

```powershell
npm publish --fetch-retries 6 --fetch-retry-mintimeout 2000 --fetch-retry-maxtimeout 10000 --fetch-timeout 180000
```

若本地跑着 Clash 等代理（如 `127.0.0.1:7897`），可临时走代理发布：

```powershell
npm publish --proxy http://127.0.0.1:7897 --https-proxy http://127.0.0.1:7897
```

注意：实测代理走不走、选择直连或代理都可能因本机网络环境而异，失败时切换直连/代理并叠加 `--fetch-retries` 重试即可。

### 目标 token 必须跳过 2FA

若 npm 返回如下 403，则属于发布鉴权或 2FA 权限问题，不应按网络故障反复重试：

```text
npm error code E403
npm error 403 Forbidden - PUT <url> - Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

如使用令牌发布，须在 https://www.npmjs.com/settings/<user>/tokens 创建有相应包发布权限且符合 npm 当前 2FA 要求的令牌；使用可信发布时则检查其配置和权限。不要把令牌写入命令行示例、仓库、公共配置或打包内容。重试发布前用 `npm view @wagzhi/plan-spec@<version> version` 核对该版本是否已存在；已发布的版本不可覆盖。

## 发布后验证

等待 registry 可见后，在新目录运行：

```powershell
npx @wagzhi/plan-spec --help
npx @wagzhi/plan-spec install --help
npm view @wagzhi/plan-spec version dist-tags --json
```

然后使用临时 `PLAN_SPEC_HOME` 和 `--project-dir` 执行一次 `install` 与 `doctor`，确认公开 registry 产物可用。

## 版本与回滚

- 补丁修复：`npm version patch`。
- 新增兼容功能：`npm version minor`。
- 不兼容配置或 CLI 改动：`npm version major`。
- 已发布版本不可覆盖。发现严重问题时发布修复版本，并用 `npm deprecate` 标记错误版本；不要删除已被用户安装的版本。

## 发布安全

- 安装器不管理凭证；不得将真实密钥写入安装清单、日志或 README 示例。
- 发布前检查 `git diff`、`npm pack --dry-run` 和 tarball 内容。
- 发布令牌、npm OTP、OpenCode `auth.json` 和 `~/.plan-spec/secrets/` 均不得进入仓库或 CI 日志。
