import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parse } from "jsonc-parser"

const PLAN_SPEC_INSTRUCTION =
  "请使用 plan-spec 技能处理当前任务，并按其规范拆分步骤后执行。"

const DEFAULT_CONFIG_PATH = "~/.config/opencode/plan-spec.jsonc"
const PLAN_SPEC_PREFIX = /^(?:\/)?(?:plan-spec|psw)\b/
// Stable V2 plugin id. Plugin storage and diagnostics are scoped by this value.
export const PLUGIN_ID = "wagzhi.plan-spec"
const MANAGED_SECRET_REFERENCES = {
  "{file:~/.plan-spec/secrets/gitee-access-token}": "gitee-access-token",
  "{file:~/.plan-spec/secrets/context7-api-key}": "context7-api-key",
}

// Agent.Info fields a plan-spec.jsonc agent override may set. `model` is parsed
// separately because it can be written as "provider/model#variant".
const AGENT_OVERRIDE_KEYS = [
  "model",
  "request",
  "system",
  "description",
  "mode",
  "hidden",
  "color",
  "steps",
  "permissions",
]

function debug(message) {
  if (process.env.PLAN_SPEC_CONFIG_DEBUG === "1" || process.env.PLAN_SPEC_CONFIG_DEBUG === "true") {
    console.error(`[plan-spec] ${message}`)
  }
}

function expandHome(path) {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
  return resolve(path)
}

function planSpecHome() {
  return resolve(process.env.PLAN_SPEC_HOME ?? join(homedir(), ".plan-spec"))
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value)) {
      const current = target[key]
      if (!isPlainObject(current)) target[key] = {}
      deepMerge(target[key], value)
      continue
    }
    target[key] = value
  }
  return target
}

export async function loadConfig(path = DEFAULT_CONFIG_PATH) {
  const fullPath = expandHome(path)
  const errors = []
  const data = parse(await readFile(fullPath, "utf8"), errors)
  if (errors.length || !isPlainObject(data)) throw new Error(`Invalid JSONC: ${fullPath}`)
  return data
}

async function resolveManagedSecret(value, name) {
  if (!(value in MANAGED_SECRET_REFERENCES)) return value
  try {
    const path = join(planSpecHome(), "secrets", MANAGED_SECRET_REFERENCES[value])
    const secret = (await readFile(path, "utf8")).trim()
    if (secret) return secret
  } catch {
    // Do not expose secret paths or values in plugin logs.
  }
  console.error(`[plan-spec] warning: managed ${name} secret is unavailable`)
  return undefined
}

// plan-spec.jsonc uses the V2 shape `mcp.servers.<name>`. Resolve `{file:...}`
// secret references before the definitions are handed to the MCP transform.
async function resolveManagedSecrets(config) {
  const servers = config.mcp?.servers
  if (!isPlainObject(servers)) return

  const gitee = servers.gitee?.environment
  if (isPlainObject(gitee)) {
    const token = await resolveManagedSecret(gitee.GITEE_ACCESS_TOKEN, "Gitee")
    if (token === undefined) delete gitee.GITEE_ACCESS_TOKEN
    else gitee.GITEE_ACCESS_TOKEN = token
  }

  const context7 = servers.context7?.headers
  if (isPlainObject(context7)) {
    const apiKey = await resolveManagedSecret(context7.CONTEXT7_API_KEY, "Context7")
    if (apiKey === undefined) delete context7.CONTEXT7_API_KEY
    else context7.CONTEXT7_API_KEY = apiKey
  }
}

// Parse "provider/model", "provider/model#variant", or an already-structured
// { providerID, model|id, variant } value into the runtime Agent.Info.model shape.
export function parseModelRef(input) {
  if (isPlainObject(input)) {
    const providerID = input.providerID
    const id = input.id ?? input.model
    if (typeof providerID === "string" && providerID && typeof id === "string" && id) {
      return input.variant ? { providerID, id, variant: input.variant } : { providerID, id }
    }
    throw new Error(`Invalid model reference: ${JSON.stringify(input)}`)
  }
  if (typeof input !== "string") throw new Error(`Invalid model reference: ${String(input)}`)
  const providerEnd = input.indexOf("/")
  if (providerEnd <= 0) throw new Error(`Invalid model reference: ${input}`)
  const providerID = input.slice(0, providerEnd)
  const variantStart = input.indexOf("#", providerEnd + 1)
  const id = input.slice(providerEnd + 1, variantStart === -1 ? undefined : variantStart)
  const variant = variantStart === -1 ? undefined : input.slice(variantStart + 1)
  if (!id || providerID.includes("#") || (variant !== undefined && (!variant || variant.includes("#")))) {
    throw new Error(`Invalid model reference: ${input}`)
  }
  return variant ? { providerID, id, variant } : { providerID, id }
}

