# 交付路线图

> 状态：`Proposed`  
> 交付假设：单一用户、一个主要 Vault、一名开发者与 AI 协作、Vercel 托管 Web、独立 Obsidian 插件

## 1. 路线图结论

不要从“做一个能聊天的 Obsidian 插件”开始。最短且不会埋下大重构的关键路径是：

```text
冻结并修复当前基线
→ 冻结领域/API/同步契约
→ 用 5 个探针打掉最高风险
→ 建立生产持久化与可观测骨架
→ 接通项目卡点—选源—诊断—课堂
→ 接通 Evidence—评价—安全回写—复习
→ 用 10 个真实项目闭环验证学习价值
→ 再决定是否扩展搜索、多设备和复杂调度
```

这是一项完整产品改造，不是简单部署配置。对单人开发，P0 的量级约为 **40–70 个有效开发日**；该数字仅用于范围判断，不是工期承诺。任何为了赶时间而跳过持久化、冲突保护或学习验证的“缩短”，都会把成本推迟到数据丢失或大重构阶段。

## 2. 范围与资源假设

### 2.1 P0 固定范围

- 个人使用；单 owner，多 device 数据模型预留但默认只启用一个设备；
- Markdown 为核心来源；只处理用户明确选择的笔记；图片附件是否进入 P0 在 Gate 1 决定；
- OpenMAIC Web 保留现有课堂能力；插件独立发布/侧载；
- Postgres、私有对象存储、持久 Workflow；
- 新建受管 Learning Record 为默认回写；
- 固定可解释复习间隔；
- 英文/中文内容均可，但先只维护一套 UI 语言和一套评测集。

### 2.2 明确不放入关键路径

- 全 Vault 自动索引、通用 RAG 聊天、多人协作、公共分享；
- 任意双向文件同步、实时 CRDT、自动覆盖原笔记；
- 自动执行代码/终端、浏览器代理、任意工具调用；
- 完整 FSRS 个性化、知识图谱自动重构、移动端后台实时同步；
- 插件商店公开发布和 SaaS 计费。

## 3. 估算方法

| 量级 | 有效开发日 | 定义 |
|---|---:|---|
| XS | 0.5–1 | 已知局部改动，测试边界清楚 |
| S | 1–3 | 单模块、少量契约、可独立验收 |
| M | 3–7 | 跨模块或含迁移/真实平台验证 |
| L | 7–15 | 完整纵切片、多个故障路径和发布证据 |

估算包含实现、测试、文档和修复，不包含等待第三方审批。每个里程碑只在上一个 Gate 有证据关闭后重新估算；后续数字不应被当成承诺锁死。

## 4. 环境与分支策略

### 4.1 仓库

1. 在个人 GitHub 账号创建 OpenMAIC fork，保留 `upstream` 指向 `THU-MAIC/OpenMAIC`。
2. `main` 始终是可部署状态；功能通过短分支和 PR 合入。
3. Obsidian 插件优先放在同一 fork 的 `packages/obsidian-plugin`，共享协议包但不共享运行时实现；成熟后再决定是否拆仓。
4. 协议、事件 Schema 和测试夹具放 `packages/integration-contracts`，由 Web 与插件共同消费。
5. 每月 fetch upstream；每个正式里程碑做一次合并/变基冲突演练并记录差异。

### 4.2 部署环境

| 环境 | 用途 | 数据 |
|---|---|---|
| Local | 开发、单元/契约测试 | 可丢弃数据库 + 专用测试 Vault |
| Preview | 每个 PR 的 Web 验证 | 隔离临时数据；不得连真实 Vault |
| Staging | 探针、E2E、迁移和回退 | 与 Production 同类服务，脱敏夹具 |
| Production | 个人真实学习 | 私有数据、最小日志、备份与删除 |

现有 Vercel Production 在新纵切片通过 Gate 6 前保持为基线版本。新功能先通过 Preview/Staging 验证，再显式 Promote；不要让每个开发提交自动改变真实学习数据。

## 5. 里程碑总览

| 里程碑 | 目标 | 量级 | 出口 |
|---|---|---:|---|
| M0 | 安全、可复现的当前基线 | M | Gate 0 |
| M1 | 产品和协议冻结 | S–M | Gate 1 |
| M2 | 五个高风险技术探针 | L | Gate 2 |
| M3 | 生产基础骨架 | L | Gate 3 |
| M4 | 项目—选源—课堂纵切片 | L | Gate 4A |
| M5 | Evidence—回写—复习闭环 | L | Gate 4B |
| M6 | 学习价值校准 | L（含使用周期） | Gate 5 |
| M7 | 安全、恢复与个人正式版 | L | Gate 6 |

