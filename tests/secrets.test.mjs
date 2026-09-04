import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

function writeSecret(home, value) {
  execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    'import { writeSecret } from "./dist/lib.js"; await writeSecret("test-token", process.env.TEST_SECRET)',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, PLAN_SPEC_HOME: home, TEST_SECRET: value },
    encoding: "utf8",
  })
}

test("blank secrets do not create or overwrite secret files", async () => {
  const home = await mkdtemp(join(tmpdir(), "plan-spec-secret-"))
  const secrets = join(home, "secrets")
  const path = join(secrets, "test-token")
  try {
    writeSecret(home, "   ")
    await assert.rejects(access(secrets))

    await mkdir(secrets, { recursive: true })
    await writeFile(path, "existing-token", "utf8")
    writeSecret(home, "\t\n")
    assert.equal(await readFile(path, "utf8"), "existing-token")

    writeSecret(home, "  updated-token  ")
    assert.equal(await readFile(path, "utf8"), "updated-token")
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
