# 知洄 Vaultide 三维知识图谱 v2 实现计划

> 状态：`learning-first navigation deployed / G1-G7 complete / G8 production performance gate pending`  
> 编制日期：2026-07-23  
> 最近实施：2026-07-24  
> 上游计划：[完整知识沉淀实现计划](./15-COMPLETE-KNOWLEDGE-DEPOSITION-IMPLEMENTATION-PLAN.md)

## 0. 实施记录

2026-07-24 已完成并验证首个可发布切片：

- graph v2 合同、稳定身份、证据引用、投影版本和确定性内容哈希；
- `0019_knowledge_graph_v2.sql`：概念、别名、关系、证据、投影节点/边及用户反馈；
- owner 隔离的投影创建、缓存、读取、LOD、邻域、最短解释路径、反馈、重建和差异 API；
- “无证据 = 未知”，掌握度与掌握置信度分离；
- 原笔记只读、伴随笔记可写，并以 `companion-of` 显式关联；没有真实伴随绑定时不伪造节点；
- v2 筛选、搜索、证据详情、可访问列表和 Canvas fallback；
- 动态加载的 Three.js/R3F WebGL 渲染器：实例化节点、合并关系线、射线选中、按需帧渲染，并可手动切回 Canvas；
- v1 Canvas 改为按需重绘，静止时不再持续高频绘制；
- 一跳/两跳邻域聚焦、最短解释路径、课堂/外部来源/Obsidian 原文件直达入口；
- 原文件路径独立从 `learning_source_versions.locator.relativePath` 投影，不再依赖伴随笔记是否已经创建；
- 学习事件、来源版本、回写回执和归纳快照统一进入持久化增量刷新队列；队列按触发证据去重、用租约防止并发重复消费，失败有限重试；
- Web 与 Obsidian 设备事件都会局部重算对应 sprint 的 mastery；只选择命中课堂或项目范围的最新归纳，不重建全部历史事实；
- 手动归纳和周期归纳保存成功后自动生成 graph v2 投影，已有投影仍按 input hash 保存为不可变历史版本；
- 新增每日 Vercel Cron：先运行到期归纳计划，再清空待处理图谱刷新；接口使用独立 `CRON_SECRET` 精确鉴权；
- `0020_knowledge_graph_refresh_queue.sql` 已应用到真实 Neon；真实 smoke 请求一次成功，仅命中 1 个归纳并生成/复用 1 个投影；
- 32 个集成测试文件共 116 项全部通过，定向 ESLint、TypeScript 和生产构建通过；
- 新增客户端 Worker 关系布局：首屏先以 O(n) 语义坐标显示，再由 Worker 完成关系松弛，避免 2,000 节点在主线程做完整布局；
- 大图自动 LOD：750 节点起限制可视细节，2,000 节点进入更紧凑层级；无障碍列表改为分批展开，不再永久隐藏第 301 个及之后的节点；
- WebGL/Canvas 选择保存在当前浏览器；新增管理员健康状态接口，仅返回刷新队列计数、功能开关和时间戳；
- 2,000 节点、4,000 边布局夹具在本机 60ms 内完成且结果稳定；Preview 云端构建已通过。
- 三维图从默认入口降为可选的“关系探索”；默认进入“学习导航”，先依据到期复习、薄弱掌握、未知掌握、来源更新和先修关系生成可解释的学习清单；
- 每条学习建议明确回答“为什么现在学”，并提供查看学习依据、进入课堂和聚焦相关知识的快捷动作；三维图承担关系解释，不再承担主要任务选择；
- 学习导航排序与汇总由纯领域函数生成并有独立集成测试；当前共 35 个集成测试文件、121 项通过。
- 真实数据投影已创建并验证缓存复用。当前 Vault 尚无服务器登记的 `learning_companions`，因此真实投影只显示只读原笔记；首次批准并由插件回执成功写入伴随笔记后，下一次投影会显示唯一可写伴随节点。
- 后台真实浏览器验证通过：README 原笔记能精确定位到 Vault 路径，邻域聚焦从 112 节点收敛为 2 节点，路径解释能连接原笔记与课堂。
- 学习优先的信息层级已完成：页面更名为“知识归纳与学习导航”，归纳范围和周期计划默认折叠，真实首屏直接显示“下一步学什么”及可执行建议。
- 学习模式不再显示 WebGL/Canvas、关系阈值、候选关系和完整节点列表；这些工具只在用户主动进入“关系探索（按需）”后出现。
- “查看学习依据”会定位到来源、掌握证据、只读/可写笔记身份与 Obsidian 去向；“探索相关知识”只加载该建议的一跳关系，不再把完整三维图当作默认学习界面。
- 后台浏览器使用真实归纳数据完成“下一步学习 → 查看依据 → 聚焦关系探索 → 返回学习模式”闭环，控制台 0 errors；三维依赖仅有既有的 `THREE.Clock` 弃用 warning。
- 35 个集成测试文件 121/121 通过；整仓并行测试的 8 个超时文件经单 worker、30 秒门限隔离复跑 90/90 通过；TypeScript、定向 ESLint和本地/云端生产构建通过。
- Production 部署 `dpl_4RPDVsJnpFVR8fAWsvEBwRWBp9Ah` 状态 `Ready`，并已别名到 `https://openmaic-eight-eosin.vercel.app`。

