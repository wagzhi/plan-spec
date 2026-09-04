import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { applyEdits, modify, parse, ParseError } from "jsonc-parser"

export type Options = {
  configDir?: string
  yes?: boolean
  skipSecrets?: boolean
  disableMcp?: string[]
  model?: string[]
}

type Manifest = {
  version: string
  configDir: string
  planSpecConfig: string
  planSpecConfigExisted: boolean
  files: Record<string, string>
  configBefore: Record<string, unknown>
  managedModels: Record<string, string>
  managedMcps: Record<string, unknown>
  managedPermissions?: Record<string, string>
  managedPlugin: unknown
  pluginBefore?: unknown
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const assets = join(packageRoot, "assets")
const planSpecPlugin = "@wagzhi/plan-spec-plugin@^0.2.0"
const manifestVersion = "0.2.0"
const managedBlockPath = join(assets, "templates", "plan-spec-routing.md")
const managedBlockExpression = /<!-- plan-spec-package:begin -->[\s\S]*?<!-- plan-spec-package:end -->/

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

const permissions = {
  "context7_*": "deny",
  "chrome_devtools_*": "deny",
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

function defaultConfigDir() {
  return resolve(join(homedir(), ".config", "opencode"))
}

export function resolveConfigDir(options: Options) {
  return resolve(options.configDir ?? process.env.OPENCODE_CONFIG_DIR ?? defaultConfigDir())
}

function planSpecConfigPath(dir: string) {
  return join(dir, "plan-spec.jsonc")
}

async function configPath(dir: string) {
  const jsonc = join(dir, "opencode.jsonc")
  const json = join(dir, "opencode.json")
  if (await exists(jsonc)) return jsonc
  return (await exists(json)) ? json : jsonc
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

async function writeJsonc(path: string, changes: Array<{ path: (string | number)[]; value: unknown; isDeletion?: boolean }>, createBackup = true) {
  const loaded = await loadJsonc(path)
  const next = updateJsonc(loaded.text, changes)
  if (next !== loaded.text) {
    await mkdir(dirname(path), { recursive: true })
    if (createBackup) await backup(path)
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

function same(value: unknown, expected: unknown) {
  return JSON.stringify(value) === JSON.stringify(expected)
}

async function copyManaged(source: string, target: string, files: Record<string, string>) {
  await mkdir(dirname(target), { recursive: true })
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
  const normalized = value?.trim()
  if (!normalized) return false
  const directory = join(planSpecHome(), "secrets")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, name)
  await writeFile(path, normalized, { encoding: "utf8", mode: 0o600 })
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
  const managedBlock = (await readFile(managedBlockPath, "utf8")).trimEnd()
  const next = managedBlockExpression.test(current) ? current.replace(managedBlockExpression, managedBlock) : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${managedBlock}\n`
  if (next !== current) await writeFile(path, next, "utf8")
  files[path] = hash(await readFile(path))
}

function pluginName(item: unknown) {
  if (typeof item === "string") return item
  return Array.isArray(item) && typeof item[0] === "string" ? item[0] : undefined
}

function isPlanSpecPlugin(item: unknown) {
  return /^@wagzhi\/plan-spec-plugin(?:@.+)?$/.test(pluginName(item) ?? "")
}

function pluginEntry(dir: string, planSpecConfig: string) {
  return dir === defaultConfigDir() ? planSpecPlugin : [planSpecPlugin, { configPath: planSpecConfig }]
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

async function loadManifest() {
  const path = join(planSpecHome(), "manifest.json")
  if (!(await exists(path))) return undefined
  const manifest = JSON.parse(await readFile(path, "utf8")) as Manifest
  if (!/^0\.2\./.test(manifest.version)) throw new Error(`Unsupported plan-spec installation manifest version: ${manifest.version}. Uninstall version 0.1.x before installing 0.2.x.`)
  return manifest
}

function addPreserved(preserved: string[], path: string) {
  if (!preserved.includes(path)) preserved.push(path)
}

function isEmptyConfig(data: Record<string, unknown>): boolean {
  return Object.entries(data).every(([key, value]) => key === "$schema" || (value !== null && typeof value === "object" && !Array.isArray(value) && isEmptyConfig(value as Record<string, unknown>)))
}

export async function install(options: Options, secrets: { gitee?: string; context7?: string } = {}) {
  const dir = resolveConfigDir(options)
  const existingManifest = await loadManifest()
  if (existingManifest && existingManifest.configDir !== dir) throw new Error(`Existing plan-spec installation belongs to ${existingManifest.configDir}. Use that config directory or uninstall it first.`)

  const global = await configPath(dir)
  const planConfig = planSpecConfigPath(dir)
  const planConfigExisted = await exists(planConfig)
  const globalLoaded = await loadJsonc(global)
  const planLoaded = await loadJsonc(planConfig)
  const files: Record<string, string> = {}
  const activeModels = configuredModels(options.model)
  const activePermissions = { ...permissions }
  const disabled = new Set(options.disableMcp ?? [])
  for (const name of disabled) if (!(name in mcps)) throw new Error(`Unknown MCP: ${name}`)
  const activeMcps = Object.fromEntries(Object.entries(mcps).map(([name, value]) => [name, { ...value, enabled: !disabled.has(name) }]))

  const plugins = Array.isArray(globalLoaded.data.plugin) ? globalLoaded.data.plugin : []
  const oldPlugin = plugins.findIndex(isPlanSpecPlugin)
  const managedPlugin = pluginEntry(dir, planConfig)
  await writeJsonc(global, [{ path: ["plugin", oldPlugin >= 0 ? oldPlugin : plugins.length], value: managedPlugin }])

  const planChanges: Array<{ path: (string | number)[]; value: unknown }> = [
    ...Object.entries(activeModels).map(([name, model]) => ({ path: ["agent", name, "model"], value: model })),
    ...Object.entries(activeMcps).map(([name, value]) => ({ path: ["mcp", name], value })),
    ...Object.entries(activePermissions).map(([name, value]) => ({ path: ["permission", name], value })),
  ]
  await writeJsonc(planConfig, planChanges)
  await copyTree(join(assets, "skills", "plan-spec"), join(dir, "skills", "plan-spec"), files)
  await writeManagedAgents(dir, files)
  await writeRouting(dir, files)
  if (!options.skipSecrets) {
    await writeSecret("gitee-access-token", secrets.gitee)
    await writeSecret("context7-api-key", secrets.context7)
  }

  const manifest: Manifest = {
    version: manifestVersion,
    configDir: dir,
    planSpecConfig: planConfig,
    planSpecConfigExisted: existingManifest?.planSpecConfigExisted ?? planConfigExisted,
    files,
    configBefore: existingManifest?.configBefore ?? planLoaded.data,
    managedModels: activeModels,
    managedMcps: activeMcps,
    managedPermissions: activePermissions,
    managedPlugin,
    pluginBefore: existingManifest?.pluginBefore ?? (oldPlugin >= 0 ? plugins[oldPlugin] : undefined),
  }
  await mkdir(planSpecHome(), { recursive: true, mode: 0o700 })
  await writeFile(join(planSpecHome(), "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  return { dir, global, planSpecConfig: planConfig }
}

export async function doctor(options: Options) {
  const dir = resolveConfigDir(options)
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  const binaryCheck = platform() === "win32"
    ? spawnSync("where.exe", ["opencode"], { windowsHide: true })
    : spawnSync("opencode", ["--version"], { windowsHide: true })
  checks.push({ name: "opencode", ok: binaryCheck.status === 0, detail: "OpenCode executable" })
  for (const path of [join(dir, "skills", "plan-spec", "SKILL.md"), ...Object.keys(models).map((name) => join(dir, "agents", `${name}.md`))]) {
    checks.push({ name: basename(path), ok: await exists(path), detail: path })
  }
  try {
    const global = await loadJsonc(await configPath(dir))
    checks.push({ name: "config", ok: true, detail: "Global config parses" })
    checks.push({ name: "plan-spec plugin", ok: Array.isArray(global.data.plugin) && global.data.plugin.some(isPlanSpecPlugin), detail: planSpecPlugin })
  }
  catch (error) { checks.push({ name: "config", ok: false, detail: error instanceof Error ? error.message : String(error) }) }

  const manifest = await loadManifest()
  const planConfig = manifest?.planSpecConfig ?? planSpecConfigPath(dir)
  try {
    const config = await loadJsonc(planConfig)
    checks.push({ name: "plan-spec config", ok: await exists(planConfig), detail: planConfig })
    const expectedModels = manifest?.managedModels ?? models
    const expectedMcps = manifest?.managedMcps ?? mcps
    const expectedPermissions = manifest?.managedPermissions ?? permissions
    for (const [name, model] of Object.entries(expectedModels)) checks.push({ name: `${name} model`, ok: getAt(config.data, ["agent", name, "model"]) === model, detail: model })
    for (const [name, mcp] of Object.entries(expectedMcps)) checks.push({ name: `${name} MCP`, ok: same(getAt(config.data, ["mcp", name]), mcp), detail: "Managed MCP definition" })
    for (const [name, permission] of Object.entries(expectedPermissions)) checks.push({ name: `${name} permission`, ok: getAt(config.data, ["permission", name]) === permission, detail: permission })
  }
  catch (error) { checks.push({ name: "plan-spec config", ok: false, detail: error instanceof Error ? error.message : String(error) }) }
  for (const secret of ["gitee-access-token", "context7-api-key"]) checks.push({ name: secret, ok: await exists(join(planSpecHome(), "secrets", secret)), detail: "Optional secret file" })
  return checks
}

export async function uninstall(options: Options) {
  const manifestPath = join(planSpecHome(), "manifest.json")
  if (!(await exists(manifestPath))) throw new Error("No plan-spec installation manifest found.")
  const manifest = await loadManifest()
  if (!manifest) throw new Error("No plan-spec installation manifest found.")
  const preserved: string[] = []

  for (const [path, expected] of Object.entries(manifest.files)) {
    if (!(await exists(path))) continue
    if (basename(path) === "AGENTS.md") {
      const text = await readFile(path, "utf8")
      const next = text.replace(new RegExp(`\\n?${managedBlockExpression.source}\\n?`), "")
      if (next !== text) await writeFile(path, next, "utf8")
      continue
    }
    if (hash(await readFile(path)) !== expected) { addPreserved(preserved, path); continue }
    await rm(path, { force: true })
  }

  const global = await configPath(manifest.configDir)
  const globalLoaded = await loadJsonc(global)
  if (Array.isArray(globalLoaded.data.plugin)) {
    const index = globalLoaded.data.plugin.findIndex(isPlanSpecPlugin)
    if (index >= 0) await writeJsonc(global, [{ path: ["plugin", index], value: manifest.pluginBefore, isDeletion: manifest.pluginBefore === undefined }], false)
  }

  const config = await loadJsonc(manifest.planSpecConfig)
  const configChanges: Array<{ path: (string | number)[]; value: unknown; isDeletion?: boolean }> = []
  for (const [name, expected] of Object.entries(manifest.managedMcps)) {
    if (!same(getAt(config.data, ["mcp", name]), expected)) { addPreserved(preserved, manifest.planSpecConfig); continue }
    const previous = getAt(manifest.configBefore, ["mcp", name])
    configChanges.push({ path: ["mcp", name], value: previous, isDeletion: previous === undefined })
  }
  for (const [name, expected] of Object.entries(manifest.managedModels)) {
    if (getAt(config.data, ["agent", name, "model"]) !== expected) { addPreserved(preserved, manifest.planSpecConfig); continue }
    const previous = getAt(manifest.configBefore, ["agent", name, "model"])
    configChanges.push({ path: ["agent", name, "model"], value: previous, isDeletion: previous === undefined })
  }
  for (const [name, expected] of Object.entries(manifest.managedPermissions ?? {})) {
    if (getAt(config.data, ["permission", name]) !== expected) { addPreserved(preserved, manifest.planSpecConfig); continue }
    const previous = getAt(manifest.configBefore, ["permission", name])
    configChanges.push({ path: ["permission", name], value: previous, isDeletion: previous === undefined })
  }
  if (configChanges.length) await writeJsonc(manifest.planSpecConfig, configChanges, false)
  if (!manifest.planSpecConfigExisted && await exists(manifest.planSpecConfig)) {
    const after = await loadJsonc(manifest.planSpecConfig)
    if (isEmptyConfig(after.data)) await rm(manifest.planSpecConfig, { force: true })
  }

  await rm(manifestPath, { force: true })
  return preserved
}

export { models, mcps, permissions, writeSecret }
