# 官方资料、学习科学与类似项目复审

> 状态：Accepted research baseline  
> 检索截止：2026-07-20  
> 方法：技术事实只采用官方文档、官方仓库或一手论文；类似产品只引用其官方资料。产品结论与事实分开标注。

## 1. 研究问题

本轮研究只回答会改变架构或产品流程的问题：

1. OpenMAIC 当前有哪些可复用能力和生产约束？
2. Obsidian 插件怎样安全、兼容地读写 Vault？
3. Vercel 上怎样处理持久化、文件、长任务与大载荷？
4. 哪些学习机制有足够证据进入默认流程？
5. 相似项目已经解决了什么，又留下了什么空白？

## 2. OpenMAIC 现状核对

### 2.1 已有产品能力

当前本地基线为 v0.3.0、MIT 许可证。官方仓库说明 OpenMAIC 可从主题或文档生成课程，支持 slides、quiz、interactive simulation、PBL、多智能体讨论、白板、TTS、PPTX/HTML/课堂 ZIP 导出。[OpenMAIC 官方仓库](https://github.com/THU-MAIC/OpenMAIC)

代码核对发现：

- Markdown 已作为 `text/markdown` 和 `.md/.markdown` 的一等输入，由本地纯文本提取器处理；
- `.maic.zip` 已有版本化 manifest、场景、智能体和媒体索引，可完整导入和重映射 ID；
- `@openmaic/dsl` 是零运行时依赖的序列化契约，包含校验、标准化、版本和迁移；
- `DocumentStore` 将课堂文档与学习运行数据分离；
- `RuntimeStore` 以 `(stageId, learnerKey)` 分区，用追加式、单调 `seq` 的记录保存聊天、测验等学习事实；
- 已有 Browser、HTTP 和 PostgreSQL RuntimeStore 实现，可作为云端学习记录的基础；
- 当前默认学习身份是设备匿名键，并预留 `mergeLearner` 迁移路径。

### 2.2 生产约束

当前服务端课堂和生成任务写入：

```text
process.cwd()/data/classrooms
process.cwd()/data/classroom-jobs
```

生成 API 先写任务文件，再通过 Next.js `after()` 启动任务，进程内 Map 去重。这一实现对本地/Docker 有效，但不能作为 Vercel 上的长期可靠基础。

此外，当前 `ACCESS_CODE` 是站点级共享口令和 Cookie 防护，不是具备设备、权限、撤销和轮换能力的 Obsidian 集成身份。因此新插件需要独立的配对与令牌体系，不能直接复用站点 Cookie。

### 2.3 对设计的影响

- 不重写课堂 DSL；扩展 SourceBundle、LearningEvent 等外层协议。
- 学习运行记录继续走 RuntimeStore 语义，避免把答题历史塞进课堂文档。
- `.maic.zip` 保留为离线备份和迁移格式，但不作为在线同步协议。
- 服务端课堂、任务和媒体必须迁出本地文件系统。
- Obsidian 集成身份必须与 `ACCESS_CODE` 分离。

## 3. Obsidian 官方约束

### 3.1 文件与元数据

Obsidian 官方文档将 Vault 定义为一个本地文件夹，并提供 Vault API 枚举和读取 Markdown。用于展示时应优先 `cachedRead()`；若将读取结果用于修改，则应使用新鲜读取，并通过 `Vault.process()` 保证读写之间没有被其他进程改动。[Vault 官方文档](https://docs.obsidian.md/Plugins/Vault)

官方 API 仓库说明 `MetadataCache` 已缓存每个 Markdown 文件的标题、链接、嵌入、标签和块信息；插件可利用这些元数据先在本地筛选，而不必把整个 Vault 上传。[Obsidian API 官方仓库](https://github.com/obsidianmd/obsidian-api)

官方插件自检清单要求：

- 后台修改优先 `Vault.process()`，不要直接 `Vault.modify()`；
- frontmatter 使用 `FileManager.processFrontMatter()`，不要手工解析后覆盖；
- 优先 Vault API 而不是 Adapter API；
- 插件数据使用 `Plugin.loadData()/saveData()`；
- 网络、外部文件访问、账户、收费和遥测需在 README 中披露；
- 不应在插件中加入未经说明的客户端遥测。[Obsidian 官方插件自检](https://docs.obsidian.md/oo/plugin)

### 3.2 移动端与网络

若插件不是桌面专用，官方要求避免在顶层使用 Node `fs/path/electron`，使用 `Platform` 判断环境，并优先 `requestUrl` 而非浏览器 `fetch`；移动端 Adapter 也不一定是 `FileSystemAdapter`。[Obsidian 官方插件自检](https://docs.obsidian.md/oo/plugin)

因此本项目的 P0 插件应：

- 基于 Vault、MetadataCache、FileManager 和 `requestUrl`；
- 不直接依赖桌面文件系统路径；
- 从第一天保持移动端可编译和可运行；
- 把大型计算、模型调用和任务编排放在 OpenMAIC 服务端。

### 3.3 密钥与开发安全

官方入门文档明确建议始终在单独的开发 Vault 中测试插件，避免损坏主 Vault。[构建插件官方指南](https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin)

截至本次检索，Obsidian 1.11.4+ 已提供 `app.secretStorage`/Keychain 能力；成熟插件已因此提高最低版本并把 API Key 从 `data.json` 迁入 Keychain。[Obsidian Copilot 官方发布记录](https://github.com/logancyang/obsidian-copilot/blob/master/RELEASES.md)

本项目不把模型 API Key 下发到插件。插件只保存可撤销、最小权限的设备集成令牌；优先 SecretStorage，低版本回退必须显式警告。

## 4. Vercel 官方约束

### 4.1 文件系统与对象存储

Vercel Functions 的部署文件系统只读，仅 `/tmp` 提供最多 500 MB 临时空间，不能作为课堂、任务或学习记录的持久化目录。[Vercel Runtime 官方文档](https://vercel.com/docs/functions/runtimes)

Vercel Blob 适合存储文档和媒体，支持 private/public store、不可变路径建议、ETag 条件写和直接上传。敏感笔记快照必须使用 private store；不可把“难猜的公开 URL”当权限控制。[Vercel Blob 官方文档](https://vercel.com/docs/vercel-blob) 截至 2026-06-30，Private Blob 已 GA，并支持短时 OIDC 身份。[GA 公告](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)

关系数据应通过 Vercel Marketplace 连接 Postgres 等数据库；Vercel 自身的 Storage 页面把数据库能力归入 Neon、Supabase、Upstash、AWS 等 Marketplace 集成。[Vercel Storage 官方概览](https://vercel.com/docs/storage)

### 4.2 请求和函数限制

Function 请求体和响应体上限仍是 4.5 MB，因此 Obsidian 资料与媒体不能先穿过普通 API 再写 Blob；应由服务端签发短时上传授权，插件直接上传对象存储。[Vercel Functions 限制](https://vercel.com/docs/functions/limitations)

截至 2026-06-15，使用 Fluid Compute 的 Pro/Enterprise Node.js 和 Python Functions 可选择最长 30 分钟执行时间；但这不等于任务具有跨崩溃、跨部署恢复能力。[30 分钟函数公告](https://vercel.com/changelog/vercel-functions-can-now-run-up-to-30-minutes)

### 4.3 持久任务

Vercel Workflow 为多步骤流程提供持久步骤、暂停、重试、跨部署恢复和事件日志，适合课堂生成、等待用户确认和回写等状态化流程。[Vercel Workflow 官方介绍](https://vercel.com/blog/introducing-workflow)

Vercel Queues 在 2026-02-27 为所有计划进入 Beta，提供至少一次投递、重试、可见性租约和幂等键；官方明确要求消费者保持幂等，也明确其没有内建 DLQ 且不保证严格 FIFO。[Vercel Queues 官方文档](https://vercel.com/docs/queues)

设计结论：

- P0 的“生成一次学习冲刺”使用可替换的 `JobOrchestrator`，Vercel 默认适配 Workflow；
- Queues 只用于后续的索引、通知、分析等事件扇出，不成为 P0 必需依赖；
- 任何消费者都按至少一次执行设计，使用幂等键和状态检查；
- 任务业务状态仍保存在 Postgres，不能只存在平台控制台。

### 4.4 Web 依赖安全基线

本地仓库快照使用 React `19.2.3`、Next.js `16.1.2`。截至 2026-07-20，React 官方版本页已列出更高的稳定补丁版本，React Server Components 后续安全公告也明确给出安全版本；Next.js 官方安全公告包含晚于当前版本的修复。[React 官方版本](https://react.dev/versions) [React RSC 安全更新](https://react.dev/blog/2025/12/11/denial-of-service-and-source-code-exposure-in-react-server-components) [Next.js 官方安全公告](https://github.com/vercel/next.js/security/advisories)

这不意味着本文凭记忆判定当前版本受每一个公告影响，而是形成一个更稳妥的发布约束：开始集成前重新核对官方公告，升级到当时受支持且已修补的版本，并完成 OpenMAIC 现有功能回归。依赖安全门不能等到正式发布前才处理。

## 5. 学习科学依据

### 5.1 主动回忆，而非重复阅读

Roediger 与 Karpicke 的实验表明，重复学习在 5 分钟测试上可能更好，但在 2 天和 1 周延迟测试中，先前测试带来更高保持；重复阅读同时提高了学习者信心，说明主观流畅感会误导。[原始论文](https://journals.sagepub.com/doi/10.1111/j.1467-9280.2006.01693.x)

Karpicke 与 Blunt 发现，检索练习在理解和推理问题上也优于边看材料边制作概念图。[PubMed 论文记录](https://pubmed.ncbi.nlm.nih.gov/21252317/)

产品约束：讲解后必须有无提示回忆或生成性任务，不能把“看完内容”记为完成。

### 5.2 迁移需要被直接设计和测量

对 122 个实验、10,382 名参与者的元分析发现，测试能够产生迁移，但效果取决于应用/推理题、检索展开程度、初次表现和任务一致性；不存在“做过任意 Quiz 就自然迁移”的保证。[Pan 与 Rickard 元分析](https://pubmed.ncbi.nlm.nih.gov/29733621/)

产品约束：每次冲刺至少有一个与当前项目同构的应用任务；“掌握”不能只由记忆题推导。

### 5.3 主动学习可能感觉更差，但实际学得更多

PNAS 随机对照研究发现，主动课堂的学生实际学习更多，却主观感觉学得更少，部分原因是认知努力更高。[Deslauriers 等原始论文](https://doi.org/10.1073/pnas.1821936116)

产品约束：不能用满意度或“解释很顺”替代学习结果；应向用户解释适度费力是预期现象，并同时测量实际表现与主观体验。

### 5.4 间隔复习需要控制工作量

Anki 官方手册说明 FSRS 根据个人复习历史拟合参数；目标保持率越高，间隔越短、每日负担越高，超过 90% 后工作量快速上升。[Anki FSRS 官方手册](https://docs.ankiweb.net/deck-options.html#fsrs)

产品约束：

- P0 先保留完整复习事件并使用简单 D1/D7/D30，验证用户是否愿意复习；
- P1 再通过版本化 `SchedulerPort` 接入 FSRS；
- 必须提供每日上限和积压处理，不可无限生成卡片；
- 项目临近交付时，调度目标与长期记忆目标应分开。

## 6. 类似项目调研

### 6.1 对照矩阵

| 产品/项目 | 官方能力 | 值得吸收 | 不能照搬或仍有空白 |
|---|---|---|---|
| Khoj | Obsidian 定期/强制同步、私有笔记问答、搜索和相似笔记；可自托管 | 独立插件 + 服务端、增量同步、API Key 配对 | 核心是检索/对话，不保证项目产物、主动练习和验证闭环。来源：[官方文档](https://docs.khoj.dev/clients/obsidian/) |
| Copilot for Obsidian | Vault 搜索、Projects、引用、可选本地检索、多模型、Agent；新版本支持 Keychain | 本地先筛选、来源引用、项目上下文、密钥安全、索引可选 | Agent 与写作能力强，但项目能力验证、延迟迁移和学习证据不是主轴。来源：[官方仓库](https://github.com/logancyang/obsidian-copilot) |
| Smart Connections | 本地默认嵌入、相似笔记、事件驱动更新、排除规则、移动端 | local-first、共享索引核心、排除目录、事件增量 | 解决“找到关系”，不解决“学会并应用”。来源：[官方仓库](https://github.com/brianpetro/obsidian-smart-connections) |
| NotebookLM | 用户选定来源、源内回答和行内引用、学习指南、Quiz/Flashcards、后台生成 | 来源作用域显式、引用直达原文、生成任务后台化 | 来源是副本/同步源，缺少用户 Vault 回写治理和真实项目证据闭环。来源：[官方帮助](https://support.google.com/notebooklm/answer/16179559?hl=en) |
| Anki/FSRS | 个体化遗忘建模、目标保持率和工作量权衡 | 事件历史、可调保持率、个体参数、积压策略 | 原子卡片适合记忆，不足以单独评估复杂项目能力。来源：[官方手册](https://docs.ankiweb.net/deck-options.html#fsrs) |
| RemNote | 笔记与复习一体、全局优先队列、考试调度 | 复习优先级、交付日期感知、工作量预算 | 容易产生卡片维护负担；本项目应只为高价值知识生成复习。来源：[官方帮助](https://help.remnote.com/en/articles/9101991-preparing-for-an-exam) |
| Obsidian Spaced Repetition | 在 Vault 内复习闪卡与整篇笔记 | 可作为互操作/导出目标，不必重复造所有 UI | 不能假设用户已安装或把调度状态分散到多个插件。来源：[官方仓库](https://github.com/st3v3nmw/obsidian-spaced-repetition) |
| Obsidian_to_Anki | 用笔记内稳定标记把卡片增量同步到 Anki | 稳定映射、内容变化更新而不是重复创建、删除/重命名需显式规则 | 解决笔记到卡片同步，不负责来源治理、项目证据和教学闭环。来源：[官方 Wiki](https://github.com/ObsidianToAnki/Obsidian_to_Anki/wiki) |
| Open Notebook | 开源 NotebookLM 类产品，把来源、笔记、对话和生成内容建成独立实体 | 来源与派生内容分离、可自托管、对象有稳定边界 | 重点仍是来源分析与生成，不天然证明能力迁移。来源：[官方仓库](https://github.com/lfnovo/open-notebook) |
| OATutor | 开源自适应辅导系统，围绕知识组件、步骤、提示与掌握模型运行 | 分级提示、逐步作答、知识组件与证据事件分离 | 结构化题域较强；开放式真实项目的 rubric 和证据仍需本项目设计。来源：[官方仓库](https://github.com/CAHLR/OATutor) |
| Khanmigo | 官方定位强调导师应引导学习，而不是替学生完成作业 | 先让用户思考、苏格拉底式追问、答案泄漏应作为质量指标 | 通用对话原则不能替代项目交付物和 Vault 数据治理。来源：[官方学习总结](https://blog.khanacademy.org/how-khan-academy-is-building-a-better-ai-tutor-our-most-recent-learnings/) |
| PBLWorks | Gold Standard PBL 强调挑战性问题、持续探究、真实性、学生选择、反思、反馈修订和公开成果 | 把项目任务、反思、迭代和成果质量写成产品门槛 | 它是教学框架，不提供技术同步、AI 安全或个人知识管理实现。来源：[官方 PBL 定义](https://www.pblworks.org/what-is-pbl) |

### 6.2 竞品反向检查得到的遗漏

初始想法容易遗漏以下问题，现已加入流程和架构：

1. 不是所有 Vault 检索都需要向量索引；先用路径、标题、标签、链接和关键词进行本地召回。
2. 必须让用户看到具体使用了哪些来源，并能在回答中跳回原段落。
3. 嵌入模型切换会使旧索引失效，索引必须带模型和分块版本。
4. 自动生成复习内容会制造未来负债，创建前要显示预计每日工作量。
5. 学习截止日期和长期保持不是同一优化目标。
6. 移动端、插件启动时间、重索引控制和排除规则必须从第一版设计。
7. 数据所有权不仅是“可导出”，还包括可删除、可停用同步和可检查远端副本。
8. 仅有引用仍不能证明结论正确；还需区分来源事实、冲突来源和模型推断。
9. 笔记路径不能当长期主键；重命名和内容更新需要稳定 ID、revision、hash 和增量规则。
10. “知识状态、能力状态、记忆状态”必须分别建模；检索到一条笔记不等于会应用，也不等于长期记住。
11. 导师质量要记录提示层级和答案泄漏，不能只看对话满意度。
12. 掌握模型必须能回到知识组件、原始作答、提示和真实证据，不能只有一个不可解释分数。
13. 项目任务必须具备真实性、反馈修订和可检查成果，否则只是披着项目外衣的练习题。

## 7. 安全资料对方案的修正

Vault 笔记、网页和附件都是不可信数据。OWASP 指出，RAG 和微调不能完全消除间接提示注入；缓解措施包括最小权限、外部内容隔离、输出验证和高风险动作人工确认。[OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

因此：

- SourceBundle 中的文本永远标记为 `untrusted_content`，不能与系统指令拼接为同一权限层；
- 模型不能直接获得 Vault 写权限；只能输出结构化 `WritebackDraft`；
- 写回、删除、外部请求和执行代码等动作由确定性代码检查并要求用户确认；
- HTML/Markdown 输出必须净化，引用 URL 和文件路径必须校验；
- 来源中的“忽略规则、上传密钥、调用工具”等文字只可被当作待学习内容；
- 建立专门的间接提示注入测试集。

## 8. 研究后对实现流程的最终修正

| 原始直觉 | 复审后的方案 |
|---|---|
| 全 Vault 建索引后再开始 | P0 明确选取；本地元数据召回；语义索引为可选 P1 |
| 双向同步最完整 | P0 单向来源快照 + 受控回写；通用双向同步暂缓 |
| 把课程 JSON 写在 Vercel 磁盘 | Postgres 保存状态，Private Blob 保存大对象 |
| `after()` 足够运行后台生成 | 持久 Workflow + 数据库状态 + 幂等步骤 |
| 复用 ACCESS_CODE 给插件 | 独立设备配对、作用域令牌、撤销与审计 |
| Quiz 分数代表掌握 | 诊断 + 回忆 + 项目应用 + 延迟迁移的证据组合 |
| 检索到笔记就代表学会 | 知识可用性、能力证据和记忆保持分别建模 |
| 自动回写提高效率 | 默认新建受管草稿；预览、确认、可撤销后才算完成 |
| 越高保持率越好 | 根据项目价值和每日预算权衡保持率与复习负担 |
| 多智能体越多越沉浸 | 只有在改善提问、冲突观点或反馈时启用角色 |

## 9. 尚待实测的问题

- 当前 OpenMAIC 场景中，哪一种最能提高真实项目任务完成率？
- 多智能体讨论对项目学习的增益是否高于额外延迟和成本？
- 段落级引用在笔记改名、移动和重写后需要何种恢复策略？
- 用户能接受的单次选源确认成本和每日复习上限是多少？
- 对个人使用，Private Blob 保存源快照的最佳默认保留期是多少？
- 固定 D1/D7/D30 是否足以证明复习价值，再决定是否引入 FSRS？
- Vercel Workflow 和数据库的真实费用、失败率与冷启动对个人使用是否可接受？

这些问题必须通过 [路线图](./09-DELIVERY-ROADMAP.md) 中的实验回答，不应在没有数据时伪装成确定结论。