尚未完成的部分：

- 真实目标 Windows 设备上的 500/2,000 节点 FPS、内存和选中延迟门禁；
- G8 的长期监控、灰度数据和最终生产性能验收。

## 1. 目标

三维图的目标不是制造炫酷动画，而是让用户快速回答五个学习问题：

1. 我学过哪些知识，它们来自哪里？
2. 不同项目、论文、文章和 Obsidian 笔记之间有什么关系？
3. 哪些内容真正有学习证据，哪些只是看过？
4. 哪些概念是前置知识、冲突点或可以迁移到其他项目？
5. 我的知识结构在一段时间内发生了什么变化？

产品入口采用“先行动、后探索”的顺序：

1. 默认学习导航先回答“我现在最应该学什么、为什么”；
2. 用户查看节点证据并进入课堂、原笔记或伴随笔记；
3. 只有在需要理解跨主题关系、先修链路或证据连接时，才进入三维关系探索。

默认坐标语义继续保持：

- X：时间；
- Y：知识板块；
- Z：掌握度估算。

但 v2 会把“掌握度”和“证据置信度”分离，并增加可切换的语义聚类视图和项目视图。

## 2. 当前实现审计

当前 `knowledge-graph/1` 已经具备：

- 确定性的时间、板块和掌握度坐标；
- 项目、课堂、概念、外部来源和 Obsidian 来源节点；
- 所属、包含、顺序、引用、来源和标题相似关系；
- 鼠标拖动、滚轮缩放、点击选中和键盘入口；
- Canvas 2D 上的手写三维旋转与透视投影；
- 无 WebGL 时也可工作的低依赖实现；
- Markdown 和 Mermaid 二维兼容归纳。

当前限制：

| 限制 | 直接影响 |
|---|---|
| 每个课堂只取前 12 个场景 | 后续概念不可见 |
| 每类来源只取前 4 个 | 大项目和论文来源关系不完整 |
| 最多 30 个课堂 | 长期使用后历史被截断 |
| 关联边使用标题词元 Jaccard | 同义概念难以连接，表面相似可能误连 |
| 跨课堂相关边最多 120 条 | 规模增长后信息丢失 |
| 概念比较为 O(n²) | 规模扩大时生成成本快速上升 |
| 没有关系证据面板 | 用户无法判断一条边为什么存在 |
| 没有概念稳定身份和别名 | 同一概念会重复出现 |
| 没有 `supports/contradicts/prerequisite` | 只能表达“相关”，不能表达知识结构 |
| 无图谱投影版本和重建任务 | 算法升级后难以比较和回退 |
| 每帧持续 `requestAnimationFrame` | 静止时仍消耗资源 |
| 无深度缓冲和实例化 | 节点规模增长后视觉与性能到达上限 |
| 节点只打开外部 URL | 不能直接回到课堂、伴随笔记或项目 |

