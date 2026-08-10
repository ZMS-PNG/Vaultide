# 数据、API 与同步协议规范

> 状态：`Proposed`  
> 协议版本：`2026-07-draft-1`  
> 适用范围：P0 个人版；P1 多设备能力已预留，但不在 P0 开启

## 1. 目的与不可破坏约束

本规范把 [PRD](./04-PRD.md) 与 [架构文档](./05-ARCHITECTURE.md) 转成可以直接实现和测试的契约。任何实现都必须维持以下不变量：

1. Vault 中的原始笔记是来源事实；服务端只持有用户明确选择的不可变快照。
2. 插件不能把当前课堂生成接口当作同步 API；所有集成只经过版本化 `/api/v1`。
3. 学习行为以追加式事件保存；能力、复习和统计是可重建投影。
4. 模型不能直接写 Vault；只能生成可审查的 `WritebackDraft`，批准后才产生受限命令。
5. 所有有副作用的请求都可幂等重放；所有跨端消息都可追踪、确认和重试。
6. `learnerKey` 仅是 OpenMAIC 课堂运行分区键，不是身份凭证。
7. P0 不同步整个 Vault、不自动改写原笔记、不实现通用 CRDT。

## 2. 标识、时间与版本

### 2.1 标识规则

- 领域对象使用 UUIDv7；对外使用带类型前缀的字符串，如 `prj_`、`src_`、`snp_`、`spr_`、`job_`、`evt_`、`wbd_`、`wbc_`。
- 每个 Vault 在本地生成 `vaultBindingId`；不得上传绝对本地路径作为身份。
- 每篇受管笔记在 frontmatter 保存 `maic_note_id`。未受管笔记由 `vaultBindingId + file path` 形成临时定位，首次回写受管内容时才写入稳定 ID。
- 服务器生成的 ID 永不复用；删除后保留墓碑到保留期结束。

### 2.2 时间规则

- API 时间均为 UTC RFC 3339，例如 `2026-07-20T18:30:00Z`。
- 服务端接收客户端时间，但同时记录 `receivedAt`；排序和游标以服务端序号为准。
- 客户端时钟偏差超过 5 分钟时给出诊断，不阻断离线事件上传。

### 2.3 三类版本必须分开

| 版本 | 示例 | 用途 |
|---|---|---|
| API 版本 | `/api/v1` | HTTP 资源和错误契约 |
| 协议版本 | `2026-07-draft-1` | 插件消息、命令和能力协商 |
| 领域 Schema 版本 | `source-bundle/1` | 持久对象和事件载荷迁移 |

客户端通过 `X-MAIC-Protocol-Version` 声明协议版本；服务端在响应中返回实际版本和 `X-MAIC-Min-Client-Version`。不兼容时返回 `426 protocol_upgrade_required`，不得静默忽略字段。

## 3. 核心领域对象

### 3.1 Project 与 LearningSprint

```text
Project
  id, ownerId, title, desiredOutcome, status
  deliverables[], acceptanceCriteria[], createdAt, updatedAt

ProjectBlocker
  id, projectId, statement, context, desiredUnblock, status, createdAt

LearningSprint
  id, projectId, blockerId, sourceBundleId, sourceBundleRevision
  objective, durationMinutes, diagnosisSummary, plan[], status
  classroomId?, jobId?, createdAt, completedAt?
```

约束：

- `LearningSprint` 必须关联一个真实项目、一个明确卡点和至少一个可检查的验收条件。
- `durationMinutes` 的 P0 默认范围是 15–45 分钟；超出范围需要用户确认。
- 冲刺状态为 `draft → ready → active → evidence_pending → evaluated → completed | abandoned`。

### 3.2 SourceBundle、SourceSnapshot 与引用

```text
SourceBundle
  id, ownerId, vaultBindingId, revision, schemaVersion
  manifestHash, objectKey, byteSize, itemCount
  selectionReason, retentionUntil, createdAt, deletedAt?

SourceSnapshot
  id, sourceBundleId, noteId?, relativePath, title
  sourceMtime, contentHash, mimeType, byteSize
  headings[], tags[], outboundLinks[], contentObjectKey?

CitationAnchor
  id, snapshotId, anchorType, headingPath?, blockId?
  startLine?, endLine?, quotedHash, contextHash
```

约束：