## 6. M0：基线冻结与依赖安全

### 交付物

- 可复现的本地构建、测试和 Vercel Preview；
- 当前课堂生成、播放器、ZIP 导入导出和 Runtime 行为的回归清单；
- 数据写入、内存状态、`after()` 和浏览器 localStorage 使用点清单；
- React/Next 及直接依赖升级到当时官方支持、已修补版本；
- 独立测试 Vault、测试账号和脱敏夹具；
- 回退 tag/commit 与基线发布证据。

### 工作项

1. 建立 fork、upstream remote、保护 `main`。
2. 保存当前 Production 配置和非敏感环境变量名称；secrets 只在平台管理。
3. 运行并补齐最小回归；记录真实失败，不先改业务。
4. 执行依赖升级，逐项修复兼容问题。
5. 建立 CI：lint/typecheck/test/build/contract placeholder。
6. 为新能力加关闭状态的 feature flags。

### 出口

满足 [Gate 0](./07-RISK-TEST-ACCEPTANCE.md#10-gate-验收矩阵)。若升级后核心课堂无法可靠回归，暂停新功能，先稳定基线。

## 7. M1：产品、数据和协议冻结

### 交付物

- 用户确认的 P0 旅程、受管目录、附件范围、保留期和外部检索默认值；
- `SourceBundle/1`、`LearningEvent/1`、`WritebackCommand/1` JSON Schema；
- API OpenAPI 草案、错误码、权限矩阵、状态机；
- 8 个关键 ADR 草案；
- Requirement → Test 追踪表。

### 工作项

1. 用一个真实但脱敏的项目手工走完旅程，删除非必要步骤。
2. 将 [协议规范](./06-DATA-API-SYNC-SPEC.md) 转成可执行 Schema。
3. 为 Web 与插件生成同一套 TypeScript 类型，但以 Schema 为权威。
4. 写消费者驱动契约测试，包含旧客户端和未知命令。
5. 冻结 P0 allowlist；任何新写命令推迟到 Gate 4 后评估。

### 出口

所有 P0 Requirement 有 ID、状态、接口、风险和至少一个验收测试；一级决策无未解决冲突。

## 8. M2：五个高风险技术探针

探针必须是可抛弃的最小实现，不提前美化 UI。

### Probe A：Obsidian 安全选源

- 在桌面和至少一个移动真机列出用户手选 Markdown；
- 构建 manifest/hash，显示范围与大小；
- 不使用 Node 专属 API、不扫描整个 Vault；
- 验证移动/重命名和 Unicode 路径。

### Probe B：设备配对与撤销

- 一次性 code → device/vault 绑定 token → scope 检查 → 撤销；
- token 存 Obsidian SecretStorage/平台安全存储，不落 frontmatter；
- 暴力、重放和错误设备确认测试通过。

### Probe C：私有直传与删除

- 10 MB Bundle 直传私有对象存储，API 只收 manifest；
- checksum、断网重传、判重和恶意压缩包测试；
- 删除后旧 URL/token 不能访问。

### Probe D：持久 Job

- 最小生成步骤运行于 Workflow；
- 部署切换、步骤终止、模型超时后从 checkpoint 恢复；
- 同一幂等键不重复执行收费步骤。

### Probe E：冲突安全回写

- 插件收到 allowlist 命令；本地显示差异并确认；
- `Vault.process` 新建/追加受管记录；
- 修改 base 文件后必定冲突且不覆盖；重复命令只执行一次。

### 出口

五个探针在 Staging 留下可复现测试和限制记录。任一探针失败都先改架构/PRD，不把临时捷径带入 M3。

## 9. M3：生产基础骨架

### 交付物

- `domain/application/adapters` 模块边界；
- Postgres migration、Repository 和 owner scope；
- 私有 Blob adapter、Workflow adapter、Model adapter；
- `/api/v1` 认证、中间件、错误信封和幂等框架；
- Outbox/Inbox、Feed cursor、审计和可观测性；
- 数据导出/删除的最小骨架；
- Preview/Staging 独立环境。

### 推荐实现顺序

1. 领域对象、状态机和纯单元测试；
2. migration + Repository 合同测试；
3. owner/device/vault 授权上下文；
4. 幂等请求、业务 Job 和 Outbox 事务；
5. Blob/Workflow adapter；
6. Feed/Inbox 与插件本地持久队列；
7. 结构化日志、request/job/sprint correlation；
8. 导出、删除和 feature flag；
9. 架构适应性检查进入 CI。

### 出口

- Production 路径不再用本地文件或内存 Map 保存新领域状态；
- 每个跨服务副作用可重试；
- 数据可以导出、删除并从测试备份恢复；
- E2E-02 的基础故障场景通过。

## 10. M4：项目—选源—诊断—课堂纵切片

### 用户可见结果

用户可以从真实 Project/Blocker 出发，在插件选取笔记，确认 SourceBundle，在 Web 完成诊断并进入使用该快照生成的 OpenMAIC 学习冲刺。

### 工作包

- Project/Blocker/Deliverable/Acceptance UI；
- 插件选源、范围预览、直传、状态页；
- SourceBundle 清单和引用浏览；
- 诊断问题、主动尝试、冲刺计划；
- 生成 Job 进度、取消、失败恢复；
- OpenMAIC 课堂 DSL 适配，不重写播放器；
- LearningEvent 批量追加与课堂刷新恢复；
- 基础成本与隐私面板。

### 出口

- E2E-01 完成到课堂学习阶段；
- 刷新、重新部署、断网均不丢课堂与事件；
- 每个关键教学主张能回到确切 SourceBundle revision；
- 用户可以在生成前取消来源和查看预计成本/保留期。

## 11. M5：Evidence—评价—回写—复习闭环

### 用户可见结果

用户提交真实项目成果，系统按预设标准提供反馈，用户确认后把错误、决策、证据和下一步写回受管学习记录，并收到适量复习任务。

### 工作包

- Evidence 类型、引用和 rubric 编辑/冻结；
- 评价与分维反馈，显式区分 AI 判断和可执行验收；
- WritebackDraft 编辑器、引用、差异与批准；
- Feed、Command lease、Receipt、冲突恢复；
- 受管目录/模板和 frontmatter；
- 四维 Mastery 投影与证据解释页；
- 固定间隔 ReviewItem 与每日预算；
- 导出/删除 UI 完整化。

### 出口

黄金 E2E-01、03、04、05 通过；连续 20 次测试写回没有静默覆盖或重复副作用。

## 12. M6：学习价值校准

### 方法

用当前用户自己的 3–5 个真实项目卡点完成至少 10 个闭环，覆盖事实、概念、操作和迁移任务。每次闭环后只记录少量高价值反馈：

- 这次是否真正解除 Blocker？
- 哪一步最浪费时间？
- 系统是否过早给答案？
- Evidence 是否真的达到验收标准？
- 回写内容一周后是否仍有用？
- 复习是否帮助迁移，还是增加负担？

### 调整优先级

1. 先修学习闭环断点；
2. 再修来源/引用、提示和 rubric；
3. 再修交互摩擦；
4. 最后才增加新功能或更复杂模型。

### 出口

达到 [学习价值阈值](./07-RISK-TEST-ACCEPTANCE.md#62-p0-学习价值阈值)，或者有明确、可复测的修改方案。若真实 Evidence 和迁移表现没有改善，停止 P1，不以更多生成内容掩盖问题。

## 13. M7：安全、恢复与个人正式版

### 工作包

- 全量授权、提示注入、上传、路径、日志与删除测试；
- 所有 Workflow 步骤故障注入；
- iOS/Android 最小真机验证；
- 数据导出、备份恢复、迁移和回退演练；
- 费用配额、速率限制、任务取消和熔断；
- 用户可见诊断、同步问题和已知限制；
- Production 迁移计划与 feature flag 渐进开启。

### 发布顺序

1. 部署数据库/存储兼容性向前变更，功能仍关闭；
2. 部署 Web，验证只读路径；
3. 给唯一测试设备启用配对与上传；
4. 启用生成，观察一个完整闭环；
5. 启用回写，但仅 `createManagedNote`；
6. 连续 3 个真实闭环无 Critical/High 事件后，标记个人正式版；
7. 保留旧课堂读取和导出路径至少一个发布窗口。

### 回退

- 功能旗标关闭新入口；
- 撤销插件 device token，停止新 Workflow；
- Web 回退到已验证部署；
- 数据库采用 expand/contract，回退期不执行破坏性 contract；
- 已创建的受管笔记不自动删除，由用户确认处理；
- 未完成 Job/Command 标记 cancelled/expired，保留审计和可恢复草稿。

## 14. P1 与 P2 触发式路线图

### P1：只有指标触发才进入

| 能力 | 进入条件 |
|---|---|
| FSRS | 复习事件量足够校准，固定规则造成可测负担，原始评分完整 |
| 多设备 | 用户确有第二设备稳定需求，P0 device/vault 隔离连续验证 |
| 受管区块更新 | ≥ 100 次回写无静默覆盖，create-only 产生明显重复信息 |
| 语义搜索/RAG | 选源成本成为主要瓶颈，且隐私和引用评测能守住 |
| 更多附件 | Markdown 闭环价值成立，附件解析有明确项目收益 |
| 外部权威检索 | 用户主动开启；来源白名单、引用和数据外发提示完成 |
| 复习回流 OpenMAIC | ReviewItem 积压受控，课堂形式确实提高迁移表现 |

### P2：方向性扩展

多人空间、公共课程市场、任意知识库连接、实时双向同步、自动代理执行和 SaaS 商业化需要新的威胁模型、身份模型和 PRD，不从 P0 架构“顺手开启”。

## 15. 首批 15 个可执行 Issue

| 顺序 | Issue | 量级 | 依赖 | 验收摘要 |
|---:|---|---:|---|---|
| 1 | Fork/upstream/分支保护与基线 tag | XS | 无 | 可回退、可拉上游 |
| 2 | React/Next 安全升级与现有功能回归 | M | 1 | Gate 0 证据完整 |
| 3 | 建立独立测试 Vault 与固定夹具 | S | 1 | 桌面/移动可重建 |
| 4 | 定义 3 个核心 JSON Schema 与版本工具 | M | Gate 1 决策 | Web/插件契约测试共享 |
| 5 | ADR：数据权威、Job、回写、认证 | S | 4 | 决策与替代方案可追溯 |
| 6 | Scaffold Obsidian 插件和移动兼容 CI | S | 3/4 | 测试 Vault 加载成功 |
| 7 | Probe A：手选 SourceBundle | M | 6 | 范围预览/hash/重命名通过 |
| 8 | Probe B：配对、scope、撤销 | M | 4/6 | 重放与旧 token 被拒绝 |
| 9 | Probe C：私有 Blob 直传/删除 | M | 4 | 10 MB、校验、删除通过 |
| 10 | Probe D：持久 Job/幂等收费步骤 | M | 4 | 故障恢复不重复执行 |
| 11 | Probe E：本地确认与冲突回写 | M | 6 | 外部修改绝不覆盖 |
| 12 | Postgres migrations + owner-scoped repositories | M | Gate 2 | 事务/越权/迁移测试通过 |
| 13 | `/api/v1` auth/error/idempotency middleware | M | 8/12 | 契约与负面测试通过 |
| 14 | Outbox/Inbox/Feed 与本地持久队列 | L | 12/13 | 24h 离线恢复不重不丢 |
| 15 | Project→Source→Job 最小纵切片 | L | 7–14 | Staging 可完成课堂生成 |

Issue 4 以前不写完整业务功能；Issue 7–11 是探针，结果允许被丢弃，但证据和 ADR 必须保留。

## 16. 进度看板

看板列：

```text
Decision needed
→ Ready（Requirement/contract/test 已有）
→ In progress
→ Review（代码 + 文档 + 证据）
→ Staging validated
→ Production validated
→ Superseded / Rejected
```

WIP 限制：单人同时最多 1 个主功能 + 1 个阻断修复。不得为了显示进度把同一个纵切片拆成大量无法独立验收的“完成”卡片。

每个 Issue 的 Definition of Ready：

- 对应 PRD ID、用户结果和非目标；
- 输入/输出/错误/权限契约明确；
- 测试和回退方式明确；
- 风险与依赖已链接。

Definition of Done：实现、测试、文档、可观测、迁移/回退、Staging 证据全部齐备。

## 17. 成本控制

在 M2 前先建立预算上限，不在文档中冻结易变化的价格。按以下单位记录：

- 每次 LearningSprint 的模型输入/输出 token 与重试放大；
- 每个 SourceBundle 的存储字节天、上传和读取；
- 每个 Job 的 Workflow 步骤数和运行时间；
- Postgres 数据量、连接和查询；
- 每个有效学习闭环的总云成本。

默认控制：生成前估算、单 Sprint 配额、同输入判重、可取消、失败不无限重试、临时制品自动过期。平台价格和限制在每次 Gate 2/6 前从官方重新核对。

## 18. 下一步动作

当前最正确的下一步不是立即写插件 UI，而是召开一次 Gate 1 决策：确认附件范围、SourceBundle 默认保留期、受管目录名、外部检索默认关闭，以及 P0 只启用一个设备。随后依次执行 Issue 1–5，再开始五个探针。

如果以上默认决策被接受，首个开发批次就是：

```text
M0 基线与安全升级
+ M1 三个核心 Schema/ADR
+ Probe A/B 的最小骨架
```

该批次完成后再根据真实 Obsidian/Vercel 探针结果冻结数据库和完整 API，实现成本最低、返工风险也最可控。