## 3. 不可破坏原则

1. 图谱是可重算投影，不是来源事实。
2. 大模型不能无证据地发明节点和关系。
3. 每条非确定性关系必须保存置信度、生成器版本和证据引用。
4. “没有证据”必须显示未知，不能伪装成低掌握度。
5. 图谱升级不能改写原有笔记。
6. 原有笔记和可变更伴随笔记必须显示为不同对象。
7. 三维界面不可成为唯一入口；必须保留可访问的二维列表、搜索和详情。
8. WebGL、低性能设备或减少动态效果设置下必须有降级路径。

## 4. 产品视图

### 4.1 学习地图

默认视图：

- X = 学习时间；
- Y = 知识板块；
- Z = 掌握度；
- 节点透明度 = 证据置信度；
- 节点大小 = 有效证据量；
- 节点外圈 = 是否到期复习；
- 项目使用空间边界或柔和包围层显示。

适合查看知识演进和薄弱区域。

### 4.2 语义关系图

- 使用稳定、可复现的语义聚类布局；
- 相近概念聚合；
- 关系类型决定边的样式；
- 可以展开/折叠项目、来源和课堂；
- 可以仅显示强关系或有直接证据的关系。

适合跨项目归纳和发现联系。

### 4.3 项目图

- 以项目为中心；
- 第一层为来源和伴随笔记；
- 第二层为概念、技能和课堂；
- 第三层为学习证据、成果和待复习项；
- 显示项目版本变化后需要重新验证的概念。

### 4.4 时间对比

- 对比两个图谱投影；
- 新增节点使用进入动画；
- 消失节点不直接删除，标记为本范围不可见或来源过期；
- 关系新增、增强、减弱、失效分别展示；
- 可以回到对应归纳快照。

## 5. 图谱合同 v2

```ts
type KnowledgeNodeType =
  | 'project'
  | 'original-note'
  | 'companion-note'
  | 'external-source'
  | 'classroom'
  | 'concept'
  | 'claim'
  | 'skill'
  | 'artifact'
  | 'review';

type KnowledgeEdgeType =
  | 'belongs-to'
  | 'contains'
  | 'cites'
  | 'derived-from'
  | 'companion-of'
  | 'precedes'
  | 'prerequisite'
  | 'supports'
  | 'contradicts'
  | 'applies-to'
  | 'related-to'
  | 'review-of';

interface KnowledgeNodeV2 {
  id: string;
  canonicalId: string;
  label: string;
  type: KnowledgeNodeType;
  domainIds: string[];
  projectIds: string[];
  sourceVersionIds: string[];
  classroomIds: string[];
  timestamp?: string;
  mastery: number | null;
  masteryConfidence: number;
  evidenceCount: number;
  coordinates: { x: number; y: number; z: number };
  layoutCoordinates?: { x: number; y: number; z: number };
  originalPath?: string;
  companionId?: string;
  externalUrl?: string;
  confidence: number;
  projectorVersion: string;
}

interface KnowledgeEdgeV2 {
  id: string;
  source: string;
  target: string;
  type: KnowledgeEdgeType;
  directed: boolean;
  weight: number;
  confidence: number;
  evidenceRefs: string[];
  origin: 'deterministic' | 'lexical' | 'embedding' | 'llm' | 'manual';
  generatorVersion: string;
}

interface KnowledgeGraphV2 {
  schemaVersion: 'knowledge-graph/2';
  projectionId: string;
  scopeHash: string;
  generatedAt: string;
  projectorVersion: string;
  layoutVersion: string;
  nodes: KnowledgeNodeV2[];
  edges: KnowledgeEdgeV2[];
  clusters: KnowledgeCluster[];
  statistics: KnowledgeGraphStatistics;
}
```

