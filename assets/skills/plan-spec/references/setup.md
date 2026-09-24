# Plan-spec 项目配置

仅在用户明确要求使用本技能后，且项目配置不存在、无法解析或字段不完整时读取本文档。配置文件位于项目根目录的 `spec/plan-spec.json`；本文件不决定技能是否触发。

## Mode 边界

- **Plan Mode**：只收集配置信息，不得写入 `spec/plan-spec.json` 或项目指令文件。
- **Build Mode**：完成以下配置和注册。

## 首次启用

1. 用 `question` 单选询问“当前项目尚未启用 plan-spec 技能，是否启用？”。
2. 用户拒绝时停止且不创建配置。
3. 用户同意后询问项目管理类型：仅“关闭”或“Gitee”。
4. 选择关闭时写入：

```json
{
  "enabled": true,
  "projectManager": { "enabled": false }
}
```

## Gitee 配置

选择 Gitee 后，让用户提供仓库网页 URL 与项目页面 URL。仓库解析为 `<owner>/<repo>`；Gitee 工具可用时用只读调用验证访问，工具不可用（例如 lite 模式未配置 Gitee MCP）时允许先保存仓库信息，但必须说明本次仅生成 issue 与评论草稿、需用户手工同步。项目 URL 仅接受 `/programs/<数字ID>` 或企业版 `/projects/<数字ID>` 的内部数字 ID；不得使用 `P1018` 等展示编号。

写入：

```json
{
  "enabled": true,
  "projectManager": {
    "enabled": true,
    "type": "gitee",
    "repository": "owner/repo",
    "programId": "12345"
  }
}
```

## 项目指令注册

优先修改项目根目录 `AGENTS.md`；不存在时修改已有 `CLAUDE.md`；两者都不存在才新建 `AGENTS.md`。幂等插入或更新以下受管区块：

```markdown
<!-- plan-spec:begin -->
## Plan-Spec

本项目已启用 plan-spec。仅在用户明确要求使用本技能后，按计划规范完成执行前检查并落盘 `spec/feats` 计划，再修改实现文件。
Plan Mode 只生成草案，文件、Git 和 Gitee 写操作延后到 Build Mode。
<!-- plan-spec:end -->
```

禁用项目后，询问用户是否移除此区块；不得静默删除。
