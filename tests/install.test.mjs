import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { access, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { platform, tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

function run(args, env, cwd) {
  return execFileSync(process.execPath, [join(process.cwd(), "dist", "cli.js"), ...args], {
    cwd: cwd ?? process.cwd(), env: { ...process.env, ...env }, encoding: "utf8",
  })
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "plan-spec-test-"))
  const project = join(root, "project")
  await mkdir(project)
  return { root, project, home: join(root, "state"), global: join(root, "config") }
}

function managedStatePath(home, project) {
  const key = platform() === "win32" ? project.toLowerCase() : project
  return join(home, "installations", `${createHash("sha256").update(`project:${key}`).digest("hex")}.json`)
}

async function packageFixture(root, version) {
  const directory = join(root, `package-${version}`)
  await mkdir(directory)
  await cp(join(process.cwd(), "dist"), join(directory, "dist"), { recursive: true })
  await cp(join(process.cwd(), "assets"), join(directory, "assets"), { recursive: true })
  await symlink(join(process.cwd(), "node_modules"), join(directory, "node_modules"), platform() === "win32" ? "junction" : "dir")
  await writeFile(join(directory, "package.json"), JSON.stringify({ version, type: "module" }))
  return (args, env, cwd) => execFileSync(process.execPath, [join(directory, "dist", "cli.js"), ...args], {
    cwd, env: { ...process.env, ...env }, encoding: "utf8",
  })
}

