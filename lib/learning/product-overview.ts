import { NeonLearningProgressRepository } from './adapters/neon/learning-progress-repository';
import { NeonProductOverviewRepository } from './adapters/neon/product-overview-repository';
import { ProductOverviewService } from './application/product-overview-service';
import { loadPairingConfig } from './config';

export function getProductOverviewService(): ProductOverviewService {
  const { ownerId } = loadPairingConfig();
  return new ProductOverviewService({
    ownerId,
    repository: new NeonProductOverviewRepository(),
    learningProgressRepository: new NeonLearningProgressRepository(),
  });
}
