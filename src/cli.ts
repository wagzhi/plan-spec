#!/usr/bin/env node
import { intro, outro, log } from "@clack/prompts"
import { Command } from "commander"
import { doctor, install, installCommand, Options, packageVersion, uninstall, uninstallCommand, uninstallLegacy, upgrade, upgradeCommand } from "./lib.js"

function target(command: Command) {
  return command.option("--scope <scope>", "installation scope: project (default) or global", "project")
    .option("--project-dir <path>", "project directory (default: current working directory)")
    .option("--config-dir <path>", "OpenCode global configuration directory (global scope only)")
}

const program = new Command().name("plan-spec").description("Install the plan-spec skill for OpenCode and Codex").version(await packageVersion())

target(program.command("install").description("Install or update the skill in the selected scope")
  .option("--with-opencode-command", "install /plan-spec even without a project OpenCode marker")
  .option("--without-opencode-command", "omit /plan-spec even when OpenCode is detected")).action(async (options: Options) => {
  intro("plan-spec install")
  const result = await install(options)
  outro(`Installed ${result.scope} skill into ${result.target}${result.routing ? `; project AGENTS.md routing is ready; OpenCode command ${result.command ? "installed" : "not installed"}` : ""}.`)
})

target(program.command("doctor").description("Check the selected installation")).option("--json", "JSON output").action(async (options: Options & { json?: boolean }) => {
  const checks = await doctor(options)
  if (options.json) console.log(JSON.stringify(checks, null, 2))
  else for (const check of checks) log.message(`${check.ok ? "OK" : "WARN"} ${check.name}: ${check.detail}`)
  if (checks.some((check) => !check.ok)) process.exitCode = 1
})

target(program.command("upgrade").description("Upgrade intact managed files using this package version")).action(async (options: Options) => {
  const result = await upgrade(options)
  outro(result.changed ? `Upgraded ${result.scope} installation at ${result.target} to ${result.version}.` : `Already at ${result.version}; no files changed.`)
})

target(program.command("uninstall").description("Remove the selected installation without discarding user edits")).action(async (options: Options) => {
  const preserved = await uninstall(options)
  outro(preserved.length ? `Preserved modified files; review and rerun uninstall: ${preserved.join(", ")}` : "Removed the selected installation.")
})

const command = program.command("command").description("Manage only the optional OpenCode /plan-spec command")
command.command("install").description("Install the project command without changing skills or AGENTS.md")
  .option("--project-dir <path>", "project directory (default: current working directory)")
  .action(async (options: Pick<Options, "projectDir">) => {
    outro(`Installed OpenCode command: ${await installCommand(options)}`)
  })
command.command("uninstall").description("Remove the command only if it is unmodified and managed by this installer")
  .option("--project-dir <path>", "project directory (default: current working directory)")
  .action(async (options: Pick<Options, "projectDir">) => {
    outro(`Removed OpenCode command: ${await uninstallCommand(options)}`)
  })
command.command("upgrade").description("Upgrade only the intact managed OpenCode command")
  .option("--project-dir <path>", "project directory (default: current working directory)")
  .action(async (options: Pick<Options, "projectDir">) => {
    const result = await upgradeCommand(options)
    outro(result.changed ? `Upgraded OpenCode command at ${result.file} to ${result.version}.` : `OpenCode command already at ${result.version}; no files changed.`)
  })

program.command("legacy-uninstall").description("Explicitly clean up a previous global lite/standard installation").action(async () => {
  const preserved = await uninstallLegacy()
  outro(preserved.length ? `Preserved modified legacy resources; review before retrying: ${preserved.join(", ")}` : "Removed the legacy global installation. Existing secrets were retained.")
})

program.parseAsync().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
