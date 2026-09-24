import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

function run(args, env) {
  return execFileSync(process.execPath, ["dist/cli.js", ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: "utf8" })
}

test("install uses plan-spec.jsonc and leaves personal config untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const personal = join(config, "opencode-personal.jsonc")
  await (await import("node:fs/promises")).mkdir(config, { recursive: true })
  await writeFile(join(config, "opencode.jsonc"), `{
  // preserve this comment
  "plugins": ["example-plugin"],
  "mcp": { "custom": { "enabled": true } }
}\n`)
  const personalContent = '{"provider":{"existing":{"name":"keep"}},"agent":{"other":{"model":"keep/me"}}}\n'
  await writeFile(personal, personalContent)
  const env = { PLAN_SPEC_HOME: home }

  run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], env)
  const global = await readFile(join(config, "opencode.jsonc"), "utf8")
  const planConfig = await readFile(join(config, "plan-spec.jsonc"), "utf8")
  assert.match(global, /preserve this comment/)
  assert.match(global, /"custom"/)
  assert.match(global, /@wagzhi\/plan-spec-plugin@\^0\.3\.0/)
  assert.doesNotMatch(global, /"gitee"/)
  assert.match(planConfig, /"gitee"/)
  assert.match(planConfig, /opencode-go\/deepseek-v4-flash/)
  assert.equal(await readFile(personal, "utf8"), personalContent)
  const skill = await readFile(join(config, "skills", "plan-spec", "SKILL.md"), "utf8")
  assert.match(skill, /## 调用与项目启用/)
  assert.match(skill, /## 技能调用后的项目配置预检查/)
  const description = skill.match(/^description: "([^"]+)"$/m)?.[1]
  assert.ok(description)
  assert.match(description, /任务规划与计划执行/)
  assert.doesNotMatch(description, /psw|插件|plan-spec\.json/)
  const routing = await readFile(join(config, "AGENTS.md"), "utf8")
  assert.match(routing, /only when the user explicitly asks to use it/)
  assert.doesNotMatch(routing, /psw|\/plan-spec/)

  const doctor = JSON.parse(run(["doctor", "--json", "--config-dir", config], env))
  assert.equal(doctor.find((check) => check.name === "config").ok, true)
  assert.equal(doctor.find((check) => check.name === "plan-spec config").ok, true)
  assert.equal(doctor.find((check) => check.name === "gitee MCP").ok, true)

  run(["uninstall", "--config-dir", config], env)
  assert.match(await readFile(join(config, "opencode.jsonc"), "utf8"), /example-plugin/)
  assert.doesNotMatch(await readFile(join(config, "opencode.jsonc"), "utf8"), /@wagzhi\/plan-spec-plugin/)
  await assert.rejects(access(join(config, "plan-spec.jsonc")))
  assert.equal(await readFile(personal, "utf8"), personalContent)
  await rm(root, { recursive: true, force: true })
})