## 6. 原笔记与伴随笔记的图谱表达

双笔记模型在图中必须明确：

```text
[原有笔记：只读]
      │ companion-of
      ▼
[学习伴随笔记：可变更]
      │ contains
      ├─ 当前理解
      ├─ 学习进度
      ├─ 待复习概念
      └─ 归纳引用
```

显示规则：

- 原有笔记节点使用固定“只读来源”视觉标识；
- 伴随笔记节点使用“受管可更新”标识；
- 同一 Vault 内一份原有笔记最多出现一条有效 `companion-of` 关系；
- 点击 `companion-of` 边可以查看绑定身份、原路径和最后同步版本；
- 原笔记变更但伴随笔记未刷新时，边显示“来源已更新”状态；
- 图谱绝不把伴随笔记误标为原始证据。
- 单笔记的多次课堂作为伴随笔记的学习历史和证据呈现，不为每次课堂制造新的笔记副本节点。

## 7. 概念抽取与稳定身份

### 7.1 候选来源

概念候选按以下优先级产生：

1. 用户明确标签、标题和项目术语；
2. 课堂场景和测验中的显式概念；
3. 来源标题层级、术语和定义；
4. 学习伴随笔记中的受管概念区块；
5. 受约束大模型抽取；
6. embedding 或词元相似候选。

### 7.2 抽取合同

模型只能返回候选：

```json
{
  "label": "主动回忆",
  "aliases": ["检索练习"],
  "definition": "……",
  "sourceRefs": ["V3", "S1"],
  "confidence": 0.86
}
```

服务端必须验证：

- `sourceRefs` 真实存在；
- 引用对应文本包含足以支持候选的证据；
- 标签和别名长度受限；
- 不允许模型创建路径、URL 或 owner/project 身份；
- 低置信度候选不进入稳定概念表。

### 7.3 规范化

规范化分为：

1. 精确规范化：大小写、空白、全半角和标点；
2. 用户别名和已有别名；
3. 共同来源与共同定义；
4. 语义相似候选；
5. 人工合并或拆分反馈。

自动合并必须保守。无法确定时保留两个节点并建立低强度 `related-to` 候选，不强行合并。

概念 ID 必须稳定，不能依赖每次布局坐标。

## 8. 关系推断与证据

### 8.1 确定性关系

以下关系置信度为 1：

- 项目包含来源；
- 原笔记对应伴随笔记；
- 课堂来自某个冻结来源版本；
- 课堂包含场景；
- 课堂引用外部来源；
- 复习项目指向概念；
- 明确的时间先后。

### 8.2 语义关系

候选关系分数由版本化策略组合：

- 共同引用；
- 同一项目/课堂中的结构位置；
- 词元相似；
- 可选 embedding 相似；
- 受约束模型返回的明确关系；
- 用户反馈。

建议首版阈值：

- `confidence >= 0.75`：默认显示；
- `0.55–0.75`：仅在“显示候选关系”时展示；
- `< 0.55`：不进入图谱投影；
- `contradicts` 和 `prerequisite` 必须有直接引用或用户确认，不能仅靠 embedding。

每条关系详情至少显示：

- 为什么连接；
- 使用了哪些来源；
- 推断方式；
- 置信度；
- 生成器版本；
- 用户是否确认或否定。

## 9. 掌握度坐标 v2

Z 轴不再把“没有证据”映射为固定 15%。

建议规则：

- `mastery = null`：没有主动证据，显示在“未知层”；
- 测验、主动回忆、解释、迁移和延迟复习形成成功/失败证据；
- 采用带先验的加权证据聚合；
- 相同题目和紧邻重复尝试降低独立性权重；
- 时间衰减影响“需要复习”，不直接抹去历史能力；
- 单独输出 `masteryConfidence`。

初始投影公式可以使用版本化 Beta 证据模型：

