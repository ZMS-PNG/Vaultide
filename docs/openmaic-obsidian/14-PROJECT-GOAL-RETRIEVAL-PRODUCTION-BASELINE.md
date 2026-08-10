# 项目自动同步与目标检索生产基线

> 状态：`Production deployed / local Obsidian reload required`  
> 版本：知洄 Vaultide Web 与 Obsidian Connector `0.6.2`  
> 发布日期：2026-07-23  
> 正式入口：`https://openmaic-eight-eosin.vercel.app`

## 1. 本次升级的产品结果

v0.6.2 把“上传一个项目文件夹”升级为“从大型 Markdown 项目中按当前学习目标选出
可审阅、可冻结、可追溯的证据，再进入课堂”。

完整主链为：

```text
Obsidian 本地扫描
→ 用户一次检查和授权
→ 自动分批上传并逐批建立索引
→ 网页显示三层覆盖率
→ 用户填写具体学习目标
→ 系统检索并物化相关原文片段
→ 用户审阅、纳入或排除来源
→ 冻结本次证据集
→ OpenMAIC 课堂保留 [V#] 引用
→ 学习记录携带项目版本与检索运行回写 Obsidian
```

这条链路服务于“学习项目中的知识”，不是代码仓库研究工具，也不会把整个 Vault
静默同步成通用 AI 知识库。

## 2. 一次授权与自动分批

连接器先在 Obsidian 本地完成扫描和筛选。未经授权的相对路径只用于本地界面展示，
不会发送到服务器。

默认规则：

| 约束 | 当前值 |
|---|---:|
| 支持内容 | Markdown |
| 单份 Markdown | 2 MB |
| 单项目一次授权 | 500 份、50 MB |
| 自动分批目标 | 约 4 MB |
| 每批协议硬上限 | 50 份、8 MB 正文、10 MB Archive |

`Vaultide/` 受管目录、隐藏目录、模板目录、常见依赖目录（如 `node_modules/`）和超限 Markdown 自动排除；PDF、图片及
其他附件只计入“不支持”，不会伪装成已覆盖。

用户只确认一次。连接器随后：

1. 为项目与逻辑来源生成并持久化稳定 ID；
2. 按确定性顺序规划批次；
3. 逐批注册项目 revision、上传私有 SourceArchive；
4. 等待服务端完成 Archive 校验和分块索引；
5. 只有状态为 `ready` 才把该批写入本地完成清单；
6. 中途失败时保留已完成批次，再次执行只同步剩余或变化内容。

如果压缩后的 Archive 意外超过 10 MB，批次会继续拆分，而不是把超限请求交给
Vercel Function。

## 3. 三层覆盖率

界面不再只显示一个容易误解的“覆盖率”：

| 层级 | 回答的问题 | 事实来源 |
|---|---|---|
| 本地授权覆盖 | 本地扫描到多少、授权多少、排除或不支持多少 | Obsidian 本地扫描 |
| 服务端索引覆盖 | 当前项目有多少活动来源真正可检索，多少 pending/failed | Postgres 索引状态 |
| 当前目标检索覆盖 | 这个目标命中多少来源、最终选了多少、容量省略多少 | 冻结检索运行 |

`partial` 表示“这次只授权了项目的一部分”，不是“系统已经读完整个项目”。
尚未上传的文件名不会为了计算网页覆盖率而外发。

## 4. 分块索引与隐私边界

每个已验证 Markdown 快照使用 `markdown-lexical-v1` 确定性分块：

- 目标约 4,500 个 UTF-16 字符；
- 单块约 2,200–6,000 字符；
- 保留标题路径、起止偏移、内容 SHA-256 和稳定 ordinal；
- 代码围栏中的 `#` 不被误认作 Markdown 标题；
- 为英文、代码标识符和中文生成可检索词。

原始 SourceArchive 保存在 Vercel Private Blob。数据库保存来源身份、版本、定位、
哈希、标题路径和有限搜索表示，不保存完整片段正文；检索命中后再从私有 Archive
按精确偏移读取原文，并重新计算哈希。任何偏移或内容不一致的候选都会被丢弃。

来源过期或删除时，同时清空派生搜索词并把索引标为 `purged`，避免只删 Blob 却
留下可检索派生数据。

## 5. 按目标检索与人工复核

检索策略为版本化的 `lexical-diverse-v1`。用户必须填写具体学习目标；“学习一下”
等泛化目标会被拒绝。

当前预算：

| 项目 | 当前值 |
|---|---:|
| 默认课堂上下文 | 44,000 字符 |
| 可配置范围 | 20,000–48,000 字符 |
| 最多片段 | 16 |
| 同一来源最多片段 | 4 |
| 候选检索上限 | 180 |
| 可人工控制的来源 | 必须包含/排除各合计最多 12 |

结果为每个片段显示：

- `[V1]` 等冻结引用编号；
- 来源路径、标题路径、版本与内容哈希；
- 命中词、相关片段预览、被选择的原因；
- 未入选但可人工加入的相邻候选。

质量门禁：

- 没有真实目标命中且没有用户指定来源时返回冲突，不用项目概览伪造成功；
- `weak` 匹配以警示状态显示，必须人工确认；
- 修改必须包含/排除来源后必须重新检索；
- 必须包含来源若未索引、原文不可用或放不进预算，拒绝进入课堂；
- 检索结果与当前项目 revision 不一致时不复用旧缓存。

