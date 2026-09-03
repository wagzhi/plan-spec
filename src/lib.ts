import { createHash } from "node:crypto"
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { applyEdits, modify, parse, ParseError } from "jsonc-parser"

export type Options = {
  configDir?: string
  yes?: boolean
  persistEnv?: boolean
  skipSecrets?: boolean
  disableMcp?: string[]
  model?: string[]
}

type Manifest = {
  version: string
  configDir: string
  personalConfig: string
  files: Record<string, string>
  configBefore: Record<string, unknown>
  agentsBefore: Record<string, unknown>
  managedModels: Record<string, string>
  managedMcps: Record<string, unknown>
  removedPlugin?: unknown
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const assets = join(packageRoot, "assets")
const managedBlock = `<!-- plan-spec-package:begin -->
## Plan-Spec Routing

- Use the \`plan-spec\` skill only after an explicit \`plan-spec\` or \`/plan-spec\` request.
- Delegate local Git write operations to \`@git-agent\` and Gitee operations to \`@gitee-agent\`.
- Delegate third-party documentation to \`@doc-agent\`; use \`@ask-agent\` when it also needs project context.
- Use \`@web-debug\` for browser debugging through Chrome DevTools.
<!-- plan-spec-package:end -->`

const models: Record<string, string> = {
  "ask-agent": "opencode-go/deepseek-v4-flash",
  "doc-agent": "opencode-go/deepseek-v4-flash",
  "git-agent": "opencode-go/deepseek-v4-flash",
  "gitee-agent": "opencode-go/deepseek-v4-flash",
  "web-debug": "opencode-go/deepseek-v4-flash-vision-exp",
}

const mcps = {
  context7: {
    type: "remote",
    url: "https://mcp.context7.com/mcp",
    headers: { CONTEXT7_API_KEY: "{file:~/.plan-spec/secrets/context7-api-key}" },
    enabled: true,
  },
  gitee: {
    type: "local",
    command: ["npx", "-y", "@gitee/mcp-gitee@latest"],
    enabled: true,
    environment: {
      GITEE_API_BASE: "https://gitee.com/api/v5",
      GITEE_ACCESS_TOKEN: "{file:~/.plan-spec/secrets/gitee-access-token}",
    },
  },
  chrome_devtools: {
    type: "local",
    command: ["npx", "chrome-devtools-mcp@latest"],
    enabled: true,
  },
}

function pathFromFileUrl(path: string) {
  return process.platform === "win32" && path.startsWith("/") ? path.slice(1) : path
}

function hash(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

async function exists(path: string) {
  return stat(path).then(() => true).catch(() => false)
}

export function planSpecHome() {
  return resolve(process.env.PLAN_SPEC_HOME ?? join(homedir(), ".plan-spec"))
}

export function resolveConfigDir(options: Options) {
  return resolve(options.configDir ?? process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode"))
}

async function configPath(dir: string) {
  const jsonc = join(dir, "opencode.jsonc")
  const json = join(dir, "opencode.json")
  if (await exists(jsonc) && await exists(json)) throw new Error(`Both ${jsonc} and ${json} exist; keep only one config format.`)
  return (await exists(jsonc)) ? jsonc : (await exists(json)) ? json : jsonc
}

function personalConfig(dir: string, options: Options) {
  return resolve(options.configDir ? join(dir, "opencode-personal.jsonc") : process.env.OPENCODE_CONFIG ?? join(dir, "opencode-personal.jsonc"))
}

async function loadJsonc(path: string) {
  if (!(await exists(path))) return { text: "{\n  \"$schema\": \"https://opencode.ai/config.json\"\n}\n", data: { "$schema": "https://opencode.ai/config.json" } as Record<string, unknown> }
  const text = await readFile(path, "utf8")
  const errors: ParseError[] = []
  const data = parse(text, errors) as Record<string, unknown>
  if (errors.length || !data || Array.isArray(data)) throw new Error(`Cannot parse OpenCode config: ${path}`)
  return { text, data }
}

function updateJsonc(text: string, changes: Array<{ path: (string | number)[]; value: unknown; isDeletion?: boolean }>) {
  let result = text
  for (const change of changes) {
    const edits = modify(result, change.path, change.isDeletion ? undefined : change.value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: result.includes("\r\n") ? "\r\n" : "\n" },
    })
    result = applyEdits(result, edits)
  }
  return result.endsWith("\n") ? result : `${result}\n`
}

async function backup(path: string) {
  if (!(await exists(path))) return
  const target = `${path}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`
  await copyFile(path, target)
}

async function writeJsonc(path: string, changes: Array<{ path: (string | number)[]; value: unknown; isDeletion?: boolean }>) {
  const loaded = await loadJsonc(path)
  const next = updateJsonc(loaded.text, changes)
  if (next !== loaded.text) {
    await mkdir(dirname(path), { recursive: true })
    await backup(path)
    await writeFile(path, next, "utf8")
  }
  return { before: loaded.data, after: parse(next) as Record<string, unknown> }
}

function getAt(data: Record<string, unknown>, path: string[]) {
  let value: unknown = data
  for (const part of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

async function copyManaged(source: string, target: string, files: Record<string, string>) {
  await mkdir(dirname(target), { recursive: true })
  await backup(target)
  await cp(source, target, { recursive: true, force: true })
  if ((await stat(target)).isFile()) files[target] = hash(await readFile(target))
}

async function copyTree(source: string, target: string, files: Record<string, string>) {
  if (await exists(target)) await cp(target, `${target}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`, { recursive: true })
  await cp(source, target, { recursive: true, force: true })
  const collect = async (directory: string): Promise<void> => {
    const { readdir } = await import("node:fs/promises")
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) await collect(full)
      else files[full] = hash(await readFile(full))
    }
  }
  await collect(target)
}

async function writeSecret(name: string, value?: string) {
  if (!value) return false
  const directory = join(planSpecHome(), "secrets")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, name)
  await writeFile(path, value.trim(), { encoding: "utf8", mode: 0o600 })
  if (platform() !== "win32") await (await import("node:fs/promises")).chmod(path, 0o600)
  else {
    const user = process.env.USERNAME
    if (!user || spawnSync("icacls.exe", [path, "/inheritance:r", "/grant:r", `${user}:(R,W)`], { windowsHide: true }).status !== 0) {
      throw new Error(`Could not restrict secret file permissions: ${path}`)
    }
  }
  return true
}