- Bundle revision 不可变；内容变化只能创建新 revision。
- manifest 使用规范化 JSON 后计算 SHA-256；文件内容也按字节计算 SHA-256。
- `relativePath` 用于展示与恢复定位，不作为唯一身份。
- 引用至少保存 `snapshotId + contentHash + headingPath/blockId + quotedHash`；路径或标题变化时按稳定 ID、块 ID、内容哈希、上下文哈希的顺序恢复。
- 原文内容放私有对象存储；Postgres 只保存索引、哈希和访问控制元数据。

### 3.3 Job 与 Artifact

```text
GenerationJob
  id, ownerId, sprintId, operation, inputRevision, status
  idempotencyKey, workflowRunId?, progress, attemptCount
  errorCode?, errorDetailSafe?, createdAt, startedAt?, finishedAt?

LearningArtifact
  id, sprintId, jobId, type, schemaVersion, revision
  objectKey, contentHash, status, createdAt
```

Job 状态机：

```text
queued → running → succeeded
              ├→ retry_wait → running
              ├→ failed
              └→ cancelling → cancelled
```

同一个 `ownerId + operation + idempotencyKey` 只能产生一个业务 Job。平台工作流 Run ID 可变化，但业务 Job ID 不变。

### 3.4 LearningEvent、Evidence 与 Evaluation

```text
LearningEvent
  id, ownerId, sprintId, eventType, schemaVersion
  clientEventId, deviceId, occurredAt, receivedAt, serverSeq
  payload, source, causationId?, correlationId?

ProjectEvidence
  id, sprintId, type, title, description
  referenceType, referenceValue, contentHash?, submittedAt

EvidenceEvaluation
  id, evidenceId, rubricVersion, dimensions
  verdict, confidence, feedback, evaluator, createdAt
```

P0 事件类型至少包括：

- `diagnosisAnswered`、`retrievalAttempted`、`hintRequested`、`answerRevealed`；
- `explanationSubmitted`、`practiceSubmitted`、`feedbackReceived`；
- `evidenceSubmitted`、`evidenceEvaluated`、`transferTaskCompleted`；
- `writebackApproved`、`writebackApplied`、`reviewCompleted`。

唯一约束为 `ownerId + deviceId + clientEventId`，保证离线重放不会重复计数。事件不做原地修改；纠错通过补偿事件完成。

### 3.5 MasteryView 与 ReviewItem

```text
MasteryView
  ownerId, projectId, capabilityId, projectionVersion
  recallScore, explanationScore, applicationScore, transferScore
  evidenceCount, confidence, lastEvidenceAt, updatedAt

ReviewItem
  id, ownerId, projectId, capabilityId, promptRef
  scheduler, schedulerVersion, dueAt, state
  stability?, difficulty?, lastReviewedAt?
```

- `MasteryView` 不是不可争议的“真实分数”；必须展示证据数、最近证据和置信度。
- P0 使用可解释的固定间隔规则并记录原始复习结果；P1 才在数据量足够时启用 FSRS。
- 复习状态为 `scheduled → due → presented → completed | skipped | suspended`。

### 3.6 WritebackDraft、Command 与 Receipt

```text
WritebackDraft
  id, sprintId, target, sections[], citations[]
  baseContentHash?, diffPreview, status, createdAt, expiresAt

WritebackCommand
  id, draftId, deviceId, operation, arguments
  baseContentHash?, protocolVersion, status, issuedAt, expiresAt

WritebackReceipt
  id, commandId, deviceId, outcome, resultingContentHash?
  resultingPath?, conflictDetail?, appliedAt?, reportedAt
```

状态：

```text
Draft: generated → edited → approved | rejected | expired
Command: pending → leased → applied | conflicted | failed | expired
```

批准必须绑定草稿 revision；批准后草稿变化必须重新批准。`Command` 永远不包含可执行脚本。

## 4. 存储模型与关键约束

建议表：

```text
owners, devices, vault_bindings, integration_tokens
projects, project_blockers, learning_sprints
source_bundles, source_snapshots, citation_anchors
generation_jobs, learning_artifacts
learning_events, project_evidence, evidence_evaluations
mastery_views, review_items, review_events
writeback_drafts, writeback_commands, writeback_receipts
sync_outbox, sync_inbox, sync_cursors, audit_events, deletion_requests
```

