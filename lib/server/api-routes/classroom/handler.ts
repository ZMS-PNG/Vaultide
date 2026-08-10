// Loaded by the consolidated Vercel API dispatcher.
import { type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError, API_ERROR_CODES } from '@/lib/server/api-response';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroomWithMetadata,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import { describeCompletedCourseSnapshotViolation } from '@/lib/generation/outline-release-contract';
import type { SceneOutline } from '@/lib/types/generation';
import { getCourseGenerationService } from '@/lib/generation/orchestration/service';

const log = createLogger('Classroom API');

export async function POST(request: NextRequest) {
  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes, generation } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (
      !stage ||
      typeof stage !== 'object' ||
      !Array.isArray(scenes) ||
      (stage.id !== undefined && (typeof stage.id !== 'string' || !isValidClassroomId(stage.id)))
    ) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const durableGenerationJobId = stage.learningContext?.generationJobId;
    if (
      typeof durableGenerationJobId === 'string' &&
      /^cgj_[a-f0-9]{32}$/.test(durableGenerationJobId)
    ) {
      return apiError(
        'SCOPE_DENIED',
        403,
        'Durable classroom releases are immutable and can only be published by the verified release transaction.',
      );
    }

    if (generation?.generationComplete === true) {
      const outlines = Array.isArray(generation.outlines)
        ? (generation.outlines as SceneOutline[])
        : [];
      const completionViolation = describeCompletedCourseSnapshotViolation({
        outlines,
        sceneOrders: scenes.map((scene: { order?: unknown }) => Number(scene?.order)),
        taskEngineMode: stage.taskEngineMode === true,
      });
      if (completionViolation) {
        return apiError(
          'QUALITY_GATE_FAILED',
          422,
          'Refusing to mark an incomplete classroom as generated.',
          completionViolation,
        );
      }
    }

    const id = stage.id || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const persisted = await persistClassroom(
      { id, stage: { ...stage, id }, scenes, generation },
      baseUrl,
    );

    return apiSuccess(
      { id: persisted.id, url: persisted.url, revision: persisted.revision ?? 1 },
      201,
    );
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const stored = await readClassroomWithMetadata(id);
    if (!stored) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }
    const generationJobId = stored.classroom.stage.learningContext?.generationJobId;
    if (
      typeof generationJobId === 'string' &&
      /^cgj_[a-f0-9]{32}$/.test(generationJobId)
    ) {
      const release = await getCourseGenerationService().publishedRelease(generationJobId);
      if (
        !release ||
        release.classroomId !== id ||
        release.snapshotSha256 !== stored.snapshotSha256
      ) {
        return apiError(
          'CLASSROOM_NOT_RELEASED',
          409,
          'Classroom generation is still being verified and has not been released.',
        );
      }
    }

    return apiSuccess({ classroom: stored.classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiError(
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
