#!/usr/bin/env node
import { intro, outro, password, isCancel, log } from "@clack/prompts"
import { Command } from "commander"
import { currentInstallMode, doctor, install, Options, uninstall } from "./lib.js"

async function secret(label: string, enabled: boolean, skip: boolean) {
  if (!enabled || skip) return undefined
  const value = await password({ message: `${label} (leave empty to configure later)` })
  if (isCancel(value)) throw new Error("Cancelled")
  return value.trim() || undefined
}

function common(command: Command) {
  return command.option("--config-dir <path>", "OpenCode global configuration directory")
    .option("-y, --yes", "use default choices without prompts")
    .option("--skip-secrets", "do not request or update secret files")
    .option("--disable-mcp <names...>", "disable one or more managed MCPs")
    .option("--model <agent=model...>", "override a managed agent model")
}

const program = new Command().name("plan-spec").description("Install and manage plan-spec for OpenCode").version("0.3.0")

common(program.command("install").description("Install all managed OpenCode resources").option("--mode <mode>", "install mode: lite or standard (default: lite)")).action(async (options: Options) => {
  intro("plan-spec install")
  const standard = (await currentInstallMode(options.mode)) === "standard"
  const result = await install(options, {
    gitee: await secret("Gitee access token", standard, Boolean(options.skipSecrets || options.yes)),
    context7: await secret("Context7 API key", standard, Boolean(options.skipSecrets || options.yes)),
  })
  outro(`Installed into ${result.dir}. Run /connect and choose OpenCode Go, then restart OpenCode.`)
})

common(program.command("config").description("Reapply managed configuration and optionally update secrets")).action(async (options: Options) => {
  intro("plan-spec config")
  const standard = (await currentInstallMode()) === "standard"
  const result = await install(options, {
    gitee: await secret("New Gitee access token", standard, Boolean(options.skipSecrets || options.yes)),
    context7: await secret("New Context7 API key", standard, Boolean(options.skipSecrets || options.yes)),
  })
  outro(`Configuration updated: ${result.planSpecConfig}`)
})

program.command("doctor").description("Verify the installation").option("--config-dir <path>").option("--json", "JSON output").action(async (options: Options & { json?: boolean }) => {
  const checks = await doctor(options)
  if (options.json) console.log(JSON.stringify(checks, null, 2))
  else for (const check of checks) log.message(`${check.ok ? "OK" : "WARN"} ${check.name}: ${check.detail}`)
  if (checks.some((check) => !check.ok && !check.detail.includes("Optional"))) process.exitCode = 1
})

program.command("uninstall").description("Remove unmodified managed resources").option("--config-dir <path>").action(async (options: Options) => {
  const preserved = await uninstall(options)
  outro(preserved.length ? `Removed managed resources; preserved modified files: ${preserved.join(", ")}` : "Removed managed resources. Secret files were retained.")
})

program.parseAsync().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
