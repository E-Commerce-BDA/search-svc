import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

describe('HealthController', () => {
  it('delegates liveness and readiness to the service', async () => {
    const checkLiveness = vi.fn().mockReturnValue({ status: 'ok' });
    const checkReadiness = vi.fn().mockResolvedValue({
      status: 'ready',
      checks: { db: 'up', redis: 'up', kafka: 'up' },
    });
    const controller = new HealthController({
      checkLiveness,
      checkReadiness,
    } as unknown as HealthService);

    expect(controller.checkLiveness()).toEqual({ status: 'ok' });
    await expect(controller.checkReadiness()).resolves.toEqual({
      status: 'ready',
      checks: { db: 'up', redis: 'up', kafka: 'up' },
    });
    expect(checkLiveness).toHaveBeenCalledOnce();
    expect(checkReadiness).toHaveBeenCalledOnce();
  });
});
