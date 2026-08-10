import { describe, expect, it } from 'vitest'

import {
  buildInstructionalPlan,
  buildSemanticInstructionalPlan,
  assessInstructionalPlan,
  instructionalPlanToOutlines,
} from '@/lib/generation/planning/instructional-blueprint'
import {
  assessOutlineEvidenceIntegrity,
  combineQualityAssessments,
  findUnsupportedNamedEvidenceTerms,
} from '@/lib/generation/evidence-quality'
import { assessOutlineQuality } from '@/lib/generation/course-quality'
import { freezeCanonicalEvidence } from '@/lib/learning/domain/v3/frozen-evidence'
import { createLearningContract } from '@/lib/learning/domain/v3/learning-contract'

describe('instructional blueprint v3', () => {
  it('creates a source-covered learning plan instead of a fixed page-count outline', () => {
    const evidence = freezeCanonicalEvidence([
      '# Architecture',
      'The worker leases one job step at a time and persists each accepted result before advancing.',
      '',
      '# Reliability',
      'A release requires every durable scene and its quality evidence before the classroom is published.',
      '',
      '# Learning',
      'A companion note records the learner artifact while the original source remains unchanged.',
    ].join('\n'))
    const contract = createLearningContract({
      projectId: 'project-demo',
      sourceMode: 'obsidian',
      objectType: 'knowledge-project',
      goal: 'Understand the durable generation architecture and choose a safe implementation step.',
      targetMinutes: 55,
      now: new Date('2026-08-02T00:00:00.000Z'),
    })

    const plan = buildInstructionalPlan({ contract, evidence })
    const assessment = assessInstructionalPlan(plan, evidence)
    const outlines = instructionalPlanToOutlines(plan)

    expect(assessment).toMatchObject({ passed: true })
    expect(outlines).toHaveLength(plan.activities.length)
    expect(outlines.length).toBeGreaterThanOrEqual(9)
    expect(outlines.length).toBeLessThanOrEqual(12)
    expect(outlines.at(-1)?.activity).toMatchObject({ kind: 'synthesis-transfer', artifactRequired: true })
    expect(new Set(outlines.flatMap((outline) => outline.activity?.evidenceLabels ?? [])).size).toBe(
      evidence.entries.length,
    )
    expect(outlines.every((outline) => outline.keyPoints.length === 3)).toBe(true)
  })

  it('keeps audit links in evidence while presenting clean learner-facing scene titles', () => {
    const evidence = freezeCanonicalEvidence(
      '[MarkItDown documentation](https://github.com/microsoft/markitdown) describes a conversion pipeline for common document formats.\n\n' +
        'A release is accepted only after the learner records an observable verification result.',
    )
    const contract = createLearningContract({
      projectId: 'project-title-cleanup',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Choose a safe document-conversion integration approach.',
      targetMinutes: 45,
      now: new Date('2026-08-02T00:00:00.000Z'),
    })

    const outlines = instructionalPlanToOutlines(buildInstructionalPlan({ contract, evidence }))

    expect(outlines.every((outline) => !outline.title.includes('https://'))).toBe(true)
    expect(outlines.every((outline) => !outline.title.includes(']('))).toBe(true)
    expect(outlines[0]?.title).toContain('MarkItDown documentation')
  })

  it('removes discovery-quality metadata from learner-facing headings', () => {
    const evidence = freezeCanonicalEvidence(
      'microsoft/markitdown; quality=primary: A Python tool converts documents into Markdown for LLM and RAG workflows.',
    )
    const contract = createLearningContract({
      projectId: 'project-metadata-cleanup',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Choose a safe document-conversion integration approach.',
      targetMinutes: 45,
      now: new Date('2026-08-03T00:00:00.000Z'),
    })

    const outlines = instructionalPlanToOutlines(buildInstructionalPlan({ contract, evidence }))

    expect(outlines.every((outline) => !/quality\s*=/iu.test(outline.title))).toBe(true)
    expect(outlines[0]?.title).toContain('A Python tool converts documents')
  })

  it('extracts a learner-readable fact from a noisy primary-source page before teaching', () => {
    const evidence = freezeCanonicalEvidence(
      'quality=primary: Position: Coding Benchmarks Are Misaligned with Agentic Software Engineering Report Issue Back to Abstract. Coding agents are composite systems of a model, harness, context, environment, and feedback signals. Benchmarks that collapse those components into one end-to-end score cannot isolate which component changed the result.',
    )
    const contract = createLearningContract({
      projectId: 'project-source-noise',
      sourceMode: 'external',
      objectType: 'paper',
      goal: 'Design an auditable evaluation plan for agentic software engineering.',
      targetMinutes: 45,
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const semanticOutlines = Array.from({ length: 9 }, (_, index) => ({
      id: `noise_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title: `Evaluation decision ${index + 1}`,
      description: `Investigate the evaluation consequence for stage ${index + 1}.`,
      keyPoints: [
        `Compare the changed component with the observed score for stage ${index + 1}.`,
        `Record the evidence needed to audit the next decision for stage ${index + 1}.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )
    const learnerText = outlines
      .flatMap((outline) => [outline.title, outline.description, ...outline.keyPoints])
      .join('\n')

    expect(learnerText).toMatch(
      /Coding agents are composite systems|Benchmarks that collapse those components/iu,
    )
    expect(learnerText).not.toMatch(/quality=|report issue|back to abstract/iu)
    expect(outlines.every((outline) => outline.keyPoints.some((point) => point.startsWith('Source fact:')))).toBe(true)
    expect(outlines.every((outline) => outline.keyPoints.every((point) => !point.startsWith('Evidence scope:')))).toBe(true)
  })

  it('grounds distinct GitHub workflow decisions in their matching README passages', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1]',
      '# GitHub Agentic Workflows',
      'GitHub Agentic Workflows lets teams write repository automation in plain Markdown and run AI coding agents inside GitHub Actions.',
      '',
      'Install the gh aw extension, then run gh aw init to configure a repository before adding a workflow.',
      '',
      'Workflows use read-only defaults and sandboxed execution; an explicit reviewable change is required before a write is accepted.',
      '',
      'A daily repository status workflow can summarize open issues, recent pull requests, and CI health.',
      '',
      'The verification record must retain the triggering event, selected permissions, observed output, and recovery decision.',
    ].join('\n'))
    const contract = createLearningContract({
      projectId: 'project-github-readme',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Build an auditable GitHub agentic workflow with secure permissions and recovery evidence.',
      targetMinutes: 50,
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const focuses = [
      'daily repository status',
      'plain Markdown',
      'read-only defaults',
      'gh aw init',
      'selected permissions',
      'sandboxed execution',
      'recovery decision',
      'CI health',
      'verification record',
    ]
    const anchors = [
      'A daily repository status workflow can summarize open issues, recent pull requests, and CI health.',
      'GitHub Agentic Workflows lets teams write repository automation in plain Markdown and run AI coding agents inside GitHub Actions.',
      'Workflows use read-only defaults and sandboxed execution; an explicit reviewable change is required before a write is accepted.',
      undefined,
      'The verification record must retain the triggering event, selected permissions, observed output, and recovery decision.',
      'Workflows use read-only defaults and sandboxed execution; an explicit reviewable change is required before a write is accepted.',
      'An invented source statement that must not be treated as evidence.',
      'A daily repository status workflow can summarize open issues, recent pull requests, and CI health.',
      'The verification record must retain the triggering event, selected permissions, observed output, and recovery decision.',
    ]
    const semanticOutlines = focuses.map((focus, index) => ({
      id: `github_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title: `GitHub workflow decision: ${focus}`,
      description: `Explain how ${focus} changes the implementation decision.`,
      keyPoints: [
        `Identify the repository fact about ${focus}.`,
        `Use ${focus} to justify the next workflow choice.`,
      ],
      ...(anchors[index] ? { evidenceAnchor: anchors[index] } : {}),
    }))

    const plan = buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines })
    const sourceFacts = instructionalPlanToOutlines(plan)
      .flatMap((outline) => outline.keyPoints)
      .filter((point) => point.startsWith('Source fact:'))

    expect(evidence.entries[0]?.text).toContain('recovery decision')
    expect(sourceFacts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('plain Markdown'),
        expect.stringContaining('gh aw init'),
        expect.stringContaining('read-only defaults'),
        expect.stringContaining('verification record'),
      ]),
    )
    expect(sourceFacts.some((point) => /contents?|quality=/iu.test(point))).toBe(false)
    expect(sourceFacts.some((point) => point.includes('invented source statement'))).toBe(false)
  })

  it('allocates distinct source passages across a semantic classroom instead of repeating its introduction', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1]',
      'The workflow author writes repository automation in Markdown and reviews every proposed change in a pull request.',
      'Install the extension with the official script before running the repository initialization command.',
      'Initialization creates the required workflow directory and records the selected runtime configuration.',
      'A scheduled status workflow reports open issues, pull requests, and continuous-integration health.',
      'Copilot requests require an explicit write permission, while other runtimes use repository secrets.',
      'Sandboxed execution and read-only defaults prevent an agent from changing the repository directly.',
      'Safe outputs sanitize proposed writes and leave a reviewable change for human approval.',
      'A release warning identifies versions that must be upgraded before billing-sensitive automation runs.',
      'The verification record keeps the trigger, permission decision, observed output, and recovery result together.',
      'When verification fails, the operator preserves the evidence and chooses a safe recovery action.',
    ].join('\n\n'))
    const contract = createLearningContract({
      projectId: 'project-distinct-facts',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Build a secure and verifiable repository automation workflow.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const semanticOutlines = Array.from({ length: 10 }, (_, index) => ({
      id: `distinct_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title: `Repository workflow decision ${index + 1}`,
      description: `Make the implementation decision for learning stage ${index + 1}.`,
      keyPoints: [
        `Inspect the source detail needed for learning stage ${index + 1}.`,
        `Record a reviewable next action for learning stage ${index + 1}.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )
    const facts = outlines
      .flatMap((outline) => outline.keyPoints)
      .filter((point) => point.startsWith('Source fact:'))
      .map((point) => point.replace(/^Source fact:\s*/u, '').replace(/\s*\[S\d+\]\s*$/u, '').trim())

    expect(facts).toHaveLength(10)
    expect(new Set(facts).size).toBeGreaterThanOrEqual(9)
    expect(facts.filter((fact) => /Markdown and reviews|scheduled status|Sandboxed execution|verification record/iu.test(fact))).toHaveLength(4)
  })

  it('matches semantic decisions to the most relevant official evidence document while covering the full set', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1] Repository automation is written in Markdown and runs coding agents inside GitHub Actions.',
      '[S2] Sandboxed execution, read-only defaults, and explicit permissions protect the repository from unsafe writes.',
      '[S3] Traditional workflows execute fixed if/then steps, while agentic workflows interpret context and choose bounded actions.',
      '[S4] Customize a workflow, run the compile command, inspect the generated lock file, then commit the verified change.',
    ].join('\n\n'))
    const contract = createLearningContract({
      projectId: 'project-semantic-evidence-routing',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Build a secure, auditable repository automation workflow.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const stages = [
      'Repository automation overview',
      'Traditional versus agentic workflows',
      'Security permissions and sandbox boundaries',
      'Workflow frontmatter and trigger structure',
      'Compile a customized workflow',
      'Secure write review decision',
      'Traditional workflow misconception check',
      'Verify the generated lock file',
      'Security failure recovery',
    ]
    const semanticOutlines = stages.map((title, index) => ({
      id: `route_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title,
      description: `Use the official evidence to make the ${title.toLocaleLowerCase()} decision.`,
      keyPoints: [
        `Identify the source passage relevant to ${title.toLocaleLowerCase()}.`,
        `Record a reviewable decision for ${title.toLocaleLowerCase()}.`,
      ],
    }))
    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )
    const facts = outlines.map((outline) => outline.keyPoints.find((point) => point.startsWith('Source fact:')) ?? '')

    expect(facts[1]).toContain('Traditional workflows execute fixed if/then')
    expect(facts[2]).toContain('Sandboxed execution')
    expect(facts[4]).toContain('run the compile command')
    expect(new Set(outlines.flatMap((outline) => outline.activity?.evidenceLabels ?? [])).size).toBe(4)
  })

  it('uses prose for English trigger scenes and rejects rendered diagram or navigation fragments', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1] flowchart LR INPUT[Repository event] --> WORKFLOW[Agentic workflow]',
      'Load when: a repository maintainer opens this documentation page.',
      'Ready to get your first agentic workflow running?',
      'The workflow frontmatter declares the event trigger and establishes whether a pull request or schedule starts the run.',
      'The selected runtime receives only the repository secrets and permissions required for its task.',
      'Read-only defaults prevent an agent from applying a proposed change without an explicit approval boundary.',
      'Safe outputs preserve a reviewable patch for the maintainer instead of directly changing the protected branch.',
      'The compile command creates a lock file that records the resolved workflow instructions.',
      'A verification record links the triggering event, observed output, and the decision that accepted or rejected the run.',
      'A recovery checklist identifies the failed assumption, the rollback action, and the evidence needed before retrying.',
      'A release review confirms that the selected trigger, runtime, permissions, and evidence satisfy the team policy.',
      'The final artifact documents the workflow decision so another repository can reproduce and audit it.',
    ].join('\n\n'))
    const contract = createLearningContract({
      projectId: 'project-english-prose-filter',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Design an auditable GitHub workflow with a safe trigger and recovery path.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const semanticOutlines = Array.from({ length: 9 }, (_, index) => {
      const triggerScene = index === 2
      return {
        id: `english_prose_${index + 1}`,
        type: 'slide' as const,
        order: index + 1,
        title: triggerScene ? 'Triggering workflows – event boundaries' : `Workflow decision ${index + 1}`,
        description: triggerScene
          ? 'Explain how a trigger determines when the workflow starts.'
          : `Explain the implementation decision for stage ${index + 1}.`,
        keyPoints: [
          `Identify the source fact that changes stage ${index + 1}.`,
          `Record the reviewable decision for stage ${index + 1}.`,
        ],
        ...(triggerScene
          ? { evidenceAnchor: 'The workflow frontmatter declares the event trigger and establishes whether a pull request or schedule starts the run.' }
          : {}),
      }
    })

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )
    const facts = outlines
      .flatMap((outline) => outline.keyPoints)
      .filter((point) => point.startsWith('Source fact:'))
      .join('\n')

    expect(facts).toContain('frontmatter declares the event trigger')
    expect(facts).not.toMatch(/flowchart|load when|ready to get/iu)
  })

  it('does not turn a discovery preamble or Markdown heading into a source fact', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1] [github/gh-aw · create.md](https://raw.githubusercontent.com/github/gh-aw/main/create.md); quality=primary: # Creating Agentic Workflows',
      '',
      'Check that gh aw is installed by running gh aw version before creating a workflow.',
      '',
      'Run the compile command after editing instructions and inspect the resulting lock file before commit.',
    ].join('\n'))
    const contract = createLearningContract({
      projectId: 'project-preamble-cleanup',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Create and verify an agentic workflow safely.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })

    const outlines = instructionalPlanToOutlines(buildInstructionalPlan({ contract, evidence }))
    const learnerText = outlines.flatMap((outline) => [outline.title, outline.description, ...outline.keyPoints]).join('\n')

    expect(learnerText).not.toContain('github/gh-aw · create.md')
    expect(learnerText).not.toMatch(/^Creating Agentic Workflows\s*\[S1\]/mu)
    expect(learnerText).toContain('gh aw is installed')
  })

  it('removes MDX frontmatter and JSON-LD before choosing a quick-start source fact', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1] [Quick Start](https://example.test/quick-start.mdx); quality=primary: ---',
      'title: Quick Start',
      'head:',
      ' content: |',
      '  { "text": "This JSON payload is page metadata, not a learner fact." }',
      '---',
      '',
      '# Quick Start',
      '',
      'Install the extension, then run gh aw add-wizard to create a daily status workflow.',
      '',
      '```bash',
      'gh aw compile',
      '```',
    ].join('\n'))
    const contract = createLearningContract({
      projectId: 'project-frontmatter-cleanup',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Install, customize, and compile a verified workflow.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })

    const outlines = instructionalPlanToOutlines(buildInstructionalPlan({ contract, evidence }))
    const learnerText = outlines.flatMap((outline) => [outline.title, outline.description, ...outline.keyPoints]).join('\n')

    expect(learnerText).not.toContain('JSON payload')
    expect(learnerText).not.toContain('"text"')
    expect(learnerText).toContain('Install the extension')
  })

  it('keeps a specific long semantic title within the classroom release limit', () => {
    const evidence = freezeCanonicalEvidence(
      'A durable workflow records its trigger, permission decision, observed result, and recovery outcome before release.',
    )
    const contract = createLearningContract({
      projectId: 'project-title-bound',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Build a verifiable automation workflow.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const semanticOutlines = Array.from({ length: 9 }, (_, index) => ({
      id: `long_title_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title:
        index === 7
          ? 'A concrete explanation of how a workflow captures trigger, permission, output, recovery, and final release evidence without losing auditability'
          : `Workflow decision ${index + 1}`,
      description: `Use the durable workflow evidence to make and verify decision ${index + 1}.`,
      keyPoints: [
        `Identify the evidence needed for workflow decision ${index + 1}.`,
        `Explain how workflow decision ${index + 1} affects verification.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )

    expect(outlines[7]?.title.length).toBeLessThanOrEqual(72)
    expect(outlines[7]?.title).toContain('concrete explanation')
    expect(
      assessOutlineQuality(outlines).issues.filter((issue) => issue.sceneOrder === 8).map((issue) => issue.code),
    ).not.toContain('outline_title_weak')
  })

  it('repairs a generic semantic final scene with the learner transfer goal instead of publishing a template', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1]',
      'The official workflow definition records its trigger, runtime, permission decision, observed output, and recovery evidence.',
      'A secure release requires sandboxed execution, read-only defaults, and human review for proposed writes.',
      'The deployment guide gives a concrete verification command and a rollback decision for a failed run.',
    ].join('\n\n'))
    const contract = createLearningContract({
      projectId: 'project-generic-final-repair',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Build an auditable repository workflow that proves its trigger, permission, output, and recovery behavior.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const genericTitles = [
      'Learning map',
      'Starting-point check',
      'Core model',
      'Mechanism and flow',
      'Evidence and trade-off',
      'Worked example',
      'Guided decision practice',
      'Retrieval and diagnosis',
      'Synthesis and transfer',
    ]
    const semanticOutlines = genericTitles.map((title, index) => ({
      id: `generic_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title,
      description: `Use source-grounded evidence to make the implementation decision for stage ${index + 1}.`,
      keyPoints: [
        `Identify the source detail that changes the workflow decision for stage ${index + 1}.`,
        `Leave a reviewable result and verification step for stage ${index + 1}.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )

    expect(outlines.at(-1)?.title).toContain('Build an auditable repository workflow')
    expect(outlines.some((outline) => /^(?:Learning map|Synthesis and transfer)/u.test(outline.title))).toBe(false)
    const issueCodes = assessOutlineQuality(outlines).issues.map((issue) => issue.code)
    expect(issueCodes).not.toContain('outline_title_weak')
    expect(issueCodes).not.toContain('outline_coverage_foundation')
  })

  it('keeps source facts separate from learner-authored named design proposals', () => {
    const evidenceText =
      'AutoGen is a framework for creating multi-agent AI applications that can act autonomously or work alongside humans.'
    const evidence = freezeCanonicalEvidence(evidenceText)
    const contract = createLearningContract({
      projectId: 'project-proposal-boundary',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Design a verifiable multi-agent appointment workflow from the repository evidence.',
      now: new Date('2026-08-03T00:00:00.000Z'),
    })
    const semanticStages = [
      'Map the prerequisite: which appointment decision needs multiple specialized agents?',
      'Diagnose the starting point: where would a handoff lose patient intent?',
      'Explain the core delegation boundary between a coordinator and a specialist role.',
      'Trace the workflow from intent intake through a verified appointment outcome.',
      'Compare evidence needed before a calendar update may be accepted.',
      'Walk through a concrete appointment change and identify the safe next action.',
      'Choose a response when a proposed tool reports an unavailable time slot.',
      'Retrieve the fault-isolation rule without prompts and name one misconception.',
      'Synthesize the evidence and transfer it into a verifiable workflow design artifact.',
    ]
    const semanticOutlines = semanticStages.map((stage, index) => ({
      id: `proposal_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title: `Appointment workflow decision ${index + 1}`,
      description: stage,
      keyPoints: [
        `Coordinator is a learner-proposed role for stage ${index + 1}, not a repository fact.`,
        `CalendarAPI is a learner-proposed boundary for stage ${index + 1} and needs independent verification.`,
        `AuditLogger is a learner-proposed review aid for stage ${index + 1}.`,
      ],
    }))

    const plan = buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines })
    const outlines = instructionalPlanToOutlines(plan)
    const learnerText = outlines
      .map((outline) => `${outline.description}\n${outline.keyPoints.join('\n')}`)
      .join('\n')

    expect(outlines.every((outline) => outline.description.includes('[S1]'))).toBe(true)
    const semanticQuality = combineQualityAssessments(
      assessOutlineQuality(outlines),
      assessOutlineEvidenceIntegrity(`[S1] ${evidenceText}`, outlines),
    )
    const citedKeyPoints = outlines.flatMap((outline) => outline.keyPoints).filter((point) => point.includes('[S'))
    expect(citedKeyPoints.length).toBeGreaterThanOrEqual(outlines.length * 3)
    expect(learnerText).toContain('Design proposal')
    expect(outlines.at(-1)?.description).toMatch(/Synthesize.*transfer/iu)
    expect(semanticQuality).toMatchObject({ passed: true })
    expect(findUnsupportedNamedEvidenceTerms(`[S1] ${evidenceText}`, learnerText)).toEqual([])
  })

  it('requires a concrete visible learner output at every stage and a testable final repository artifact', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1]',
      'The workflow frontmatter defines the event trigger, minimum permissions, configured tools, and runtime, while the Markdown body carries the natural language task description that the selected engine executes.',
      'A safe release records the observed output, the verification command or run, and the recovery decision when the result does not satisfy policy.',
      'Human approval is required before a proposed write can be accepted by the protected repository.',
    ].join('\n\n'))
    const contract = createLearningContract({
      projectId: 'project-visible-output-contract',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Create a source-grounded repository workflow that is safe to verify and recover.',
      now: new Date('2026-08-04T00:00:00.000Z'),
    })
    const semanticOutlines = Array.from({ length: 9 }, (_, index) => ({
      id: `visible_output_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title: `Workflow decision ${index + 1}`,
      description: `Make and verify workflow decision ${index + 1} from the official source evidence.`,
      keyPoints: [
        `Identify the source detail needed for workflow decision ${index + 1}.`,
        `Record the concrete result for workflow decision ${index + 1}.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )
    const sourceFacts = outlines
      .flatMap((outline) => outline.keyPoints)
      .filter((point) => point.startsWith('Source fact:'))
      .join('\n')

    expect(outlines.every((outline) => outline.description.includes('Visible output:'))).toBe(true)
    expect(outlines.every((outline) => !outline.description.includes('Leave a reviewable decision'))).toBe(true)
    expect(outlines.every((outline) => outline.keyPoints.some((point) => point.includes('Output:')))).toBe(true)
    expect(outlines.at(-1)?.description).toContain('minimum permissions')
    expect(outlines.at(-1)?.description).toContain('executable verification step')
    expect(sourceFacts).toContain('natural language task description')
    expect(sourceFacts).not.toContain('task descr\n')
  })

  it('selects complete explanatory prose instead of code comments or callout fragments', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1]',
      'Install the extension with gh extension install github/gh-aw before adding a workflow to the repository.',
      'The interactive wizard records the selected engine and required secret before it creates the workflow file.',
      'The compiled lock file is the verification target for the team review.',
      '',
      '```text',
      '# default — wizard will ask you to choose an engine interactively',
      'gh aw add-wizard githubnext/agentics/daily-repo-status',
      '# pre-select Claude and skip the interactive engine prompt',
      'gh aw add-wizard githubnext/agentics/daily-repo-status --engine claude',
      '```',
    ].join('\n'))
    const contract = createLearningContract({
      projectId: 'project-code-fragment-filter',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Install and verify an auditable GitHub workflow.',
      now: new Date('2026-08-04T00:00:00.000Z'),
    })
    const semanticOutlines = Array.from({ length: 9 }, (_, index) => ({
      id: `code_fragment_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title: index === 0 ? 'Install the extension safely' : `Workflow decision ${index + 1}`,
      description: index === 0
        ? 'Explain why the extension installation precedes repository workflow setup.'
        : `Explain workflow decision ${index + 1} from the source evidence.`,
      keyPoints: [
        `Identify the source evidence for workflow decision ${index + 1}.`,
        `Record the visible result for workflow decision ${index + 1}.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )
    const sourceFacts = outlines
      .flatMap((outline) => outline.keyPoints)
      .filter((point) => point.startsWith('Source fact:'))
      .join('\n')

    expect(sourceFacts).toContain('Install the extension with gh extension install')
    expect(sourceFacts).not.toMatch(/default\s*[—-]|pre-select|skip the interactive engine/iu)
  })

  it('routes structure, security, and setup scenes to their most specific source documents', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1] GitHub Agentic Workflows runs AI coding agents inside GitHub Actions. Use it with caution, and at your own risk.',
      '[S2] The security architecture uses sandbox isolation, a network firewall, an API proxy, an MCP gateway, and SafeOutputs to constrain unsafe behavior.',
      '[S3] The workflow frontmatter defines triggers, permissions, and tools, while Markdown instructions define the task executed by the configured engine.',
      '[S4] Install the extension, choose an engine, configure its secret, add a sample workflow, and run the generated workflow from a repository.',
    ].join('\n\n'))
    const contract = createLearningContract({
      projectId: 'project-source-routing',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Build a secure, source-grounded GitHub workflow.',
      now: new Date('2026-08-04T00:00:00.000Z'),
    })
    const titles = [
      'What agentic workflows do',
      'Defense-in-depth security boundaries',
      'Workflow frontmatter: triggers, permissions, and tools',
      'Install the extension and choose an engine',
      'Compare two trigger choices',
      'Verify the generated workflow',
      'Handle a permissions failure',
      'Recall the SafeOutputs boundary',
      'Transfer the design to a team workflow',
    ]
    const semanticOutlines = titles.map((title, index) => ({
      id: `route_specific_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title,
      description: `Use the official evidence to make the ${title.toLocaleLowerCase()} decision.`,
      keyPoints: [
        `Identify the source evidence relevant to ${title.toLocaleLowerCase()}.`,
        `Record the visible result for ${title.toLocaleLowerCase()}.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )

    expect(outlines[1]?.activity?.evidenceLabels).toEqual(['S2'])
    expect(outlines[2]?.activity?.evidenceLabels).toEqual(['S3'])
    expect(outlines[3]?.activity?.evidenceLabels).toEqual(['S4'])
    expect(outlines.flatMap((outline) => outline.keyPoints).join('\n')).not.toContain('Use it with caution')
  })

  it('keeps CLI and recovery lessons on their matching official documents', () => {
    const evidence = freezeCanonicalEvidence([
      '[S1] [README](https://github.com/github/gh-aw/blob/main/README.md): GitHub Agentic Workflows lets teams write repository automation in Markdown.',
      '[S2] [Architecture](https://github.com/github/gh-aw/blob/main/docs/src/content/docs/introduction/architecture.mdx): SafeOutputs and sandbox isolation constrain external writes.',
      '[S3] [How they work](https://github.com/github/gh-aw/blob/main/docs/src/content/docs/introduction/how-they-work.mdx): Frontmatter defines triggers, permissions, and tools.',
      '[S4] [Quick start](https://github.com/github/gh-aw/blob/main/docs/src/content/docs/setup/quick-start.mdx): Install the extension and create a first workflow.',
      '[S5] [CLI](https://github.com/github/gh-aw/blob/main/docs/src/content/docs/setup/cli.md): Run gh aw init, gh aw add, gh aw compile, gh aw run, and gh aw logs to manage a workflow.',
      '[S6] [Common issues](https://github.com/github/gh-aw/blob/main/docs/src/content/docs/troubleshooting/common-issues.md): When compile fails, inspect the error, correct the invalid frontmatter, and rerun the command.',
    ].join('\n\n'))
    const contract = createLearningContract({
      projectId: 'project-cli-recovery-routing',
      sourceMode: 'external',
      objectType: 'repository',
      goal: 'Build, verify, and recover an auditable GitHub workflow.',
      now: new Date('2026-08-04T00:00:00.000Z'),
    })
    const titles = [
      'What agentic workflows do',
      'Agentic versus traditional workflows',
      'Workflow architecture',
      'Workflow frontmatter',
      'First workflow quick start',
      'Compilation, verification, and audit',
      'Pick your AI engine',
      'Knowledge check',
      'Recovering from failures',
      'Deliver a transferred workflow',
    ]
    const semanticOutlines = titles.map((title, index) => ({
      id: `cli_recovery_${index + 1}`,
      type: 'slide' as const,
      order: index + 1,
      title,
      description:
        title === 'Workflow frontmatter'
          ? 'Make the workflow frontmatter decision, including trigger, permissions, tools, and engine selection, from source evidence.'
          : `Make the ${title.toLocaleLowerCase()} decision from source evidence.`,
      keyPoints: [
        `Identify the evidence relevant to ${title.toLocaleLowerCase()}.`,
        `Record an observable result for ${title.toLocaleLowerCase()}.`,
      ],
    }))

    const outlines = instructionalPlanToOutlines(
      buildSemanticInstructionalPlan({ contract, evidence, semanticOutlines }),
    )
    const cli = outlines[5]
    const recovery = outlines[8]
    const transfer = outlines[9]

    expect(outlines[0]?.activity?.evidenceLabels).toEqual(['S1'])
    expect(outlines[1]?.activity?.evidenceLabels).toEqual(['S1'])
    expect(outlines[2]?.activity?.evidenceLabels).toEqual(['S2'])
    expect(outlines[3]?.activity?.evidenceLabels).toEqual(['S3'])
    expect(outlines[4]?.activity?.evidenceLabels).toEqual(['S4'])
    expect(cli?.activity?.evidenceLabels).toEqual(['S5'])
    expect(cli?.keyPoints.join('\n')).toContain('gh aw init')
    expect(outlines[6]?.activity?.evidenceLabels).toEqual(['S4'])
    expect(recovery?.activity?.evidenceLabels).toEqual(['S6'])
    expect(recovery?.keyPoints.join('\n')).toContain('compile fails')
    expect(transfer?.activity?.evidenceLabels).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
  })
})