```text
alpha = priorSuccess + Σ(success × weight × independence)
beta  = priorFailure + Σ((1-success) × weight × independence)
mastery = alpha / (alpha + beta)
confidence = 1 - exp(-Σweight / 3)
```

具体权重必须通过真实学习数据校准，不能作为永久常量写死在产品文案中。

## 10. 布局策略

### 10.1 坐标视图

时间/板块/掌握度坐标由服务器确定性生成：

- 相同 scope、事实输入和 projector version 得到相同坐标；
- 领域使用稳定 domain ID，不按本次结果重新排序；
- 时间轴支持绝对时间和相对周期；
- 未知掌握度进入独立平面，不与低掌握度混淆；
- 同坐标节点使用稳定微偏移，避免完全重叠。

### 10.2 语义聚类视图

- 图布局在 Web Worker 中计算；
- 使用由 projection ID 派生的固定随机种子；
- 第一次计算后保存布局版本和坐标；
- 页面重开不重新抖动；
- 新节点只在局部布局范围内加入；
- 用户可以重置为服务器确定性布局。

### 10.3 层次和 LOD

| 节点规模 | 默认行为 |
|---:|---|
| 1–300 | 显示全部节点和主要边 |
| 301–1,000 | 实例化节点，标签按选中/悬停显示 |
| 1,001–3,000 | 默认按项目和领域聚类，可逐层展开 |
| 3,001–10,000 | 服务端/Worker 生成 LOD，按邻域加载 |
| >10,000 | 不一次传输全图，使用 scope、聚类和分页邻域 |

## 11. 渲染技术方案

### 11.1 选型

主渲染器：

- Three.js；
- `@react-three/fiber` 作为 React 19 兼容渲染层；
- WebGL2 优先；
- 当前 Canvas 投影作为兼容回退；
- 二维列表和关系表作为无障碍入口。

不直接把通用 force-graph 组件作为核心渲染器，因为本产品必须保持 X/Y/Z 轴语义、稳定坐标、双笔记身份和关系证据面板。通用组件可以作为技术探针对照，但不能拥有领域模型。

### 11.2 关键实现

- 节点按类型使用 `InstancedMesh`，减少 draw calls；
- 边按类型合并为 `LineSegments` 或缓冲几何；
- 使用 raycasting 完成节点拾取；
- 静止时使用按需渲染，不保持永久 60 FPS；
- 相机交互时临时进入连续帧；
- 动态 DPR，默认上限 1.5 或按性能自适应；
- 3D 模块通过 Next.js 动态加载，不进入知识页首屏包；
- WebGL context lost 时显示恢复按钮并切换到 Canvas；
- 语义布局和大规模预处理放入 Worker；
- `prefers-reduced-motion` 下禁用自动旋转和大幅过渡。

### 11.3 不在首版使用

- WebGPU 作为唯一渲染后端；
- 复杂后处理、泛光和粒子特效；
- VR/AR；
- 在浏览器端加载完整 embedding 模型；
- 无限制的物理模拟。

## 12. 交互设计

必须实现：

- 旋转、平移、缩放、重置和适配范围；
- 搜索节点；
- 按项目、时间、板块、类型、来源和掌握状态筛选；
- 一跳/两跳邻域；
- A 到 B 的最短解释路径；
- 隐藏弱关系；
- 时间范围滑块；
- 节点详情抽屉；
- 关系详情抽屉；
- 打开课堂、外部来源和对应伴随笔记；
- 原笔记与伴随笔记一键切换；
- 标记错误关系、确认关系、合并别名；
- 导出当前视图 PNG 和带来源的 Markdown 列表。

节点详情展示：

- 节点类型；
- 所属项目和来源；
- 当前掌握度、置信度和证据数；
- 最近学习和下次复习；
- 为什么位于当前坐标；
- 相关课堂；
- 原有笔记或伴随笔记入口；
- 关系数量和最强关系。

## 13. 视觉编码

