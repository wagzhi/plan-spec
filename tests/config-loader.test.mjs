import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import PlanSpecPlugin, { deepMerge, loadConfig } from "../plugin/index.js"

test("deepMerge merges objects recursively and replaces arrays", () => {
  const target = {
    agent: { explore: { model: "model-a", temperature: 0.2 } },
    plugin: ["plugin-a"],
  }
  deepMerge(target, {
    agent: { explore: { model: "model-b" }, reviewer: { model: "model-c" } },
    plugin: ["plugin-b"],
  })

  assert.deepEqual(target, {
    agent: { explore: { model: "model-b", temperature: 0.2 }, reviewer: { model: "model-c" } },
    plugin: ["plugin-b"],
  })
})

test("plugin loads only the configured plan-spec.jsonc", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-spec-config-"))
  try {
    const configPath = join(dir, "plan-spec.jsonc")
    const ignoredPath = join(dir, "ignored.jsonc")
    await writeFile(configPath, `{
      // JSONC comments are supported
      "agent": { "explore": { "model": "model-a" } },
      "files": ["${ignoredPath.replaceAll("\\", "\\\\")}"]
    }`)
    await writeFile(ignoredPath, '{"agent":{"explore":{"model":"model-b"}}}')

    assert.deepEqual(await loadConfig(configPath), {
      agent: { explore: { model: "model-a" } },
      files: [ignoredPath],
    })
    const hooks = await PlanSpecPlugin({}, { configPath })
    const runtime = { agent: { explore: { temperature: 0.2 } } }
    hooks.config(runtime)
    assert.deepEqual(runtime, {
      agent: { explore: { model: "model-a", temperature: 0.2 } },
      files: [ignoredPath],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("plugin keeps running when the configured file is missing", async () => {
  const hooks = await PlanSpecPlugin({}, { configPath: join(tmpdir(), "plan-spec-missing.jsonc") })
  const runtime = { agent: { explore: { model: "existing" } } }
  hooks.config(runtime)
  assert.deepEqual(runtime, { agent: { explore: { model: "existing" } } })
})
