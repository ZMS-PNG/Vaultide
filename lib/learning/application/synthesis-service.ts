import { createHash, randomUUID } from 'node:crypto';
import type { LearningProgressRepository } from '../ports/learning-progress-repository';
import type { SynthesisRepository } from '../ports/synthesis-repository';
import {
  asPersistedKnowledgeGraph,
  buildTrustedKnowledgeSpace,
  buildTrustedSynthesisFilterOptions,
  selectTrustedKnowledgeSnapshots,
  trustedSynthesisEvidenceManifest,
  type TrustedKnowledgeSnapshotInput,
} from '../domain/knowledge-space-synthesis';
import type { KnowledgeSpaceEvidenceRepository } from '../ports/knowledge-space-evidence-repository';
import {
  diffSynthesisGraphs,
  nextSynthesisScheduleRunAt,
  synthesisScopeHash,
} from '../domain/synthesis-schedule';
import { renderSynthesisIndex, synthesisIndexDraftBlocks } from '../domain/synthesis-index';
import type {
  SynthesisDelta,
  SynthesisFilterOptions,
  SynthesisListItem,
  SynthesisRequest,
  SynthesisRunRecord,
  SynthesisRunView,
  SynthesisSchedulePeriod,
  SynthesisScheduleRecord,
  SynthesisScheduleStatus,
  SynthesisScope,
} from '../domain/synthesis';
import type { WritebackDraftView } from '../domain/learning-progress';
import type { KnowledgeGraphRefreshChange } from '../domain/knowledge-graph-refresh';

function identifier(prefix: 'syn' | 'wbd' | 'sch' | 'ssr' | 'sdx'): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function pathSegment(value: string): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/\.{2,}/g, '.')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 80) || '知识归纳'
  );
}

function projectDirectory(projectId: string, projectName?: string): string {
  return `${pathSegment(projectName ?? '未命名项目')}--${projectId.slice(-8)}`;
}

const SYNTHESIS_WRITEBACK_FRONTMATTER_KEYS = new Set([
  'maic_synthesis_schema',
  'maic_knowledge_space_schema',
  'maic_generated_at',
  'maic_verified_snapshot_count',
  'maic_incremental',
]);

type SynthesisWritebackFrontmatter = Record<string, string | number | boolean>;

/**
 * Trusted synthesis reports carry a small machine-readable YAML header. A
 * managed Obsidian note must have exactly one YAML header, so move only those
 * known scalar fields into the writeback command's allowlisted frontmatter.
 * Any unknown or malformed header is preserved as body text instead of being
 * silently promoted into Obsidian properties.
 */
function splitSynthesisWritebackMarkdown(markdown: string): {
  content: string;
  frontmatter: SynthesisWritebackFrontmatter;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { content: markdown, frontmatter: {} };

  const frontmatter: SynthesisWritebackFrontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!entry || !SYNTHESIS_WRITEBACK_FRONTMATTER_KEYS.has(entry[1])) {
      return { content: markdown, frontmatter: {} };
    }
    const rawValue = entry[2];
    if (rawValue === 'true' || rawValue === 'false') {
      frontmatter[entry[1]] = rawValue === 'true';
    } else if (/^-?\d+(?:\.\d+)?$/.test(rawValue)) {
      frontmatter[entry[1]] = Number(rawValue);
    } else if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      frontmatter[entry[1]] = rawValue.slice(1, -1);
    } else {
      frontmatter[entry[1]] = rawValue;
    }
  }

  return {
    content: markdown.slice(match[0].length).replace(/^\s+/, ''),
    frontmatter,
  };
}

function uniqueClassroomCount(snapshots: readonly TrustedKnowledgeSnapshotInput[]): number {
  return new Set(
    snapshots.map((snapshot) => snapshot.classroomId ?? `snapshot:${snapshot.snapshotId}`),
  ).size;
}