| 视觉属性 | 语义 |
|---|---|
| 节点形状 | 节点类型 |
| 节点主色 | 知识板块或类型，最终只选一个主维度 |
| 节点大小 | 有效证据量，设置上下限 |
| 节点透明度 | 置信度 |
| 外圈 | 待复习、冲突或来源已更新 |
| 边颜色 | 关系类型 |
| 边粗细 | 关系权重 |
| 边虚实 | 确定性或推断性 |
| 聚类包围层 | 项目或领域 |

颜色不能作为唯一信息渠道；形状、线型、标签和详情必须提供等价信息。

## 14. 数据库与投影存储

已实施迁移 `0019_knowledge_graph_v2.sql`：

- `knowledge_concepts`
- `knowledge_concept_aliases`
- `knowledge_relations`
- `knowledge_evidence_refs`
- `knowledge_graph_projections`
- `knowledge_graph_projection_nodes`
- `knowledge_graph_projection_edges`
- `knowledge_relation_feedback`

原则：

- 概念和人工反馈是长期对象；
- 坐标和 LOD 是投影对象；
- 所有非确定性边都必须有 evidence ref；
- owner 复合外键不可省略；
- 图谱 JSON 可以作为传输快照，但不能成为唯一可查询存储；
- 大投影可把压缩快照放入 Private Blob，Postgres 保存索引、hash 和统计；
- 不引入独立图数据库，除非真实规模和查询证据证明 Postgres 不够。

## 15. API

- `POST /api/v1/knowledge-graphs/projections`
- `GET /api/v1/knowledge-graphs/projections/:projectionId`
- `GET /api/v1/knowledge-graphs/projections/:projectionId/chunks`
- `GET /api/v1/knowledge-graphs/nodes/:nodeId`
- `GET /api/v1/knowledge-graphs/nodes/:nodeId/neighborhood`
- `GET /api/v1/knowledge-graphs/path?from=&to=`
- `POST /api/v1/knowledge-graphs/rebuild`
- `POST /api/v1/knowledge-graphs/feedback`
- `GET /api/v1/knowledge-graphs/diff?from=&to=`

图谱返回必须支持：

- `lod`；
- `nodeTypes`；
- `edgeTypes`；
- `projectIds`；
- 时间范围；
- 最低置信度；
- 是否包含候选关系。

## 16. 代码边界

建议新增：

```text
lib/learning/domain/knowledge-graph-v2/
├─ contracts.ts
├─ concept-normalization.ts
├─ relation-inference.ts
├─ mastery-projector.ts
├─ coordinate-projector.ts
├─ graph-diff.ts
└─ validation.ts

lib/learning/application/
├─ knowledge-graph-projection-service.ts
└─ knowledge-graph-feedback-service.ts

components/learning/knowledge-graph-v2/
├─ knowledge-graph-shell.tsx
├─ knowledge-graph-webgl.tsx
├─ knowledge-graph-canvas-fallback.tsx
├─ graph-controls.tsx
├─ graph-filters.tsx
├─ node-details.tsx
├─ edge-details.tsx
└─ graph-accessible-list.tsx

workers/
└─ knowledge-graph-layout.worker.ts
```

现有 `knowledge-graph.ts` 和 `knowledge-graph-3d.tsx` 在迁移期保留为 v1 和 fallback，不原地重写成难以回退的单文件。

## 17. 分阶段实施

### G0：基线和性能测量

- 保存当前 50、118、500、2,000 节点夹具；
- 测量生成时间、页面加载、交互延迟、FPS 和内存；
- 加入当前图谱截图与可访问性基线；
- 固定 graph v1 行为。

出口：可以量化 v2 是否真正改善。

### G1：合同、证据和投影版本

- 新增 graph v2 TypeScript 合同；
- 新增投影、概念、关系和证据表；
- 实现 graph v1 → v2 只读适配器；
- 实现 hash、scope 和 projector version。

出口：相同输入可生成稳定、可验证的 v2 JSON。

### G2：掌握度 v2

