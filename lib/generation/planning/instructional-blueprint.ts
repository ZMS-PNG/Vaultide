import { createHash } from 'node:crypto'

import type { LearningContract } from '@/lib/learning/domain/v3/learning-contract'
import type { FrozenEvidenceEntry, FrozenEvidenceSet } from '@/lib/learning/domain/v3/frozen-evidence'
import type {
  InstructionalActivityContract,
  InstructionalActivityKind,
  SceneOutline,
} from '@/lib/types/generation'
import {
  V3_COURSE_MAX_ACTIVITIES,
  V3_COURSE_MIN_ACTIVITIES,
} from '@/lib/generation/outline-release-contract'

export interface InstructionalPlanActivity extends InstructionalActivityContract {
  title: string
  description: string
  keyPoints: string[]
  estimatedMinutes: number
}

export interface CourseInstructionalPlan {
  schemaVersion: 3
  planId: string
  contractId: string
  sourceSetId: string
  targetMinutes: number
  activities: InstructionalPlanActivity[]
}

export interface InstructionalPlanAssessment {
  passed: boolean
  violations: string[]
  metrics: {
    activityCount: number
    evidenceCount: number
    evidenceCoverage: number
    estimatedMinutes: number
  }
}

const ACTIVITY_LABEL: Record<InstructionalActivityKind, string> = {
  orientation: 'Learning map',
  diagnostic: 'Starting-point check',
  foundation: 'Core model',
  mechanism: 'Mechanism and flow',
  evidence: 'Evidence and trade-off',
  'worked-example': 'Worked example',
  practice: 'Guided decision practice',
  retrieval: 'Retrieval and diagnosis',
  limits: 'Boundary and failure modes',
  'synthesis-transfer': 'Synthesis and transfer',
}

const ACTION_TEXT: Record<InstructionalActivityKind, string> = {
  orientation: 'State the learning goal and identify the source-backed questions that matter.',
  diagnostic: 'Answer a short diagnostic question and name the uncertainty to resolve.',
  foundation: 'Explain the core model in your own words using the cited source detail.',
  mechanism: 'Trace the mechanism or workflow and justify each consequential transition.',
  evidence: 'Compare evidence, constraints, or alternatives and make a justified choice.',
  'worked-example': 'Walk through the concrete source-grounded example and predict the next step.',
  practice: 'Make a decision for a changed condition and explain the evidence used.',
  retrieval: 'Retrieve the key mechanism without prompts and diagnose one likely misconception.',
  limits: 'Identify a boundary, failure mode, or open question and propose a safe response.',
  'synthesis-transfer': 'Create the required artifact for a new project, decision, or problem and cite the evidence that supports it.',
}

const ZH_ACTIVITY_LABEL: Record<InstructionalActivityKind, string> = {
  orientation: '学习路线与成功标准',
  diagnostic: '先导诊断：你已经知道什么',
  foundation: '核心概念与系统全貌',
  mechanism: '关键机制与工作链路',
  evidence: '证据、取舍与决策依据',
  'worked-example': '来源案例：一步一步走通',
  practice: '情境练习：做出可解释的选择',
  retrieval: '主动回忆与薄弱点校验',
  limits: '边界、风险与失败模式',
  'synthesis-transfer': '迁移交付：形成可验证成果',
}

const ZH_ACTION_TEXT: Record<InstructionalActivityKind, string> = {
  orientation: '明确本次学习目标，并识别必须由来源证据回答的关键问题。',
  diagnostic: '完成一个短诊断，写下当前不确定、需要在课堂中验证的判断。',
  foundation: '用自己的话解释核心模型，并把它和对应来源细节连接起来。',
  mechanism: '沿着机制或工作流追踪关键状态变化，并说明每次转折为何重要。',
  evidence: '比较证据、约束或替代方案，并给出有依据的选择。',
  'worked-example': '走读一个来源中的具体案例，并预测下一步会发生什么。',
  practice: '在变化条件下做出决策，并说明你使用了哪些证据。',
  retrieval: '不看提示复述关键机制，并诊断一个容易出现的误解。',
  limits: '识别一个边界、失败模式或未决问题，并提出安全的应对方式。',
  'synthesis-transfer': '为一个新项目、决策或问题产出可验证的成果，并标注支撑它的来源证据。',
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value))
}

function cleanExcerpt(value: string, limit = 220): string {
  return value
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit)
}

function stripDiscoveryPreamble(value: string): string {
  // Frozen external evidence retains a source title and discovery authority
  // before the original document. It belongs in the audit trail, not in a
  // learner-facing source fact or scene title.
  return value.replace(
    /^\s*\[[^\]]+\]\([^)]*\)\s*;\s*(?:quality|authority|source[_ -]?quality)\s*=\s*(?:primary|official|authoritative|trusted)\s*:\s*/gmu,
    '',
  )
}

function prepareEvidenceDocument(value: string): string {
  return stripDiscoveryPreamble(value)
    // MDX/YAML frontmatter and its JSON-LD payload describe the web page; they
    // are not the source's instructional claim. Remove the leading block before
    // fact extraction so a JSON `text` field cannot become a classroom fact.
    .replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/u, '')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    // Keep executable commands as evidence, but retain their line boundaries.
    // Collapsing a fenced block turned a comment plus several commands into one
    // apparent source claim, which made the evidence allocator select a brittle
    // fragment instead of the surrounding explanatory prose.
    .replace(/```[^\n]*\n([\s\S]*?)```/gmu, (_match, body: string) => `\n${body}\n`)
    .replace(/([^\n])\n(?:[ \t]*\n)*[ \t]*(?=(?:gh|git|npm|pnpm|curl|node|python)\b)/gmu, '$1 ')
}

