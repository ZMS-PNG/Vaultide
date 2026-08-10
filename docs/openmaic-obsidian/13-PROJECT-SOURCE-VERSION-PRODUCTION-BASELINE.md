# 项目、知识源与版本生产基线

> 后续状态：v0.6 已在本模型之上增加项目自动分批、分块索引与按学习目标检索；
> 见[项目自动同步与目标检索生产基线](./14-PROJECT-GOAL-RETRIEVAL-PRODUCTION-BASELINE.md)。

> 状态：`Production deployed / desktop reload pending`  
> 版本：知洄 Vaultide Web 与 Obsidian Connector `0.5.0`  
> 发布日期：2026-07-22  
> 正式入口：`https://openmaic-eight-eosin.vercel.app`

## 1. 本次解决的问题

0.4 以前，“项目文件夹”只存在于 Obsidian 插件本地。服务器只能看到一次次互不
关联的 SourceBundle，无法可靠回答：

- 两次上传是否属于同一项目；
- 一份笔记是否是同一知识源的新版本；
- 一个课堂、学习记录和归纳结果属于哪个项目；
- 本次未选择的文件是暂不上传，还是已经从项目中删除。

0.5 建立了统一的项目—知识源—版本主链，同时保持旧单笔记、旧 SourceBundle、
旧 SourceArchive 和旧回写命令可读取。

## 2. 兼容边界

- `LEARNING_PROTOCOL_VERSION` 保持 `2026-07-draft-1`。
- `SourceBundle/1`、`SourceArchive/1`、`WritebackCommand/1` 结构不变。
- `canonicalSourceManifest()` 不变，旧 Bundle 的 manifest hash 不变。
- 新增严格合同 `project-binding/1` 和 `source-upload-intent/1`。
- 0.4 的五字段上传 payload 继续被精确接受。
- 继续复用 `sources:write`，现有设备无需重新配对。

## 3. 新的持久模型

```text
LearningProject
  ├─ ProjectSource ── LearningSource
  │                    └─ LearningSourceVersion
  ├─ SourceBundleItem ─ Snapshot
  ├─ LearningSprint ── Classroom / LearningEvent
  └─ SynthesisRun ──── KnowledgeGraph / WritebackDraft
```

关键身份：

- 项目：`prj_<32 hex>`；
- 稳定知识源：`sou_<32 hex>`；
- 不可变来源快照：现有 `snp_<32 hex>`；
- 不可变来源集合：现有 `src_<32 hex>`。

Snapshot 表示“这一次看到的内容”；Source 表示“跨上传版本的同一逻辑资料”，两者
不再混用。

## 4. 项目上传状态机

```text
能力发现
→ 幂等注册项目文件夹
→ 构建 SourceArchive + 项目上传 sidecar
→ Vercel Private Blob 直传
→ 服务端重新校验 Archive、hash、owner/device/vault
→ 同一事务登记 Source / Version / ProjectSource / BundleItem
→ 项目 revision + 1
→ 上传状态变为 validated
→ 插件轮询确认后才更新本地 projectBindings
```

当前插件发送 `coverage=partial`。这意味着用户取消勾选某份笔记时，服务端不会把
已有知识源误判为删除；只有未来明确的 complete 同步才允许产生移除标记。

## 5. 学习、回写与归纳

- 新课堂可通过 SourceBundle 反查真实项目与学习时项目 revision。
- 项目学习记录进入
  `Vaultide/学习记录/<项目名--项目ID后8位>/`。
- `maic_project_id` 写入真实项目 ID；旧无项目课堂不再伪造项目 ID。
- 知识归纳支持 `projectIds` 范围筛选。
- 三维图谱新增 `project` 节点和 `belongs-to` 关系，原有
  X=时间、Y=知识板块、Z=掌握度保持不变。
- 仅包含一个项目的归纳进入
  `Vaultide/归纳/<项目名--项目ID后8位>/`。
- 原始 Obsidian 笔记仍只读，回写仍只有双确认后的 `createManagedNote`。

## 6. 数据库与部署

生产数据库已追加：

| 迁移 | 内容 |
|---|---|
| `0008_learning_projects_sources.sql` | 项目、稳定来源、来源版本、项目来源关联、Bundle item 与项目感知上传字段 |
| `0009_learning_project_propagation.sql` | sprint、research run、synthesis run 的项目关联与索引 |

两份迁移与旧迁移在同一 advisory-lock 事务中执行；0001–0007 按原 SHA-256 跳过，
0008–0009 成功应用。

Vercel 正式部署：

- 不可变地址：
  `https://openmaic-lsei9gsd2-zhaomaosen780-7874s-projects.vercel.app`
- 主域名：
  `https://openmaic-eight-eosin.vercel.app`
- 远端 Next.js/TypeScript 构建成功并完成主域名 alias。

## 7. 验证证据

| 门禁 | 结果 |
|---|---|
| 协议合同 | 3 files，24/24 tests 通过 |
| Obsidian 插件 | 8 files，25/25 tests 通过 |
| Web 学习集成 | 18 files，60/60 tests 通过 |
| 根 TypeScript | `tsc --noEmit` 通过 |
| 本地生产构建 | 46/46 页面生成，全部项目/API 路由存在 |
| Vercel 生产构建 | 成功，主域名 alias 完成 |
| 本地插件安装 | 三份运行产物与构建源 SHA-256 一致；`data.json` 哈希保持不变 |

本地插件已覆盖为 0.5.0，备份位于：

`D:\J-obsidian\.obsidian\plugin-backups\openmaic-learning\20260723-012232`

## 8. 当前限制与下一版本

0.5 解决的是长期身份和版本基础，不等于已经完成无限规模项目 RAG：

- 单次仍最多 50 份 Markdown、8 MB 正文和 10 MB Archive；
- 课堂生成入口仍把文本限制在 200,000 字符；
- 图片、PDF 与其他附件尚未加入项目文件夹同步；
- GitHub 仓库、论文、网页和会议目前已有来源类型与研究引用链，但还没有全部复用
  同一个“外部项目注册/增量版本”入口；
- 项目文件夹移动/重命名后的显式重新绑定 UI 尚未实现；
- 多项目混合归纳不会强行归入某一个项目目录。

下一阶段应先实现分块索引与按学习目标检索，再接入 GitHub/arXiv/网页等外部采集器；
它们必须复用本次的 Project、Source、Version 与引用模型，不能另建第二套知识库。

## 9. 首次桌面验收

1. 在 Obsidian 中重新加载应用或重启一次，使 0.5.0 `main.js` 生效。
2. 对一个不敏感的小项目文件夹执行
   `Preview a project folder as a SourceBundle`。
3. 上传后确认浏览器打开学习来源页；生成课堂并完成一次练习。
4. 批准学习记录，回到 Obsidian 执行
   `Check and apply Vaultide writebacks`。
5. 确认笔记进入项目专属子目录，frontmatter 的 `maic_project_id` 以 `prj_` 开头。
6. 在知识归纳页按该项目筛选，确认图谱出现项目节点及所属关系。