- 接入主动学习事件；
- 区分未知、掌握度和置信度；
- 保存解释性证据；
- 修复 Z 轴语义。

出口：没有证据的节点不再显示伪精确 15%。

### G3：概念规范化和关系证据

- 概念候选；
- 稳定 ID 和别名；
- 确定性关系；
- 受约束语义关系；
- 用户反馈；
- 关系证据详情。

出口：每条推断关系都能回答“为什么”。

### G4：布局和 LOD

- 稳定坐标投影；
- Worker 语义布局；
- 聚类和 LOD；
- 邻域和路径算法；
- 投影缓存与重建。

出口：2,000 节点仍可交互，页面重开布局不漂移。

### G5：WebGL 渲染器

- 动态加载 Three.js/R3F；
- 实例化节点；
- 批量边；
- 相机、拾取、选中；
- 按需帧和自适应 DPR；
- WebGL context 恢复；
- Canvas fallback。

出口：达到性能预算且不影响知识页首屏。

### G6：学习型交互

- 搜索和过滤；
- 一跳/两跳；
- 解释路径；
- 节点/边详情；
- 打开课堂、原笔记、伴随笔记和来源；
- 时间差异视图；
- 错误关系反馈。

出口：用户可以通过图谱完成一次真实复习或跨项目归纳，而不只是观看。

### G7：增量更新和周期归纳

状态：已实现并通过真实 Neon 验证。

- 新学习事件触发局部 mastery 重算；
- 新来源版本触发受影响概念重建；
- 周期归纳生成图谱投影；
- 显示变化；
- 保留历史投影。

实现约束：

- 四类触发均先保存业务事实，再以 best-effort 方式请求同步刷新；图谱短暂失败不会回滚学习事件、来源、回写回执或归纳结果；
- 队列以 `owner + trigger + scope` 的稳定哈希去重，领取使用五分钟租约和 `FOR UPDATE SKIP LOCKED`；
- 每个请求最多尝试五次，失败按指数退避；每日维护任务继续处理未完成请求；
- 课堂/项目变化只选择每个计划或同一手动 scope 的最新归纳，单次最多 20 个，不扫描重建全部历史投影；
- 显式新归纳只刷新自己的 projection；历史 `knowledge_graph_projections` 不覆盖、不删除；
- Hobby 部署使用每天一次的维护 Cron；若要让小于一天的自定义周期准点执行，需要升级 Vercel 计划或接入更高频的外部调度器。

出口：新增一次课堂后不需要全量重建所有历史事实。

### G8：生产门禁

- 性能、可访问性、隐私、越权和恢复测试；
- 预览部署；
- v1/v2 双读；
- 用户开关；
- 正式部署和监控。

## 18. 性能预算

目标设备：普通 Windows 桌面浏览器，集成显卡也应可用。

| 指标 | 目标 |
|---|---:|
| 知识页首屏 | 不加载 Three.js 主包 |
| 3D 动态模块 | 独立 chunk，并经 bundle analyzer 设门禁 |
| 500 节点首次可交互 | p95 ≤ 2.5 秒 |
| 500 节点拖动帧率 | p95 ≥ 45 FPS |
| 2,000 节点拖动帧率 | p95 ≥ 30 FPS，启用 LOD |
| 选中响应 | p95 ≤ 80 ms |
| 搜索/过滤 | p95 ≤ 150 ms |
| 静止状态 | 不持续高频重绘 |
| 内存 | 500 节点目标 ≤ 200 MB |

若无法满足预算，优先减少标签、边和后处理，不降低来源可追溯性。

## 19. 测试

### 19.1 图谱正确性

- 相同输入、版本和 scope 得到相同 hash；
- 双笔记关系正确；
- owner/project 不越界；
- 原有笔记不被标记为可写；
- 每条推断边有证据；
- 删除或过期来源后关系按规则失效；
- graph v1 历史仍可查看。

### 19.2 算法