function applyAgentOverride(agent, override) {
  for (const key of AGENT_OVERRIDE_KEYS) {
    if (!(key in override)) continue
    if (key === "model") {
      agent.model = parseModelRef(override.model)
      continue
    }
    agent[key] = override[key]
  }
}

// V2 has no mutable global config object, so each plan-spec.jsonc section is
// applied through the domain transform that owns it. `AgentEditor.update`
// upserts, which matters because agents declared in config or in an `agents/`
// directory are merged after transforms run and therefore never show up in
// `editor.get`/`editor.list` while the callback executes.
export async function applyConfig(ctx, extraConfig) {
  const agents = extraConfig.agents
  if (isPlainObject(agents) && Object.keys(agents).length) {
    await ctx.agent.transform((editor) => {
      for (const [id, override] of Object.entries(agents)) {
        if (!isPlainObject(override)) continue
        editor.update(id, (agent) => applyAgentOverride(agent, override))
      }
    })
  }

  const servers = extraConfig.mcp?.servers
  if (isPlainObject(servers) && Object.keys(servers).length) {
    await ctx.mcp.transform((editor) => {
      for (const [name, server] of Object.entries(servers)) {
        if (!isPlainObject(server)) continue
        editor.set(name, server)
      }
    })
  }

  const permissions = extraConfig.permissions
  if (Array.isArray(permissions) && permissions.length) {
    await ctx.agent.transform((editor) => {
      // `editor.list()` only exposes the built-in agents, so also target every
      // agent named by plan-spec.jsonc to cover the managed agent files.
      const ids = new Set(editor.list().map((agent) => agent.id))
      if (isPlainObject(agents)) for (const id of Object.keys(agents)) ids.add(id)
      for (const id of ids) {
        editor.update(id, (agent) => {
          const existing = Array.isArray(agent.permissions) ? agent.permissions : []
          for (const rule of permissions) {
            if (!isPlainObject(rule)) continue
            // A global deny is overridden by an agent-level rule for the same
            // action, mirroring V2's agent-over-global permission precedence.
            if (existing.some((item) => item?.action === rule.action && item?.resource === rule.resource)) continue
            existing.push(rule)
          }
          agent.permissions = existing
        })
      }
    })
  }
}

async function applyPlanSpecConfig(ctx, configPath) {
  let extraConfig = {}
  try {
    extraConfig = await loadConfig(configPath)
    await resolveManagedSecrets(extraConfig)
    debug(`loaded ${expandHome(configPath)}`)
  } catch (error) {
    console.error(`[plan-spec] warning: cannot load config ${configPath}: ${error?.message ?? error}`)
    return
  }
  await applyConfig(ctx, extraConfig)
  debug("applied plan-spec.jsonc through domain transforms")
}

function expandPrompt(event) {
  const text = event.prompt?.text
  if (typeof text !== "string") return
  if (!PLAN_SPEC_PREFIX.test(text)) return
  if (text.includes(PLAN_SPEC_INSTRUCTION)) return

  const task = text.replace(PLAN_SPEC_PREFIX, "").trim()
  event.prompt.text = `${task || "请按 plan-spec 规范处理当前项目状态。"}\n\n---\n\n${PLAN_SPEC_INSTRUCTION}`
}

// A V2 plugin is a default-exported definition with an `id` and a `setup`
// function. Exporting the plain object (equivalent to Plugin.define from
// @opencode/plugin, which is an identity helper) keeps this package free of a
// runtime dependency on the plugin SDK.
export default {
  id: PLUGIN_ID,
  async setup(ctx) {
    const configPath = typeof ctx.options?.configPath === "string" ? ctx.options.configPath : DEFAULT_CONFIG_PATH
    await applyPlanSpecConfig(ctx, configPath)
    await ctx.session.hook("prompt", (event) => expandPrompt(event))
  },
}