function learnerFacingText(value: string, limit = 180): string {
  // Evidence anchors are deliberately lossless enough for audit, which often
  // means they contain Markdown links or raw URLs. They belong in the source
  // trace, not in a classroom heading. Keep the claim, remove presentation
  // syntax, and retain a compact fallback so every scene title reads naturally.
  const plain = cleanExcerpt(stripDiscoveryPreamble(value), limit * 3)
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/https?:\/\/\S+/gu, '')
    // Discovery metadata is useful in the source ledger, but not in an
    // instructional heading. Keep the actual source finding after the marker.
    .replace(/\b(?:quality|authority|source[_ -]?quality)\s*=\s*(?:primary|official|authoritative|trusted)\s*:\s*/giu, '')
    .replace(/[|`*_]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const fallback = plain || 'Source-backed decision'
  if (fallback.length <= limit) return fallback

  // Never leave a learner-facing sentence cut through a word.  A clipped
  // source fact such as "the markdown contains natural language task descr"
  // looks fabricated even when it came from a primary source, and it weakens
  // both trust and recall.  Prefer the last complete sentence when there is
  // one; otherwise retain the last whole word within the display budget.
  const clipped = fallback.slice(0, limit)
  const sentenceEnd = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('! '),
    clipped.lastIndexOf('? '),
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('！'),
    clipped.lastIndexOf('？'),
  )
  if (sentenceEnd >= Math.max(56, Math.floor(limit * 0.5))) {
    return clipped.slice(0, sentenceEnd + 1).trim()
  }
  const wordEnd = clipped.lastIndexOf(' ')
  return clipped.slice(0, wordEnd >= 24 ? wordEnd : clipped.length).trim()
}

function learnerFacingTitle(value: string, limit = 74): string {
  return learnerFacingText(value, limit)
}

const SOURCE_NAVIGATION_NOISE = /\b(?:quality|authority|source[_ -]?quality)\s*=|https?:\/\/|\barXiv:\d+\b|\b(?:skip to|back to|report issue|submit|donate|log in|search|title:|authors?:|copyright|license|learn more|content selection|abstract\.?$|contents?|quick start|overview|documentation|faq|contributing|community contributions?|share feedback|related projects?|workshop|hey agent|hello fellow agent|get you started)\b|<\/?(?:details|summary|!--)/iu
const SOURCE_SUBSTANCE_CUE = /\b(?:agent|benchmark|model|harness|component|system|environment|signal|evaluate|evaluation|workflow|architecture|design|decision|constraint|failure|evidence|require|provide|support|compare|transform|manage|iterate|validate|verify|deploy|security|data|api|repository|issue|pull request)\b|[\u3400-\u9fff]/iu
const MARKDOWN_STRUCTURE_ONLY = /^(?:#{1,6}\s*)?(?:contents?|quick start|overview|guardrails|documentation|faq|contributing|community contributions?|share feedback|related projects?|workshop)\s*$/iu
const MARKDOWN_HEADING_ONLY = /^\s*#{1,6}\s+\S[\s\S]{0,140}\s*$/u
// Rendered repository documents often contain diagrams, MDX configuration and
// navigation fragments next to useful prose. They may explain the page to the
// site renderer, but they cannot carry a learner-facing factual claim.
const SOURCE_NONTEACHING_NOISE = /^(?:flowchart|graph|subgraph|classDef|style|linkStyle|[A-Z][A-Z0-9_]*\[|load when\s*:|use when\s*:|title\s*:|description\s*:|sidebar\s*:|order\s*:|head\s*:|import\s+|export\s+|this prompt guides you, a coding agent)/iu
// A source may use a friendly invitation before explaining anything. Such a
// phrase is useful copy for documentation, but not evidence for a learning
// decision and must never become the supporting fact for a classroom scene.
const SOURCE_GENERIC_INTRODUCTION = /^(?:ready to\b|welcome\b|here(?:\s+(?:is|are))?\b|let'?s\b|this (?:guide|document|page|prompt)\b|in this guide\b|if you are new\b)/iu
// Code comments and callouts often sit beside useful commands in official
// documentation. They are operational context, not a standalone learner fact:
// selecting one produces fragments such as "default — wizard will ask ...".
const SOURCE_CODE_OR_ASIDE_FRAGMENT = /^(?:#|>\s*(?:note|tip|important)\b|(?:default|pre-select)\s*[—-]|passing\s+--|if\s+you\s+omit\b)/iu
const SOURCE_WEAK_CAUTION = /^(?:use (?:it|this) with caution|at your own risk|please note that|important notice)\b/iu

/**
 * Search results blend primary prose with document titles and page chrome.
 * Keep the source label separately for audit, while selecting one factual,
 * readable sentence for the learner-facing teaching material.
 */
function focusTerms(value: string): string[] {
  const ignored = new Set([
    'and',
    'agentic',
    'actions',
    'are',
    'can',
    'changes',
    'decision',
    'explain',
    'for',
    'from',
    'github',
    'how',
    'identify',
    'implementation',
    'into',
    'learning',
    'project',
    'repository',
    'source',
    'the',
    'this',
    'with',
    'workflow',
    'gh-aw',
  ])
  return [...new Set(
    (value.toLocaleLowerCase().match(/[\p{Script=Han}]{2,}|[a-z][a-z0-9_-]{2,}/giu) ?? [])
      .map((term) => term.toLocaleLowerCase())
      .filter((term) => !ignored.has(term)),
  )].slice(0, 18)
}

function bridgedSourceFocus(value: string): string {
  const bridges: Array<{ pattern: RegExp; terms: string }> = [
    { pattern: /\btrigger(?:s|ing)?\b|\bevents?\b|\bschedul(?:e|ed|ing)\b/iu, terms: 'trigger triggers triggering event schedule frontmatter workflow' },
    { pattern: /\bgetting started\b|\bfirst (?:workflow|run)\b/iu, terms: 'quick start install extension add wizard prerequisites engine secret' },
    { pattern: /\bruntime\b|\bengine\b|\bprovider\b/iu, terms: 'runtime engine copilot claude codex gemini secret permission' },
    { pattern: /\bpermissions?\b|\bsafe[ -]?outputs?\b|\bread[ -]?only\b/iu, terms: 'permission permissions safeoutputs safe output read-only write approval' },
    { pattern: /\bsecurity\b|\bsafety\b|\bsandbox(?:ed)?\b|\btrusted\b|\bmcp\b/iu, terms: 'security sandbox safeoutputs firewall proxy mcp gateway trusted isolation' },
    { pattern: /\bverif(?:y|ication|ied)\b|\block[ -]?file\b|\brun logs?\b/iu, terms: 'verify verification compile lock file output run logs validation' },
    { pattern: /\bcreat(?:e|ing)\b|\bcustomi[sz](?:e|ing)\b|\bcompile\b|\bworked example\b/iu, terms: 'create creating customize compile workflow lock file instructions add wizard' },
    { pattern: /\bfail(?:ure|ed)?\b|\brecover(?:y)?\b|\brisk\b|\bpitfall\b|\berror\b/iu, terms: 'failure recovery risk error warning limitation rollback upgrade' },
    { pattern: /安装|初始化|配置|接入/iu, terms: 'install init setup configure extension' },
    { pattern: /传统|确定性|连续AI|工作流对比/iu, terms: 'traditional fixed if then continuous ai workflow agent' },
    { pattern: /结构|frontmatter|触发|工具/iu, terms: 'frontmatter markdown trigger permissions tools instruction' },
    { pattern: /权限|密钥|安全|沙盒|围栏/iu, terms: 'permissions secret security sandbox guardrails read-only' },
    { pattern: /验证|验收|测试|检查|交付|复核/iu, terms: 'verify verification validation output acceptance recovery' },
    { pattern: /事件|触发|调度|状态|报告|示例|实战/iu, terms: 'trigger event schedule daily status issue pull request ci' },
    { pattern: /版本|计费|升级|局限|风险/iu, terms: 'release version billing upgrade caution limitation risk' },
    { pattern: /自定义|编写|编译|创建/iu, terms: 'create customize compile workflow lock file instructions' },
    { pattern: /边界|风险|陷阱|故障|失败|恢复/iu, terms: 'limitation guardrails failure recovery read-only' },
    { pattern: /架构|机制|运行|代理|模型/iu, terms: 'architecture mechanism runtime agent model' },
  ]
  // Put explicit semantic bridges first. focusTerms has a bounded vocabulary;
  // appending bridge terms after a verbose model description meant concrete
  // cues such as "frontmatter" or "recovery" were often discarded before
  // source routing happened.
  return [
    ...bridges.filter(({ pattern }) => pattern.test(value)).map(({ terms }) => terms),
    value,
  ].join(' ')
}

function sourceSpecializationBonus(
  sourceText: string,
  focus: string,
  kind: InstructionalActivityKind,
): number {
  const source = sourceText.toLocaleLowerCase()
  const requested = focus.toLocaleLowerCase()
  const matchingTerms = (terms: readonly string[]) => terms.filter((term) => source.includes(term)).length
  const focusedOn = (pattern: RegExp) => pattern.test(requested)

  // These are content signatures, not source IDs. They give a semantic scene
  // preference to a document that actually explains the requested operation
  // (for example, a security architecture page over a README that merely says
  // "safe outputs"). They remain neutral for other kinds of material.
  if (focusedOn(/security|sandbox|safeoutputs|firewall|mcp|trusted|isolation/iu)) {
    const hits = matchingTerms(['defense-in-depth', 'security architecture', 'firewall', 'mcp gateway', 'privileged container', 'substrate-level', 'prompt injection'])
    if (hits > 0) return 620 + hits * 95
  }
  if (focusedOn(/frontmatter|markdown|trigger|permission|tools?/iu)) {
    const hits = matchingTerms(['frontmatter', 'triggers', 'permissions', 'tools', 'natural language task', 'markdown contains'])
    if (hits > 0) return 560 + hits * 90
  }
  if (focusedOn(/install|quick.?start|add.?wizard|prerequisite|engine|secret/iu)) {
    const hits = matchingTerms(['quick start', 'install the', 'add-wizard', 'prerequisites', 'choose an engine', 'required secret'])
    if (hits > 0) return 540 + hits * 85
  }
  if (focusedOn(/verify|verification|compile|lock.?file|logs?|run/iu)) {
    const hits = matchingTerms(['compile', 'lock file', 'verification', 'gh aw run', 'gh aw logs', 'validation'])
    if (hits > 0) return 500 + hits * 80
  }
  if (focusedOn(/failure|recovery|risk|error|billing|upgrade|monitor/iu)) {
    const hits = matchingTerms(['failure', 'recovery', 'rollback', 'billing', 'upgrade', 'error', 'logs'])
    if (hits > 0) return 500 + hits * 80
  }
  if (kind === 'orientation' && /\breadme\b/iu.test(source)) return 5_000
  return 0
}

/**
 * The planning model receives the full frozen source set, but a scene must not
 * borrow a neighbouring document simply because both contain a few shared
 * words. GitHub documentation is an especially clear example: quick-start,
 * CLI, and troubleshooting pages all mention `gh aw`, while they teach very
 * different learner decisions. Infer a narrow document role from the stable
 * source header/content and use it as a hard preference during evidence
 * routing. The classifier is deliberately optional: arbitrary papers and
 * internal notes continue through semantic scoring unchanged.
 */
type EvidenceDocumentRole =
  | 'overview'
  | 'architecture'
  | 'mechanism'
  | 'quick-start'
  | 'cli'
  | 'recovery'
  | 'unknown'

function evidenceDocumentRole(entry: FrozenEvidenceEntry): EvidenceDocumentRole {
  const text = entry.text.slice(0, 1_400).toLocaleLowerCase()
  // Official GitHub documents keep their stable path in the preserved source
  // preamble. Prefer that identity over body keywords: the "how they work"
  // page can discuss SafeOutputs, but it is still the mechanism reference, not
  // the architecture reference.
  const header = entry.text.slice(0, 650).toLocaleLowerCase()
  if (/\/common[- ]issues\.(?:md|mdx)(?:[^\w]|$)|\/troubleshooting\//iu.test(header)) return 'recovery'
  if (/\/(?:cli|commands?)\.(?:md|mdx)(?:[^\w]|$)/iu.test(header)) return 'cli'
  if (/\/quick[- ]start\.(?:md|mdx)(?:[^\w]|$)|\/setup\//iu.test(header)) return 'quick-start'
  if (/\/architecture\.(?:md|mdx)(?:[^\w]|$)/iu.test(header)) return 'architecture'
  if (/\/how[- ]they[- ]work\.(?:md|mdx)(?:[^\w]|$)/iu.test(header)) return 'mechanism'
  if (/\/readme\.md(?:[^\w]|$)|\[github\/gh-aw readme\]/iu.test(header)) return 'overview'
  if (/\btroubleshooting\b|common[- ]issues?|known[- ]issues?|\brecovery\b|\brollback\b|\bdiagnos(?:e|is|tic)\b/iu.test(text)) {
    return 'recovery'
  }
  if (/\/(?:cli|commands?)(?:\.[a-z]+)?(?:[/?#]|$)|\bcommand[- ]line\b|\bgh\s+aw\s+(?:init|add|compile|run|logs|doctor|audit)\b/iu.test(text)) {
    return 'cli'
  }
  if (/quick[- ]start|get(?:ting)?[- ]started|first[- ]workflow|add[- ]wizard|\bprerequisites?\b|\binstallation\b/iu.test(text)) {
    return 'quick-start'
  }
  if (/defen[cs]e[- ]in[- ]depth|security[- ]architecture|\bsafeoutputs?\b|\bsandbox(?:ed|ing)?\b|\bfirewall\b|\bmcp\s+gateway\b/iu.test(text)) {
    return 'architecture'
  }
  if (/how[- ]they[- ]work|\bfrontmatter\b|natural[- ]language[- ]task|\bcompilation\b|\bworkflow\s+lifecycle\b/iu.test(text)) {
    return 'mechanism'
  }
  if (/\breadme\b|github[- ]agentic[- ]workflows|repository[- ]automation/iu.test(text)) {
    return 'overview'
  }
  return 'unknown'
}

function requestedEvidenceRole(
  semantic: SceneOutline,
  fallback: InstructionalPlanActivity,
): EvidenceDocumentRole | undefined {
  const title = normalizedSemanticText(semantic.title, 180).toLocaleLowerCase()
  const detail = normalizedSemanticText(
    [semantic.description, ...(semantic.keyPoints ?? [])].filter(Boolean).join(' '),
    600,
  ).toLocaleLowerCase()
  // Title is a stronger intent signal than the model's supporting prose. A
  // recovery page can legitimately mention commands, but that must not make it
  // select the CLI reference over the troubleshooting guide.
  const titleAndDetail = `${title}\n${detail}`
  // The opening scene is the learner's orientation to the source set. A model
  // may mention frontmatter while describing it, but that must not steal the
  // README/overview evidence from the opening map.
  if (fallback.kind === 'orientation') return 'overview'
  // Compilation, verification, audit logs, and command invocations are one
  // operational decision. Keep them on the CLI document even when the model
  // describes the surrounding workflow architecture.
  if (/\bcli\b|\bcommands?\b|\bgh\s+aw\s+(?:init|add|compile|run|logs|doctor|audit)\b/iu.test(title)) return 'cli'
  if (/troubleshoot|common[- ]issues?|\brecover(?:y|ing)?\b|\bfailure(?:s)?\b|\brollback\b|\bdiagnos(?:e|is|tic)\b/iu.test(title)) return 'recovery'
  if (/\bcompile(?:d|r|s|ation)?\b|\bverif(?:y|ied|ication)\b|\baudit(?:ing)?\b|\block[- ]file\b|\bgh\s+aw\s+(?:init|add|compile|run|logs|doctor|audit)\b/iu.test(title)) return 'cli'
  if (/\barchitecture\b|security|sandbox|safeoutputs?|firewall|\bmcp\b|defen[cs]e[- ]in[- ]depth/iu.test(titleAndDetail)) return 'architecture'
  if (/frontmatter|workflow[- ]anatomy|workflow[- ]lifecycle|how[- ]they[- ]work|compilation/iu.test(titleAndDetail)) return 'mechanism'
  if (/quick[- ]start|get(?:ting)?[- ]started|first[- ]workflow|installation|add[- ]wizard|\bprerequisites?\b|\bengine\b|\bprovider\b|\bsecret\b/iu.test(titleAndDetail)) return 'quick-start'
  if (fallback.kind === 'limits') return 'recovery'
  return undefined
}

function semanticPointMatchesSource(point: string, sourceFact: string): boolean {
  const pointTerms = focusTerms(bridgedSourceFocus(point)).filter((term) => term.length >= 3)
  const sourceTerms = new Set(focusTerms(sourceFact).filter((term) => term.length >= 3))
  if (pointTerms.length < 2 || sourceTerms.size === 0) return false
  const overlap = pointTerms.filter((term) => sourceTerms.has(term)).length
  return overlap >= Math.min(2, Math.ceil(pointTerms.length * 0.35))
}

function normalizedEvidencePhrase(value: string): string {
  return learnerFacingText(value, 260)
    .replace(SOURCE_LABEL_PATTERN, ' ')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim()
}

function verifiedSemanticAnchor(value: unknown, sourceText: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = learnerFacingText(value, 360)
  if (
    candidate.length < 32 ||
    SOURCE_NAVIGATION_NOISE.test(candidate) ||
    SOURCE_NONTEACHING_NOISE.test(candidate) ||
    SOURCE_GENERIC_INTRODUCTION.test(candidate)
  ) return undefined
  const needle = normalizedEvidencePhrase(candidate)
  const haystack = normalizedEvidencePhrase(sourceText)
  if (!needle || !haystack) return undefined
  if (haystack.includes(needle)) return candidate
  const terms = focusTerms(candidate).filter((term) => term.length >= 3)
  const matched = terms.filter((term) => haystack.includes(term)).length
  return terms.length >= 4 && matched / terms.length >= 0.9 ? candidate : undefined
}

function rankedEvidenceAnchors(text: string, focus = ''): string[] {
  const prepared = prepareEvidenceDocument(text)
    .replace(/\r\n?/gu, '\n')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\b(?:quality|authority|source[_ -]?quality)\s*=\s*(?:primary|official|authoritative|trusted)\s*:\s*/giu, '')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
    .slice(0, 8_000)
  const candidates = prepared
    .split(/\n+/u)
    .flatMap((line) => line.split(/(?<=[。！？.!?])\s+/u))
    .filter((candidate) => !MARKDOWN_HEADING_ONLY.test(candidate))
    .filter((candidate) => !SOURCE_NONTEACHING_NOISE.test(candidate.trim()))
    .filter((candidate) => !SOURCE_GENERIC_INTRODUCTION.test(candidate.trim()))
    .filter((candidate) => !SOURCE_CODE_OR_ASIDE_FRAGMENT.test(candidate.trim()))
    .filter((candidate) => !SOURCE_WEAK_CAUTION.test(candidate.trim()))
    .filter((candidate) => !/[：:]\s*$/u.test(candidate.trim()))
    .map((candidate) => cleanExcerpt(candidate, 440))
    .filter((candidate) => candidate.length >= 36 && candidate.length <= 360 && !MARKDOWN_STRUCTURE_ONLY.test(candidate))
  const requestedTerms = focusTerms(focus)
  const scored = candidates
    .map((candidate, index) => {
      const substanceHits = (candidate.match(new RegExp(SOURCE_SUBSTANCE_CUE.source, 'giu')) ?? []).length
      const normalizedCandidate = candidate.toLocaleLowerCase()
      const focusHits = requestedTerms.filter((term) => normalizedCandidate.includes(term)).length
      const sentenceComplete = /[.?!。！？]["')\]]*$/u.test(candidate.trim())
      const longFragmentPenalty = candidate.length > 360 && !sentenceComplete ? 120 : 0
      const score =
        Math.min(candidate.length, 200) +
        Math.min(substanceHits, 5) * 18 -
        (SOURCE_NAVIGATION_NOISE.test(candidate) ? 260 : 0) -
        longFragmentPenalty +
        (index === 0 && /^\s*(?:\d+\s+)?(?:position|introduction|abstract)\b/iu.test(candidate) ? 80 : 0) +
        (sentenceComplete ? 80 : 0) +
        focusHits * 260
      return { candidate, score }
    })
    .sort((left, right) => right.score - left.score)
  const substantive = scored.filter(({ candidate }) => !SOURCE_NAVIGATION_NOISE.test(candidate))
  const pool = substantive.length > 0 ? substantive : scored
  // When a scene supplies semantic focus, fidelity is more important than
  // forced variation: pick the best supporting passage. For an underspecified
  // scene only, rotate among the strongest passages to avoid repeating one
  // introductory sentence throughout the classroom.
  const focused = pool.filter(({ candidate }) => {
    const normalized = candidate.toLocaleLowerCase()
    return requestedTerms.some((term) => normalized.includes(term))
  })
  // Keep focus-aligned passages first, but retain the full ranked pool. The
  // semantic allocator may already have consumed the one matching sentence in
  // an earlier scene; it must then move to another source fact rather than
  // repeat that first sentence for the rest of the classroom.
  const ranked = focused.length > 0
    ? [...focused, ...pool.filter((entry) => !focused.includes(entry))]
    : pool
  // Preserve the original candidate here.  The caller decides the
  // learner-facing budget; an early 210-character cut silently truncated
  // otherwise complete primary-source claims before semantic selection.
  return ranked.map(({ candidate }) => candidate)
}

function evidenceAnchor(text: string, focus = '', variant = 0): string {
  const ranked = rankedEvidenceAnchors(text, focus)
  const selected = ranked.length > 0
    ? focusTerms(focus).length > 0
      ? ranked[0]
      : ranked[Math.abs(variant) % Math.min(ranked.length, 4)]
    : undefined
  return learnerFacingText(selected ?? text, 210)
}

function allocateEvidenceAnchor(
  text: string,
  focus: string,
  variant: number,
  usedFactIdentities: Set<string>,
): string {
  const identity = (value: string) => normalizedEvidencePhrase(value)
  const candidates = rankedEvidenceAnchors(text, focus)
  const selected =
    candidates.find((candidate) => !usedFactIdentities.has(identity(candidate))) ||
    candidates[Math.abs(variant) % Math.max(candidates.length, 1)] ||
    evidenceAnchor(text, focus, variant)
  const fact = learnerFacingText(selected, 210)
  if (fact) usedFactIdentities.add(identity(fact))
  return fact
}

function activityKindsForTarget(target: number): InstructionalActivityKind[] {
  const required: InstructionalActivityKind[] = [
    'orientation',
    'diagnostic',
    'foundation',
    'mechanism',
    'practice',
    'retrieval',
    'synthesis-transfer',
  ]
  if (target <= required.length) return required

  const expanded = [...required]
  const optional: InstructionalActivityKind[] = ['evidence', 'worked-example', 'limits']
  for (let index = 0; expanded.length < target && index < optional.length; index++) {
    expanded.splice(expanded.length - 3, 0, optional[index])
  }
  const insertionKinds: InstructionalActivityKind[] = ['mechanism', 'evidence', 'worked-example', 'practice']
  for (let index = 0; expanded.length < target; index++) {
    expanded.splice(expanded.length - 2, 0, insertionKinds[index % insertionKinds.length])
  }
  return expanded
}

function activityKinds(
  contract: LearningContract,
  evidenceCount: number,
  requestedCount?: number,
): InstructionalActivityKind[] {
  const target =
    requestedCount ??
    clamp(
      Math.round(contract.targetMinutes / 7) + Math.min(4, Math.max(0, evidenceCount - 1)),
      V3_COURSE_MIN_ACTIVITIES,
      V3_COURSE_MAX_ACTIVITIES,
    )
  return activityKindsForTarget(target)
}

function teachesInChinese(contract: LearningContract): boolean {
  return /[\u3400-\u9fff]/u.test(contract.goal)
}

function activityCopy(kind: InstructionalActivityKind, contract: LearningContract) {
  const chinese = teachesInChinese(contract)
  return {
    label: chinese ? ZH_ACTIVITY_LABEL[kind] : ACTIVITY_LABEL[kind],
    action: chinese ? ZH_ACTION_TEXT[kind] : ACTION_TEXT[kind],
    observableOutcome: chinese
      ? kind === 'synthesis-transfer'
        ? `一份可验证的 ${contract.artifact.artifactType} 已准备写入 ${contract.artifact.destination}。`
        : '学习者留下了可见的回答、决策、解释或诊断结果。'
      : kind === 'synthesis-transfer'
        ? `A verifiable ${contract.artifact.artifactType} is ready for ${contract.artifact.destination}.`
        : 'The learner records a visible answer, decision, explanation, or diagnosis.',
  }
}

function sceneTypeFor(kind: InstructionalActivityKind): SceneOutline['type'] {
  return kind === 'diagnostic' || kind === 'practice' || kind === 'retrieval' ? 'quiz' : 'slide'
}

function sourceLabelsFor(index: number, total: number, evidence: FrozenEvidenceSet): string[] {
  if (evidence.entries.length === 0) return []
  const primary = evidence.entries[index % evidence.entries.length].label
  if (total > evidence.entries.length || evidence.entries.length < 2) return [primary]
  const secondary = evidence.entries[(index + 1) % evidence.entries.length].label
  return index % 3 === 0 && secondary !== primary ? [primary, secondary] : [primary]
}

function semanticEvidenceLabels(
  semantic: SceneOutline,
  fallback: InstructionalPlanActivity,
  evidence: FrozenEvidenceSet,
  usage: Map<string, number>,
  remainingScenes: number,
): string[] {
  if (evidence.entries.length === 0) return fallback.evidenceLabels
  // The final learner artifact must make the whole evidence chain auditable,
  // not merely cite the document used for its last operational step. This is
  // deliberately multi-source only for synthesis/transfer; ordinary scenes
  // stay narrow enough for a learner to inspect one claim at a time.
  if (fallback.kind === 'synthesis-transfer') {
    const labels = evidence.entries.map((entry) => entry.label)
    for (const label of labels) usage.set(label, (usage.get(label) ?? 0) + 1)
    return labels
  }
  const focus = bridgedSourceFocus(
    [semantic.title, semantic.description, ...(semantic.keyPoints ?? [])]
      .filter(Boolean)
      .join(' '),
  )
  const terms = focusTerms(focus).filter((term) => term.length >= 3)
  const unused = evidence.entries.filter((entry) => (usage.get(entry.label) ?? 0) === 0)
  // Preserve complete source-set coverage: once the remaining number of scenes
  // equals the still-unused official documents, allocate one of those documents
  // even when a broad scene title would otherwise keep selecting README.md.
  const coverageCandidates = unused.length >= remainingScenes ? unused : evidence.entries
  const requiredRole = requestedEvidenceRole(semantic, fallback)
  // A precise scene intent (for example, "CLI commands" or "recover from a
  // failure") wins over rotation and broad token overlap. Without this filter,
  // an unrelated quick-start paragraph could be cited on a CLI lesson solely
  // because both mention `gh aw`. If the source set has no recognisable match,
  // fall back to the normal semantic allocator rather than rejecting a paper
  // or a user's internal note with an arbitrary structure.
  const roleCandidates = requiredRole
    ? evidence.entries.filter((entry) => evidenceDocumentRole(entry) === requiredRole)
    : []
  const candidates = roleCandidates.length > 0 ? roleCandidates : coverageCandidates
  const selected = candidates
    .map((entry) => {
      const text = entry.text.toLocaleLowerCase()
      const focusHits = terms.filter((term) => text.includes(term)).length
      const fallbackBonus = fallback.evidenceLabels.includes(entry.label) ? 18 : 0
      const freshnessBonus = (usage.get(entry.label) ?? 0) === 0 ? 42 : 0
      const reusePenalty = (usage.get(entry.label) ?? 0) * 7
      const specializationBonus = sourceSpecializationBonus(entry.text, focus, fallback.kind)
      return {
        entry,
        score: focusHits * 260 + specializationBonus + fallbackBonus + freshnessBonus - reusePenalty,
      }
    })
    .sort((left, right) => right.score - left.score || left.entry.label.localeCompare(right.entry.label))[0]?.entry
  const label = selected?.label ?? fallback.evidenceLabels[0] ?? evidence.entries[0]!.label
  usage.set(label, (usage.get(label) ?? 0) + 1)
  return [label]
}

function evidenceByLabel(evidence: FrozenEvidenceSet, label: string): string {
  return evidence.entries.find((entry) => entry.label === label)?.text ?? ''
}

function conceptId(label: string): string {
  return `concept:${label.toLocaleLowerCase()}`
}

function buildActivity(
  kind: InstructionalActivityKind,
  index: number,
  total: number,
  contract: LearningContract,
  evidence: FrozenEvidenceSet,
  usedFactIdentities: Set<string>,
): InstructionalPlanActivity {
  const copy = activityCopy(kind, contract)
  const evidenceLabels = sourceLabelsFor(index, total, evidence)
  const anchors = evidenceLabels
    .map((label) => allocateEvidenceAnchor(
      evidenceByLabel(evidence, label),
      `${copy.action} ${contract.goal}`,
      index,
      usedFactIdentities,
    ))
    .filter(Boolean)
  const rawAnchor = anchors[0] || contract.goal
  const anchor = learnerFacingText(rawAnchor)
  const evidenceSuffix = evidenceLabels.map((label) => `[${label}]`).join(' ')
  const isFinal = kind === 'synthesis-transfer'
  const baseDescription = teachesInChinese(contract)
    ? isFinal
      ? `${copy.action} 依据“${anchor}” ${evidenceSuffix}，完成一份 ${contract.artifact.artifactType}，至少包含：${contract.artifact.requiredSections.join('、')}；用以下方式验证：${contract.artifact.verificationMethod}`
      : `${copy.action} 本场聚焦的来源发现是“${anchor}” ${evidenceSuffix}；你的学习结果必须让推理过程可审查。`
    : isFinal
      ? `${copy.action} Use the source-backed model “${anchor}” ${evidenceSuffix}. Produce a ${contract.artifact.artifactType} with ${contract.artifact.requiredSections.join(', ')} and verify it by: ${contract.artifact.verificationMethod}`
      : `${copy.action} The focal source finding is “${anchor}” ${evidenceSuffix}. The learner-visible result must make the reasoning inspectable.`
  const description = isFinal
    ? `${baseDescription} ${synthesisTransferRequirement(contract)}`
    : baseDescription
  const keyPoints = [
    `${anchor} ${evidenceSuffix}`.trim(),
    (teachesInChinese(contract)
      ? `决策规则：把这条来源发现连接到“${contract.observableCapability}”`
      : `Decision rule: connect this source finding to ${contract.observableCapability}`) +
      ` ${evidenceSuffix}`.trim(),
    isFinal
      ? (teachesInChinese(contract)
          ? `成果验收：${contract.artifact.verificationMethod}`
          : `Artifact acceptance: ${contract.artifact.verificationMethod}`) + ` ${evidenceSuffix}`.trim()
      : (teachesInChinese(contract)
          ? '通过解释“证据为何改变下一步决策”来检查理解'
          : 'Check understanding by explaining why the evidence changes the next decision') +
        ` ${evidenceSuffix}`.trim(),
  ]
  const slotId = `slot_${String(index + 1).padStart(2, '0')}_${kind}`
  return {
    schemaVersion: 3,
    slotId,
    kind,
    conceptIds: evidenceLabels.length > 0 ? evidenceLabels.map(conceptId) : ['goal:core'],
    evidenceLabels,
    learnerAction: copy.action,
    observableOutcome: copy.observableOutcome,
    artifactRequired: isFinal,
    ...(isFinal
      ? {
          artifact: {
            artifactType: contract.artifact.artifactType,
            requiredSections: [...contract.artifact.requiredSections],
            verificationMethod: contract.artifact.verificationMethod,
            destination: contract.artifact.destination,
          },
        }
      : {}),
    // The durable fallback remains a real source-grounded classroom, not a
    // page labelled only "Learning map" or "Synthesis". The evidence phrase
    // gives every learner-facing title a concrete subject even without a
    // semantic model response.
    title: learnerFacingTitle(anchor, 72),
    description,
    keyPoints,
    estimatedMinutes: Math.max(3, Math.round(contract.targetMinutes / total)),
  }
}

export function buildInstructionalPlan(input: {
  contract: LearningContract
  evidence: FrozenEvidenceSet
  activityCount?: number
}): CourseInstructionalPlan {
  const kinds = activityKinds(input.contract, input.evidence.entries.length, input.activityCount)
  const usedFactIdentities = new Set<string>()
  const activities = kinds.map((kind, index) =>
    buildActivity(kind, index, kinds.length, input.contract, input.evidence, usedFactIdentities),
  )
  const planId = `ipl_${hash(`${input.contract.contractId}:${input.evidence.sourceSetId}:${activities.map((entry) => entry.slotId).join('|')}`).slice(0, 32)}`
  return {
    schemaVersion: 3,
    planId,
    contractId: input.contract.contractId,
    sourceSetId: input.evidence.sourceSetId,
    targetMinutes: input.contract.targetMinutes,
    activities,
  }
}

export function instructionalPlanToOutlines(plan: CourseInstructionalPlan): SceneOutline[] {
  return plan.activities.map((activity, index) => ({
    id: `v3_${plan.planId.slice(4, 12)}_${String(index + 1).padStart(2, '0')}`,
    type: sceneTypeFor(activity.kind),
    title: activity.title,
    description: activity.description,
    keyPoints: activity.keyPoints,
    order: index + 1,
    activity: {
      schemaVersion: 3,
      slotId: activity.slotId,
      kind: activity.kind,
      conceptIds: activity.conceptIds,
      evidenceLabels: activity.evidenceLabels,
      learnerAction: activity.learnerAction,
      observableOutcome: activity.observableOutcome,
      artifactRequired: activity.artifactRequired,
      ...(activity.artifact ? { artifact: activity.artifact } : {}),
    },
    ...(sceneTypeFor(activity.kind) === 'quiz'
      ? {
          quizConfig: {
            questionCount: 3,
            difficulty: activity.kind === 'diagnostic' ? ('easy' as const) : ('medium' as const),
            questionTypes: ['single' as const, 'text' as const],
          },
        }
      : {}),
  }))
}

const SOURCE_LABEL_PATTERN = /\[(?:S|V)\d+\]/giu
const GENERIC_SEMANTIC_TITLE = /^(?:learning map|starting-point check|core model|mechanism and flow|evidence and trade-off|worked example|guided decision practice|retrieval and diagnosis|boundary and failure modes|synthesis and transfer|学习地图|学习路线|先导诊断|核心概念|核心模型|关键机制|证据与取舍|案例演练|情境练习|主动回忆|边界与风险|迁移交付)[：:：\s]*$/iu

function normalizedSemanticText(value: unknown, limit = 360): string {
  return learnerFacingText(String(value ?? '').replace(SOURCE_LABEL_PATTERN, ' '), limit)
}

function semanticTitle(
  value: unknown,
  fallback: InstructionalPlanActivity,
  sourceFact: string,
  contract: LearningContract,
  order: number,
  used: Set<string>,
): string {
  // The release gate reserves room for a concrete learner-facing title. A
  // model may use a full sentence as its title; keep its specific opening
  // rather than rejecting the entire otherwise useful teaching arc.
  const candidate = learnerFacingTitle(String(value ?? '').replace(SOURCE_LABEL_PATTERN, ' '), 68)
  // A generic model heading (especially the final "summary" scene) must not
  // force the whole semantic arc back to the old template. Bind it to either a
  // concrete newly allocated source fact or the learner's transfer goal.
  const sourceBackedFallback = learnerFacingTitle(
    fallback.kind === 'synthesis-transfer' ? contract.goal : sourceFact || fallback.title,
    68,
  )
  let title = GENERIC_SEMANTIC_TITLE.test(candidate) || candidate.length < 5
    ? sourceBackedFallback
    : candidate
  const identity = (input: string) => input.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
  let suffix = 2
  while (used.has(identity(title))) {
    title = `${learnerFacingTitle(candidate || sourceBackedFallback, 56)}（关键问题 ${order}）`
    suffix++
    if (suffix > 2) title = `${learnerFacingTitle(candidate || sourceBackedFallback, 52)}（关键问题 ${order}-${suffix - 1}）`
  }
  used.add(identity(title))
  return title
}

function sourceSuffixed(value: string, labels: readonly string[]): string {
  const text = normalizedSemanticText(value)
  const suffix = labels.map((label) => `[${label}]`).join(' ')
  return `${text || 'Source-backed decision'} ${suffix}`.trim()
}

function proposedDesignPoint(value: string, chinese: boolean): string {
  const proposal = chinese
    ? '设计提案（需自行验证，非来源事实）'
    : 'Design proposal (verify independently; not a source fact)'
  return `${proposal}: ${value}`
}

function synthesisTransferRequirement(contract: LearningContract): string {
  const chinese = teachesInChinese(contract)
  const artifact = contract.artifact.artifactType
  const verification = contract.artifact.verificationMethod
  return chinese
    ? `综合（synthesis）本课证据并迁移（transfer）到一个新项目、决策或问题；交付可验证的 ${artifact}，验收方式：${verification}`
    : `Synthesis and transfer: synthesize the course evidence and transfer it to a new project, decision, or problem. Deliver a verifiable ${artifact}; completion test: ${verification}`
}

function sceneOutcomeRequirement(kind: InstructionalActivityKind, chinese: boolean): string {
  if (chinese) {
    return {
      orientation: '一条学习目标、两个带来源标签的问题和一个成功信号。',
      diagnostic: '当前假设、未知点，以及需要核验的来源证据。',
      foundation: '三个相互关联的概念说明，并为每项标注来源。',
      mechanism: '一条包含输入、约束、状态变化和输出的机制链路。',
      evidence: '至少两个方案的取舍表，明确选择、依据与后果。',
      'worked-example': '对来源案例的逐步标注：设置、动作、预期结果和验证点。',
      practice: '针对变化条件的选择，包含理由、证据和预期后果。',
      retrieval: '无提示回忆答案、一个误解，以及用来源完成的纠正。',
      limits: '一个失败情境及其检测、遏制、恢复和升级动作。',
      'synthesis-transfer': '完整可验证成果及其来源依据。',
    }[kind]
  }
  return {
    orientation: 'one learning goal, two source-labeled questions, and one success signal.',
    diagnostic: 'the current assumption, the unknown, and the evidence needed to check it.',
    foundation: 'three linked concept statements with a source label for each.',
    mechanism: 'a mechanism trace with input, constraint, state change, and output.',
    evidence: 'a trade-off table for at least two options, naming the choice, evidence, and consequence.',
    'worked-example': 'an annotated source example: setup, action, expected result, and verification point.',
    practice: 'a changed-condition choice with rationale, evidence, and expected consequence.',
    retrieval: 'a no-prompt recall answer, one misconception, and its source-backed correction.',
    limits: 'one failure scenario with detection, containment, recovery, and escalation actions.',
    'synthesis-transfer': 'the complete verifiable artifact and the source evidence that justifies it.',
  }[kind]
}

function semanticDesignPoints(
  semantic: SceneOutline,
  fallback: InstructionalPlanActivity,
  contract: LearningContract,
  sourceFact: string,
): string[] {
  const chinese = teachesInChinese(contract)
  const semanticPoints = (semantic.keyPoints ?? [])
    .map((point) => normalizedSemanticText(point, 220))
    .filter((point) => point.length >= 12)
  const labels = fallback.evidenceLabels.map((label) => `[${label}]`).join(' ')
  const topic = normalizedSemanticText(semantic.title || fallback.title, 120)
  let semanticFocus =
    semanticPoints.find(
      (point) =>
        !/^(?:来源事实|证据范围|证据审查|证据决策|evidence scope|evidence audit|evidence decision)/iu.test(
          point,
        ),
    ) ?? topic
  let semanticExtension = semanticPoints.find(
    (point) => point !== semanticFocus && point.length >= 18,
  )
  // A model-authored heading is useful pedagogical framing only when it shares
  // concrete terms with the already-selected source fact. Otherwise it can
  // accidentally ask a security question on a CLI citation (or vice versa).
  // In that case, teach the verified fact directly and keep any ungrounded idea
  // explicitly labelled as a learner proposal below.
  if (!semanticPointMatchesSource(semanticFocus, sourceFact)) {
    semanticFocus = normalizedSemanticText(sourceFact, 180) || topic
    semanticExtension = undefined
  } else if (semanticExtension && !semanticPointMatchesSource(semanticExtension, sourceFact)) {
    semanticExtension = undefined
  }
  const factualPoint = chinese
    ? `来源事实：${sourceFact} ${labels}`
    : `Source fact: ${sourceFact} ${labels}`
  const inquiryPoint = chinese
    ? `机制核验：围绕“${semanticFocus}”，指出来源中的哪一段支持、限定或反驳这个判断。 ${labels}`
    : `Mechanism check: for “${semanticFocus}”, identify which source passage supports, limits, or challenges the judgment. ${labels}`
  const decisionPoint = chinese
    ? `决策练习：${fallback.learnerAction} 产出：${sceneOutcomeRequirement(fallback.kind, true)} 先引用上述事实，再说明它如何改变下一步；可额外比较“${semanticExtension ?? topic}”。 ${labels}`
    : `Decision practice: ${fallback.learnerAction} Output: ${sceneOutcomeRequirement(fallback.kind, false)} Cite the fact above, then explain how it changes the next step; optionally compare “${semanticExtension ?? topic}”. ${labels}`
  const proposal = semanticFocus || normalizedSemanticText(semantic.description, 220) || fallback.title
  return [factualPoint, inquiryPoint, decisionPoint, proposedDesignPoint(proposal, chinese)]
}

function semanticSourceFact(
  semantic: SceneOutline,
  fallback: InstructionalPlanActivity,
  evidence: FrozenEvidenceSet,
  usedFactIdentities: Set<string>,
): string {
  const sourceText = fallback.evidenceLabels
    .map((label) => evidenceByLabel(evidence, label))
    .filter(Boolean)
    .join('\n\n')
  const sourceAnchor = verifiedSemanticAnchor(semantic.evidenceAnchor, sourceText)
  const focus = bridgedSourceFocus([semantic.title, semantic.description, ...(semantic.keyPoints ?? [])]
    .filter(Boolean)
    .join(' '))
  const identity = (value: string) => normalizedEvidencePhrase(value)
  const anchored = sourceAnchor
    ? learnerFacingText(sourceAnchor, 360)
      .replace(SOURCE_LABEL_PATTERN, '')
      .replace(/\s+/gu, ' ')
      .trim()
    : ''
  const candidates = rankedEvidenceAnchors(sourceText || fallback.keyPoints[0] || fallback.title, focus)
    .map((candidate) => learnerFacingText(candidate, 360)
      .replace(SOURCE_LABEL_PATTERN, '')
      .replace(/\s+/gu, ' ')
      .trim())
    .filter(Boolean)
  // A citation label alone is not enough for learning: repeated introductory
  // facts leave every later scene without a new decision to make. Prefer a
  // previously unused exact passage across the full arc, while still honoring a
  // valid model-supplied anchor when it adds new evidence.
  const selected =
    (anchored && !usedFactIdentities.has(identity(anchored)) ? anchored : '') ||
    candidates.find((candidate) => !usedFactIdentities.has(identity(candidate))) ||
    anchored ||
    candidates[Math.abs(semantic.order - 1) % Math.max(candidates.length, 1)] ||
    evidenceAnchor(sourceText || fallback.keyPoints[0] || fallback.title, focus, semantic.order - 1)
  const fact = learnerFacingText(selected, 360)
    .replace(SOURCE_LABEL_PATTERN, '')
    .replace(/\s+/gu, ' ')
    .trim()
  if (fact) usedFactIdentities.add(identity(fact))
  return fact
}

function semanticDescription(
  semantic: SceneOutline,
  fallback: InstructionalPlanActivity,
  contract: LearningContract,
  sourceFact: string,
): string {
  const labels = fallback.evidenceLabels
  const sourceDetail = normalizedSemanticText(sourceFact || fallback.keyPoints[0] || fallback.title, 360)
  const proposedFocus = normalizedSemanticText(
    semantic.description || semantic.keyPoints?.join('; ') || fallback.title,
    300,
  )
  const chinese = teachesInChinese(contract)
  const transfer = fallback.kind === 'synthesis-transfer'
  const finalRequirement = chinese
    ? `交付一份 ${contract.artifact.artifactType}，包含${contract.artifact.requiredSections.join('、')}；完成标准：${contract.artifact.verificationMethod}`
    : `Deliver a ${contract.artifact.artifactType} with ${contract.artifact.requiredSections.join(', ')}; completion test: ${contract.artifact.verificationMethod}`
  const learnerRequirement = chinese
    ? `${fallback.learnerAction} 本场可见产出：${sceneOutcomeRequirement(fallback.kind, true)}`
    : `${fallback.learnerAction} Visible output: ${sceneOutcomeRequirement(fallback.kind, false)}`
  const sourceBoundary = sourceSuffixed(sourceDetail, labels)
  const proposal = proposedDesignPoint(proposedFocus, chinese)
  const synthesisRequirement = synthesisTransferRequirement(contract)
  const prerequisiteContext =
    fallback.kind === 'orientation' || fallback.kind === 'diagnostic'
      ? chinese
        ? '\u524d\u7f6e\u6761\u4ef6\u4e0e\u4e0a\u4e0b\u6587\uff1a\u5728\u8fdb\u5165\u6838\u5fc3\u673a\u5236\u524d\uff0c\u5148\u660e\u786e\u5df2\u77e5\u80fd\u529b\u3001\u8fd8\u7f3a\u4ec0\u4e48\u4fe1\u606f\u4ee5\u53ca\u672c\u8bfe\u8981\u89e3\u51b3\u7684\u5b9e\u9645\u95ee\u9898\u3002'
        : 'Prerequisites and context: before entering the core mechanism, identify what the learner already knows, which evidence is still missing, and the real decision this course will resolve.'
      : ''
  // Keep evidence-backed findings and learner-authored design work distinct.
  // The latter is useful for practice, but it must never borrow a [S#] label
  // as if the frozen source had asserted the proposal.
  return transfer
    ? `${sourceBoundary}\n\n${proposal}\n\n${synthesisRequirement}\n\n${learnerRequirement} ${finalRequirement}`
    : [prerequisiteContext, sourceBoundary, proposal, learnerRequirement].filter(Boolean).join('\n\n')
}

function assertSemanticOutlineCandidate(outlines: readonly SceneOutline[]): void {
  if (
    outlines.length < V3_COURSE_MIN_ACTIVITIES ||
    outlines.length > V3_COURSE_MAX_ACTIVITIES
  ) {
    throw new Error('semantic_outline_count_out_of_range')
  }
  const shallowCount = outlines.filter((outline) => {
    const description = normalizedSemanticText(outline.description, 240)
    const concretePoints = (outline.keyPoints ?? [])
      .map((point) => normalizedSemanticText(point, 180))
      .filter((point) => point.length >= 12)
    // The later V3 merger always adds the learner action, source labels, and
    // transfer evidence. At this boundary we only reject scenes that have no
    // usable teaching substance at all; short but specific Chinese headings
    // and two concrete points are valid semantic seeds.
    return description.length < 18 || concretePoints.length < 2
  }).length
  // Titles are repaired at merge time from newly allocated source facts and,
  // for the final scene, the learner's transfer goal. A model may return a
  // generic arc skeleton while still supplying useful descriptions and
  // exercises; rejecting it solely for those headings used to publish the
  // visibly generic deterministic template. Only missing teaching substance is
  // a semantic-plan rejection.
  if (shallowCount > Math.floor(outlines.length * 0.5)) {
    throw new Error('semantic_outline_content_too_shallow')
  }
}

/**
 * Combines a model-authored teaching arc with the V3 durable activity contract.
 * The model is responsible for the human teaching narrative; the deterministic
 * layer owns source labels, learner actions, transfer evidence, scene shape,
 * and release invariants. An invalid semantic draft is rejected before it can
 * become a user-visible course; generic headings are repaired from evidence
 * instead of triggering a visible template fallback.
 */
export function buildSemanticInstructionalPlan(input: {
  contract: LearningContract
  evidence: FrozenEvidenceSet
  semanticOutlines: readonly SceneOutline[]
}): CourseInstructionalPlan {
  assertSemanticOutlineCandidate(input.semanticOutlines)
  const baseline = buildInstructionalPlan({
    contract: input.contract,
    evidence: input.evidence,
    activityCount: input.semanticOutlines.length,
  })
  const usedTitles = new Set<string>()
  const usedFactIdentities = new Set<string>()
  const evidenceUsage = new Map<string, number>()
  const activities = baseline.activities.map((fallback, index) => {
    const semantic = input.semanticOutlines[index]
    const evidenceLabels = semanticEvidenceLabels(
      semantic,
      fallback,
      input.evidence,
      evidenceUsage,
      input.semanticOutlines.length - index,
    )
    const sourceActivity: InstructionalPlanActivity = {
      ...fallback,
      evidenceLabels,
      conceptIds: evidenceLabels.map(conceptId),
    }
    const sourceFact = semanticSourceFact(semantic, sourceActivity, input.evidence, usedFactIdentities)
    const title = semanticTitle(semantic.title, sourceActivity, sourceFact, input.contract, index + 1, usedTitles)
    return {
      ...sourceActivity,
      title,
      description: semanticDescription(semantic, sourceActivity, input.contract, sourceFact),
      keyPoints: semanticDesignPoints(semantic, sourceActivity, input.contract, sourceFact),
    }
  })
  return {
    ...baseline,
    planId: `ipl_${hash(`${baseline.planId}:${activities.map((activity) => `${activity.title}|${activity.description}`).join('|')}`).slice(0, 32)}`,
    activities,
  }
}

export function assessInstructionalPlan(
  plan: CourseInstructionalPlan,
  evidence: FrozenEvidenceSet,
): InstructionalPlanAssessment {
  const violations: string[] = []
  const available = new Set(evidence.entries.map((entry) => entry.label))
  const covered = new Set<string>()
  const slotIds = new Set<string>()
  const totalMinutes = plan.activities.reduce((total, activity) => total + activity.estimatedMinutes, 0)

  if (plan.schemaVersion !== 3) violations.push('plan_schema_version_invalid')
  if (plan.contractId.length < 8 || plan.sourceSetId !== evidence.sourceSetId) {
    violations.push('plan_contract_or_source_set_mismatch')
  }
  if (
    plan.activities.length < V3_COURSE_MIN_ACTIVITIES ||
    plan.activities.length > V3_COURSE_MAX_ACTIVITIES
  ) {
    violations.push('plan_activity_count_out_of_range')
  }
  for (const [index, activity] of plan.activities.entries()) {
    if (slotIds.has(activity.slotId)) violations.push(`plan_duplicate_slot:${activity.slotId}`)
    slotIds.add(activity.slotId)
    if (activity.keyPoints.length < 3 || activity.keyPoints.some((point) => point.length < 12)) {
      violations.push(`plan_shallow_activity:${index + 1}`)
    }
    if (!activity.learnerAction || !activity.observableOutcome) {
      violations.push(`plan_missing_learning_result:${index + 1}`)
    }
    for (const label of activity.evidenceLabels) {
      if (!available.has(label)) violations.push(`plan_unknown_evidence:${label}`)
      else covered.add(label)
    }
  }
  const finalActivity = plan.activities.at(-1)
  if (!finalActivity || finalActivity.kind !== 'synthesis-transfer' || !finalActivity.artifactRequired) {
    violations.push('plan_final_artifact_missing')
  }
  if (evidence.entries.length > 0 && covered.size !== evidence.entries.length) {
    violations.push('plan_frozen_evidence_underused')
  }

  return {
    passed: violations.length === 0,
    violations,
    metrics: {
      activityCount: plan.activities.length,
      evidenceCount: evidence.entries.length,
      evidenceCoverage: evidence.entries.length > 0 ? covered.size / evidence.entries.length : 1,
      estimatedMinutes: totalMinutes,
    },
  }
}
