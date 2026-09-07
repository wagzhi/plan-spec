import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parse } from "jsonc-parser"

const PLAN_SPEC_INSTRUCTION =
  "请使用 plan-spec 技能处理当前任务，并按其规范拆分步骤后执行。"

const DEFAULT_CONFIG_PATH = "~/.config/opencode/plan-spec.jsonc"
const PLAN_SPEC_PREFIX = /^(?:\/)?(?:plan-spec|psw)\b/
const MANAGED_SECRET_REFERENCES = {
  "{file:~/.plan-spec/secrets/gitee-access-token}": "gitee-access-token",
  "{file:~/.plan-spec/secrets/context7-api-key}": "context7-api-key",
}

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

async function resolveManagedSecrets(config) {
  const gitee = config.mcp?.gitee?.environment
  if (gitee && typeof gitee === "object" && !Array.isArray(gitee)) {
    const token = await resolveManagedSecret(gitee.GITEE_ACCESS_TOKEN, "Gitee")
    if (token === undefined) delete gitee.GITEE_ACCESS_TOKEN
    else gitee.GITEE_ACCESS_TOKEN = token
  }

  const context7 = config.mcp?.context7?.headers
  if (context7 && typeof context7 === "object" && !Array.isArray(context7)) {
    const apiKey = await resolveManagedSecret(context7.CONTEXT7_API_KEY, "Context7")
    if (apiKey === undefined) delete context7.CONTEXT7_API_KEY
    else context7.CONTEXT7_API_KEY = apiKey
  }
}

export async function PlanSpecPlugin(_input, options = {}) {
  const configPath = typeof options.configPath === "string" ? options.configPath : DEFAULT_CONFIG_PATH
  let extraConfig = {}
  try {
    extraConfig = await loadConfig(configPath)
    await resolveManagedSecrets(extraConfig)
    debug(`loaded ${expandHome(configPath)}`)
  } catch (error) {
    console.error(`[plan-spec] warning: cannot load config ${configPath}: ${error?.message ?? error}`)
  }

  return {
    config: (config) => {
      if (Object.keys(extraConfig).length) {
        deepMerge(config, extraConfig)
        debug("merged plan-spec.jsonc into runtime config")
      }
    },
    "chat.message": async (_input, output) => {
      const text = output.parts.find((part) => part.type === "text")
      if (!text) return

      const original = text.text ?? ""
      if (!PLAN_SPEC_PREFIX.test(original)) return
      if (original.includes(PLAN_SPEC_INSTRUCTION)) return

      const task = original.replace(PLAN_SPEC_PREFIX, "").trim()
      text.text = `${task || "请按 plan-spec 规范处理当前项目状态。"}\n\n---\n\n${PLAN_SPEC_INSTRUCTION}`
    },
  }
}

export default PlanSpecPlugin