数据库约束：

- 所有用户数据表必须带 `owner_id`，Repository 层禁止无 owner 条件查询。
- 外键删除默认为 `RESTRICT`；隐私删除使用显式编排，不依赖大范围级联。
- `source_bundles(owner_id, vault_binding_id, manifest_hash)` 唯一。
- `generation_jobs(owner_id, operation, idempotency_key)` 唯一。
- `learning_events(owner_id, device_id, client_event_id)` 唯一。
- `writeback_receipts(command_id, device_id)` 唯一。
- Outbox 与领域变更同一事务提交；Inbox 先判重、再处理、最后确认。
- 私密正文不进入应用日志、错误追踪标签、模型调用元数据或分析事件。

## 5. HTTP API 总则

### 5.1 路由与认证

所有插件接口位于 `/api/v1`，使用短期 Bearer access token。首次设备配对使用一次性 code；完成后签发受作用域限制、可撤销、可轮换的 device credential。

作用域：

```text
sources:write projects:read projects:write
sprints:read sprints:write events:append evidence:write
jobs:read writebacks:read writebacks:receipt reviews:read reviews:write
```

P0 token 必须绑定 `ownerId + deviceId + vaultBindingId`。网页的 `ACCESS_CODE` cookie 不得复用为插件认证。

### 5.2 通用请求头

| Header | 要求 |
|---|---|
| `Authorization` | 除配对交换外必填 |
| `X-MAIC-Protocol-Version` | 必填 |
| `X-Request-Id` | 推荐；缺失时服务端生成 |
| `Idempotency-Key` | 所有 POST/PUT/DELETE 副作用请求必填 |
| `If-Match` | 修改可变资源或批准回写时使用 revision/ETag |

### 5.3 错误信封

```json
{
  "error": {
    "code": "writeback_conflict",
    "message": "目标笔记已变化，请重新预览差异。",
    "retryable": false,
    "requestId": "req_...",
    "details": { "expectedHash": "...", "actualHash": "..." }
  }
}
```

错误码必须稳定，用户消息可本地化。常见状态：`400 invalid_request`、`401 token_invalid`、`403 scope_denied`、`409 conflict`、`413 direct_upload_required`、`422 learning_contract_invalid`、`426 protocol_upgrade_required`、`429 quota_exceeded`、`503 dependency_unavailable`。

## 6. P0 API 清单

### 6.1 配对与设备

| 方法与路径 | 作用 |
|---|---|
| `POST /api/v1/pairing-sessions` | Web 创建一次性配对会话和 6 位 code |
| `POST /api/v1/pairing-sessions/exchange` | 插件交换 device credential |
| `POST /api/v1/device-tokens/refresh` | 轮换短期 token |
| `DELETE /api/v1/devices/{deviceId}` | 撤销设备并终止租约 |
| `GET /api/v1/integration-capabilities` | 协议、大小、命令与功能协商 |

配对 code 最长存活 10 分钟、只能使用一次、连续失败限速；界面必须显示待连接设备指纹和 Vault 名称。

### 6.2 项目与冲刺

| 方法与路径 | 作用 |
|---|---|
| `GET/POST /api/v1/projects` | 列表/创建项目 |
| `GET/PATCH /api/v1/projects/{projectId}` | 获取/更新项目 |
| `POST /api/v1/projects/{projectId}/blockers` | 创建当前卡点 |
| `POST /api/v1/learning-sprints` | 创建学习冲刺 |
| `GET /api/v1/learning-sprints/{sprintId}` | 获取冲刺、课堂和状态 |
| `POST /api/v1/learning-sprints/{sprintId}/abandon` | 带原因放弃 |

### 6.3 来源与直传

| 方法与路径 | 作用 |
|---|---|
| `POST /api/v1/source-bundles/initiate` | 校验 manifest，返回私有直传 URL/凭证 |
| `POST /api/v1/source-bundles/{id}/complete` | 校验对象 hash、大小并提交 revision |
| `GET /api/v1/source-bundles/{id}` | 查看 manifest、保留期与处理状态 |
| `DELETE /api/v1/source-bundles/{id}` | 发起删除并写审计记录 |

超过函数请求限制的正文必须由插件直传私有对象存储；应用 API 只接收 manifest。完成请求必须携带对象存储校验和，服务端再次校验 `manifestHash`。

