import { createHash } from "node:crypto"
import { mkdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { applyEdits, modify, parse, ParseError } from "jsonc-parser"

export type Scope = "project" | "global"
export type Options = { scope?: string; projectDir?: string; configDir?: string; withOpencodeCommand?: boolean; withoutOpencodeCommand?: boolean }
type Installation = {
  version: 1
  scope: Scope
  target: string
  files: Record<string, string>
  resourceVersions?: Record<string, string>
  opencodeCommandPreference?: boolean
  routing?: { path: string; block: string; created: boolean }
}
type LegacyManifest = {
  version: string
  configDir: string
  planSpecConfig: string
  planSpecConfigExisted: boolean
  files: Record<string, string>
  configBefore: Record<string, unknown>
  managedModels: Record<string, string>
  managedMcps: Record<string, unknown>
  managedPermissions?: unknown[]
  managedPlugin: unknown
  pluginBefore?: unknown
  mode?: "lite" | "standard"
}

const assets = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "assets")
const marker = /<!-- plan-spec-package:begin -->[\s\S]*?<!-- plan-spec-package:end -->/
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
let packageVersionPromise: Promise<string> | undefined

export function packageVersion() {
  return packageVersionPromise ??= readFile(join(packageRoot, "package.json"), "utf8")
    .then((text) => (JSON.parse(text) as { version: string }).version)
}

function renderVersion(content: string, version: string) {
  if (!/<!-- plan-spec-version: [^>]+ -->/.test(content)) throw new Error("Missing plan-spec version marker in packaged asset.")
  return content.replace(/<!-- plan-spec-version: [^>]+ -->/g, `<!-- plan-spec-version: ${version} -->`)
}

// Compare npm-style semver, including prereleases; build metadata does not affect precedence.
function compareVersion(a: string, b: string) {
  const parseVersion = (value: string) => {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value)
    if (!match) throw new Error(`Invalid package version in installation record: ${value}`)
    return { core: match.slice(1, 4).map(Number), pre: match[4]?.split(".") }
  }
  const left = parseVersion(a), right = parseVersion(b)
  for (let i = 0; i < 3; i++) if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i])
  if (!left.pre && !right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    if (left.pre[i] === undefined) return -1
    if (right.pre[i] === undefined) return 1
    if (left.pre[i] === right.pre[i]) continue
    const x = left.pre[i], y = right.pre[i]
    const xNumber = /^(0|[1-9]\d*)$/.test(x), yNumber = /^(0|[1-9]\d*)$/.test(y)
    if (xNumber !== yNumber) return xNumber ? -1 : 1
    return xNumber ? (BigInt(x) > BigInt(y) ? 1 : -1) : (x > y ? 1 : -1)
  }
  return 0
}

export function planSpecHome() {
  return resolve(process.env.PLAN_SPEC_HOME ?? join(homedir(), ".plan-spec"))
}

function hash(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex")
}

async function exists(path: string) {
  return stat(path).then(() => true).catch(() => false)
}

function scopeOf(options: Options): Scope {
  if (options.scope === undefined || options.scope === "project") return "project"
  if (options.scope === "global") return "global"
  throw new Error(`Invalid --scope value: ${options.scope}. Use project or global.`)
}

export async function resolveTarget(options: Options) {
  const scope = scopeOf(options)
  if (scope === "global") {
    if (options.projectDir) throw new Error("--project-dir is only supported for project scope.")
    return { scope, target: resolve(options.configDir ?? process.env.OPENCODE_CONFIG_DIR ?? join(homedir(), ".config", "opencode")) }
  }
  if (options.configDir) throw new Error("--config-dir is only supported for global scope.")
  const requested = resolve(options.projectDir ?? process.cwd())
  const info = await stat(requested).catch(() => undefined)
  if (!info?.isDirectory()) throw new Error(`Project directory does not exist: ${requested}`)
  return { scope, target: requested }
}

function statePath(scope: Scope, target: string) {
  const key = platform() === "win32" ? target.toLowerCase() : target
  return join(planSpecHome(), "installations", `${hash(`${scope}:${key}`)}.json`)
}