- 中文、英文和混合术语；
- 同义词合并；
- 同名异义不误合并；
- 矛盾关系必须有双侧证据；
- 大量概念不会触发无界 O(n²)；
- LOD 聚类可还原到原节点。

### 19.3 渲染

- WebGL2、WebGL1/兼容、context lost；
- 100%、150%、200% 缩放；
- 明暗主题；
- 触摸板、鼠标和键盘；
- `prefers-reduced-motion`；
- 窗口大小变化；
- 长中文标签；
- 500、2,000 和 10,000 节点夹具。

### 19.4 无障碍

- 所有节点可通过搜索和列表访问；
- 键盘可选中节点和关系；
- 屏幕阅读器能读取节点类型、掌握度和关系数量；
- 不依赖颜色表达唯一状态；
- Canvas/WebGL 不可用时仍能完成筛选、查看来源和打开课堂。

## 20. 发布策略

功能开关：

- `KNOWLEDGE_GRAPH_V2_ENABLED`
- `KNOWLEDGE_GRAPH_SEMANTIC_EDGES_ENABLED`
- `KNOWLEDGE_GRAPH_WEBGL_ENABLED`

顺序：

1. 先启用 v2 数据投影，仍使用旧 Canvas 显示；
2. 核对节点和关系正确性；
3. 启用 WebGL 渲染器；
4. 启用语义候选边但默认隐藏；
5. 通过真实反馈校准后默认显示高置信关系；
6. 最后启用增量图谱和周期对比。

回退：

- WebGL 失败自动使用 Canvas；
- v2 投影失败读取最近成功的 v2；
- 无成功 v2 时使用 v1；
- 语义边可独立关闭，不影响确定性关系；
- 所有原始事件、来源和伴随笔记不受图谱回退影响。

## 21. 验收场景

### 场景 1：内部项目

对“项目3-微信小程序”完成两轮不同目标的学习：

- 项目、原有笔记、伴随笔记、课堂和概念关系正确；
- 原笔记与伴随笔记视觉和语义明确；
- 第二轮学习更新掌握证据；
- 项目版本变化后显示需要重新验证的概念。

### 场景 2：外部 GitHub 项目

- 仓库、README/docs、课堂和概念可追溯；
- commit/release 版本变化可识别；
- 与内部项目的相同概念可以建立有证据的跨项目关系。

### 场景 3：论文和科研

- 论文元数据、关键主张和引用作为不同节点；
- 支持和矛盾关系有来源证据；
- 不把模型总结误标为论文原始主张。

### 场景 4：时间归纳

- 对比两个周期；
- 显示新增、强化、待复习和关系变化；
- 点击节点能回到课堂、来源或伴随笔记；
- 归纳 Markdown 与三维图使用同一 projection ID。

## 22. 完成定义

三维图谱 v2 只有满足以下条件才算完成：

- 图中的每个节点都有稳定身份和来源；
- 每条非确定性边都有证据、置信度和生成器版本；
- 原笔记与可变更伴随笔记清晰分离；
- 无证据不显示伪掌握度；
- 用户能搜索、筛选、查看路径和打开对应学习对象；
- 500 和 2,000 节点达到性能门禁；
- WebGL 失败时可完整降级；
- 图谱可以重建、比较和回退；
- 至少一个真实项目、一个外部仓库、一篇论文和一份内部文章通过端到端验收；
- 图谱帮助用户完成归纳、复习或迁移，而不是只提供视觉展示。

## 23. 官方技术依据

- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)：大量同几何节点使用实例化减少 draw calls。
- [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html)：用于三维节点拾取。
- [MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)：可将重计算或渲染与主线程解耦；本计划优先把布局计算放入 Worker。
- [Next.js Lazy Loading](https://nextjs.org/docs/app/guides/lazy-loading)：三维客户端模块动态加载，避免进入知识页首屏包。
- [React Three Fiber](https://www.npmjs.com/package/@react-three/fiber)：为 Three.js 提供 React 渲染层；实施前固定版本并验证与仓库 React 19.2 的兼容性。
