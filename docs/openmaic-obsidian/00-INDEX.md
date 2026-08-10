# OpenMAIC × Obsidian 项目学习系统：文档总索引

> 文档基线：v0.6.2（完整沉淀、周期归纳、三维图谱 G1-G7 与增量投影）  
> 复审日期：2026-07-24  
> OpenMAIC 基线：v0.3.0，commit `84b1907255208ad39fd04beac7c9087d202d146c`  
> 目标部署：个人使用，OpenMAIC Web 部署在 Vercel，Obsidian 通过独立插件接入

## 1. 一句话结论

本项目不是“让 OpenMAIC 读取 Obsidian 并生成更多内容”，而是一个项目驱动的学习闭环：

```text
真实项目卡点
→ 明确交付物与验收标准
→ 用户授权选取 Obsidian 资料
→ 诊断知识缺口
→ 生成 15–45 分钟最短学习冲刺
→ OpenMAIC 主动教学、练习与反馈
→ 回到真实项目产出证据
→ 验证能力
→ 人工确认后回写 Obsidian
→ 延迟复习与迁移练习
```

系统职责必须长期保持清晰：

| 组成 | 唯一核心职责 |
|---|---|
| 真实项目 | 提供问题、实践场景、交付物和最终能力证据 |
| OpenMAIC | 诊断、教学、主动回忆、练习、反馈与课堂交互 |
| Obsidian | 管理来源、决策、错误、证据、掌握记录和长期复习 |

## 2. 已冻结的一级决策

1. Obsidian 是长期知识的事实源；OpenMAIC 是学习干预与交互运行时。
2. MVP 不做全 Vault 扫描，也不做通用双向同步。
3. 只上传用户本次明确选择的笔记；每次都显示范围、估算大小和外发边界。
4. 原始来源默认只读；回写先生成草稿和差异预览，必须由用户确认。
5. 首个版本以“新建受管学习记录”为默认回写方式，不直接改写原始笔记。
6. 每个学习单元必须绑定真实项目交付物和可检查的验收标准。
7. 学习历史用追加式事件保存；“掌握度”是可重算的派生结果，不是不可解释的真相。
8. OpenMAIC 与 Obsidian 插件通过版本化协议连接，不把插件代码深埋进 Web 应用。
9. 服务端持久化不再依赖 Vercel Function 本地文件系统；长任务不再依赖 `after()`。
10. 领域层通过端口隔离 Postgres、Blob、Workflow 等供应商实现，以降低未来迁移成本。

## 3. 文档及阅读顺序

| 顺序 | 文档 | 回答的问题 |
|---|---|---|
| 1 | [愿景与边界](./01-VISION-AND-SCOPE.md) | 为什么做、为谁做、什么算成功、什么绝不做 |
| 2 | [研究与竞品复审](./02-RESEARCH-AND-COMPETITIVE-ANALYSIS.md) | 官方资料和类似产品对方案产生了哪些约束 |
| 3 | [完整实现流程](./03-IMPLEMENTATION-FLOW.md) | 从零到可用、验证、扩展的具体步骤与阶段门 |
| 4 | [详细 PRD](./04-PRD.md) | 产品需求、用户旅程、功能优先级和验收标准 |
| 5 | [完整架构文档](./05-ARCHITECTURE.md) | 系统边界、组件、部署、可靠性、安全与演进方式 |
| 6 | [数据、API 与同步协议](./06-DATA-API-SYNC-SPEC.md) | 数据实体、接口契约、幂等、冲突与回写如何实现 |
| 7 | [风险、测试与验收矩阵](./07-RISK-TEST-ACCEPTANCE.md) | 哪些地方最容易失败，怎样在上线前证明可接受 |
| 8 | [文档治理与反馈机制](./08-GOVERNANCE-AND-FEEDBACK.md) | PRD、架构和实现如何持续同步、及时更新 |
| 9 | [交付路线图](./09-DELIVERY-ROADMAP.md) | 按什么顺序开发，何时继续、暂停或回退 |
| 10 | [实施记录](./10-IMPLEMENTATION-LOG.md) | 当前真正完成了什么、验证证据是什么、下一阶段还缺什么 |
| 11 | [M2 安全、验证与部署门禁](./11-M2-SECURITY-VALIDATION-AND-DEPLOYMENT-GATE.md) | 配对、私有上传、学习启动如何验收，什么条件下才能正式发布 |
| 12 | [学习、研究与知识归纳生产基线](./12-PRODUCTION-LEARNING-RESEARCH-SYNTHESIS-BASELINE.md) | 持久课堂、学习事件、弹性搜索、3D 图谱与双确认归纳回写当前实际运行到哪里 |
| 13 | [项目、知识源与版本生产基线](./13-PROJECT-SOURCE-VERSION-PRODUCTION-BASELINE.md) | 项目文件夹如何获得稳定身份、版本、课堂关联、项目级回写与归纳 |
| 14 | [项目自动同步与目标检索生产基线](./14-PROJECT-GOAL-RETRIEVAL-PRODUCTION-BASELINE.md) | 大项目如何一次授权、自动分批、建立索引、按目标选证据并把引用带入课堂与回写 |
| 15 | [完整知识沉淀实现计划](./15-COMPLETE-KNOWLEDGE-DEPOSITION-IMPLEMENTATION-PLAN.md) | 如何实现双笔记、自动沉淀、进度回写、资料卡、复习和周期归纳 |
| 16 | [三维知识图谱 v2 实现计划](./16-3D-KNOWLEDGE-GRAPH-V2-IMPLEMENTATION-PLAN.md) | 如何把当前确定性 Canvas 图谱升级为可追溯语义图、WebGL 交互和增量投影 |

