import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { TokenService } from './token.service';
import { PrismaService } from '../../prisma/prisma.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('TokenService', () => {
  let service: TokenService;
  let prisma: {
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwt: { signAsync: jest.Mock };

  const user = { id: 'u1', email: 'a@b.com', role: 'USER' as const };

  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-secret';
    process.env.JWT_ACCESS_TTL = '15m';
    process.env.REFRESH_TTL_DAYS = '3';
    prisma = {
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
    const moduleRef = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = moduleRef.get(TokenService);
  });

  describe('issueTokenPair', () => {
    it('access·refresh를 발급하고 refresh는 평문이 아닌 sha256 해시로 저장한다', async () => {
      const pair = await service.issueTokenPair(user);

      expect(pair.accessToken).toBe('access.jwt');
      expect(typeof pair.refreshToken).toBe('string');
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);

      const { data } = prisma.refreshToken.create.mock.calls[0][0];
      expect(data.userId).toBe('u1');
      expect(data.tokenHash).toBe(sha256(pair.refreshToken));
      expect(data.tokenHash).not.toBe(pair.refreshToken);
      expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('rotate', () => {
    it('알 수 없는 refresh → AUTH_REFRESH_INVALID', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('nope')).rejects.toMatchObject({
        code: 'AUTH_REFRESH_INVALID',
      });
    });

    it('만료된 refresh → AUTH_TOKEN_EXPIRED', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
        user,
      });
      await expect(service.rotate('x')).rejects.toMatchObject({
        code: 'AUTH_TOKEN_EXPIRED',
      });
    });

    it('이미 revoke된 refresh 재사용 → 유저 전체 토큰 무효화 + AUTH_REFRESH_REUSED', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
        user,
      });
      await expect(service.rotate('x')).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSED',
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
      );
    });

    it('정상 refresh → 기존 토큰 revoke 후 새 쌍 발급', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        user,
      });

      const pair = await service.rotate('x');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      expect(pair.accessToken).toBe('access.jwt');
      expect(pair.refreshToken).toEqual(expect.any(String));
    });
  });

  describe('revoke (logout)', () => {
    it('refresh를 revoke 처리한다', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        revokedAt: null,
      });
      await service.revoke('x');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      );
    });

    it('알 수 없는 refresh는 조용히 무시(멱등)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.revoke('nope')).resolves.toBeUndefined();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