### 6.4 任务、课堂与运行事件

| 方法与路径 | 作用 |
|---|---|
| `POST /api/v1/learning-sprints/{id}/generation-jobs` | 启动诊断/计划/课堂生成 |
| `GET /api/v1/jobs/{jobId}` | 查询业务 Job、进度和安全错误 |
| `POST /api/v1/jobs/{jobId}/cancel` | 请求取消 |
| `GET /api/v1/jobs/{jobId}/events` | SSE/轮询增量状态；断线可续传 |
| `POST /api/v1/learning-events:batch` | 追加一批学习事件 |

批量事件最多 500 条或 1 MB，以先到者为准；每条独立判重，响应返回 accepted/duplicate/rejected 明细。

### 6.5 证据、回写与复习

| 方法与路径 | 作用 |
|---|---|
| `POST /api/v1/learning-sprints/{id}/evidence` | 提交真实项目证据 |
| `POST /api/v1/evidence/{id}/evaluate` | 按冻结 rubric 评价 |
| `GET /api/v1/writeback-drafts/{id}` | 获取草稿、引用与差异 |
| `PATCH /api/v1/writeback-drafts/{id}` | 用户编辑草稿 |
| `POST /api/v1/writeback-drafts/{id}/approve` | 按 revision 批准并创建命令 |
| `GET /api/v1/sync/feed?cursor=...` | 插件拉取命令、复习项和状态 |
| `POST /api/v1/writeback-receipts` | 上报 applied/conflicted/failed |
| `GET /api/v1/reviews/due` | 获取到期复习项 |
| `POST /api/v1/review-events:batch` | 上报复习结果 |

### 6.6 导出与删除

| 方法与路径 | 作用 |
|---|---|
| `POST /api/v1/exports` | 生成用户数据导出任务 |
| `GET /api/v1/exports/{id}` | 获取状态和短期下载链接 |
| `POST /api/v1/deletion-requests` | 预览并确认范围化删除 |

导出必须是机器可读且包含 schema 版本；删除任务完成后返回各存储层结果和不能立即清除的备份保留说明。

## 7. SourceBundle 上传协议

1. 插件使用 `Vault.cachedRead` 做只读展示，确认时用 `Vault.read` 取最终内容。
2. 插件规范化换行、构建 manifest、计算每项 hash 与总 manifest hash。
3. 用户看到路径清单、文件数、大小、附件、排除项和保留期，并明确确认。
4. `initiate` 按 hash 判重并返回只允许写指定 object key 的短期直传凭证。
5. 插件上传加密传输的压缩包；不在日志打印正文或 URL 查询参数。
6. `complete` 校验大小、对象 checksum、manifest 和权限，事务性创建 Bundle revision。
7. 后台解析只处理 manifest 声明内容；防 zip slip、压缩炸弹、MIME 欺骗和超额解压。
8. 处理结果写 Outbox；插件或 Web 通过状态接口看到成功、拒绝项和删除日期。

失败重传沿用同一 `Idempotency-Key`；相同 manifest 不产生重复存储和重复计费。

## 8. 同步协议

### 8.1 消息信封

```json
{
  "messageId": "msg_...",
  "messageType": "writeback.command.created",
  "schemaVersion": "writeback-command/1",
  "ownerId": "own_...",
  "deviceId": "dev_...",
  "sequence": 184,
  "occurredAt": "2026-07-20T18:30:00Z",
  "correlationId": "spr_...",
  "payload": {}
}
```

### 8.2 上行 Outbox

1. 本地操作与 Outbox 记录在插件本地存储中先后持久化；不得只留内存。
2. 按创建顺序批量发送；每条带 `clientEventId` 和幂等键。
3. 服务端 Inbox 判重后在同一事务内写领域数据与确认结果。
4. 成功后本地标记 acknowledged；可重试错误使用指数退避加抖动。
5. 永久错误进入用户可见的“同步问题”，允许导出诊断和人工重试。

### 8.3 下行 Feed

- Feed 使用每设备单调递增 `sequence`；游标是不透明字符串，不能由客户端推算。
- 客户端只在消息成功落地本地 Inbox 后推进游标。
- 同一消息可重复投递；客户端按 `messageId` 判重。
- P0 轮询即可；前台 15 秒、后台 1–5 分钟并带随机抖动。SSE 只用于用户正在等待的 Job。
- 服务端保留至少 30 天 feed；游标过期返回 `410 cursor_expired`，客户端执行完整状态重建，不重放 Vault 写入。