async function loadInstallation(path: string): Promise<Installation | undefined> {
  if (!(await exists(path))) return undefined
  const data = JSON.parse(await readFile(path, "utf8")) as Installation
  if (data.version !== 1 || !["project", "global"].includes(data.scope) || !data.files) throw new Error(`Unsupported installation state: ${path}`)
  return data
}

function projectSkillPath(target: string) { return join(target, ".agents", "skills", "plan-spec", "SKILL.md") }
function oldProjectSkillPath(target: string) { return join(target, ".opencode", "skills", "plan-spec", "SKILL.md") }
function commandPath(target: string) { return join(target, ".opencode", "commands", "plan-spec.md") }

async function saveInstallation(path: string, installation: Installation) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(installation, null, 2)}\n`, "utf8")
}

/** Install only the optional OpenCode command, without taking ownership of a SkillHub skill or AGENTS.md. */
export async function installCommand(options: Pick<Options, "projectDir">) {
  const { target } = await resolveTarget(options)
  const path = statePath("project", target)
  const state = await loadInstallation(path)
  const file = commandPath(target)
  if (await exists(file) && (!state?.files[file] || hash(await readFile(file)) !== state.files[file])) {
    throw new Error(`Command exists or was modified; refusing to overwrite: ${file}`)
  }
  const version = await packageVersion()
  const content = renderVersion(await readFile(join(assets, "commands", "plan-spec.md"), "utf8"), version)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
  const installation: Installation = state ?? { version: 1, scope: "project", target, files: {} }
  installation.files[file] = hash(content)
  installation.resourceVersions = { ...installation.resourceVersions, [file]: version }
  installation.opencodeCommandPreference = true
  await saveInstallation(path, installation)
  return file
}

/** Remove only a command tracked by this installer; never touch a shared SkillHub skill. */
export async function uninstallCommand(options: Pick<Options, "projectDir">) {
  const { target } = await resolveTarget(options)
  const path = statePath("project", target)
  const state = await loadInstallation(path)
  const file = commandPath(target)
  if (!state?.files[file]) throw new Error(`No managed OpenCode command found at ${file}.`)
  if (await exists(file)) {
    if (hash(await readFile(file)) !== state.files[file]) throw new Error(`Managed command was modified; refusing to remove: ${file}`)
    await rm(file)
  }
  delete state.files[file]
  if (state.resourceVersions) delete state.resourceVersions[file]
  state.opencodeCommandPreference = false
  if (Object.keys(state.files).length || state.routing) await saveInstallation(path, state)
  else await rm(path)
  return file
}

async function hasOpencodeMarker(target: string) {
  if ((await stat(join(target, ".opencode")).catch(() => undefined))?.isDirectory()) return true
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    if ((await stat(join(target, name)).catch(() => undefined))?.isFile()) return true
  }
  return false
}

async function installationFiles(scope: Scope, target: string, withCommand: boolean) {
  const skill = scope === "project" ? projectSkillPath(target) : join(target, "skills", "plan-spec", "SKILL.md")
  const files = [{ source: join(assets, "skills", "plan-spec", "SKILL.md"), dest: skill }]
  if (scope === "project") files.push({ source: join(assets, "skills", "plan-spec", "agents", "openai.yaml"), dest: join(dirname(skill), "agents", "openai.yaml") })
  if (withCommand) files.push({ source: join(assets, "commands", "plan-spec.md"), dest: commandPath(target) })
  return files
}

export async function install(options: Options, upgradeCommand?: boolean) {
  const { scope, target } = await resolveTarget(options)
  if (options.withOpencodeCommand && options.withoutOpencodeCommand) throw new Error("Choose only one of --with-opencode-command or --without-opencode-command.")
  if (scope === "global" && (options.withOpencodeCommand || options.withoutOpencodeCommand)) throw new Error("OpenCode command options are only supported for project scope.")
  const path = statePath(scope, target)
  const previous = await loadInstallation(path)
  const command = scope === "project" && (upgradeCommand ?? (options.withOpencodeCommand ? true : options.withoutOpencodeCommand ? false : previous?.opencodeCommandPreference ?? (Boolean(previous?.files[commandPath(target)]) || await hasOpencodeMarker(target))))
  const version = await packageVersion()
  const files = await installationFiles(scope, target, command)
  const routingPath = join(target, "AGENTS.md")
  const block = scope === "project" ? renderVersion(await readFile(join(assets, "templates", "plan-spec-project-routing.md"), "utf8"), version).trim() : undefined
  const routingExisted = block ? await exists(routingPath) : false
  const existingRouting = routingExisted ? await readFile(routingPath, "utf8") : ""
  const oldSkill = scope === "project" ? oldProjectSkillPath(target) : undefined

  // Check every destination before writing anything. Never overwrite user edits or an unrelated skill/command.
  for (const { dest } of files) {
    if (!(await exists(dest))) continue
    if (!previous?.files[dest] || hash(await readFile(dest)) !== previous.files[dest]) {
      throw new Error(`File exists or was modified; refusing to overwrite: ${dest}`)
    }
  }
  if (oldSkill && await exists(oldSkill)) {
    if (!previous?.files[oldSkill] || hash(await readFile(oldSkill)) !== previous.files[oldSkill]) {
      throw new Error(`Old skill exists or was modified; refusing to migrate: ${oldSkill}`)
    }
  }
  const previousCommand = scope === "project" ? commandPath(target) : undefined
  if (previousCommand && !command && previous?.files[previousCommand] && await exists(previousCommand)) {
    if (hash(await readFile(previousCommand)) !== previous.files[previousCommand]) {
      throw new Error(`Managed command was modified; refusing to remove: ${previousCommand}`)
    }
  }
  if (block && marker.test(existingRouting)) {
    const installed = existingRouting.match(marker)?.[0]
    if (!previous?.routing || installed !== previous.routing.block) {
      throw new Error(`Managed AGENTS.md block exists or was modified; refusing to overwrite: ${routingPath}`)
    }
  }

  const recorded: Record<string, string> = {}
  for (const { source, dest } of files) {
    const sourceContent = await readFile(source, "utf8")
    const content = source.endsWith("SKILL.md") || source.endsWith("plan-spec.md") ? renderVersion(sourceContent, version) : sourceContent
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, content)
    recorded[dest] = hash(content)
  }
  if (oldSkill && previous?.files[oldSkill] && await exists(oldSkill)) {
    await rm(oldSkill)
    try { await rmdir(dirname(oldSkill)) }
    catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error }
  }
  if (previousCommand && !command && previous?.files[previousCommand] && await exists(previousCommand)) await rm(previousCommand)
  if (block) {
    const next = marker.test(existingRouting)
      ? existingRouting.replace(marker, block)
      : `${existingRouting.trimEnd()}${existingRouting.trim() ? "\n\n" : ""}${block}\n`
    if (next !== existingRouting) await writeFile(routingPath, next, "utf8")
  }

  const manifest: Installation = {
    version: 1, scope, target, files: recorded,
    resourceVersions: Object.fromEntries([...Object.keys(recorded), ...(block ? [routingPath] : [])].map((file) => [file, version])),
    ...(scope === "project" && (options.withOpencodeCommand || options.withoutOpencodeCommand || previous?.opencodeCommandPreference !== undefined)
      ? { opencodeCommandPreference: options.withOpencodeCommand ? true : options.withoutOpencodeCommand ? false : previous?.opencodeCommandPreference }
      : {}),
    ...(block ? { routing: { path: routingPath, block, created: previous?.routing?.created ?? !routingExisted } } : {}),
  }
  await saveInstallation(path, manifest)
  return { scope, target, files: Object.keys(recorded), routing: scope === "project" ? routingPath : undefined, command }
}

export async function upgrade(options: Options) {
  const { scope, target } = await resolveTarget(options)
  const path = statePath(scope, target)
  const state = await loadInstallation(path)
  if (!state) throw new Error(`No ${scope} installation found at ${target}; use install first.`)
  const resources = [...Object.keys(state.files), ...(state.routing ? [state.routing.path] : [])]
  if (!resources.length) throw new Error(`No managed resources found at ${target}; use install first.`)
  const version = await packageVersion()
  for (const file of resources) {
    const installed = state.resourceVersions?.[file]
    if (installed && compareVersion(installed, version) > 0) {
      throw new Error(`Refusing to downgrade ${file} from ${installed} to ${version}.`)
    }
  }
  // All tracked resources must be intact before changing any of them.
  for (const [file, expected] of Object.entries(state.files)) {
    if (!(await exists(file)) || hash(await readFile(file)) !== expected) {
      throw new Error(`Managed file is missing or was modified; refusing to upgrade: ${file}`)
    }
  }
  if (state.routing) {
    const text = await readFile(state.routing.path, "utf8").catch(() => "")
    if (text.match(marker)?.[0] !== state.routing.block) {
      throw new Error(`Managed AGENTS.md block is missing or was modified; refusing to upgrade: ${state.routing.path}`)
    }
  }
  if (resources.every((file) => state.resourceVersions?.[file] === version)) {
    return { scope, target, version, changed: false, resources }
  }
  const skill = scope === "project" ? projectSkillPath(target) : join(target, "skills", "plan-spec", "SKILL.md")
  const oldSkill = scope === "project" ? oldProjectSkillPath(target) : undefined
  const fullInstall = Boolean(state.files[skill] || (oldSkill && state.files[oldSkill]))
  if (!fullInstall) {
    const commandFile = commandPath(target)
    if (scope !== "project" || !state.files[commandFile] || resources.length !== 1) {
      throw new Error(`Unsupported command-only installation state at ${target}.`)
    }
    await installCommand({ projectDir: target })
  } else {
    // Upgrade preserves the set of installed components rather than re-detecting OpenCode markers.
    const command = scope === "project" && Boolean(state.files[commandPath(target)])
    const targets = new Set<string>(resources)
    const generated = new Map<string, Buffer>()
    for (const { source, dest } of await installationFiles(scope, target, command)) {
      targets.add(dest)
      const text = await readFile(source, "utf8")
      generated.set(dest, Buffer.from(source.endsWith("SKILL.md") || source.endsWith("plan-spec.md") ? renderVersion(text, version) : text))
    }
    targets.add(path)
    const before = new Map<string, Buffer | undefined>()
    for (const file of targets) before.set(file, await readFile(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    }))
    if (state.routing) {
      const text = before.get(state.routing.path)?.toString("utf8") ?? ""
      const block = renderVersion(await readFile(join(assets, "templates", "plan-spec-project-routing.md"), "utf8"), version).trim()
      generated.set(state.routing.path, Buffer.from(text.replace(marker, block)))
    }
    try {
      await install(options, command)
    } catch (error) {
      // Restore only changes made by this upgrade; do not overwrite concurrent user edits.
      const issues: string[] = []
      for (const [file, original] of before) {
        try {
          const current = await readFile(file).catch((readError: NodeJS.ErrnoException) => {
            if (readError.code === "ENOENT") return undefined
            throw readError
          })
          if (current?.equals(original ?? Buffer.alloc(0)) || (!current && !original)) continue
          if (current && file !== path && !current.equals(generated.get(file) ?? Buffer.alloc(0))) {
            issues.push(file)
            continue
          }
          if (original) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, original) }
          else if (current) await rm(file)
        } catch { issues.push(file) }
      }
      if (issues.length) throw new Error(`Upgrade failed and manual recovery may be needed for: ${issues.join(", ")}. Cause: ${String(error)}`)
      throw error
    }
  }
  return { scope, target, version, changed: true, resources }
}

export async function upgradeCommand(options: Pick<Options, "projectDir">) {
  const { target } = await resolveTarget(options)
  const state = await loadInstallation(statePath("project", target))
  const file = commandPath(target)
  if (!state?.files[file]) throw new Error(`No managed OpenCode command found at ${file}; use command install first.`)
  if (!(await exists(file)) || hash(await readFile(file)) !== state.files[file]) {
    throw new Error(`Managed command is missing or was modified; refusing to upgrade: ${file}`)
  }
  const version = await packageVersion()
  const installed = state.resourceVersions?.[file]
  if (installed && compareVersion(installed, version) > 0) throw new Error(`Refusing to downgrade ${file} from ${installed} to ${version}.`)
  if (installed === version) return { file, version, changed: false }
  await installCommand(options)
  return { file, version, changed: true }
}

export async function doctor(options: Options) {
  const { scope, target } = await resolveTarget(options)
  const state = await loadInstallation(statePath(scope, target))
  const checks: Array<{ name: string; ok: boolean; detail: string }> = []
  checks.push({ name: "installation", ok: Boolean(state), detail: target })
  if (!state) return checks
  const versions = new Set([...Object.keys(state.files), ...(state.routing ? [state.routing.path] : [])]
    .map((file) => state.resourceVersions?.[file] ?? "unknown"))
  checks.push({ name: "managed versions", ok: true, detail: `${[...versions].join(", ")} (running ${await packageVersion()})` })
  for (const [path, expected] of Object.entries(state.files)) {
    checks.push({ name: basename(path), ok: await exists(path) && hash(await readFile(path)) === expected, detail: path })
  }
  if (state.routing) {
    const content = await exists(state.routing.path) ? await readFile(state.routing.path, "utf8") : ""
    checks.push({ name: "AGENTS.md routing", ok: content.match(marker)?.[0] === state.routing.block, detail: state.routing.path })
  }
  return checks
}

export async function uninstall(options: Options) {
  const { scope, target } = await resolveTarget(options)
  const path = statePath(scope, target)
  const state = await loadInstallation(path)
  if (!state) throw new Error(`No ${scope} installation found at ${target}.`)
  const preserved: string[] = []
  for (const [file, expected] of Object.entries(state.files)) {
    if (!(await exists(file))) continue
    if (hash(await readFile(file)) !== expected) { preserved.push(file); continue }
    await rm(file)
  }
  // Only remove directories inside the skill when empty; never remove .agents/skills or user-added files.
  const skillDir = scope === "project" ? dirname(projectSkillPath(target)) : join(target, "skills", "plan-spec")
  if (scope === "project" && state.files[join(skillDir, "agents", "openai.yaml")]) {
    try { await rmdir(join(skillDir, "agents")) }
    catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error }
  }
  if (state.files[join(skillDir, "SKILL.md")]) {
    try {
      await rmdir(skillDir)
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error
    }
  }
  if (scope === "project" && state.files[oldProjectSkillPath(target)]) {
    try { await rmdir(dirname(oldProjectSkillPath(target))) }
    catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error }
  }
  if (state.routing && await exists(state.routing.path)) {
    const text = await readFile(state.routing.path, "utf8")
    if (text.match(marker)?.[0] !== state.routing.block) preserved.push(state.routing.path)
    else {
      const next = text.replace(/\n?<!-- plan-spec-package:begin -->[\s\S]*?<!-- plan-spec-package:end -->\n?/, "\n").trim()
      if (!next && state.routing.created) await rm(state.routing.path)
      else await writeFile(state.routing.path, next ? `${next}\n` : "", "utf8")
    }
  }
  // Keep the state for retrying removal of user-modified files after review.
  if (preserved.length) {
    state.files = Object.fromEntries(Object.entries(state.files).filter(([file]) => preserved.includes(file)))
    if (state.routing && !preserved.includes(state.routing.path)) delete state.routing
    if (state.resourceVersions) {
      state.resourceVersions = Object.fromEntries(Object.entries(state.resourceVersions)
        .filter(([file]) => Boolean(state.files[file] || file === state.routing?.path)))
    }
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  } else await rm(path)
  return preserved
}

function jsonc(path: string, text: string) {
  const errors: ParseError[] = []
  const data = parse(text, errors) as Record<string, unknown>
  if (errors.length || !data || Array.isArray(data)) throw new Error(`Cannot parse configuration: ${path}`)
  return data
}

function at(data: Record<string, unknown>, path: string[]) {
  let value: unknown = data
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

function equal(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }

async function restoreFields(file: string, changes: Array<{ path: (string | number)[]; value: unknown }>) {
  if (!(await exists(file)) || !changes.length) return
  let text = await readFile(file, "utf8")
  for (const change of changes) text = applyEdits(text, modify(text, change.path, change.value, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" } }))
  await writeFile(file, text.endsWith("\n") ? text : `${text}\n`, "utf8")
}

/** Explicit, conservative cleanup for the old single global installation. Never called by install(). */
export async function uninstallLegacy() {
  const path = join(planSpecHome(), "manifest.json")
  if (!(await exists(path))) throw new Error("No legacy installation manifest found.")
  const state = JSON.parse(await readFile(path, "utf8")) as LegacyManifest
  if (!/^0\.[234]\./.test(state.version) || !state.files || !state.configDir) throw new Error("Unsupported legacy installation manifest.")
  const preserved: string[] = []
  const remaining: Record<string, string> = {}
  for (const [file, expected] of Object.entries(state.files)) {
    if (!(await exists(file))) continue
    if (basename(file) === "AGENTS.md") {
      const text = await readFile(file, "utf8")
      const block = text.match(marker)?.[0]
      const legacyTemplates = ["plan-spec-routing.md", "plan-spec-routing-lite.md"]
      const known = await Promise.all(legacyTemplates.map((name) => readFile(join(assets, "templates", name), "utf8")))
      if (!block || !known.some((template) => template.trim() === block)) { preserved.push(file); remaining[file] = expected; continue }
      const remainder = text.replace(/\n?<!-- plan-spec-package:begin -->[\s\S]*?<!-- plan-spec-package:end -->\n?/, "\n").trim()
      if (!remainder && hash(text) === expected) await rm(file)
      else await writeFile(file, remainder ? `${remainder}\n` : "", "utf8")
      continue
    }
    if (hash(await readFile(file)) !== expected) { preserved.push(file); remaining[file] = expected; continue }
    await rm(file)
  }
  if (state.mode !== "lite") {
    const config = join(state.configDir, await exists(join(state.configDir, "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json")
    if (state.managedPlugin !== null && await exists(config)) {
      const data = jsonc(config, await readFile(config, "utf8"))
      const plugins = Array.isArray(data.plugins) ? data.plugins : []
      const index = plugins.findIndex((item) => equal(item, state.managedPlugin))
      if (index < 0) preserved.push(config)
      else {
        const next = [...plugins]
        if (state.pluginBefore === undefined) next.splice(index, 1)
        else next[index] = state.pluginBefore
        await restoreFields(config, [{ path: ["plugins"], value: next }])
        state.managedPlugin = null
      }
    }
    if (await exists(state.planSpecConfig)) {
      const data = jsonc(state.planSpecConfig, await readFile(state.planSpecConfig, "utf8"))
      const changes: Array<{ path: (string | number)[]; value: unknown }> = []
      for (const [name, expected] of Object.entries(state.managedMcps ?? {})) {
        const target = ["mcp", "servers", name]
        if (equal(at(data, target), expected)) { changes.push({ path: target, value: at(state.configBefore ?? {}, target) }); delete state.managedMcps[name] }
        else preserved.push(state.planSpecConfig)
      }
      for (const [name, expected] of Object.entries(state.managedModels ?? {})) {
        const target = ["agents", name, "model"]
        if (equal(at(data, target), expected)) { changes.push({ path: target, value: at(state.configBefore ?? {}, target) }); delete state.managedModels[name] }
        else preserved.push(state.planSpecConfig)
      }
      const rules = state.managedPermissions ?? []
      const current = at(data, ["permissions"])
      if (rules.length && Array.isArray(current) && rules.every((rule) => current.some((item) => equal(item, rule)))) {
        changes.push({ path: ["permissions"], value: at(state.configBefore ?? {}, ["permissions"]) })
        state.managedPermissions = []
      } else if (rules.length) preserved.push(state.planSpecConfig)
      await restoreFields(state.planSpecConfig, changes)
      if (!state.planSpecConfigExisted && !preserved.includes(state.planSpecConfig)) {
        const after = jsonc(state.planSpecConfig, await readFile(state.planSpecConfig, "utf8"))
        const empty = (value: unknown): boolean => !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([key, item]) => key === "$schema" || empty(item))
        if (empty(after)) await rm(state.planSpecConfig)
      }
    }
  }
  if (preserved.length) {
    state.files = remaining
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  } else await rm(path)
  return [...new Set(preserved)]
}
