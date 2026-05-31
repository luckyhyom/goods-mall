import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    prismaMock.$queryRaw.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('DB ping 성공 시 status ok, db up 반환', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    await expect(controller.check()).resolves.toEqual({ status: 'ok', db: 'up' });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('DB ping 실패 시 status error, db down 반환', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(controller.check()).resolves.toEqual({ status: 'error', db: 'down' });
  });
});
