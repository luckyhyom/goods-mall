import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { LocalAuthService } from './local-auth.service';
import { TokenService } from '../token.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthResultResponse } from '../dto/auth-result.response';
import { PublicUserResponse } from '../dto/public-user.response';

describe('LocalAuthService', () => {
  let service: LocalAuthService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let tokens: { issueTokenPair: jest.Mock };

  const baseUser = {
    id: 'u1',
    email: 'a@b.com',
    name: '홍길동',
    role: 'USER' as const,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    tokens = {
      issueTokenPair: jest
        .fn()
        .mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LocalAuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
      ],
    }).compile();
    service = moduleRef.get(LocalAuthService);
  });

  describe('signup', () => {
    it('새 이메일이면 비번을 bcrypt 해시로 저장하고 AuthResult를 반환(해시 미노출)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) =>
        Promise.resolve({ ...baseUser, ...data }),
      );

      const result = await service.signup({
        email: 'a@b.com',
        password: 'pw12345678',
        name: '홍길동',
      });

      const storedHash = prisma.user.create.mock.calls[0][0].data.passwordHash;
      expect(storedHash).not.toBe('pw12345678');
      await expect(bcrypt.compare('pw12345678', storedHash)).resolves.toBe(
        true,
      );

      expect(result.accessToken).toBe('access');
      expect(result.refreshToken).toBe('refresh');
      expect(result.user).toEqual({
        id: 'u1',
        email: 'a@b.com',
        name: '홍길동',
        role: 'USER',
        createdAt: baseUser.createdAt,
      });
      expect(
        result.user as unknown as Record<string, unknown>,
      ).not.toHaveProperty('passwordHash');
      // 응답은 평범한 객체가 아니라 응답 DTO 클래스 인스턴스여야 한다
      expect(result).toBeInstanceOf(AuthResultResponse);
      expect(result.user).toBeInstanceOf(PublicUserResponse);
    });

    it('이미 존재하는 이메일 → AUTH_EMAIL_TAKEN', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);
      await expect(
        service.signup({ email: 'a@b.com', password: 'pw12345678', name: 'x' }),
      ).rejects.toMatchObject({ code: 'AUTH_EMAIL_TAKEN' });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('체크 통과 후 동시 가입으로 create가 P2002 → AUTH_EMAIL_TAKEN(409)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue({ code: 'P2002' });
      await expect(
        service.signup({ email: 'a@b.com', password: 'pw12345678', name: 'x' }),
      ).rejects.toMatchObject({ code: 'AUTH_EMAIL_TAKEN' });
    });
  });

  describe('login', () => {
    it('정상 자격증명 → AuthResult', async () => {
      const passwordHash = await bcrypt.hash('pw12345678', 12);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash });

      const result = await service.login({
        email: 'a@b.com',
        password: 'pw12345678',
      });

      expect(result.accessToken).toBe('access');
      expect(result.user.email).toBe('a@b.com');
      expect(result).toBeInstanceOf(AuthResultResponse);
    });

    it('없는 유저 → AUTH_INVALID_CREDENTIALS', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'no@b.com', password: 'pw12345678' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    });

    it('비번 불일치 → AUTH_INVALID_CREDENTIALS', async () => {
      const passwordHash = await bcrypt.hash('correct-pw', 12);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, passwordHash });
      await expect(
        service.login({ email: 'a@b.com', password: 'wrong-pw' }),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    });

    it('passwordHash가 null(OAuth 전용 계정) → AUTH_LOCAL_DISABLED', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash: null,
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'pw12345678' }),
      ).rejects.toMatchObject({ code: 'AUTH_LOCAL_DISABLED' });
    });
  });
});
