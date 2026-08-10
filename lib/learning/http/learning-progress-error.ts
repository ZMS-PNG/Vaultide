import { DeviceTokenServiceError } from '../application/device-token-service';
import { LearningProgressServiceError } from '../application/learning-progress-service';
import { LearningConfigurationError } from '../config';
import { learningError, type LearningRequestContext } from './api';

export function learningProgressErrorResponse(
  context: LearningRequestContext,
  error: unknown,
): Response {
  if (error instanceof LearningProgressServiceError || error instanceof DeviceTokenServiceError) {
    return learningError(context, error.code, error.status, error.message, {
      retryable: 'retryable' in error && error.retryable === true,
    });
  }
  if (error instanceof LearningConfigurationError) {
    return learningError(
      context,
      'dependency_unavailable',
      503,
      'Learning progress storage is not configured.',
    );
  }
  console.error('Learning progress request failed.', { requestId: context.requestId, error });
  return learningError(
    context,
    'dependency_unavailable',
    503,
    'Learning progress storage is temporarily unavailable.',
    { retryable: true },
  );
}
