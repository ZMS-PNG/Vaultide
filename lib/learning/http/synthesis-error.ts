import { LearningConfigurationError } from '../config';
import { SynthesisServiceError } from '../application/synthesis-service';
import { learningError, type LearningRequestContext } from './api';

export function synthesisErrorResponse(context: LearningRequestContext, error: unknown): Response {
  if (error instanceof SynthesisServiceError) {
    return learningError(context, error.code, error.status, error.message);
  }
  if (error instanceof LearningConfigurationError) {
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Synthesis storage is not configured.',
    );
  }
  console.error('Synthesis request failed.', { requestId: context.requestId, error });
  return learningError(
    context,
    'dependency_unavailable',
    503,
    'Synthesis storage is temporarily unavailable.',
    { retryable: true },
  );
}
