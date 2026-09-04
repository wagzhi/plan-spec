import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