test("config updates the single managed config without duplicating the plugin", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const env = { PLAN_SPEC_HOME: home }
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], env)
    run(["config", "--yes", "--skip-secrets", "--disable-mcp", "chrome_devtools", "--model", "ask-agent=provider/model", "--config-dir", config], env)
    const global = await readFile(join(config, "opencode.jsonc"), "utf8")
    const planConfig = await readFile(join(config, "plan-spec.jsonc"), "utf8")
    assert.equal((global.match(/@wagzhi\/plan-spec-plugin/g) ?? []).length, 1)
    assert.match(planConfig, /provider\/model/)
    assert.match(planConfig, /"chrome_devtools"[\s\S]*?"disabled": true/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("default config directory uses the plugin default path", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, ".config", "opencode")
  const home = join(root, "state")
  const env = { PLAN_SPEC_HOME: home, HOME: root, USERPROFILE: root }
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets"], env)
    const global = JSON.parse(await readFile(join(config, "opencode.jsonc"), "utf8"))
    assert.deepEqual(global.plugins, ["@wagzhi/plan-spec-plugin@^0.3.0"])

    run(["uninstall"], env)
    assert.doesNotMatch(await readFile(join(config, "opencode.jsonc"), "utf8"), /@wagzhi\/plan-spec-plugin/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("prefers opencode.jsonc and only replaces the plan-spec plugin", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const json = join(config, "opencode.json")
  const jsonc = join(config, "opencode.jsonc")
  const originalJson = '{"plugins":["json-plugin"]}\n'
  const previousPlugin = ["@wagzhi/plan-spec-plugin@^0.1.0", { configPath: "old-plan-spec.jsonc" }]
  await (await import("node:fs/promises")).mkdir(config, { recursive: true })
  await writeFile(json, originalJson)
  await writeFile(jsonc, `${JSON.stringify({ plugins: ["keep-plugin", previousPlugin, "other-plugin"] }, null, 2)}\n`)
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.equal(await readFile(json, "utf8"), originalJson)

    const installed = JSON.parse(await readFile(jsonc, "utf8"))
    assert.deepEqual(installed.plugins, [
      "keep-plugin",
      { package: "@wagzhi/plan-spec-plugin@^0.3.0", options: { configPath: join(config, "plan-spec.jsonc") } },
      "other-plugin",
    ])

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.equal(await readFile(json, "utf8"), originalJson)
    assert.deepEqual(JSON.parse(await readFile(jsonc, "utf8")).plugins, ["keep-plugin", previousPlugin, "other-plugin"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("uninstall removes a changed plan-spec plugin entry without affecting other plugins", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const global = join(config, "opencode.jsonc")
  await (await import("node:fs/promises")).mkdir(config, { recursive: true })
  await writeFile(global, '{"plugins":["keep-plugin"]}\n')
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    await writeFile(global, `{
  "plugins": [
    "keep-plugin",
    "@wagzhi/plan-spec-plugin@^0.3.1"
  ]
}\n`)

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.deepEqual(JSON.parse(await readFile(global, "utf8")).plugins, ["keep-plugin"])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("uninstall removes the managed AGENTS block after user edits without creating backups", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const agents = join(config, "AGENTS.md")
  await (await import("node:fs/promises")).mkdir(config, { recursive: true })
  await writeFile(join(config, "opencode.jsonc"), '{"plugins":["keep-plugin"]}\n')
  await writeFile(agents, "# User instructions\n")
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    const installed = await readFile(agents, "utf8")
    assert.match(installed, /## Managed Subagents/)
    assert.match(installed, /`@web-debug`/)
    assert.equal((await readdir(config)).some((name) => name.startsWith("AGENTS.md.backup-")), false)

    const backupsBefore = (await readdir(config)).filter((name) => name.includes(".backup-")).sort()
    await writeFile(agents, `${installed}\n## User edits\n`)

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    const uninstalled = await readFile(agents, "utf8")
    assert.match(uninstalled, /# User instructions/)
    assert.match(uninstalled, /## User edits/)
    assert.doesNotMatch(uninstalled, /plan-spec-package:begin|Managed Subagents/)
    assert.deepEqual((await readdir(config)).filter((name) => name.includes(".backup-")).sort(), backupsBefore)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("install manages only plan-spec permission rules and uninstall restores them", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const planConfig = join(config, "plan-spec.jsonc")
  await (await import("node:fs/promises")).mkdir(config, { recursive: true })
  await writeFile(planConfig, `{
  "permissions": [
    { "action": "edit", "resource": "*", "effect": "ask" },
    { "action": "context7_*", "resource": "*", "effect": "ask" }
  ]
}\n`)
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    const installed = JSON.parse(await readFile(planConfig, "utf8"))
    assert.deepEqual(installed.permissions, [
      { action: "edit", resource: "*", effect: "ask" },
      { action: "context7_*", resource: "*", effect: "deny" },
      { action: "chrome_devtools_*", resource: "*", effect: "deny" },
    ])

    const doctor = JSON.parse(run(["doctor", "--json", "--config-dir", config], { PLAN_SPEC_HOME: home }))
    assert.equal(doctor.find((check) => check.name === "context7_* permission").ok, true)
    assert.equal(doctor.find((check) => check.name === "chrome_devtools_* permission").ok, true)

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.deepEqual(JSON.parse(await readFile(planConfig, "utf8")).permissions, [
      { action: "edit", resource: "*", effect: "ask" },
      { action: "context7_*", resource: "*", effect: "ask" },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("install and uninstall do not create backups for managed agent files", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const agents = join(config, "agents")
  const askAgent = join(agents, "ask-agent.md")
  await (await import("node:fs/promises")).mkdir(agents, { recursive: true })
  await writeFile(askAgent, "old agent content\n")
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.match(await readFile(askAgent, "utf8"), /mode: subagent/)
    assert.equal((await readdir(agents)).some((name) => name.includes(".backup-")), false)

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    await assert.rejects(access(askAgent))
    assert.equal((await readdir(agents)).some((name) => name.includes(".backup-")), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("install rejects a manifest that does not use the 0.2 format", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  await (await import("node:fs/promises")).mkdir(home, { recursive: true })
  await writeFile(join(home, "manifest.json"), '{"version":"0.1.0"}\n')
  try {
    assert.throws(() => run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home }), /Unsupported plan-spec installation manifest version/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("install defaults to lite mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  try {
    run(["install", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    const manifest = JSON.parse(await readFile(join(home, "manifest.json"), "utf8"))
    assert.equal(manifest.mode, "lite")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("lite install omits agents, plugin and plan-spec.jsonc", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const env = { PLAN_SPEC_HOME: home }
  try {
    run(["install", "--mode", "lite", "--yes", "--skip-secrets", "--config-dir", config], env)

    await assert.rejects(access(join(config, "opencode.jsonc")))
    await assert.rejects(access(join(config, "plan-spec.jsonc")))
    await assert.rejects(access(join(config, "agents")))
    assert.match(await readFile(join(config, "skills", "plan-spec", "SKILL.md"), "utf8"), /计划规范/)

    const routing = await readFile(join(config, "AGENTS.md"), "utf8")
    assert.match(routing, /plan-spec \*\*lite\*\* mode/)
    assert.match(routing, /only when the user explicitly asks to use it/)
    assert.doesNotMatch(routing, /psw|\/plan-spec/)
    assert.doesNotMatch(routing, /Managed Subagents/)

    const manifest = JSON.parse(await readFile(join(home, "manifest.json"), "utf8"))
    assert.equal(manifest.mode, "lite")

    const doctor = JSON.parse(run(["doctor", "--json", "--config-dir", config], env))
    assert.equal(doctor.find((check) => check.name === "AGENTS.md routing").ok, true)
    assert.equal(doctor.some((check) => check.name === "plan-spec plugin"), false)
    assert.equal(doctor.some((check) => check.name === "ask-agent.md"), false)

    run(["uninstall", "--config-dir", config], env)
    assert.doesNotMatch(await readFile(join(config, "AGENTS.md"), "utf8"), /plan-spec-package:begin/)
    await assert.rejects(access(join(config, "skills", "plan-spec", "SKILL.md")))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("lite install rejects standard-only options", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const env = { PLAN_SPEC_HOME: home }
  try {
    assert.throws(() => run(["install", "--mode", "lite", "--yes", "--skip-secrets", "--model", "ask-agent=provider/model", "--config-dir", config], env), /--model is only supported in standard mode/)
    assert.throws(() => run(["install", "--mode", "lite", "--yes", "--skip-secrets", "--disable-mcp", "context7", "--config-dir", config], env), /--disable-mcp is only supported in standard mode/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("lite install upgrades to standard in place and can be uninstalled", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const env = { PLAN_SPEC_HOME: home }
  try {
    run(["install", "--mode", "lite", "--yes", "--skip-secrets", "--config-dir", config], env)
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], env)

    assert.match(await readFile(join(config, "opencode.jsonc"), "utf8"), /@wagzhi\/plan-spec-plugin@\^0\.3\.0/)
    assert.match(await readFile(join(config, "plan-spec.jsonc"), "utf8"), /"gitee"/)
    assert.match(await readFile(join(config, "agents", "ask-agent.md"), "utf8"), /mode: subagent/)
    assert.match(await readFile(join(config, "AGENTS.md"), "utf8"), /## Managed Subagents/)
    assert.equal(JSON.parse(await readFile(join(home, "manifest.json"), "utf8")).mode, "standard")

    run(["uninstall", "--config-dir", config], env)
    assert.doesNotMatch(await readFile(join(config, "opencode.jsonc"), "utf8"), /@wagzhi\/plan-spec-plugin/)
    await assert.rejects(access(join(config, "plan-spec.jsonc")))
    await assert.rejects(access(join(config, "agents", "ask-agent.md")))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("standard install refuses to downgrade to lite until uninstalled", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const env = { PLAN_SPEC_HOME: home }
  try {
    run(["install", "--mode", "standard", "--yes", "--skip-secrets", "--config-dir", config], env)
    const globalBefore = await readFile(join(config, "opencode.jsonc"), "utf8")

    assert.throws(() => run(["install", "--mode", "lite", "--yes", "--skip-secrets", "--config-dir", config], env), /Cannot downgrade plan-spec from standard to lite/)
    assert.equal(await readFile(join(config, "opencode.jsonc"), "utf8"), globalBefore)
    assert.equal(JSON.parse(await readFile(join(home, "manifest.json"), "utf8")).mode, "standard")

    run(["uninstall", "--config-dir", config], env)
    run(["install", "--mode", "lite", "--yes", "--skip-secrets", "--config-dir", config], env)
    assert.equal(JSON.parse(await readFile(join(home, "manifest.json"), "utf8")).mode, "lite")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("a 0.2.x manifest is normalized to standard mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  await (await import("node:fs/promises")).mkdir(home, { recursive: true })
  await writeFile(join(home, "manifest.json"), `${JSON.stringify({ version: "0.2.0", configDir: config })}\n`)
  try {
    assert.throws(() => run(["install", "--mode", "lite", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home }), /Cannot downgrade plan-spec from standard to lite/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
