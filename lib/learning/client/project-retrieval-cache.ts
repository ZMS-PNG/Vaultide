export const PROJECT_RETRIEVAL_CACHE_PREFIX = 'vaultide:project-retrieval:';

export function projectRetrievalStorageKey(bundleId: string): string {
  return `${PROJECT_RETRIEVAL_CACHE_PREFIX}${bundleId}`;
}
