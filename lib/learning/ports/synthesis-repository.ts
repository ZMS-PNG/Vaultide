import type {
  SaveSynthesisRunInput,
  SynthesisClassroomRecord,
  SynthesisEvidenceFingerprint,
  SynthesisScheduleRecord,
  SynthesisScheduleRunRecord,
  SynthesisScheduleRunState,
  SynthesisScheduleStatus,
  SynthesisRunRecord,
  SynthesisScope,
  SynthesisMode,
} from '../domain/synthesis';

export interface CreateSynthesisScheduleInput {
  id: string;
  ownerId: string;
  name: string;
  period: SynthesisScheduleRecord['period'];
  intervalMinutes?: number;
  timezone: string;
  mode: SynthesisMode;
  scope: SynthesisScope;
  scopeHash: string;
  nextRunAt: Date;
  now: Date;
}

export interface UpdateSynthesisScheduleInput {
  ownerId: string;
  scheduleId: string;
  name: string;
  period: SynthesisScheduleRecord['period'];
  intervalMinutes?: number;
  timezone: string;
  mode: SynthesisMode;
  scope: SynthesisScope;
  scopeHash: string;
  status: SynthesisScheduleStatus;
  nextRunAt: Date;
  now: Date;
}

export interface ClaimSynthesisScheduleRunInput {
  id: string;
  ownerId: string;
  scheduleId: string;
  scheduledFor: Date;
  now: Date;
}

export interface CompleteSynthesisScheduleRunInput {
  ownerId: string;
  schedule: SynthesisScheduleRecord;
  runId: string;
  state: Exclude<SynthesisScheduleRunState, 'running'>;
  synthesisId?: string;
  baselineSynthesisId?: string;
  evidenceManifest: SynthesisEvidenceFingerprint[];
  errorDetail?: string;
  nextRunAt?: Date;
  now: Date;
}

export interface SynthesisRepository {
  listClassroomInputs(ownerId: string, limit: number): Promise<SynthesisClassroomRecord[]>;
  save(input: SaveSynthesisRunInput): Promise<SynthesisRunRecord>;
  find(ownerId: string, synthesisId: string): Promise<SynthesisRunRecord | null>;
  list(ownerId: string, limit: number): Promise<SynthesisRunRecord[]>;
  listBySchedule(
    ownerId: string,
    scheduleId: string,
    limit: number,
  ): Promise<SynthesisRunRecord[]>;
  createSchedule(input: CreateSynthesisScheduleInput): Promise<SynthesisScheduleRecord>;
  findSchedule(ownerId: string, scheduleId: string): Promise<SynthesisScheduleRecord | null>;
  listSchedules(ownerId: string, limit: number): Promise<SynthesisScheduleRecord[]>;
  updateSchedule(input: UpdateSynthesisScheduleInput): Promise<SynthesisScheduleRecord | null>;
  listDueSchedules(ownerId: string, now: Date, limit: number): Promise<SynthesisScheduleRecord[]>;
  claimScheduleRun(input: ClaimSynthesisScheduleRunInput): Promise<SynthesisScheduleRunRecord | null>;
  completeScheduleRun(input: CompleteSynthesisScheduleRunInput): Promise<void>;
}
