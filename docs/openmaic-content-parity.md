# OpenMAIC 内容优势融合方案

> 目标：让 Vaultide 课堂内容达到并吸收 OpenMAIC 的“沉浸式互动课堂”水准，同时完整保留 Vaultide 自己的来源证据、复习、归纳与 Obsidian 回写优势。

## 结论

两者不冲突，而是不同时间轴上的能力：

- **OpenMAIC 强在“课中”**：交互优先、5 类交互组件、AI 教师引导、多智能体讨论/白板、PBL v2、讲台表现力。
- **Vaultide 强在“课前 / 课后”**：来源审查与证据引用、9–12 场景质量门、遗忘曲线复习、周期归纳、三维知识空间、Obsidian 受控回写。

当前问题不是内容设计不足，而是 Vaultide 让“课前证据层”反过来压制了“课中体验”，把交互优先降级成了 slide-first。

## 吸收的 OpenMAIC 长处

1. **交互优先**：以 simulation / diagram / code / game / visualization3d 为主要教学载体，slide 只用于开场、关键解释和结尾综合。
2. **AI 教师引导**：交互场景保留 `scientificModel`（公式、机制、约束、禁止错误），使教师能主动操作 UI、纠错、给提示。
3. **多智能体体验**：课堂讨论、圆桌辩论、问答、共享白板实时演示。
4. **PBL v2**：角色、里程碑、交付物，以及剧本式角色扮演。
5. **讲台表现力**：语音旁白、聚光灯、激光笔、即时测验反馈。

## 保留的 Vaultide 长处

1. **来源证据闭环**：`[S#]` / `[V#]` 引用、冻结来源、权威优先级。
2. **课前审查与质量门**：9–12 场景、完整学习弧、可审计。
3. **课后复习**：遗忘曲线、薄弱点、到期复习、主动回忆证据。
4. **归纳与知识空间**：周期归纳快照、时间/主题/来源筛选、三维关系图。
5. **Obsidian 双向**：受控回写、双重确认、项目文件夹学习。

## 融合原则

- 证据引用是**标注**，不是**场景类型约束**：slide 的证据放在 keyPoints / 旁白，交互场景的证据放在描述与教师引导里，不能因为要引用证据就把交互改成 slide。
- 交互优先，但**不为凑数发明交互**：只有真正能动手理解的场景才用 widget。
- 完整闭环不变：课堂结束后的复习、归纳、知识空间、Obsidian 回写仍由 Vaultide 负责。

## 本次改动范围

1. `lib/prompts/templates/interactive-outlines/user.md`：把“45–60% slide / 交互≤40% / diagram 最多 1 个”改为“交互优先、slide 只用于开场/关键解释/结尾综合”。
2. `lib/generation/outline-generator.ts`：移除 `normalizeQualityFirstOutlines` 里把交互强制转 slide 的 40% 上限与 45% slide 下限，只保留开场/结尾 slide 和主动回忆 quiz 注入。
3. `tests/generation/outline-quality-balance.test.ts`：更新断言，验证交互优先不被后处理压平。