## 4. 北极星指标

北极星指标是：**每周完成的有效项目学习闭环数**。

一次闭环只有满足以下全部条件才计数：

- 来源于真实项目问题或能力目标；
- 使用了可追溯的来源材料；
- 用户完成了主动回忆、解释或练习；
- 产生了真实项目成果；
- 成果通过预定义验收标准、自动测试或人工量规；
- 结论、错误与证据经用户确认后写回 Obsidian；
- 创建了后续复习或迁移任务。

课程数量、幻灯片数量、AI 对话轮数、写入字数和在线时长都不是成功指标。

## 5. 方案状态标签

本文档组使用以下状态：

- `Proposed`：待评审，不能指导不可逆实现。
- `Accepted`：已形成共识，可以实施。
- `In delivery`：正在实现，需求变化必须经过变更流程。
- `Validated`：已有真实使用证据满足门槛。
- `Superseded`：已被新版本替代，保留历史原因。

当前整体状态为 `In delivery`。配对、私有上传、持久课堂、学习事件、受控回写、
确定性知识归纳、项目稳定身份与版本，以及 Markdown 项目的自动分批和目标检索
已经形成个人生产基线；GitHub、论文、网页、会议和附件的专用采集器仍在后续阶段。
最新证据见[学习、研究与知识归纳生产基线](./12-PRODUCTION-LEARNING-RESEARCH-SYNTHESIS-BASELINE.md)、
[项目、知识源与版本生产基线](./13-PROJECT-SOURCE-VERSION-PRODUCTION-BASELINE.md)和
[项目自动同步与目标检索生产基线](./14-PROJECT-GOAL-RETRIEVAL-PRODUCTION-BASELINE.md)。

## 6. 术语

| 术语 | 定义 |
|---|---|
| Project | 用户正在真实推进、存在交付物和验收条件的项目 |
| Project Blocker | 当前阻碍项目推进的具体问题 |
| Learning Sprint | 围绕一个 Blocker 生成的 15–45 分钟学习干预 |
| Source Selection | 用户本次明确授权使用的 Obsidian 笔记集合 |
| Source Snapshot | 带版本、哈希和来源定位的只读内容快照 |
| Source Bundle | 一次学习冲刺所需的快照与元数据包 |
| Learning Artifact | OpenMAIC 生成的课堂、测验、练习或反馈 |
| Project Evidence | 代码、测试、文档、决策、设计或其他真实成果 |
| Learning Event | 诊断、作答、提示、评分、应用和复习等追加式事实 |
| Writeback Draft | 等待用户审查的 Obsidian 回写候选内容 |
| Mastery View | 根据学习事件推导的可解释能力状态 |
| Synthesis Run | 对指定课堂范围生成的一次可追溯、可重算知识归纳与图谱投影 |

## 7. 证据优先级

发生冲突时按以下顺序处理：

1. 当前本地 OpenMAIC 代码与测试；
2. Obsidian、Vercel、OpenMAIC 等官方文档和官方仓库；
3. 同行评审论文、官方研究机构资料；
4. 类似产品官方文档与官方仓库；
5. 专家判断和明确标注的推断。

所有时效性结论都以 2026-07-20 为检索快照；实施时若超过 30 天，应重新核对平台限制和 API。
