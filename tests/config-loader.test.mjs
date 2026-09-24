import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import plugin, { deepMerge, loadConfig, parseModelRef } from "../plugin/index.js"

function captureContext() {
  const agentTransforms = []
  const mcpTransforms = []
  const promptHooks = []
  const ctx = {
    options: {},
    agent: { transform: async (callback) => { agentTransforms.push(callback); return { dispose: async () => {} } } },
    mcp: { transform: async (callback) => { mcpTransforms.push(callback); return { dispose: async () => {} } } },
    session: { hook: async (name, callback) => { promptHooks.push({ name, callback }); return { dispose: async () => {} } } },
  }
  return { ctx, agentTransforms, mcpTransforms, promptHooks }
}

function agentEditor(initial = {}) {
  const agents = new Map(Object.entries(initial))
  return {
    list: () => [...agents.values()],
    get: (id) => agents.get(id),
    // Mirrors V2 `AgentEditor.update`, which upserts: agents declared in config
    // or in an `agents/` directory are merged after transforms run and are not
    // visible through `get`/`list` yet.
    update: (id, update) => { if (!agents.has(id)) agents.set(id, { id }); update(agents.get(id)) },
    remove: (id) => { agents.delete(id) },
    default: () => {},
  }
}

function mcpEditor() {
  const servers = new Map()
  return {
    list: () => [...servers.entries()],
    get: (name) => servers.get(name),
    set: (name, config) => { servers.set(name, config) },
    update: (name, update) => { const config = servers.get(name); if (config) update(config) },
    remove: (name) => { servers.delete(name) },
  }
}

test("deepMerge merges objects recursively and replaces arrays", () => {
  const target = {
    agents: { explore: { model: "model-a", temperature: 0.2 } },
    plugins: ["plugin-a"],
  }
  deepMerge(target, {
    agents: { explore: { model: "model-b" }, reviewer: { model: "model-c" } },
    plugins: ["plugin-b"],
  })

  assert.deepEqual(target, {
    agents: { explore: { model: "model-b", temperature: 0.2 }, reviewer: { model: "model-c" } },
    plugins: ["plugin-b"],
  })
})

test("parseModelRef accepts strings and structured references", () => {
  assert.deepEqual(parseModelRef("provider/model"), { providerID: "provider", id: "model" })
  assert.deepEqual(parseModelRef("provider/model#variant"), { providerID: "provider", id: "model", variant: "variant" })
  assert.deepEqual(parseModelRef({ providerID: "provider", model: "model" }), { providerID: "provider", id: "model" })
  assert.deepEqual(parseModelRef({ providerID: "provider", id: "model", variant: "v" }), { providerID: "provider", id: "model", variant: "v" })
  assert.throws(() => parseModelRef("invalid"))
})

test("plugin loads only the configured plan-spec.jsonc", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-spec-config-"))
  try {
    const configPath = join(dir, "plan-spec.jsonc")
    const ignoredPath = join(dir, "ignored.jsonc")
    await writeFile(configPath, `{
      // JSONC comments are supported
      "agents": { "explore": { "model": "provider/model" } },
      "permissions": [{ "action": "context7_*", "resource": "*", "effect": "deny" }],
      "files": ["${ignoredPath.replaceAll("\\", "\\\\")}"]
    }`)
    await writeFile(ignoredPath, '{"agents":{"explore":{"model":"other/model"}}}')

    assert.deepEqual(await loadConfig(configPath), {
      agents: { explore: { model: "provider/model" } },
      permissions: [{ action: "context7_*", resource: "*", effect: "deny" }],
      files: [ignoredPath],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("setup applies plan-spec.jsonc through V2 transforms and rewrites explicit requests", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-spec-setup-"))
  try {
    const configPath = join(dir, "plan-spec.jsonc")
    await writeFile(configPath, `{
      "agents": {
        "explore": { "model": "provider/model#fast" },
        "git-agent": { "model": "provider/git-model" }
      },
      "mcp": { "servers": { "context7": { "type": "remote", "url": "https://example.com/mcp" } } },
      "permissions": [{ "action": "context7_*", "resource": "*", "effect": "deny" }]
    }`)

    const { ctx, agentTransforms, mcpTransforms, promptHooks } = captureContext()
    await plugin.setup({ ...ctx, options: { configPath } })

    const agents = agentEditor({
      explore: { id: "explore", permissions: [] },
      "ask-agent": { id: "ask-agent", permissions: [{ action: "context7_*", resource: "*", effect: "allow" }] },
    })
    for (const transform of agentTransforms) transform(agents)
    assert.deepEqual(agents.get("explore").model, { providerID: "provider", id: "model", variant: "fast" })
    // `git-agent` is not present in the editor yet: `update` must still upsert it.
    assert.deepEqual(agents.get("git-agent").model, { providerID: "provider", id: "git-model" })
    assert.ok(agents.get("explore").permissions.some((rule) => rule.action === "context7_*" && rule.effect === "deny"))
    assert.ok(!agents.get("ask-agent").permissions.some((rule) => rule.effect === "deny"))

    const servers = mcpEditor()
    for (const transform of mcpTransforms) transform(servers)
    assert.deepEqual(servers.get("context7"), { type: "remote", url: "https://example.com/mcp" })

    assert.equal(promptHooks.length, 1)
    const event = { prompt: { text: "psw 处理某任务" } }
    promptHooks[0].callback(event)
    assert.match(event.prompt.text, /请使用 plan-spec 技能处理当前任务/)
    assert.match(event.prompt.text, /处理某任务/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a missing configuration file warns but does not stop setup", async () => {
  const { ctx, agentTransforms, promptHooks } = captureContext()
  await plugin.setup({ ...ctx, options: { configPath: join(tmpdir(), "plan-spec-missing", "plan-spec.jsonc") } })
  assert.equal(agentTransforms.length, 0)
  assert.equal(promptHooks.length, 1)
})
