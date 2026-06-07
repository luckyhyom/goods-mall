import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { OAuthLinkService } from './oauth-link.service';
import { TokenService } from '../token.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthResultResponse } from '../dto/auth-result.response';
import { PublicUserResponse } from '../dto/public-user.response';

/**
 * Phase C — Google 콜백 4단계 분기 + 계정 연결.
 * Passport 전략/컨트롤러(리다이렉트)는 얇으므로 분기 로직만 서비스에서 검증한다.
 */
describe('OAuthLinkService', () => {
  let service: OAuthLinkService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    oAuthAccount: { findUnique: jest.Mock; create: jest.Mock };
  };
  let tokens: { issueTokenPair: jest.Mock };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  const tokenPair = { accessToken: 'a.jwt', refreshToken: 'r.opaque' };
  const profile = {
    providerId: 'google-sub-1',
    email: 'g@user.com',
    name: 'G User',
  };

  beforeEach(async () => {
    process.env.PENDING_LINK_SECRET = 'test-pending-secret';
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      oAuthAccount: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    tokens = { issueTokenPair: jest.fn().mockResolvedValue(tokenPair) };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('pending.jwt'),
      verifyAsync: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        OAuthLinkService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = moduleRef.get(OAuthLinkService);
  });

  describe('handleGoogleLogin', () => {
    it('단계1: 기존 OAuthAccount 있으면 그 User로 로그인 발급(authenticated)', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue({
        user: {
          id: 'u1',
          email: 'g@user.com',
          name: 'G User',
          role: 'USER',
          createdAt: new Date(),
          passwordHash: null,
        },
      });

      const out = await service.handleGoogleLogin(profile);

      expect(out.kind).toBe('authenticated');
      if (out.kind !== 'authenticated') throw new Error('unreachable');
      expect(out.result.accessToken).toBe('a.jwt');
      expect(out.result.user.email).toBe('g@user.com');
      expect(out.result).toBeInstanceOf(AuthResultResponse);
      expect(out.result.user).toBeInstanceOf(PublicUserResponse);
      // 이미 OAuthAccount가 있으므로 email 조회/신규가입 분기로 넘어가지 않음
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('단계2: OAuthAccount·email User 모두 없으면 신규 가입(passwordHash=null + OAuthAccount)', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u-new',
        email: 'g@user.com',
        name: 'G User',
        role: 'USER',
        createdAt: new Date(),
        passwordHash: null,
      });

      const out = await service.handleGoogleLogin(profile);

      expect(out.kind).toBe('authenticated');
      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.email).toBe('g@user.com');
      expect(createArg.data.passwordHash ?? null).toBeNull();
      // 같은 create에서 OAuthAccount 연결 생성
      expect(createArg.data.oauthAccounts.create).toMatchObject({
        provider: 'GOOGLE',
        providerId: 'google-sub-1',
      });
    });

    it('단계3: OAuthAccount 없고 email User가 있으면 pending_link JWT 발급(연결 필요)', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-local',
        email: 'g@user.com',
        name: 'Local',
        role: 'USER',
        createdAt: new Date(),
        passwordHash: 'hash',
      });

      const out = await service.handleGoogleLogin(profile);

      expect(out).toMatchObject({
        kind: 'pending',
        pendingToken: 'pending.jwt',
      });
      // pending JWT는 access와 분리된 시크릿·짧은 TTL로 email/sub만 담는다
      const [payload, opts] = jwt.signAsync.mock.calls[0];
      expect(payload).toMatchObject({
        email: 'g@user.com',
        sub: 'google-sub-1',
      });
      expect(opts.secret).toBe('test-pending-secret');
      expect(opts.expiresIn).toBe('5m');
      // 연결은 사용자 확인이 필요하므로 토큰을 바로 발급하지 않음
      expect(tokens.issueTokenPair).not.toHaveBeenCalled();
    });

    it('신규 생성 중 동시 OAuth 로그인으로 P2002 → 재조회 후 로그인(authenticated)', async () => {
      // 초기 조회는 없음 → create 시도 → 그 사이 다른 요청이 같은 OAuthAccount 생성(P2002)
      prisma.oAuthAccount.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          user: {
            id: 'u-raced',
            email: 'g@user.com',
            name: 'G User',
            role: 'USER',
            createdAt: new Date(),
            passwordHash: null,
          },
        });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue({ code: 'P2002' });

      const out = await service.handleGoogleLogin(profile);

      expect(out.kind).toBe('authenticated');
      if (out.kind !== 'authenticated') throw new Error('unreachable');
      expect(out.result.user.id).toBe('u-raced');
    });

    it('신규 생성 중 동시 로컬 signup으로 P2002(email 충돌) → 연결 필요(pending)', async () => {
      // create가 User.email unique 위반 → 재조회 시 OAuthAccount는 여전히 없음 → 연결 분기
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue({ code: 'P2002' });

      const out = await service.handleGoogleLogin(profile);

      expect(out).toMatchObject({
        kind: 'pending',
        pendingToken: 'pending.jwt',
      });
      expect(tokens.issueTokenPair).not.toHaveBeenCalled();
    });

    it('create가 P2002가 아닌 에러면 그대로 전파', async () => {
      prisma.oAuthAccount.findUnique.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(new Error('db down'));

      await expect(service.handleGoogleLogin(profile)).rejects.toThrow(
        'db down',
      );
    });
  });

  describe('link', () => {
    const validPayload = { email: 'g@user.com', sub: 'google-sub-1' };

    it('유효 pending + 올바른 패스워드 → OAuthAccount 생성 후 AuthResult', async () => {
      jwt.verifyAsync.mockResolvedValue(validPayload);
      const passwordHash = await bcrypt.hash('correct-pw', 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-local',
        email: 'g@user.com',
        name: 'Local',
        role: 'USER',
        createdAt: new Date(),
        passwordHash,
      });

      const result = await service.link({
        pending: 'pending.jwt',
        password: 'correct-pw',
      });

      expect(result.accessToken).toBe('a.jwt');
      expect(result).toBeInstanceOf(AuthResultResponse);
      expect(prisma.oAuthAccount.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-local',
          provider: 'GOOGLE',
          providerId: 'google-sub-1',
        },
      });
    });

    it('pending JWT 검증 실패(만료/위조) → AUTH_LINK_INVALID', async () => {
      jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));

      await expect(
        service.link({ pending: 'bad', password: 'x' }),
      ).rejects.toMatchObject({ code: 'AUTH_LINK_INVALID' });
      expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
    });

    it('OAuth 전용 계정(passwordHash=null)에는 연결 불가 → AUTH_LINK_INVALID', async () => {
      jwt.verifyAsync.mockResolvedValue(validPayload);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-oauth',
        email: 'g@user.com',
        name: 'OAuthOnly',
        role: 'USER',
        createdAt: new Date(),
        passwordHash: null,
      });

      await expect(
        service.link({ pending: 'pending.jwt', password: 'x' }),
      ).rejects.toMatchObject({ code: 'AUTH_LINK_INVALID' });
      expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
    });

    it('패스워드 불일치 → AUTH_LINK_INVALID', async () => {
      jwt.verifyAsync.mockResolvedValue(validPayload);
      const passwordHash = await bcrypt.hash('correct-pw', 12);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-local',
        email: 'g@user.com',
        name: 'Local',
        role: 'USER',
        createdAt: new Date(),
        passwordHash,
      });

      await expect(
        service.link({ pending: 'pending.jwt', password: 'wrong-pw' }),
      ).rejects.toMatchObject({ code: 'AUTH_LINK_INVALID' });
      expect(prisma.oAuthAccount.create).not.toHaveBeenCalled();
    });
  });
});
