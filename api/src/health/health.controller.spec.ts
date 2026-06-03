import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };

  const makeRes = () => {
    const res = { status: jest.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as Response & { status: jest.Mock };
  };

  beforeEach(async () => {
    prismaMock.$queryRaw.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('DB ping 성공 시 status ok, db up 반환 (상태코드 미변경=200)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    const res = makeRes();
    await expect(controller.check(res)).resolves.toEqual({ status: 'ok', db: 'up' });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('DB ping 실패 시 503 + status error, db down 반환', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = makeRes();
    await expect(controller.check(res)).resolves.toEqual({
      status: 'error',
      db: 'down',
    });
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