## 6. 冻结引用、课堂与回写

每次检索创建不可变 `project_retrieval_run`，记录：

- 项目 ID 与学习时 revision；
- 目标和目标哈希；
- 检索策略、预算和质量指标；
- 选中 chunk、来源版本、Bundle、Snapshot；
- 精确定位快照、引用哈希和选中字符数。

冻结结果进入课堂后，来源面板展示项目版本、检索运行、覆盖状态和 `[V#]` 来源。
学习总结回写增加：

- `maic_project_revision`
- `maic_retrieval_run_id`
- `maic_coverage_state`
- `maic_selected_source_count`

正文同时列出冻结来源版本。原始 Obsidian 笔记仍只读；系统仍只生成受管学习记录，
且必须经过网页批准与 Obsidian 插件再次确认。

## 7. 数据库演进

迁移 `0010_project_chunk_retrieval.sql` 新增：

- `learning_source_indexes`
- `learning_source_chunks` 与 PostgreSQL GIN 全文索引
- SourceUpload 的索引状态字段
- `project_retrieval_runs`
- `project_retrieval_items`
- LearningSprint 到 retrieval run 的可选关联

所有读取和外键都包含 `owner_id` 边界；冻结引用不能跨用户指向其他 chunk。
迁移仍由 advisory lock、单事务和迁移文件 SHA-256 校验保护。

## 8. 验证门禁

发布候选已通过：

| 门禁 | 结果 |
|---|---|
| Learning Protocol | 3 files，24/24 tests |
| Obsidian Connector | 8 files，31/31 tests |
| Web 学习集成 | 23 files，75/75 tests |
| 根 TypeScript | `tsc --noEmit` 通过 |
| 定向 React ESLint | 新项目来源页、课堂来源面板与课堂页通过 |
| 本地生产构建 | 46/46 页面生成，Next.js 与 TypeScript 通过 |
| 生产数据库 | 0001–0009 哈希一致并跳过，0010 单事务应用成功 |
| Vercel 生产构建 | 46/46 页面生成，部署成功并完成主域名 alias |
| 本地插件 | 0.6.2 三份运行产物与构建源 SHA-256 一致，`data.json` 哈希不变 |

专项测试覆盖 120/200 文件自动分批、超限与不支持内容、索引 ready/failed、确定性
chunk 与哈希、篡改候选拒绝、零匹配拒绝、弱匹配、必须包含/排除来源和 owner 级外键。

Vercel 不可变地址：

`https://openmaic-eeusxiwr5-zhaomaosen780-7874s-projects.vercel.app`

正式主域名：

`https://openmaic-eight-eosin.vercel.app`

本地插件备份：

`D:\J-obsidian\.obsidian\plugin-backups\openmaic-learning\20260723-083547`

## 9. 四类真实场景验收（2026-07-23）

本轮验收把“知识对象”分为外部项目、内部项目、外部文章和内部文章；所有 Vault
原文均只在本地扫描和打包校验，未将任何测试笔记批准回写。

| 场景 | 测试对象 | 验收结果 | 证据 |
|---|---|---|---|
| 外部项目 | `https://github.com/openai/codex` | 通过 | 权威检索、大纲、角色、页面、动作和课堂创建均成功；课堂 ID `2HAwaWYvmp`，2 个场景 |
| 内部项目 | `Architecture-Analysis-Vault/项目3-微信小程序` | 通过受控本地校验 | 排除 `node_modules/` 与 `bower_components/` 后为 17 份 Markdown、365,451 bytes、1 个可验证批次；SourceBundle 与 SourceArchive 均通过 |
| 外部文章 | arXiv:2607.06341 | 通过 | 正式线上课堂已创建，课堂 ID `50FbrrbIpW`；Obsidian 回写预览生成成功但未批准写入 |
| 内部文章 | `Architecture-Analysis-Vault/Grok/Grok-Build-功能指南.md` | 通过受控本地校验 | 1 份 Markdown、15,531 bytes；SourceBundle 与 SourceArchive 均通过 |

生产链路还修复了两个会阻断真实使用的问题：访问码登录后再加载服务器模型配置，避免
模型选择被一次 401 永久禁用；把 `github.com` 和 `raw.githubusercontent.com` 标为首要来源，
并对直接 GitHub 仓库链接生成官方 README、docs 与发布信息导向的查询。

内部对象的最后一步需要用户在已经配对的 Obsidian 中重新加载插件后手动执行一次命令。
这是为了不在后台重新配对并吊销用户现有设备凭据；上传、索引、目标检索和回写的代码链路
已由构建、单元测试和本地真实打包校验覆盖。

## 10. 明确未完成

v0.6.2 是个人 Markdown 项目检索生产基线，不应被描述为“所有知识对象都已统一导入”：

- PDF、图片、音视频、白板和附件尚未进入项目索引；
- 当前是可解释的 lexical retrieval，不是向量或混合语义检索；
- GitHub、arXiv、论文网页、科研数据库和会议材料可通过受控外部检索学习，但尚缺专用采集器与增量同步 UI；
- 没有后台全 Vault 监听，也没有自动推断删除/重命名；
- 尚未建立跨多种真实项目的离线检索质量基准集。

下一阶段应复用同一 Project → Source → Version → Chunk → RetrievalRun → Citation
主链增加外部采集器，再用真实个人项目建立检索评测集；不能为 GitHub、论文和网页
各自复制一套不可互通的“知识库”。
