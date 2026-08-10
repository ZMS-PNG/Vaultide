import { KnowledgeGraphServiceError } from '../application/knowledge-graph-projection-service';
import { LearningConfigurationError } from '../config';
import { learningError, type LearningRequestContext } from './api';

export function knowledgeGraphErrorResponse(
  context: LearningRequestContext,
  error: unknown,
): Response {
  if (error instanceof KnowledgeGraphServiceError) {
    return learningError(context, error.code, error.status, error.message);
  }
  if (error instanceof LearningConfigurationError) {
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Knowledge graph storage is not configured.',
    );
  }
  console.error('Knowledge graph request failed.', { requestId: context.requestId, error });
  return learningError(
    context,
    'dependency_unavailable',
    503,
    'Knowledge graph storage is temporarily unavailable.',
    { retryable: true },
  );
}