function runView(run: SynthesisRunRecord): SynthesisRunView {
  return {
    id: run.id,
    ...(run.scheduleId ? { scheduleId: run.scheduleId } : {}),
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.projectName ? { projectName: run.projectName } : {}),
    mode: run.mode,
    title: run.title,
    scope: run.scope,
    summaryMarkdown: run.summaryMarkdown,
    graph: run.graph,
    graphHash: run.graphHash,
    classroomCount: run.classroomCount,
    ...(run.baselineSynthesisId ? { baselineSynthesisId: run.baselineSynthesisId } : {}),
    incremental: run.incremental,
    evidenceManifest: run.evidenceManifest,
    ...(run.delta ? { delta: run.delta } : {}),
    taskCandidates: run.taskCandidates,
    nodeCount: run.graph.nodes.length,
    edgeCount: run.graph.edges.length,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function listItem(run: SynthesisRunRecord): SynthesisListItem {
  const view = runView(run);
  return {
    id: view.id,
    ...(view.projectId ? { projectId: view.projectId } : {}),
    ...(view.projectName ? { projectName: view.projectName } : {}),
    mode: view.mode,
    title: view.title,
    classroomCount: view.classroomCount,
    nodeCount: view.nodeCount,
    edgeCount: view.edgeCount,
    createdAt: view.createdAt,
  };
}

export class SynthesisServiceError extends Error {
  constructor(
    readonly code: 'invalid_request' | 'conflict' | 'dependency_unavailable',
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SynthesisServiceError';
  }
}

export interface SynthesisServiceOptions {
  ownerId: string;
  repository: SynthesisRepository;
  knowledgeSpaceEvidenceRepository: KnowledgeSpaceEvidenceRepository;
  learningProgressRepository: LearningProgressRepository;
  approveWritebackDraft?: (draftId: string, revision: number) => Promise<unknown>;
  onKnowledgeChanged?: (change: KnowledgeGraphRefreshChange) => Promise<void>;
  now?: () => Date;
}

export interface CreateSynthesisScheduleRequest {
  name: string;
  period: SynthesisSchedulePeriod;
  intervalMinutes?: number;
  timezone?: string;
  mode: SynthesisRequest['mode'];
  scope: SynthesisScope;
}

export interface UpdateSynthesisScheduleRequest {
  name?: string;
  period?: SynthesisSchedulePeriod;
  intervalMinutes?: number;
  timezone?: string;
  mode?: SynthesisRequest['mode'];
  scope?: SynthesisScope;
  status?: SynthesisScheduleStatus;
}

export interface RunDueSynthesesResult {
  attempted: number;
  succeeded: number;
  skipped: number;
  failed: number;
  writebackDrafted: number;
  synthesisIndexUpdatesQueued: number;
  writebackFailed: number;
  syntheses: SynthesisRunView[];
}

export class SynthesisService {
  private readonly now: () => Date;

  constructor(private readonly options: SynthesisServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private async loadTrustedSnapshotInputs(): Promise<TrustedKnowledgeSnapshotInput[]> {
    try {
      return await this.options.knowledgeSpaceEvidenceRepository.listKnowledgeSnapshots(
        this.options.ownerId,
      );
    } catch (error) {
      throw new SynthesisServiceError(
        'dependency_unavailable',
        503,
        error instanceof Error
          ? `Verified knowledge snapshots could not be loaded: ${error.message}`
          : 'Verified knowledge snapshots could not be loaded.',
      );
    }
  }

  private selectTrustedSnapshots(
    inputs: readonly TrustedKnowledgeSnapshotInput[],
    request: SynthesisRequest,
  ): TrustedKnowledgeSnapshotInput[] {
    try {
      return selectTrustedKnowledgeSnapshots(inputs, request).selected;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('trusted_synthesis_scope_too_broad:')
      ) {
        throw new SynthesisServiceError(
          'conflict',
          409,
          'The synthesis scope contains more than 50 verified snapshots. Narrow it by time, project, board, or classroom so no evidence is silently truncated.',
        );
      }
      throw error;
    }
  }

  private scopeFromRequest(request: SynthesisRequest): SynthesisScope {
    return {
      ...(request.question ? { question: request.question } : {}),
      ...(request.timeFrom ? { timeFrom: request.timeFrom } : {}),
      ...(request.timeTo ? { timeTo: request.timeTo } : {}),
      ...(request.domainQuery ? { domainQuery: request.domainQuery } : {}),
      ...(request.domain ? { domain: request.domain } : {}),
      ...(request.sourceType ? { sourceType: request.sourceType } : {}),
      ...(request.topicTags?.length ? { topicTags: request.topicTags } : {}),
      ...(request.projectIds?.length ? { projectIds: request.projectIds } : {}),
      ...(request.classroomIds?.length ? { classroomIds: request.classroomIds } : {}),
    };
  }

  private async saveSynthesisRun(
    request: SynthesisRequest,
    selected: readonly TrustedKnowledgeSnapshotInput[],
    options: {
      schedule?: SynthesisScheduleRecord;
      baseline?: SynthesisRunRecord;
      incremental?: boolean;
      titlePrefix?: string;
    } = {},
  ): Promise<SynthesisRunRecord> {
    const now = this.now();
    const id = identifier('syn');
    const modeLabel =
      request.mode === 'timeline'
        ? '时间线'
        : request.mode === 'domain'
          ? '知识板块'
          : '时间线 × 知识板块 × 项目';
    const title = options.schedule
      ? `Vaultide 周期归纳｜${options.schedule.name}｜${now.toISOString().slice(0, 10)}`
      : request.question
        ? `知洄问题归纳｜${request.question.slice(0, 48)}｜${now.toISOString().slice(0, 10)}`
        : `${options.titlePrefix ?? '知洄可信知识归纳'}｜${modeLabel}｜${now.toISOString().slice(0, 10)}`;
    const built = buildTrustedKnowledgeSpace({
      snapshots: selected,
      request,
      title,
      now,
      incremental: options.incremental ?? false,
    });
    const graph = asPersistedKnowledgeGraph(built.graph);
    const evidenceManifest = built.evidenceManifest;
    const delta = diffSynthesisGraphs({
      current: graph,
      ...(options.baseline ? { baseline: options.baseline.graph } : {}),
      ...(options.baseline ? { baselineSynthesisId: options.baseline.id } : {}),
      currentEvidence: evidenceManifest,
      ...(options.baseline ? { baselineEvidence: options.baseline.evidenceManifest } : {}),
    });
    const selectedProjects = new Map(
      built.selectedSnapshots
        .filter(
          (item): item is TrustedKnowledgeSnapshotInput & { projectId: string } =>
            typeof item.projectId === 'string',
        )
        .map((item) => [item.projectId, item.projectName]),
    );
    const project =
      selectedProjects.size === 1
        ? {
            projectId: selectedProjects.keys().next().value as string,
            projectName: selectedProjects.values().next().value,
          }
        : undefined;
    const saved = await this.options.repository.save({
      id,
      ownerId: this.options.ownerId,
      ...(options.schedule ? { scheduleId: options.schedule.id } : {}),
      ...(project ? project : {}),
      mode: request.mode,
      title,
      scope: this.scopeFromRequest(request),
      summaryMarkdown: built.markdown,
      graph,
      graphHash: sha256(JSON.stringify(graph)),
      classroomCount: uniqueClassroomCount(built.selectedSnapshots),
      ...(options.baseline ? { baselineSynthesisId: options.baseline.id } : {}),
      incremental: options.incremental ?? false,
      evidenceManifest,
      delta,
      taskCandidates: built.taskCandidates,
      createdAt: now,
      updatedAt: now,
    });
    if (this.options.onKnowledgeChanged) {
      try {
        await this.options.onKnowledgeChanged({
          triggerKind: 'synthesis',
          triggerId: saved.id,
          synthesisId: saved.id,
          ...(saved.projectId ? { projectId: saved.projectId } : {}),
        });
      } catch (error) {
        console.warn('Synthesis was saved but its knowledge graph projection was deferred.', {
          synthesisId: saved.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return saved;
  }

  async generate(request: SynthesisRequest): Promise<SynthesisRunView> {
    const inputs = await this.loadTrustedSnapshotInputs();
    const selected = this.selectTrustedSnapshots(inputs, request);
    if (selected.length === 0) {
      throw new SynthesisServiceError(
        'conflict',
        409,
        'No traceable, system-verified knowledge snapshots matched this synthesis scope.',
      );
    }
    return runView(await this.saveSynthesisRun(request, inputs));
  }

  async get(synthesisId: string): Promise<SynthesisRunView> {
    const run = await this.options.repository.find(this.options.ownerId, synthesisId);
    if (!run) throw new SynthesisServiceError('invalid_request', 404, 'Synthesis was not found.');
    return runView(run);
  }

  async list(limit = 20): Promise<SynthesisListItem[]> {
    const bounded = Math.max(1, Math.min(50, Math.trunc(limit)));
    return (await this.options.repository.list(this.options.ownerId, bounded)).map(listItem);
  }

  async filterOptions(): Promise<SynthesisFilterOptions> {
    return buildTrustedSynthesisFilterOptions(await this.loadTrustedSnapshotInputs());
  }

  private validatedTimezone(value: string): string {
    const timezone = value.trim() || 'UTC';
    if (timezone.length > 80) {
      throw new SynthesisServiceError('invalid_request', 400, 'Schedule timezone is invalid.');
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(this.now());
    } catch {
      throw new SynthesisServiceError('invalid_request', 400, 'Schedule timezone is invalid.');
    }
    return timezone;
  }

  private normalizedScheduleFields(
    input: CreateSynthesisScheduleRequest | UpdateSynthesisScheduleRequest,
    existing?: SynthesisScheduleRecord,
  ): {
    name: string;
    period: SynthesisSchedulePeriod;
    intervalMinutes?: number;
    timezone: string;
    mode: SynthesisRequest['mode'];
    scope: SynthesisScope;
    status: SynthesisScheduleStatus;
  } {
    const name = (input.name ?? existing?.name ?? '').trim().slice(0, 160);
    if (!name)
      throw new SynthesisServiceError('invalid_request', 400, 'Schedule name is required.');
    const period = input.period ?? existing?.period;
    if (!period || !['daily', 'weekly', 'monthly', 'custom'].includes(period)) {
      throw new SynthesisServiceError('invalid_request', 400, 'Schedule period is invalid.');
    }
    const interval = input.intervalMinutes ?? existing?.intervalMinutes;
    if (
      period === 'custom' &&
      (!Number.isInteger(interval) || (interval ?? 0) < 15 || (interval ?? 0) > 525600)
    ) {
      throw new SynthesisServiceError(
        'invalid_request',
        400,
        'Custom schedule interval must be between 15 minutes and one year.',
      );
    }
    const mode = input.mode ?? existing?.mode;
    if (!mode || !['timeline', 'domain', 'combined'].includes(mode)) {
      throw new SynthesisServiceError('invalid_request', 400, 'Schedule mode is invalid.');
    }
    const scope = input.scope ?? existing?.scope ?? {};
    return {
      name,
      period,
      ...(period === 'custom' ? { intervalMinutes: interval as number } : {}),
      timezone: this.validatedTimezone(input.timezone ?? existing?.timezone ?? 'UTC'),
      mode,
      scope,
      status: ('status' in input ? input.status : undefined) ?? existing?.status ?? 'active',
    };
  }

  private requestForSchedule(schedule: SynthesisScheduleRecord): SynthesisRequest {
    return { mode: schedule.mode, ...schedule.scope } as SynthesisRequest;
  }

  private nextRunAt(schedule: SynthesisScheduleRecord, now: Date): Date {
    let next = nextSynthesisScheduleRunAt(
      schedule.nextRunAt,
      schedule.period,
      schedule.intervalMinutes,
    );
    // A dormant browser or cron wake-up must not execute every missed period
    // in a burst. One fresh run represents the current durable state.
    for (let guard = 0; next.getTime() <= now.getTime() && guard < 600; guard += 1) {
      next = nextSynthesisScheduleRunAt(next, schedule.period, schedule.intervalMinutes);
    }
    return next;
  }

  async createSchedule(input: CreateSynthesisScheduleRequest): Promise<SynthesisScheduleRecord> {
    const fields = this.normalizedScheduleFields(input);
    const now = this.now();
    return this.options.repository.createSchedule({
      id: identifier('sch'),
      ownerId: this.options.ownerId,
      name: fields.name,
      period: fields.period,
      ...(fields.intervalMinutes ? { intervalMinutes: fields.intervalMinutes } : {}),
      timezone: fields.timezone,
      mode: fields.mode,
      scope: fields.scope,
      scopeHash: synthesisScopeHash(fields.mode, fields.scope),
      // The first execution is deliberately due immediately, but still only
      // happens when the user opens the knowledge area or invokes run-due.
      nextRunAt: now,
      now,
    });
  }

  async listSchedules(limit = 50): Promise<SynthesisScheduleRecord[]> {
    return this.options.repository.listSchedules(
      this.options.ownerId,
      Math.max(1, Math.min(100, Math.trunc(limit))),
    );
  }

  async updateSchedule(
    scheduleId: string,
    patch: UpdateSynthesisScheduleRequest,
  ): Promise<SynthesisScheduleRecord> {
    if (!/^sch_[a-f0-9]{32}$/.test(scheduleId)) {
      throw new SynthesisServiceError('invalid_request', 400, 'Schedule id is invalid.');
    }
    const existing = await this.options.repository.findSchedule(this.options.ownerId, scheduleId);
    if (!existing)
      throw new SynthesisServiceError('invalid_request', 404, 'Schedule was not found.');
    const fields = this.normalizedScheduleFields(patch, existing);
    const now = this.now();
    const shouldRunNow = existing.status === 'paused' && fields.status === 'active';
    const updated = await this.options.repository.updateSchedule({
      ownerId: this.options.ownerId,
      scheduleId,
      name: fields.name,
      period: fields.period,
      ...(fields.intervalMinutes ? { intervalMinutes: fields.intervalMinutes } : {}),
      timezone: fields.timezone,
      mode: fields.mode,
      scope: fields.scope,
      scopeHash: synthesisScopeHash(fields.mode, fields.scope),
      status: fields.status,
      nextRunAt: shouldRunNow ? now : existing.nextRunAt,
      now,
    });
    if (!updated)
      throw new SynthesisServiceError('conflict', 409, 'Schedule could not be updated.');
    return updated;
  }

  async diff(synthesisId: string, baselineId: string): Promise<SynthesisDelta> {
    const [current, baseline] = await Promise.all([
      this.options.repository.find(this.options.ownerId, synthesisId),
      this.options.repository.find(this.options.ownerId, baselineId),
    ]);
    if (!current || !baseline) {
      throw new SynthesisServiceError('invalid_request', 404, 'Synthesis snapshot was not found.');
    }
    return diffSynthesisGraphs({
      current: current.graph,
      baseline: baseline.graph,
      baselineSynthesisId: baseline.id,
      currentEvidence: current.evidenceManifest,
      baselineEvidence: baseline.evidenceManifest,
    });
  }

  async runDueSchedules(limit = 10): Promise<RunDueSynthesesResult> {
    const now = this.now();
    const schedules = await this.options.repository.listDueSchedules(
      this.options.ownerId,
      now,
      Math.max(1, Math.min(20, Math.trunc(limit))),
    );
    const result: RunDueSynthesesResult = {
      attempted: 0,
      succeeded: 0,
      skipped: 0,
      failed: 0,
      writebackDrafted: 0,
      synthesisIndexUpdatesQueued: 0,
      writebackFailed: 0,
      syntheses: [],
    };
    const inputs = await this.loadTrustedSnapshotInputs();
    for (const schedule of schedules) {
      const claimed = await this.options.repository.claimScheduleRun({
        id: identifier('ssr'),
        ownerId: this.options.ownerId,
        scheduleId: schedule.id,
        scheduledFor: schedule.nextRunAt,
        now,
      });
      if (!claimed) continue;
      result.attempted += 1;
      let baseline: SynthesisRunRecord | null = null;
      try {
        baseline = schedule.lastSynthesisId
          ? await this.options.repository.find(this.options.ownerId, schedule.lastSynthesisId)
          : null;
        const request = this.requestForSchedule(schedule);
        const selected = this.selectTrustedSnapshots(inputs, request);
        if (selected.length === 0) {
          throw new SynthesisServiceError(
            'conflict',
            409,
            'No traceable, system-verified knowledge snapshots currently match this scheduled synthesis scope.',
          );
        }
        const manifest = trustedSynthesisEvidenceManifest(selected);
        const nextRunAt = this.nextRunAt(schedule, now);
        const evidenceUnchanged =
          baseline !== null &&
          sha256(JSON.stringify(manifest)) === sha256(JSON.stringify(baseline.evidenceManifest));
        if (evidenceUnchanged && baseline) {
          await this.options.repository.completeScheduleRun({
            ownerId: this.options.ownerId,
            schedule,
            runId: claimed.id,
            state: 'skipped',
            baselineSynthesisId: baseline.id,
            evidenceManifest: manifest,
            nextRunAt,
            now,
          });
          result.skipped += 1;
          continue;
        }
        const saved = await this.saveSynthesisRun(request, inputs, {
          schedule,
          ...(baseline ? { baseline } : {}),
          incremental: true,
        });
        await this.options.repository.completeScheduleRun({
          ownerId: this.options.ownerId,
          schedule,
          runId: claimed.id,
          state: 'succeeded',
          synthesisId: saved.id,
          ...(baseline ? { baselineSynthesisId: baseline.id } : {}),
          evidenceManifest: saved.evidenceManifest,
          nextRunAt,
          now,
        });
        result.succeeded += 1;
        result.syntheses.push(runView(saved));
        await this.queueScheduledWritebacks(schedule, saved, result);
      } catch (error) {
        await this.options.repository.completeScheduleRun({
          ownerId: this.options.ownerId,
          schedule,
          runId: claimed.id,
          state: 'failed',
          ...(baseline ? { baselineSynthesisId: baseline.id } : {}),
          evidenceManifest: [],
          errorDetail: (error instanceof Error
            ? error.message
            : 'Scheduled synthesis failed.'
          ).slice(0, 2000),
          now,
        });
        result.failed += 1;
      }
    }
    return result;
  }

  private async queueScheduledWritebacks(
    schedule: SynthesisScheduleRecord,
    run: SynthesisRunRecord,
    result: RunDueSynthesesResult,
  ): Promise<void> {
    // Every immutable synthesis snapshot remains a manual decision. Creating
    // the draft here merely makes the new result visible in the review queue.
    try {
      await this.createWritebackDraft(run.id);
      result.writebackDrafted += 1;
    } catch {
      result.writebackFailed += 1;
    }

    try {
      const indexDraft = await this.createSynthesisIndexDraft(schedule.id);
      result.writebackDrafted += 1;
      const policy = await this.options.learningProgressRepository.getDepositionPolicy(
        this.options.ownerId,
      );
      const canQueueManagedIndexUpdate =
        indexDraft.operation === 'replaceSynthesisIndexBlocks' &&
        (indexDraft.status === 'generated' || indexDraft.status === 'edited') &&
        policy.mode === 'managed-auto' &&
        policy.managedAutoEnabled &&
        policy.allowSynthesisIndexUpdates &&
        Boolean(this.options.approveWritebackDraft);
      if (canQueueManagedIndexUpdate) {
        await this.options.approveWritebackDraft?.(indexDraft.id, indexDraft.revision);
        result.synthesisIndexUpdatesQueued += 1;
      }
    } catch {
      result.writebackFailed += 1;
    }
  }

  /**
   * Draft the one mutable overview belonging to this schedule and the active
   * Vault. The periodic snapshots themselves are separate immutable notes;
   * this document only aggregates links, deltas, and user-approved task
   * candidates inside explicitly marked Vaultide blocks.
   */
  async createSynthesisIndexDraft(scheduleId: string): Promise<WritebackDraftView> {
    if (!/^sch_[a-f0-9]{32}$/.test(scheduleId)) {
      throw new SynthesisServiceError('invalid_request', 400, 'Schedule id is invalid.');
    }
    const schedule = await this.options.repository.findSchedule(this.options.ownerId, scheduleId);
    if (!schedule) {
      throw new SynthesisServiceError('invalid_request', 404, 'Synthesis schedule was not found.');
    }
    const target = await this.options.learningProgressRepository.findWritebackTarget(
      this.options.ownerId,
    );
    if (!target) {
      throw new SynthesisServiceError(
        'conflict',
        409,
        'No active paired Obsidian Vault is available for synthesis-index writeback.',
      );
    }
    const now = this.now();
    const snapshots = await this.options.repository.listBySchedule(
      this.options.ownerId,
      schedule.id,
      100,
    );
    const synthesisIndexId = identifier('sdx');
    const provisional = renderSynthesisIndex({
      synthesisIndexId,
      schedule,
      snapshots,
      now,
    });
    const document = await this.options.learningProgressRepository.findOrCreateSynthesisIndex({
      id: synthesisIndexId,
      ownerId: this.options.ownerId,
      scheduleId: schedule.id,
      vaultBindingId: target.vaultBindingId,
      relativePath: provisional.relativePath,
      initialManagedBlocks: provisional.managedBlocks,
      now,
    });
    const rendered = renderSynthesisIndex({
      synthesisIndexId: document.id,
      schedule,
      snapshots,
      now,
    });
    let managedBlocks;
    try {
      managedBlocks = synthesisIndexDraftBlocks(rendered.managedBlocks, document);
    } catch (error) {
      throw new SynthesisServiceError(
        'conflict',
        409,
        error instanceof Error ? error.message : 'Synthesis index needs manual review.',
      );
    }
    const existing = await this.options.learningProgressRepository.findOpenDraftBySynthesisIndex(
      this.options.ownerId,
      document.id,
    );
    if (existing) {
      return {
        id: existing.id,
        revision: existing.revision,
        ...(existing.synthesisRunId ? { synthesisRunId: existing.synthesisRunId } : {}),
        draftKind: existing.draftKind,
        targetVaultName: target.vaultName,
        operation: existing.operation,
        relativePath: existing.relativePath,
        content: existing.content,
        status: existing.status,
      };
    }
    const created = await this.options.learningProgressRepository.createDraft({
      id: identifier('wbd'),
      ownerId: this.options.ownerId,
      draftKind: 'synthesis-index',
      synthesisIndexId: document.id,
      targetDeviceId: target.deviceId,
      targetVaultBindingId: target.vaultBindingId,
      operation: document.lastContentHash ? 'replaceSynthesisIndexBlocks' : 'createManagedNote',
      managedBlocks,
      relativePath: document.relativePath,
      content: rendered.content,
      frontmatter: rendered.frontmatter,
      now,
    });
    return {
      id: created.id,
      revision: created.revision,
      draftKind: created.draftKind,
      targetVaultName: target.vaultName,
      operation: created.operation,
      relativePath: created.relativePath,
      content: created.content,
      status: created.status,
    };
  }

  async createWritebackDraft(synthesisId: string): Promise<WritebackDraftView> {
    const run = await this.options.repository.find(this.options.ownerId, synthesisId);
    if (!run) throw new SynthesisServiceError('invalid_request', 404, 'Synthesis was not found.');
    const target = await this.options.learningProgressRepository.findWritebackTarget(
      this.options.ownerId,
    );
    if (!target) {
      throw new SynthesisServiceError(
        'conflict',
        409,
        'No active paired Obsidian Vault is available for synthesis writeback.',
      );
    }
    const now = this.now();
    const projectPath = run.projectId ? `${projectDirectory(run.projectId, run.projectName)}/` : '';
    const synthesisRoot = run.scheduleId ? 'Vaultide/归纳/周期' : 'Vaultide/归纳';
    const relativePath = `${synthesisRoot}/${projectPath}${now.toISOString().slice(0, 10)}-${pathSegment(run.title)}-${run.id}.md`;
    const writebackMarkdown = splitSynthesisWritebackMarkdown(run.summaryMarkdown);
    const created = await this.options.learningProgressRepository.createSynthesisDraft({
      id: identifier('wbd'),
      ownerId: this.options.ownerId,
      synthesisRunId: run.id,
      targetDeviceId: target.deviceId,
      targetVaultBindingId: target.vaultBindingId,
      relativePath,
      content: writebackMarkdown.content,
      frontmatter: {
        ...writebackMarkdown.frontmatter,
        maic_note_id: `synthesis-${run.id}`,
        ...(run.projectId ? { maic_project_id: run.projectId } : {}),
        ...(run.scheduleId ? { maic_synthesis_schedule_id: run.scheduleId } : {}),
        maic_status: 'synthesized',
        maic_updated_at: now.toISOString(),
        tags: ['openmaic', 'synthesis', 'knowledge-graph'],
        aliases: [run.title],
      },
      now,
    });
    return {
      id: created.id,
      revision: created.revision,
      synthesisRunId: run.id,
      draftKind: created.draftKind,
      targetVaultName: target.vaultName,
      operation: created.operation,
      relativePath: created.relativePath,
      content: created.content,
      status: created.status,
    };
  }
}
