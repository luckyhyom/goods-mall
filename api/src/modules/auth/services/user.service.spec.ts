import { Test } from '@nestjs/testing';
import { UserService } from './user.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { PublicUserResponse } from '../dto/public-user.response';

describe('UserService', () => {
  let service: UserService;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    const moduleRef = await Test.createTestingModule({
      providers: [UserService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UserService);
  });

  describe('getMe', () => {
    it('계정이 존재하면 PublicUser를 반환(passwordHash 미노출)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        name: '홍길동',
        role: 'USER',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        passwordHash: 'secret-hash',
      });

      const user = await service.getMe('u1');

      expect(user).toEqual({
        id: 'u1',
        email: 'a@b.com',
        name: '홍길동',
        role: 'USER',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      expect(user as unknown as Record<string, unknown>).not.toHaveProperty(
        'passwordHash',
      );
      expect(user).toBeInstanceOf(PublicUserResponse);
    });

    it('토큰은 유효하나 계정이 사라진 경우 → UNAUTHORIZED', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMe('gone')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });
});