test("installed resources share the package version and an equal-version upgrade does not rewrite them", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    await writeFile(join(project, "opencode.jsonc"), "{}\n")
    run(["install"], env, project)
    const version = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")).version
    const skill = join(project, ".agents", "skills", "plan-spec", "SKILL.md")
    const command = join(project, ".opencode", "commands", "plan-spec.md")
    const routing = join(project, "AGENTS.md")
    const files = [skill, command, routing]
    for (const file of files) assert.match(await readFile(file, "utf8"), new RegExp(`<!-- plan-spec-version: ${version.replaceAll(".", "\\.")} -->`))
    const state = JSON.parse(await readFile(managedStatePath(home, project), "utf8"))
    for (const file of files) assert.equal(state.resourceVersions[file], version)
    const dates = await Promise.all(files.map(async (file) => (await stat(file)).mtimeMs))
    assert.match(run(["upgrade"], env, project), /no files changed/)
    assert.deepEqual(await Promise.all(files.map(async (file) => (await stat(file)).mtimeMs)), dates)
    assert.ok(JSON.parse(run(["doctor", "--json"], env, project)).every((check) => check.ok))
    run(["uninstall"], env, project)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("published asset markers and CLI version match the package version", async () => {
  const version = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")).version
  assert.match(run(["--version"], {}, process.cwd()), new RegExp(`^${version.replaceAll(".", "\\.")}\\s*$`))
  for (const file of ["assets/skills/plan-spec/SKILL.md", "assets/commands/plan-spec.md", "assets/templates/plan-spec-project-routing.md"]) {
    assert.match(await readFile(join(process.cwd(), file), "utf8"), new RegExp(`<!-- plan-spec-version: ${version.replaceAll(".", "\\.")} -->`))
  }
})

test("upgrade refuses to claim an untracked SkillHub installation", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const skill = join(project, ".agents", "skills", "plan-spec", "SKILL.md")
    await mkdir(join(project, ".agents", "skills", "plan-spec"), { recursive: true })
    await writeFile(skill, "# SkillHub-owned\n")
    assert.throws(() => run(["upgrade"], env, project), /use install first/)
    assert.throws(() => run(["command", "upgrade"], env, project), /use command install first/)
    assert.equal(await readFile(skill, "utf8"), "# SkillHub-owned\n")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("upgrade moves intact legacy version records forward without adding an absent OpenCode command", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const older = await packageFixture(root, "0.5.0")
    const newer = await packageFixture(root, "0.5.1")
    older(["install"], env, project)
    const stateFile = managedStatePath(home, project)
    const state = JSON.parse(await readFile(stateFile, "utf8"))
    delete state.resourceVersions
    await writeFile(stateFile, JSON.stringify(state))
    // Simulate a real pre-version release: no version marker in files or the managed block.
    for (const file of Object.keys(state.files)) {
      const text = (await readFile(file, "utf8")).replace(/<!-- plan-spec-version: 0\.5\.0 -->\r?\n\r?\n/, "")
      await writeFile(file, text)
      state.files[file] = createHash("sha256").update(text).digest("hex")
    }
    const routingText = (await readFile(state.routing.path, "utf8")).replace(/<!-- plan-spec-version: 0\.5\.0 -->\r?\n/, "")
    await writeFile(state.routing.path, routingText)
    state.routing.block = routingText.match(/<!-- plan-spec-package:begin -->[\s\S]*?<!-- plan-spec-package:end -->/)[0]
    await writeFile(stateFile, JSON.stringify(state))
    await mkdir(join(project, ".opencode")) // a new marker must not add a command during upgrade
    assert.match(newer(["upgrade"], env, project), /0\.5\.1/)
    assert.match(await readFile(join(project, ".agents", "skills", "plan-spec", "SKILL.md"), "utf8"), /plan-spec-version: 0\.5\.1/)
    assert.match(await readFile(join(project, "AGENTS.md"), "utf8"), /plan-spec-version: 0\.5\.1/)
    await assert.rejects(access(join(project, ".opencode", "commands", "plan-spec.md")))
    assert.throws(() => older(["upgrade"], env, project), /Refusing to downgrade/)
    newer(["uninstall"], env, project)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("upgrade refuses modified or missing managed resources without partially updating", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const older = await packageFixture(root, "0.5.0")
    const newer = await packageFixture(root, "0.5.1")
    older(["install", "--with-opencode-command"], env, project)
    const skill = join(project, ".agents", "skills", "plan-spec", "SKILL.md")
    const command = join(project, ".opencode", "commands", "plan-spec.md")
    await writeFile(command, "# User edit\n")
    assert.throws(() => newer(["upgrade"], env, project), /refusing to upgrade/)
    assert.match(await readFile(skill, "utf8"), /plan-spec-version: 0\.5\.0/)
    assert.equal(await readFile(command, "utf8"), "# User edit\n")
    await rm(command)
    assert.throws(() => newer(["upgrade"], env, project), /missing or was modified/)
    assert.match(await readFile(skill, "utf8"), /plan-spec-version: 0\.5\.0/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("an edited managed AGENTS.md block prevents upgrading other intact files", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const older = await packageFixture(root, "0.5.0")
    const newer = await packageFixture(root, "0.5.1")
    older(["install"], env, project)
    const routing = join(project, "AGENTS.md")
    await writeFile(routing, (await readFile(routing, "utf8")).replace("## Plan-Spec", "## Edited Plan-Spec"))
    assert.throws(() => newer(["upgrade"], env, project), /refusing to upgrade/)
    assert.match(await readFile(join(project, ".agents", "skills", "plan-spec", "SKILL.md"), "utf8"), /plan-spec-version: 0\.5\.0/)
    assert.match(await readFile(routing, "utf8"), /Edited Plan-Spec/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("command upgrade never changes a SkillHub skill or unrelated AGENTS.md text", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const older = await packageFixture(root, "0.5.0")
    const newer = await packageFixture(root, "0.5.1")
    const skill = join(project, ".agents", "skills", "plan-spec", "SKILL.md")
    const command = join(project, ".opencode", "commands", "plan-spec.md")
    await mkdir(join(project, ".agents", "skills", "plan-spec"), { recursive: true })
    await writeFile(skill, "# SkillHub-owned\n")
    await writeFile(join(project, "AGENTS.md"), "# User instructions\n")
    older(["command", "install"], env, project)
    assert.match(newer(["command", "upgrade"], env, project), /0\.5\.1/)
    assert.match(await readFile(command, "utf8"), /plan-spec-version: 0\.5\.1/)
    assert.match(newer(["upgrade"], env, project), /no files changed/)
    assert.equal(await readFile(skill, "utf8"), "# SkillHub-owned\n")
    assert.equal(await readFile(join(project, "AGENTS.md"), "utf8"), "# User instructions\n")
    assert.throws(() => older(["command", "upgrade"], env, project), /Refusing to downgrade/)
    newer(["command", "uninstall"], env, project)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("a full upgrade preserves the existing command choice and user AGENTS.md content", async () => {
  const { root, project, home, global } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const older = await packageFixture(root, "0.5.0")
    const newer = await packageFixture(root, "0.5.1")
    await writeFile(join(project, "AGENTS.md"), "# Keep this\n")
    older(["install", "--with-opencode-command"], env, project)
    await writeFile(join(project, "AGENTS.md"), `${await readFile(join(project, "AGENTS.md"), "utf8")}\n# Extra instructions\n`)
    newer(["upgrade"], env, project)
    assert.match(await readFile(join(project, ".opencode", "commands", "plan-spec.md"), "utf8"), /plan-spec-version: 0\.5\.1/)
    const routing = await readFile(join(project, "AGENTS.md"), "utf8")
    assert.match(routing, /# Keep this/)
    assert.match(routing, /# Extra instructions/)
    assert.match(routing, /plan-spec-version: 0\.5\.1/)
    assert.equal((routing.match(/plan-spec-package:begin/g) ?? []).length, 1)
    older(["install", "--scope", "global", "--config-dir", global], env, project)
    newer(["upgrade", "--scope", "global", "--config-dir", global], env, project)
    assert.match(await readFile(join(global, "skills", "plan-spec", "SKILL.md"), "utf8"), /plan-spec-version: 0\.5\.1/)
    newer(["uninstall", "--scope", "global", "--config-dir", global], env, project)
    newer(["uninstall"], env, project)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("default install puts only skill, command and routing in the current project directory", async () => {
  const { root, project, home, global } = await fixture()
  const env = { PLAN_SPEC_HOME: home, OPENCODE_CONFIG_DIR: global }
  try {
    execFileSync("git", ["init", "-q", project])
    await writeFile(join(project, "opencode.jsonc"), "{}\n")
    run(["install"], env, project)
    const skill = await readFile(join(project, ".agents", "skills", "plan-spec", "SKILL.md"), "utf8")
    assert.match(skill, /计划规范/)
    assert.doesNotMatch(skill, /@git-agent|@gitee-agent|spec\/plan-spec\.json|Gitee/)
    assert.match(skill, /当前会话上下文规划、完善或执行/)
    assert.match(skill, /同一会话从只读规划模式切至允许写入的模式/)
    assert.match(skill, /不得按文件时间/)
    assert.match(await readFile(join(project, ".agents", "skills", "plan-spec", "agents", "openai.yaml"), "utf8"), /allow_implicit_invocation: false/)
    const command = await readFile(join(project, ".opencode", "commands", "plan-spec.md"), "utf8")
    assert.match(command, /\$ARGUMENTS/)
    assert.match(command, /当前会话/)
    assert.match(command, /意图判断、计划归属与读写边界均以技能正文为准/)
    assert.doesNotMatch(command, /Plan agent|Build agent/)
    assert.doesNotMatch(command, /^agent:/m)
    assert.match(await readFile(join(project, "AGENTS.md"), "utf8"), /plan-spec-package:begin/)
    await assert.rejects(access(global))
    const checks = JSON.parse(run(["doctor", "--json"], env, project))
    assert.ok(checks.every((check) => check.ok))
    run(["uninstall"], env, project)
    await assert.rejects(access(join(project, ".agents", "skills", "plan-spec")))
    await access(join(project, ".agents", "skills"))
    await assert.rejects(access(join(project, ".opencode", "commands", "plan-spec.md")))
    await access(join(project, ".opencode", "commands"))
    await access(join(project, ".opencode"))
    await assert.rejects(access(join(project, "AGENTS.md")))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("default install from a Git subdirectory stays in that directory", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    execFileSync("git", ["init", "-q", project])
    const nested = join(project, "packages", "web")
    await mkdir(nested, { recursive: true })
    run(["install"], env, nested)
    const skill = await readFile(join(nested, ".agents", "skills", "plan-spec", "SKILL.md"), "utf8")
    assert.match(skill, /计划规范/)
    assert.match(skill, /不因外层 Git 仓库而上溯/)
    assert.match(await readFile(join(nested, "AGENTS.md"), "utf8"), /plan-spec-package:begin/)
    await assert.rejects(access(join(nested, ".opencode")))
    await assert.rejects(access(join(project, ".agents")))
    await assert.rejects(access(join(project, "AGENTS.md")))
    assert.ok(JSON.parse(run(["doctor", "--json"], env, nested)).every((check) => check.ok))
    run(["uninstall"], env, nested)
    await assert.rejects(access(join(nested, "AGENTS.md")))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("explicit project directory works outside Git and preserves existing AGENTS.md content", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const instructions = join(project, "AGENTS.md")
    await writeFile(instructions, "# Keep me\n")
    run(["install", "--project-dir", project], env)
    run(["install", "--project-dir", project], env)
    assert.match(await readFile(join(project, ".agents", "skills", "plan-spec", "SKILL.md"), "utf8"), /计划规范/)
    await assert.rejects(access(join(project, ".opencode", "commands")))
    assert.equal((await readFile(instructions, "utf8")).match(/plan-spec-package:begin/g)?.length, 1)
    await writeFile(instructions, `${await readFile(instructions, "utf8")}\n# User addition\n`)
    run(["uninstall", "--project-dir", project], env)
    assert.match(await readFile(instructions, "utf8"), /# Keep me[\s\S]*# User addition/)
    assert.doesNotMatch(await readFile(instructions, "utf8"), /plan-spec-package:begin/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("OpenCode command detection can be overridden and explicit disable survives reinstall", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const command = join(project, ".opencode", "commands", "plan-spec.md")
  try {
    run(["install", "--project-dir", project, "--with-opencode-command"], env)
    await access(command)
    run(["install", "--project-dir", project, "--without-opencode-command"], env)
    await assert.rejects(access(command))
    run(["install", "--project-dir", project], env)
    await assert.rejects(access(command))
    run(["install", "--project-dir", project, "--with-opencode-command"], env)
    await access(command)
    assert.throws(() => run(["install", "--project-dir", project, "--with-opencode-command", "--without-opencode-command"], env), /Choose only one/)
    run(["uninstall", "--project-dir", project], env)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("command-only setup preserves a SkillHub-managed skill and AGENTS.md", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const skill = join(project, ".agents", "skills", "plan-spec", "SKILL.md")
  const instructions = join(project, "AGENTS.md")
  const command = join(project, ".opencode", "commands", "plan-spec.md")
  try {
    await mkdir(join(project, ".agents", "skills", "plan-spec"), { recursive: true })
    await writeFile(skill, "# SkillHub owns this\n")
    await writeFile(instructions, "# Existing instructions\n")
    run(["command", "install"], env, project)
    assert.match(await readFile(command, "utf8"), /\$ARGUMENTS/)
    assert.equal(await readFile(skill, "utf8"), "# SkillHub owns this\n")
    assert.equal(await readFile(instructions, "utf8"), "# Existing instructions\n")
    run(["command", "install"], env, project)
    run(["command", "uninstall"], env, project)
    await assert.rejects(access(command))
    await access(join(project, ".opencode", "commands"))
    assert.equal(await readFile(skill, "utf8"), "# SkillHub owns this\n")
    assert.equal(await readFile(instructions, "utf8"), "# Existing instructions\n")
    await assert.rejects(access(managedStatePath(home, project)))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("ordinary uninstall of command-only state leaves a third-party skill directory untouched", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const skillDir = join(project, ".agents", "skills", "plan-spec")
  try {
    await mkdir(skillDir, { recursive: true })
    run(["command", "install", "--project-dir", project], env)
    run(["uninstall", "--project-dir", project], env)
    await access(skillDir)
    await assert.rejects(access(join(project, ".opencode", "commands", "plan-spec.md")))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("command-only setup never claims an unmanaged command or removes a modified one", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const command = join(project, ".opencode", "commands", "plan-spec.md")
  try {
    await mkdir(join(project, ".opencode", "commands"), { recursive: true })
    await writeFile(command, "# User-owned\n")
    assert.throws(() => run(["command", "install", "--project-dir", project], env), /refusing to overwrite/)
    assert.throws(() => run(["command", "uninstall", "--project-dir", project], env), /No managed OpenCode command/)
    assert.equal(await readFile(command, "utf8"), "# User-owned\n")
    await rm(command)
    run(["command", "install", "--project-dir", project], env)
    await writeFile(command, "# Edited after install\n")
    assert.throws(() => run(["command", "uninstall", "--project-dir", project], env), /refusing to remove/)
    assert.equal(await readFile(command, "utf8"), "# Edited after install\n")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("command-only setup and removal leave a full npm installation intact", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const command = join(project, ".opencode", "commands", "plan-spec.md")
  try {
    run(["install", "--project-dir", project, "--without-opencode-command"], env)
    run(["command", "install", "--project-dir", project], env)
    await access(command)
    run(["command", "uninstall", "--project-dir", project], env)
    await assert.rejects(access(command))
    await access(join(project, ".agents", "skills", "plan-spec", "SKILL.md"))
    assert.match(await readFile(join(project, "AGENTS.md"), "utf8"), /plan-spec-package:begin/)
    run(["install", "--project-dir", project], env)
    await assert.rejects(access(command))
    run(["uninstall", "--project-dir", project], env)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("existing OpenCode command remains managed even after its marker disappears", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const marker = join(project, "opencode.json")
  try {
    await writeFile(marker, "{}\n")
    run(["install", "--project-dir", project], env)
    await rm(marker)
    run(["install", "--project-dir", project], env)
    await access(join(project, ".opencode", "commands", "plan-spec.md"))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("explicit command removal does not discard a modified managed command", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const command = join(project, ".opencode", "commands", "plan-spec.md")
  try {
    run(["install", "--project-dir", project, "--with-opencode-command"], env)
    await writeFile(command, "# Custom command\n")
    assert.throws(() => run(["install", "--project-dir", project, "--without-opencode-command"], env), /refusing to remove/)
    assert.equal(await readFile(command, "utf8"), "# Custom command\n")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("project skill cannot overwrite an unmanaged shared skill", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const skill = join(project, ".agents", "skills", "plan-spec", "SKILL.md")
  try {
    await mkdir(join(project, ".agents", "skills", "plan-spec"), { recursive: true })
    await writeFile(skill, "# Other skill\n")
    assert.throws(() => run(["install", "--project-dir", project], env), /refusing to overwrite/)
    assert.equal(await readFile(skill, "utf8"), "# Other skill\n")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("a tracked old project skill migrates to the shared directory without deleting parent folders", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const oldSkill = join(project, ".opencode", "skills", "plan-spec", "SKILL.md")
  try {
    await mkdir(join(project, ".opencode", "skills", "plan-spec"), { recursive: true })
    const content = "---\nname: plan-spec\ndescription: Legacy skill\n---\n"
    await writeFile(oldSkill, content)
    await mkdir(join(home, "installations"), { recursive: true })
    await writeFile(managedStatePath(home, project), JSON.stringify({
      version: 1, scope: "project", target: project,
      files: { [oldSkill]: createHash("sha256").update(content).digest("hex") },
    }))
    run(["install", "--project-dir", project], env)
    await assert.rejects(access(oldSkill))
    await assert.rejects(access(join(project, ".opencode", "skills", "plan-spec")))
    await access(join(project, ".opencode", "skills"))
    await access(join(project, ".agents", "skills", "plan-spec", "SKILL.md"))
    run(["uninstall", "--project-dir", project], env)
    await assert.rejects(access(join(project, ".agents", "skills", "plan-spec")))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("a modified old project skill is never overwritten or migrated", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  const oldSkill = join(project, ".opencode", "skills", "plan-spec", "SKILL.md")
  try {
    await mkdir(join(project, ".opencode", "skills", "plan-spec"), { recursive: true })
    await writeFile(oldSkill, "User changes\n")
    await mkdir(join(home, "installations"), { recursive: true })
    await writeFile(managedStatePath(home, project), JSON.stringify({
      version: 1, scope: "project", target: project,
      files: { [oldSkill]: createHash("sha256").update("Original\n").digest("hex") },
    }))
    assert.throws(() => run(["install", "--project-dir", project], env), /refusing to migrate/)
    assert.equal(await readFile(oldSkill, "utf8"), "User changes\n")
    await assert.rejects(access(join(project, ".agents")))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("global scope installs skill only", async () => {
  const { root, project, home, global } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    run(["install", "--scope", "global", "--config-dir", global], env, project)
    assert.match(await readFile(join(global, "skills", "plan-spec", "SKILL.md"), "utf8"), /计划规范/)
    await assert.rejects(access(join(global, "commands")))
    await assert.rejects(access(join(global, "AGENTS.md")))
    await assert.rejects(access(join(project, ".opencode")))
    const checks = JSON.parse(run(["doctor", "--scope", "global", "--config-dir", global, "--json"], env, project))
    assert.ok(checks.every((check) => check.ok))
    run(["uninstall", "--scope", "global", "--config-dir", global], env, project)
    await assert.rejects(access(join(global, "skills", "plan-spec")))
    await access(join(global, "skills"))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("two projects have independent manifests and an edited command is never overwritten or deleted", async () => {
  const { root, project, home } = await fixture()
  const other = join(root, "other")
  const env = { PLAN_SPEC_HOME: home }
  try {
    await mkdir(other)
    await mkdir(join(project, ".opencode"))
    await mkdir(join(other, ".opencode"))
    run(["install", "--project-dir", project], env)
    run(["install", "--project-dir", other], env)
    const command = join(project, ".opencode", "commands", "plan-spec.md")
    await writeFile(command, "# User version\n")
    assert.throws(() => run(["install", "--project-dir", project], env), /refusing to overwrite/)
    let report
    try { run(["doctor", "--project-dir", project, "--json"], env) }
    catch (error) { report = error.stdout }
    const checks = JSON.parse(report)
    assert.equal(checks.find((check) => check.name === "plan-spec.md").ok, false)
    run(["uninstall", "--project-dir", project], env)
    assert.equal(await readFile(command, "utf8"), "# User version\n")
    assert.match(await readFile(join(other, ".opencode", "commands", "plan-spec.md"), "utf8"), /\$ARGUMENTS/)
    run(["uninstall", "--project-dir", other], env)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("uninstall preserves an edited skill and user-added files inside its directory", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    run(["install", "--project-dir", project], env)
    const directory = join(project, ".agents", "skills", "plan-spec")
    const skill = join(directory, "SKILL.md")
    const extra = join(directory, "notes.md")
    await writeFile(skill, "# User-edited skill\n")
    await writeFile(extra, "Keep me\n")
    run(["uninstall", "--project-dir", project], env)
    assert.equal(await readFile(skill, "utf8"), "# User-edited skill\n")
    assert.equal(await readFile(extra, "utf8"), "Keep me\n")
    await access(directory)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("uninstall leaves the skill directory if it contains only a user-added file", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    run(["install", "--project-dir", project], env)
    const directory = join(project, ".agents", "skills", "plan-spec")
    const extra = join(directory, "notes.md")
    await writeFile(extra, "Keep me\n")
    run(["uninstall", "--project-dir", project], env)
    await assert.rejects(access(join(directory, "SKILL.md")))
    assert.equal(await readFile(extra, "utf8"), "Keep me\n")
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("unmanaged command or modified AGENTS block blocks installation", async () => {
  const { root, project, home } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    const command = join(project, ".opencode", "commands", "plan-spec.md")
    await mkdir(join(project, ".opencode", "commands"), { recursive: true })
    await writeFile(command, "mine\n")
    assert.throws(() => run(["install", "--project-dir", project], env), /refusing to overwrite/)
    assert.equal(await readFile(command, "utf8"), "mine\n")
    await rm(command)
    run(["install", "--project-dir", project], env)
    const agents = join(project, "AGENTS.md")
    await writeFile(agents, (await readFile(agents, "utf8")).replace("普通开发请求", "其他请求"))
    assert.throws(() => run(["install", "--project-dir", project], env), /refusing to overwrite/)
    run(["uninstall", "--project-dir", project], env)
    assert.match(await readFile(agents, "utf8"), /其他请求/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("legacy installation is not touched by a project install; cleanup is explicit", async () => {
  const { root, project, home, global } = await fixture()
  const env = { PLAN_SPEC_HOME: home, OPENCODE_CONFIG_DIR: global }
  try {
    await mkdir(home)
    const legacy = join(home, "manifest.json")
    await writeFile(legacy, JSON.stringify({ version: "0.4.0", mode: "lite", configDir: global, files: {} }))
    run(["install", "--project-dir", project], env)
    assert.match(await readFile(legacy, "utf8"), /0\.4\.0/)
    run(["legacy-uninstall"], env)
    await assert.rejects(access(legacy))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("legacy cleanup restores only intact managed config and can retry modified fields", async () => {
  const { root, home, global } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    await mkdir(home)
    await mkdir(global)
    const legacy = join(home, "manifest.json")
    const config = join(global, "opencode.jsonc")
    const plan = join(global, "plan-spec.jsonc")
    await writeFile(config, JSON.stringify({ plugins: ["keep-plugin", "@wagzhi/plan-spec-plugin@^0.3.0"] }))
    const modified = { mcp: { servers: { gitee: { user: true }, context7: { managed: true } } }, agents: { other: { model: "new" } } }
    await writeFile(plan, JSON.stringify(modified))
    await writeFile(legacy, JSON.stringify({
      version: "0.4.0", mode: "standard", configDir: global, planSpecConfig: plan,
      planSpecConfigExisted: true, files: {}, configBefore: { mcp: { servers: { gitee: { previous: true } } } },
      managedPlugin: "@wagzhi/plan-spec-plugin@^0.3.0",
      managedMcps: { gitee: { managed: true }, context7: { managed: true } },
      managedModels: { other: "new" }, managedPermissions: [],
    }))
    run(["legacy-uninstall"], env)
    assert.deepEqual(JSON.parse(await readFile(config, "utf8")).plugins, ["keep-plugin"])
    const remaining = JSON.parse(await readFile(plan, "utf8"))
    assert.deepEqual(remaining.mcp.servers.gitee, { user: true })
    assert.equal(remaining.mcp.servers.context7, undefined)
    assert.equal(remaining.agents.other.model, undefined)
    assert.deepEqual(JSON.parse(await readFile(legacy, "utf8")).managedMcps, { gitee: { managed: true } })
    remaining.mcp.servers.gitee = { managed: true }
    await writeFile(plan, JSON.stringify(remaining))
    run(["legacy-uninstall"], env)
    assert.deepEqual(JSON.parse(await readFile(plan, "utf8")).mcp.servers.gitee, { previous: true })
    await assert.rejects(access(legacy))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("legacy cleanup removes only its global AGENTS.md block", async () => {
  const { root, home, global } = await fixture()
  const env = { PLAN_SPEC_HOME: home }
  try {
    await mkdir(home)
    await mkdir(global)
    const template = (await readFile(join(process.cwd(), "assets", "templates", "plan-spec-routing-lite.md"), "utf8")).trim()
    const agents = join(global, "AGENTS.md")
    await writeFile(agents, `# Existing\n\n${template}\n\n# Added later\n`)
    await writeFile(join(home, "manifest.json"), JSON.stringify({
      version: "0.4.0", mode: "lite", configDir: global, files: { [agents]: "old-install-hash" },
    }))
    run(["legacy-uninstall"], env)
    const content = await readFile(agents, "utf8")
    assert.match(content, /# Existing[\s\S]*# Added later/)
    assert.doesNotMatch(content, /plan-spec-package:begin/)
    await assert.rejects(access(join(home, "manifest.json")))
  } finally { await rm(root, { recursive: true, force: true }) }
})