async function writeManagedAgents(dir: string, files: Record<string, string>) {
  for (const name of Object.keys(models)) await copyManaged(join(assets, "agents", `${name}.md`), join(dir, "agents", `${name}.md`), files)
}

async function writeRouting(dir: string, files: Record<string, string>) {
  const path = join(dir, "AGENTS.md")
  const current = (await exists(path)) ? await readFile(path, "utf8") : ""
  const expression = /<!-- plan-spec-package:begin -->[\s\S]*?<!-- plan-spec-package:end -->/
  const next = expression.test(current) ? current.replace(expression, managedBlock) : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${managedBlock}\n`
  if (next !== current) {
    await backup(path)
    await writeFile(path, next, "utf8")
  }
  files[path] = hash(await readFile(path))
}

function previousPluginIndex(data: Record<string, unknown>) {
  const plugins = data.plugin
  if (!Array.isArray(plugins)) return -1
  return plugins.findIndex((item) => typeof item === "string" && /(?:^|[\\/])plugin[\\/]plan-spec-plugin\.ts$/.test(item))
}

async function persistOpenCodeConfig(path: string) {
  if (process.env.PLAN_SPEC_NO_PERSIST_ENV === "1") return
  if (platform() === "win32") {
    const result = spawnSync("setx", ["OPENCODE_CONFIG", path], { stdio: "ignore", windowsHide: true })
    if (result.status !== 0) throw new Error("Could not persist OPENCODE_CONFIG with setx.")
    return
  }
  const profile = process.env.SHELL?.includes("zsh") ? join(homedir(), ".zshrc") : join(homedir(), ".profile")
  const block = `# plan-spec:begin\nexport OPENCODE_CONFIG=${JSON.stringify(path)}\n# plan-spec:end`
  const current = (await exists(profile)) ? await readFile(profile, "utf8") : ""
  await writeFile(profile, /# plan-spec:begin[\s\S]*?# plan-spec:end/.test(current) ? current.replace(/# plan-spec:begin[\s\S]*?# plan-spec:end/, block) : `${current.trimEnd()}\n${block}\n`)
}

function configuredModels(overrides: string[] = []) {
  const result = { ...models }
  for (const override of overrides) {
    const [agent, model] = override.split("=", 2)
    if (!agent || !model || !(agent in result)) throw new Error(`Invalid --model value: ${override}. Use one of ${Object.keys(models).join(", ")}=provider/model.`)
    result[agent] = model
  }
  return result
}

export async function install(options: Options, secrets: { gitee?: string; context7?: string } = {}) {
  const dir = resolveConfigDir(options)
  const global = await configPath(dir)
  const personal = personalConfig(dir, options)
  const files: Record<string, string> = {}
  const activeModels = configuredModels(options.model)
  const disabled = new Set(options.disableMcp ?? [])
  for (const name of disabled) if (!(name in mcps)) throw new Error(`Unknown MCP: ${name}`)
  const globalLoaded = await loadJsonc(global)
  const oldPlugin = previousPluginIndex(globalLoaded.data)
  const removedPlugin = oldPlugin >= 0 ? (globalLoaded.data.plugin as unknown[])[oldPlugin] : undefined
  const activeMcps = Object.fromEntries(Object.entries(mcps).map(([name, value]) => [name, { ...value, enabled: !disabled.has(name) }]))
  const globalChanges: Array<{ path: (string | number)[]; value: unknown; isDeletion?: boolean }> = [
    ...Object.entries(activeMcps).map(([name, value]) => ({ path: ["mcp", name], value })),
  ]
  if (oldPlugin >= 0) globalChanges.push({ path: ["plugin", oldPlugin], value: undefined, isDeletion: true })
  const globalResult = await writeJsonc(global, globalChanges)
  const personalLoaded = await loadJsonc(personal)
  const agentChanges = Object.entries(activeModels).map(([name, model]) => ({ path: ["agent", name, "model"], value: model }))
  await writeJsonc(personal, agentChanges)
  await copyTree(join(assets, "skills", "plan-spec"), join(dir, "skills", "plan-spec"), files)
  await writeManagedAgents(dir, files)
  await copyManaged(join(assets, "plugins", "plan-spec-plugin.js"), join(dir, "plugins", "plan-spec-plugin.js"), files)
  await writeRouting(dir, files)
  if (!options.skipSecrets) {
    await writeSecret("gitee-access-token", secrets.gitee)
    await writeSecret("context7-api-key", secrets.context7)
  }
  if (options.persistEnv !== false) await persistOpenCodeConfig(personal)
  const manifest: Manifest = {
    version: "0.1.0",
    configDir: dir,
    personalConfig: personal,
    files,
    configBefore: { mcp: getAt(globalResult.before, ["mcp"]), plugin: getAt(globalResult.before, ["plugin"]) },
    agentsBefore: Object.fromEntries(Object.keys(models).map((name) => [name, getAt(personalLoaded.data, ["agent", name, "model"])])),
    managedModels: activeModels,
    managedMcps: activeMcps,
    removedPlugin,
  }
  await mkdir(planSpecHome(), { recursive: true, mode: 0o700 })
  await writeFile(join(planSpecHome(), "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return { dir, global, personal }
}

export async function doctor(options: Options) {
  const dir = resolveConfigDir(options)
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const binaryCheck = platform() === "win32"
    ? spawnSync("where.exe", ["opencode"], { windowsHide: true })
    : spawnSync("opencode", ["--version"], { windowsHide: true })
  checks.push({ name: "opencode", ok: binaryCheck.status === 0, detail: "OpenCode executable" })
  for (const path of [join(dir, "skills", "plan-spec", "SKILL.md"), join(dir, "plugins", "plan-spec-plugin.js"), ...Object.keys(models).map((name) => join(dir, "agents", `${name}.md`))]) {
    checks.push({ name: basename(path), ok: await exists(path), detail: path })
  }
  try {
    const global = await loadJsonc(await configPath(dir))
    checks.push({ name: "config", ok: true, detail: "Global config parses" })
    for (const name of Object.keys(mcps)) checks.push({ name: `${name} MCP`, ok: Boolean(getAt(global.data, ["mcp", name])), detail: "Managed MCP definition" })
  }
  catch (error) { checks.push({ name: "config", ok: false, detail: error instanceof Error ? error.message : String(error) }) }
  const personal = personalConfig(dir, options)
  const loaded = await loadJsonc(personal)
  const manifestPath = join(planSpecHome(), "manifest.json")
  const expectedModels = (await exists(manifestPath)) ? (JSON.parse(await readFile(manifestPath, "utf8")) as Manifest).managedModels : models
  for (const [name, model] of Object.entries(expectedModels)) checks.push({ name: `${name} model`, ok: getAt(loaded.data, ["agent", name, "model"]) === model, detail: model })
  for (const secret of ["gitee-access-token", "context7-api-key"]) checks.push({ name: secret, ok: await exists(join(planSpecHome(), "secrets", secret)), detail: "Optional secret file" })
  return checks
}

export async function uninstall(options: Options) {
  const manifestPath = join(planSpecHome(), "manifest.json")
  if (!(await exists(manifestPath))) throw new Error("No plan-spec installation manifest found.")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
  const preserved: string[] = []
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (!(await exists(path))) continue
    if (hash(await readFile(path)) !== expected) { preserved.push(path); continue }
    if (basename(path) === "AGENTS.md") {
      const text = await readFile(path, "utf8")
      await writeFile(path, text.replace(/\n?<!-- plan-spec-package:begin -->[\s\S]*?<!-- plan-spec-package:end -->\n?/, ""))
    } else await rm(path, { force: true })
  }
  const global = await configPath(manifest.configDir)
  const globalLoaded = await loadJsonc(global)
  const mcpChanges: Array<{ path: (string | number)[]; value: unknown; isDeletion?: boolean }> = []
  for (const [name, expected] of Object.entries(manifest.managedMcps)) {
    if (JSON.stringify(getAt(globalLoaded.data, ["mcp", name])) !== JSON.stringify(expected)) continue
    const previous = getAt(manifest.configBefore.mcp as Record<string, unknown> ?? {}, [name])
    mcpChanges.push({ path: ["mcp", name], value: previous, isDeletion: previous === undefined })
  }
  if (manifest.removedPlugin !== undefined && Array.isArray(globalLoaded.data.plugin) && !globalLoaded.data.plugin.includes(manifest.removedPlugin)) {
    mcpChanges.push({ path: ["plugin", globalLoaded.data.plugin.length], value: manifest.removedPlugin })
  }
  if (mcpChanges.length) await writeJsonc(global, mcpChanges)
  const personalLoaded = await loadJsonc(manifest.personalConfig)
  const agentChanges: Array<{ path: (string | number)[]; value: unknown; isDeletion?: boolean }> = []
  for (const [name, expected] of Object.entries(manifest.managedModels)) {
    if (getAt(personalLoaded.data, ["agent", name, "model"]) !== expected) continue
    const previous = manifest.agentsBefore[name]
    agentChanges.push({ path: ["agent", name, "model"], value: previous, isDeletion: previous === undefined })
  }
  if (agentChanges.length) await writeJsonc(manifest.personalConfig, agentChanges)
  await rm(manifestPath, { force: true })
  return preserved
}

export { models, mcps, writeSecret }
