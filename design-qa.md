# 知洄首页学习控制系统 Design QA

## 验收范围

- 磁吸边缘坞：三阶段轨道、知识回流中心、拖动把手与状态提示。
- 记忆与复习侧栏：今日计划、遗忘曲线、薄弱点、复习任务。
- 学习维护状态：与学习任务分层，展示下一步动作，不再使用拥挤的四列状态格。
- 课堂可靠性：当前课堂不被后台下一节预生成阻塞。

## 同图对照证据

- 记忆侧栏参考与实现：`output/playwright/qa-memory-reference-vs-final.png`
- 维护卡片参考与实现：`output/playwright/qa-maintenance-reference-vs-final.png`
- 边缘坞参考与实现：`output/playwright/qa-dock-reference-vs-final.png`
- 1520 × 1024 首页：`output/playwright/home-final-1520.png`
- 1520 × 1024 记忆侧栏：`output/playwright/memory-sidebar-final-1520.png`
- 1024 × 768 记忆侧栏：`output/playwright/memory-sidebar-final-1024.png`
- 阶段切换与轨道高亮：`output/playwright/memory-sidebar-stage-selected-final.png`
- 知识回流中心：`output/playwright/return-center-final-1520.png`

## 视觉检查

- [x] 信息层级清楚：学习任务优先，系统维护降级为独立维护区。
- [x] 记忆侧栏顶部直接回答“今天先学什么、需要多久、为什么”。
- [x] 遗忘曲线明确标注为学习安排估算，不冒充认知测量。
- [x] 薄弱点使用真实学习目标，不显示无意义 ID 或裸 URL。
- [x] 磁吸坞轨道保持圆点、主线和三阶段色彩关系，徽标使用真实品牌资产。
- [x] 状态色仅用于当前阶段、提醒和主操作，没有整块滥用警告色。
- [x] 1520 × 1024 与 1024 × 768 均无横向溢出或主操作裁切。

## 交互与可访问性

- [x] 轨道阶段按钮可点击并有真实页面功能。
- [x] 用户查看阶段与后台流程状态分离；切换圆点会立即移动高亮，同时保留待沉淀提醒。
- [x] 当前阶段再次点击可展开对应状态；切换阶段会关闭冲突浮层。
- [x] 品牌徽标单击打开知识回流中心，双击准备安全写回预览。
- [x] 拖动操作有独立按钮，不与阶段切换冲突。
- [x] 原生按钮、区域标签、`aria-current`、`aria-expanded` 和可见焦点状态完整。
- [x] 键盘聚焦轨道按钮后按 Enter 可打开目标来源面板。
- [x] 浏览器最终检查为 0 console errors。

## 可靠性与测试

- [x] 场景内容与动作请求单次最长 150 秒。
- [x] 自动后台预生成不再执行六次长重试；失败章节进入可重试状态。
- [x] 浏览器取消会传递到服务端 LLM 请求，避免无意义后台消耗。
- [x] 超时边界、网页直连回退、学习队列和场景生成测试通过。
- [x] TypeScript 检查，以及本轮新增/改造组件与服务模块 ESLint 检查通过。

## 结论

未发现待处理的 P0、P1 或 P2 视觉与交互问题。当前实现适合进入正式环境部署前的构建验证。

final result: passed
