# OpenMAIC × Obsidian 实施记录

> 状态：`Historical M2 record / production baseline superseded`  
> 记录日期：2026-07-21  
> 上游基线：OpenMAIC v0.3.0，commit `84b1907255208ad39fd04beac7c9087d202d146c`

> 本文保留 M2 发布过程和当时的验证证据。持久课堂、LearningEvent、受控回写、外部研究加固和 3D 知识归纳均已在后续批次上线；当前事实基线请以[学习、研究与知识归纳生产基线](./12-PRODUCTION-LEARNING-RESEARCH-SYNTHESIS-BASELINE.md)为准。

## 1. 本批目标

本批把 M0–M1 基线推进到可部署的 M2 纵向切片：个人用户可以在 OpenMAIC 生成一次性配对码，在 Obsidian 中只选择当前活动笔记，审查私有上传范围，上传不可变快照，并把该快照送入 OpenMAIC 现有的交互式课程生成流程。

本批不实现 LearningEvent、掌握度投影和 Vault 写回；这些能力仍保持关闭，避免把“能上传并学习”误报为完整双向学习闭环。

## 2. 已完成

### 2.1 协议与数据模型

- `@openmaic/learning-protocol` 提供版本协商、`SourceBundle`、`SourceArchive`、`LearningEvent`、`WritebackCommand`、运行时校验和 4 份 JSON Schema。
- 新增 Neon Postgres 迁移：owner、pairing session、device、access/refresh token、限流状态与 source upload 元数据。
- 新增带 advisory lock 和迁移内容 SHA-256 校验的迁移运行器。
- 服务层通过 repository/blob 端口隔离 Neon 与 Vercel Blob，避免领域逻辑绑定供应商 SDK。

### 2.2 一次性配对与设备凭证

- 新增 `/learning-pairing` 管理页，生成十分钟、一次性六位配对码。
- 新增 pairing session 创建/兑换、access token、refresh rotation 和 revoke API。
- access token 有效期 15 分钟，refresh token 有效期 30 天；新会话会撤销同一 owner 的旧活动会话。
- 数据库只保存 HMAC/哈希摘要，不保存配对码或 token 明文。
- 兑换同时执行 deployment、network 和 device 三层持久限流；创建新配对码时清理过期限流记录。
- 管理 API 在 route handler 内再次验证站点访问 cookie，不只依赖 middleware。

### 2.3 私有来源上传

- Obsidian 插件只读取用户当前明确打开并触发命令的 Markdown 笔记，不扫描 Vault。
- 上传前展示相对路径、字节数、内容哈希和 manifest hash，并要求用户再次确认。
- 使用 Vercel Private Blob 客户端直传，签发五分钟、限定 pathname 的上传令牌。
- 服务端回调重新读取私有 Blob，并校验 MIME、大小、owner/device/vault/bundle 身份、pathname、Schema、manifest hash 与每份正文 hash。
- 校验失败的新 Blob 会被拒绝并删除；设备只能删除自己 Vault 绑定下的 bundle。
- source archive 限制为 10 MB，正文总量 8 MB，最多 50 项，保留期 1–90 天。
- 每日 Vercel Cron 调用保留期清理接口，接口使用独立 `CRON_SECRET` 鉴权。

### 2.4 学习启动与外部知识

- 新增 `/learning-source/[bundleId]`，只为已通过站点访问认证的 owner 读取并再次校验私有快照。
- 用户先核对来源，再填写学习目标；默认只依据私有快照。
- “同时检索最新外部资料”是显式 opt-in，复用 OpenMAIC 已有 Web Search 配置，不默认混入网络材料。
- 复用现有 `generation-preview` 和交互式课程流程，不建设第二套教学引擎。
- 三套 outline system prompt 都加入来源隔离规则：上传材料、PDF 和网页均视为不可信数据，材料中的提示式文本不得覆盖系统指令或用户学习目标。

### 2.5 Obsidian 真实侧载

- 插件凭证只写入 Obsidian SecretStorage；`data.json` 只保存非秘密设置和本地随机身份。
- access token 到期前自动使用单次 refresh token 轮换；断开连接先尝试服务端 revoke，再清理本地凭证。
- 服务地址强制 HTTPS，仅 localhost 开发环境允许 HTTP，并拒绝 URL 内嵌用户名/密码。
- 最新 `main.js`、`manifest.json`、`styles.css` 已侧载至 `D:\J-obsidian\.obsidian\plugins\openmaic-learning`；三份文件与构建产物 SHA-256 完全一致。
- 未修改 `community-plugins.json`，因此仍需用户在 Obsidian 设置中手动启用插件。

## 3. 验证证据

| 验证 | 结果 |
|---|---|
| Next.js 生产构建 | 通过；编译、TypeScript、45 个静态页面与所有学习路由成功 |
| Learning Protocol | 2 个文件、15/15 tests 通过；含 JSON 传输前后 manifest 稳定性回归；4 份 Schema 生成成功 |
| Obsidian 插件 | 3 个文件、8/8 tests 通过；TypeScript 与 esbuild 生产构建成功 |
| 学习集成、安全边界与 prompt isolation | 10 个文件、33/33 tests 通过 |
| 定向 ESLint | 新增/修改学习源码 0 errors |
| 整仓 Vitest（4 workers） | 320 files passed、3 skipped；2939 tests passed、4 skipped；5 个上游文件有 7 个超时 |
| 超时隔离复跑 | 其中 3 个文件 84/84 通过；一个 5s 用例放宽 CLI 时限后在 5.01s 通过；一个硬编码 50ms 的锁时序用例仍失败 |
| Vault 产物 | 3/3 文件存在且 SHA-256 与本地构建产物一致 |

