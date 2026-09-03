---
name: plan-spec
description: "仅当用户显式输入 `plan-spec`，或 plan-spec 插件注入“请使用 plan-spec 技能”指令时使用本技能。显式调用后，只有项目 `spec/plan-spec.json` 的 `enabled` 为 `true` 才执行计划规范；配置缺失或项目未启用时，询问用户是否为该项目启用并沿用初始化流程。不得仅因配置存在或任务类别匹配而触发。"
---

# 计划规范

标准化项目内的计划管理，确保计划先落盘、执行可追溯、结果可回填，并按项目配置关联需求与任务。

## 双重启用条件

- **本次调用**：仅当用户以 `plan-spec` 或 `/plan-spec` 开头输入任务时，插件会注入本技能指令。
- **项目配置**：本次调用已显式启用后，只有 `spec/plan-spec.json` 的 `enabled === true` 才执行计划规范。
- 未显式触发时按当前会话其他指令处理；不得读取或依据配置自行启用。

## Mode 边界

- **Plan Mode**：只做只读检查和计划草案，不写文件、不创建分支、不提交、不更新 Gitee。
- **Build Mode**：按本规范落盘计划、修改代码、创建分支和同步 Gitee。

## 显式调用后的项目配置检查

定位项目根目录：Git 仓库使用仓库根目录，否则使用当前工作目录。读取 `<项目根目录>/spec/plan-spec.json`；该文件只决定项目是否启用，不是触发条件。

1. 配置不存在时，在 Build Mode 用 `question` 询问是否为当前项目启用。拒绝则停止；同意后读取 [references/setup.md](references/setup.md) 完成初始化。Plan Mode 仅说明后续步骤。
2. 配置存在但 `enabled` 不为 `true` 时，询问是否重新为当前项目启用。确认后仅将顶层 `enabled` 写为 `true`，保留有效项目管理配置；缺失字段按下一项补全。
3. 配置无法解析或缺少必需字段时，读取 [references/setup.md](references/setup.md)，询问用户补全并写回。
4. `projectManager.enabled=false` 是有效配置，不得再次询问项目管理系统。
5. 项目管理启用时，只接受 `type="gitee"`、非空 `repository` 和十进制字符串 `programId`；处理 Gitee 需求前读取 [references/gitee-project-management.md](references/gitee-project-management.md)。

## 执行前检查

1. 记录当前分支、HEAD 与工作区状态，作为本次修改基线。
2. 存在未提交或未跟踪文件时列出并询问是否继续；不得撤销或自动提交任务前修改。
3. Build Mode 下，干净工作区位于 `dev`、`main`、`master`、`release/*` 或 `release-*` 时，通过 `@git-agent` 创建 `feat/<brief_name>` 分支。Plan Mode 只说明分支方案。
4. 基线分支优先用 `git remote show <remote>` 获取；当前已在任务分支时先确认是否基于该分支继续。

## 需求拆解与执行

- Gitee “需求”类型 issue 必须先拆分为可独立验证的任务，用户明确指定任务 issue 后才实现。
- Build Mode 将计划写到 `spec/feats/NNN-brief-YYYYMMDD.md`；Plan Mode 只生成草案。
- 计划至少包含变更点、测试计划、假设与风险；完成后补充结果总结、文件清单、测试结果和后续跟进。
- 项目管理已启用时，所有 Gitee 操作通过 `@gitee-agent`。

## 任务收尾

1. 对照任务基线与最终 Git 状态，准确汇总本次新增、修改、删除或重命名文件。
2. 回填计划文件和最终答复；无法执行测试时如实记录原因。
3. 仅当开始时工作区干净、当前为本任务分支、待提交内容全属本任务且测试通过时，通过 `@git-agent` 自动提交任务文件。
4. 其他情况列出文件、分支和测试结果并询问是否提交。不得自动推送、创建 PR 或混入任务前修改。

## Git 操作

- Build Mode 的 Git 写操作委托 `@git-agent`；Plan Mode 只允许只读 Git 检查。
- 本地 Git 和 Gitee 同时涉及时，先完成本地 Git 操作，再调用 `@gitee-agent`。
