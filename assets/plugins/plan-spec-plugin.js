const PLAN_SPEC_INSTRUCTION =
  "请使用 plan-spec 技能处理当前任务，并按其规范拆分步骤后执行。"

export async function PlanSpecPlugin() {
  return {
    "chat.message": async (_input, output) => {
      const text = output.parts.find((part) => part.type === "text")
      if (!text) return

      const original = text.text ?? ""
      if (!/^(?:\/)?plan-spec\b/.test(original)) return
      if (original.includes(PLAN_SPEC_INSTRUCTION)) return

      const task = original.replace(/^(?:\/)?plan-spec\b/, "").trim()
      text.text = `${task || "请按 plan-spec 规范处理当前项目状态。"}\n\n---\n\n${PLAN_SPEC_INSTRUCTION}`
    },
  }
}
