import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

function run(args, env) {
  return execFileSync(process.execPath, ["dist/cli.js", ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: "utf8" })
}

test("install merges JSONC, preserves unrelated settings, and uninstalls managed values", async () => {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const config = join(root, "opencode")
  const home = join(root, "home")
  const personal = join(config, "opencode-personal.jsonc")
  await writeFile(join(root, "placeholder"), "")
  await (await import("node:fs/promises")).mkdir(config, { recursive: true })
  await writeFile(join(config, "opencode.jsonc"), `{
  // preserve this comment
  "plugin": ["./plugin/plan-spec-plugin.ts"],
  "mcp": { "custom": { "enabled": true } }
}\n`)
  await writeFile(personal, `{"provider":{"existing":{"name":"keep"}},"agent":{"other":{"model":"keep/me"}}}\n`)
  const env = { PLAN_SPEC_HOME: home, PLAN_SPEC_NO_PERSIST_ENV: "1" }

  run(["install", "--yes", "--skip-secrets", "--no-persist-env", "--config-dir", config], env)
  const global = await readFile(join(config, "opencode.jsonc"), "utf8")
  const personalAfter = await readFile(personal, "utf8")
  assert.match(global, /preserve this comment/)
  assert.match(global, /"custom"/)
  assert.match(global, /"gitee"/)
  assert.doesNotMatch(global, /\.\/plugin\/plan-spec-plugin\.ts/)
  assert.match(personalAfter, /"existing"/)
  assert.match(personalAfter, /"other"/)
  assert.match(personalAfter, /opencode-go\/deepseek-v4-flash/)
  assert.match(await readFile(join(config, "skills", "plan-spec", "SKILL.md"), "utf8"), /双重启用条件/)
  assert.match(await readFile(join(config, "plugins", "plan-spec-plugin.js"), "utf8"), /chat.message/)

  const doctor = run(["doctor", "--json", "--config-dir", config], env)
  assert.equal(JSON.parse(doctor).find((check) => check.name === "config").ok, true)
  run(["uninstall", "--config-dir", config], env)
  assert.doesNotMatch(await readFile(join(config, "opencode.jsonc"), "utf8"), /"gitee"/)
  assert.match(await readFile(personal, "utf8"), /"other"/)
  await rm(root, { recursive: true, force: true })
})
