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
  "plugin": ["example-plugin"],
  "mcp": { "custom": { "enabled": true } }
}\n`)
  const personalContent = '{"provider":{"existing":{"name":"keep"}},"agent":{"other":{"model":"keep/me"}}}\n'
  await writeFile(personal, personalContent)
  const env = { PLAN_SPEC_HOME: home }

  run(["install", "--yes", "--skip-secrets", "--config-dir", config], env)
  const global = await readFile(join(config, "opencode.jsonc"), "utf8")
  const planConfig = await readFile(join(config, "plan-spec.jsonc"), "utf8")
  assert.match(global, /preserve this comment/)
  assert.match(global, /"custom"/)
  assert.match(global, /@wagzhi\/plan-spec-plugin@\^0\.2\.0/)
  assert.doesNotMatch(global, /"gitee"/)
  assert.match(planConfig, /"gitee"/)
  assert.match(planConfig, /opencode-go\/deepseek-v4-flash/)
  assert.equal(await readFile(personal, "utf8"), personalContent)
  assert.match(await readFile(join(config, "skills", "plan-spec", "SKILL.md"), "utf8"), /双重启用条件/)

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
    run(["install", "--yes", "--skip-secrets", "--config-dir", config], env)
    run(["config", "--yes", "--skip-secrets", "--disable-mcp", "chrome_devtools", "--model", "ask-agent=provider/model", "--config-dir", config], env)
    const global = await readFile(join(config, "opencode.jsonc"), "utf8")
    const planConfig = await readFile(join(config, "plan-spec.jsonc"), "utf8")
    assert.equal((global.match(/@wagzhi\/plan-spec-plugin/g) ?? []).length, 1)
    assert.match(planConfig, /provider\/model/)
    assert.match(planConfig, /"chrome_devtools"[\s\S]*?"enabled": false/)
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
    run(["install", "--yes", "--skip-secrets"], env)
    const global = JSON.parse(await readFile(join(config, "opencode.jsonc"), "utf8"))
    assert.deepEqual(global.plugin, ["@wagzhi/plan-spec-plugin@^0.2.0"])

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
  const originalJson = '{"plugin":["json-plugin"]}\n'
  const previousPlugin = ["@wagzhi/plan-spec-plugin@^0.1.0", { configPath: "old-plan-spec.jsonc" }]
  await (await import("node:fs/promises")).mkdir(config, { recursive: true })
  await writeFile(json, originalJson)
  await writeFile(jsonc, `${JSON.stringify({ plugin: ["keep-plugin", previousPlugin, "other-plugin"] }, null, 2)}\n`)
  try {
    run(["install", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.equal(await readFile(json, "utf8"), originalJson)

    const installed = JSON.parse(await readFile(jsonc, "utf8"))
    assert.deepEqual(installed.plugin, [
      "keep-plugin",
      ["@wagzhi/plan-spec-plugin@^0.2.0", { configPath: join(config, "plan-spec.jsonc") }],
      "other-plugin",
    ])

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.equal(await readFile(json, "utf8"), originalJson)
    assert.deepEqual(JSON.parse(await readFile(jsonc, "utf8")).plugin, ["keep-plugin", previousPlugin, "other-plugin"])
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
  await writeFile(global, '{"plugin":["keep-plugin"]}\n')
  try {
    run(["install", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    await writeFile(global, `{
  "plugin": [
    "keep-plugin",
    "@wagzhi/plan-spec-plugin@^0.2.1"
  ]
}\n`)

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.deepEqual(JSON.parse(await readFile(global, "utf8")).plugin, ["keep-plugin"])
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
  await writeFile(join(config, "opencode.jsonc"), '{"plugin":["keep-plugin"]}\n')
  await writeFile(agents, "# User instructions\n")
  try {
    run(["install", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
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
  "permission": {
    "edit": "ask",
    "context7_*": "ask"
  }
}\n`)
  try {
    run(["install", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
    const installed = JSON.parse(await readFile(planConfig, "utf8"))
    assert.deepEqual(installed.permission, {
      edit: "ask",
      "context7_*": "deny",
      "chrome_devtools_*": "deny",
    })

    const doctor = JSON.parse(run(["doctor", "--json", "--config-dir", config], { PLAN_SPEC_HOME: home }))
    assert.equal(doctor.find((check) => check.name === "context7_* permission").ok, true)
    assert.equal(doctor.find((check) => check.name === "chrome_devtools_* permission").ok, true)

    run(["uninstall", "--config-dir", config], { PLAN_SPEC_HOME: home })
    assert.deepEqual(JSON.parse(await readFile(planConfig, "utf8")).permission, {
      edit: "ask",
      "context7_*": "ask",
    })
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
    run(["install", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home })
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
    assert.throws(() => run(["install", "--yes", "--skip-secrets", "--config-dir", config], { PLAN_SPEC_HOME: home }), /Unsupported plan-spec installation manifest version/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