### 8.4 冲突原则

| 对象 | 冲突策略 |
|---|---|
| SourceBundle | 不合并，创建新 revision |
| LearningEvent | 追加并按事件 ID 判重 |
| Project 可变字段 | ETag/`If-Match`，冲突后人工选择 |
| Writeback | `baseContentHash` 不符即停止，不自动覆盖 |
| Review result | 全部保留，投影按服务端序号重算 |

## 9. 受控回写命令

P0 allowlist：

```text
createManagedNote
appendManagedSection
updateManagedFrontmatterKeys
```

明确禁止：任意路径写入、删除/移动文件、执行代码、修改插件配置、全局搜索替换、覆盖原笔记正文。

插件执行顺序：

1. 校验 token、命令签名/来源、版本、过期时间、device/vault 绑定和 operation allowlist。
2. 将路径规范化并确认目标位于用户配置的受管目录内；拒绝 `..`、绝对路径和符号链接逃逸。
3. 重新读取目标并计算 hash；与 `baseContentHash` 不符则上报 `conflicted`。
4. 再次展示结构化差异，只有本地用户确认后执行。
5. 使用 `Vault.process` 原子更新正文，使用 `FileManager.processFrontMatter` 更新允许字段。
6. 计算结果 hash、写本地 receipt，再发送服务端；重复命令只返回既有 receipt。
7. 失败保留草稿和原文件，不进行猜测性补写。

## 10. 引用与来源可追溯性

每个教学主张应保存：

```text
artifactId → citationId → snapshotId → sourceBundle revision
                           ├─ contentHash
                           ├─ headingPath/blockId
                           └─ quotedHash/contextHash
```

- 用户看到的是 Vault 相对路径、标题、快照时间和“当前笔记是否已变化”。
- 引用只能证明“模型使用了哪个快照”，不能自动证明结论正确。
- 当前笔记与快照 hash 不同则显示 stale，不悄悄把引用切到新内容。
- 删除原文后，若用户也删除云端快照，历史 Artifact 保留引用墓碑但不保留原文摘录。

## 11. 兼容、迁移与生命周期

### 11.1 兼容承诺

- 同一 API 大版本内只新增可选字段或枚举；删除/重命名字段必须升大版本。
- 消费端遇到未知可选字段应忽略，遇到未知命令 operation 必须拒绝。
- 事件 payload 通过 `eventType + schemaVersion` 迁移；保留原始事件。
- 插件升级前用 capabilities 端点确认最小版本；服务端至少支持当前和前一个稳定协议版本。

### 11.2 数据保留默认值

| 数据 | 默认策略 |
|---|---|
| SourceBundle 正文 | 30 天；用户可延长或立即删除 |
| manifest、hash、引用墓碑 | 与项目历史一致，用户删除时清除 |
| 学习事件与能力证据 | 保留到用户删除项目/账户 |
| Job 临时中间产物 | 7 天 |
| 审计安全事件 | 90 天，仅元数据 |
| 导出下载对象 | 24 小时 |

### 11.3 删除顺序

撤销 token → 停止新任务 → 删除私有对象 → 删除派生投影 → 删除领域行/写墓碑 → 验证无可访问对象 → 生成删除 receipt。删除流程必须可重入并能报告部分失败。

## 12. 协议验收条件

进入 P0 纵切片前必须以自动化测试证明：

- 同一上传、Job、事件和回写 receipt 重放 3 次仍只有一次副作用；
- 插件离线 24 小时后恢复，事件不丢失、不重复计分；
- 目标笔记被外部修改后，回写必定进入 conflicted 且原文不变；
- 旧客户端收到未知写命令时拒绝执行并产生可诊断 receipt；
- 游标过期可以重建状态，且不会重复回写；
- owner/device/vault 越权请求全部被拒绝；
- 删除后私有对象不可再通过旧 URL 或 token 访问；
- 所有 Artifact 的引用都能定位到确切 SourceBundle revision。

测试矩阵与发布门槛见 [风险、测试与验收矩阵](./07-RISK-TEST-ACCEPTANCE.md)。
