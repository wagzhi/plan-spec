# Gitee 项目管理

仅当 `spec/plan-spec.json` 中 `projectManager.enabled=true` 且 `type="gitee"` 时读取本文档。

- Plan Mode 只读 issue、评论和仓库信息，只生成草案；Build Mode 的 Gitee 写操作优先委派 `@gitee-agent`，该子代理或 Gitee 工具不可用时只生成 issue 与评论草稿交由用户手工同步。
- 将 `repository` 按第一个 `/` 拆为 `owner` 与 `repo`，`programId` 原样作为十进制字符串传给 `program`。
- 调用 `gitee_get_user_info` 的 `login` 作为新 issue 的 `assignee`。
- “需求” issue 先拆解为独立任务，用户明确选择任务 issue 后才实现。
- 创建需求或任务 issue 必须使用 `issue_type="需求"` 或 `issue_type="任务"`，不得用标签代替。
- 创建、更新、评论、合并前必须遵守当前 Mode 约束与用户确认；实现收尾后先完成本地 Git，再同步 Gitee。
- MCP 未配置、认证失败、仓库无权限或项目 ID 无效时停止同步并说明问题，不得静默移除项目关联。
