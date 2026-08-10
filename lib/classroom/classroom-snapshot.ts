import type { SceneOutline } from '@/lib/types/generation';
import type { PersistedGenerationStatus } from '@/lib/utils/database';

export interface ClassroomGenerationSnapshot {
  outlines: SceneOutline[];
  generationComplete: boolean;
  generationStatus: PersistedGenerationStatus;
  failedOutlineIds: string[];
}