整仓测试不能标记为全绿。剩余失败文件与相关运行时代码均未被本批修改，表现为机器负载下的既有时序门槛；本批不通过修改上游测试时限来制造绿色结果。学习集成专项、生产构建和插件专项均已通过。

## 4. Vercel 当前状态

- 项目已链接到 `zhaomaosen780-7874s-projects/openmaic`。
- Neon Marketplace 资源 `neon-camel-basket` 已连接；`0001_identity_pairing.sql` 与 `0002_source_uploads.sql` 已应用，重复运行迁移时均按相同 SHA 跳过。
- 私有 Blob `openmaic-learning-private` 已创建在用户确认的 `hkg1` 地域；生产 QA 清理后为 0 个对象、0B。
- `LEARNING_OWNER_ID`、`LEARNING_OWNER_DISPLAY_NAME`、`PAIRING_HMAC_SECRET`、`CRON_SECRET`、`ACCESS_CODE`、Neon 与 Blob 变量均已写入 Development、Preview、Production。秘密值未写入文档或命令输出；本地副本只存在于被 Git 忽略的 `.env.local`。
- Preview 已部署并通过访问码、capabilities、一次性配对、refresh rotation、私有上传/读取/完整性往返、删除、revoke 与重放拒绝测试。
- Production 部署 `dpl_61VupZ9i5cGA4U3eWJrkozsvB37m` 状态为 `Ready`，不可变地址为 `https://openmaic-eku1ipm2g-zhaomaosen780-7874s-projects.vercel.app`，正式入口为 `https://openmaic-eight-eosin.vercel.app`。
- 正式入口再次通过相同端到端测试；Cron 未授权请求返回 401，正确 bearer 返回 200，结果为 `deleted=0, failed=0`。
- 首次真实 Obsidian 上传暴露了客户端令牌路由缺少 CORS 响应头：生产日志只有 `OPTIONS 204`，没有后续 `POST`。接口现仅允许 `app://obsidian.md`，放行所需方法与请求头；不可信网页来源返回 403。修复后的预检、POST 响应、专项测试、生产构建与在线 E2E 均通过。
- CORS 修复后的真实上传进一步暴露 manifest 规范化差异：插件内存对象包含值为 `undefined` 的可选字段，而 JSON 传输会删除这些字段，导致服务端重算 hash 时拒绝并删除 Blob。共享协议现按 JSON 语义忽略对象中的 `undefined` 属性，并使用与 locale 无关的键排序；协议与插件都加入 JSON round-trip 回归测试。
- 最新 Production 使用包含同一组 `undefined` 可选字段的故障形态完成了配对、私有上传、服务端验 hash、读取、删除与 revoke E2E。最新元数据为 `deleted`、`failure_code=null`、`archive_byte_size=1108`；清理后 Blob 为 0 个对象。
- 用户已在 Production 以 Sensitive 环境变量配置 DeepSeek，模型白名单与默认模型均固定为 `deepseek-v4-pro`；新部署构建与 alias 切换通过，真实课程生成仍待用户在已登录页面触发验收。
- UI 验证期间，浏览器 CLI 曾在调试输出中回显访问码输入参数。该值在接触任何真实 Vault 数据前已轮换并重新部署；最终访问码没有打印，登录态 UI 不再使用该工具自动化。
- 最终正式部署没有 error 级运行时日志，也没有 HTTP 500 记录；最终合成 QA 结束后 Blob 再次为 0 个对象、0B。

## 5. 剩余桌面验收与下一阶段门禁

基础设施与在线 API 门禁已经通过。剩余步骤涉及真实 Vault 内容与桌面应用控制，必须由用户显式触发：

1. 在 Obsidian 中重新加载 `OpenMAIC Learning Bridge`，使已侧载的新 `main.js` 生效；现有 SecretStorage 配对凭据保持不变。
2. 打开一份确认不含敏感信息的 Markdown 笔记，再次执行预览命令，核对路径、大小、hash 与保留期后批准上传。
3. 在 `/learning-source/[bundleId]` 再次核对来源、填写学习目标，并用已配置的模型提供方启动一次真实课程。
4. 检查 Vercel 运行日志、Blob 对象与 Obsidian 本地设置，确认没有正文、token、配对码或 secret 泄漏。
5. 第一条真实学习价值链稳定后，才进入 LearningEvent、可解释掌握度、WritebackDraft/diff/receipt 与人工确认写回。

## 6. 发布约束

Git `origin` 仍指向 THU-MAIC 上游仓库。没有用户自己的 fork 和明确推送授权前，不提交、不推送、不创建上游分支。正式部署可以从本地 Vercel 链接项目发布，但代码长期保存仍应先建立用户自有 Git 仓库。
