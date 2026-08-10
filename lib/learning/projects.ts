import { NeonProjectRepository } from './adapters/neon/project-repository';
import { ProjectService } from './application/project-service';
import { getDeviceTokenService } from './device-tokens';

export function getProjectService(): ProjectService {
  return new ProjectService(new NeonProjectRepository(), getDeviceTokenService());
}
