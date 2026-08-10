import type {
  SynthesisClassroomFilterOption,
  SynthesisFilterOptions,
  SynthesisRunView,
  SynthesisScope,
} from '@/lib/learning/domain/synthesis';

export type SynthesisFreshnessStatus = 'fresh' | 'review' | 'stale' | 'historical';

export interface SynthesisFreshnessReport {
  status: SynthesisFreshnessStatus;
  ageDays: number;
  coveredClassroomCount: number;
  scopedClassroomCount: number;
  newClassroomCount: number;
  changedProjectCount: number;
  coverageEstimated: boolean;
}

function dateValue(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesScope(classroom: SynthesisClassroomFilterOption, scope: SynthesisScope): boolean {
  if (scope.classroomIds?.length && !scope.classroomIds.includes(classroom.classroomId)) {
    return false;
  }
  if (scope.projectIds?.length && !scope.projectIds.includes(classroom.projectId ?? '')) {
    return false;
  }
  if (scope.domain && classroom.domain !== scope.domain) return false;
  if (scope.sourceType && classroom.sourceType !== scope.sourceType) return false;
  if (
    scope.topicTags?.length &&
    !scope.topicTags.every((tag) => classroom.topicTags.includes(tag))
  ) {
    return false;
  }

  const createdAt = dateValue(classroom.createdAt);
  const timeFrom = scope.timeFrom ? dateValue(`${scope.timeFrom}T00:00:00.000Z`) : null;
  const timeTo = scope.timeTo ? dateValue(`${scope.timeTo}T23:59:59.999Z`) : null;
  if (createdAt !== null && timeFrom !== null && createdAt < timeFrom) return false;
  if (createdAt !== null && timeTo !== null && createdAt > timeTo) return false;

  if (scope.domainQuery) {
    const query = scope.domainQuery.trim().toLocaleLowerCase();
    const searchable = [classroom.title, classroom.domain, ...classroom.topicTags]
      .join(' ')
      .toLocaleLowerCase();
    if (query && !searchable.includes(query)) return false;
  }

  return true;
}

function graphClassroomProvenance(synthesis: SynthesisRunView): Set<string> {
  const candidate = synthesis.graph as unknown as {
    schemaVersion?: string;
    nodes?: Array<{ classroomId?: unknown; classroomIds?: unknown }>;
  };
  if (candidate.schemaVersion !== 'trusted-knowledge-space/1' || !Array.isArray(candidate.nodes)) {
    return new Set();
  }
  return new Set(
    candidate.nodes.flatMap((node) => {
      if (Array.isArray(node.classroomIds)) {
        return node.classroomIds.filter(
          (classroomId): classroomId is string =>
            typeof classroomId === 'string' && classroomId.length > 0,
        );
      }
      return typeof node.classroomId === 'string' && node.classroomId.length > 0
        ? [node.classroomId]
        : [];
    }),
  );
}

export function evaluateSynthesisFreshness({
  synthesis,
  filters,
  isLatest,
  now = new Date(),
}: {
  synthesis: SynthesisRunView;
  filters: SynthesisFilterOptions;
  isLatest: boolean;
  now?: Date;
}): SynthesisFreshnessReport {
  const generatedAt =
    dateValue(synthesis.updatedAt) ?? dateValue(synthesis.createdAt) ?? now.getTime();
  const ageDays = Math.max(0, Math.floor((now.getTime() - generatedAt) / 86_400_000));
  const scopedClassrooms = filters.classrooms.filter((classroom) =>
    matchesScope(classroom, synthesis.scope),
  );
  const graphClassroomIds = graphClassroomProvenance(synthesis);
  // New manifests carry the actual classroom id plus snapshotId. Older
  // manifests overloaded classroomId with a snapshot id, so graph provenance
  // is the reliable compatibility path for historical runs.
  const manifestClassroomIds = new Set(
    synthesis.evidenceManifest
      .filter(
        (evidence) => Boolean(evidence.snapshotId) || !evidence.classroomId.startsWith('ksn_'),
      )
      .map((evidence) => evidence.classroomId),
  );
  const evidenceClassroomIds =
    graphClassroomIds.size > 0 ? graphClassroomIds : manifestClassroomIds;
  const newClassroomCount = scopedClassrooms.filter(
    (classroom) => !evidenceClassroomIds.has(classroom.classroomId),
  ).length;

  const scopedProjectIds = new Set(
    synthesis.scope.projectIds?.length
      ? synthesis.scope.projectIds
      : scopedClassrooms.flatMap((classroom) => (classroom.projectId ? [classroom.projectId] : [])),
  );
  const changedProjectCount = filters.projects.filter((project) => {
    if (scopedProjectIds.size > 0 && !scopedProjectIds.has(project.projectId)) return false;
    const latestActivityAt = dateValue(project.latestActivityAt);
    return latestActivityAt !== null && latestActivityAt > generatedAt;
  }).length;

  const status: SynthesisFreshnessStatus = !isLatest
    ? 'historical'
    : newClassroomCount > 0 || changedProjectCount > 0
      ? 'stale'
      : ageDays >= 7
        ? 'review'
        : 'fresh';

  return {
    status,
    ageDays,
    coveredClassroomCount: evidenceClassroomIds.size,
    scopedClassroomCount: scopedClassrooms.length,
    newClassroomCount,
    changedProjectCount,
    coverageEstimated: Boolean(synthesis.scope.domainQuery),
  };
}
