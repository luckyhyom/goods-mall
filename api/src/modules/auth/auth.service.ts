import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { TokenService } from './token.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { LinkDto } from './dto/link.dto';

const BCRYPT_ROUNDS = 12;

/** 응답용 User (passwordHash 절대 미노출 — api-spec §2) */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

/** Google 프로필에서 분기에 필요한 최소 정보(전략이 추출해 전달) */
export interface GoogleProfile {
  providerId: string; // Google sub
  email: string;
  name: string;
}

/** pending_link JWT payload */
interface PendingLinkPayload {
  email: string;
  sub: string; // Google providerId
}

/**
 * Google 콜백 결과. 컨트롤러는 `kind`만 보고 리다이렉트를 분기한다.
 * - authenticated: 로그인 성공 → fragment redirect
 * - pending: 기존 로컬 계정과 연결 필요 → `?pending=<jwt>` redirect
 */
export type GoogleAuthOutcome =
  | { kind: 'authenticated'; result: AuthResult }
  | { kind: 'pending'; pendingToken: string };

/** pending_link JWT 수명 (auth-strategy §5: 5분) */
const PENDING_LINK_TTL: JwtSignOptions['expiresIn'] = '5m';

interface UserRow extends PublicUser {
  passwordHash: string | null;
}

/** Prisma 고유 제약 위반(P2002) 여부 — 클래스 import 결합 없이 duck-typing */
const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: unknown }).code === 'P2002';

const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  createdAt: u.createdAt,
});

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
  ) {}

  async signup({ email, password, name }: SignupDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppException('AUTH_EMAIL_TAKEN');
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    try {
      const user = await this.prisma.user.create({
        data: { email, name, passwordHash },
      });
      return this.buildResult(user);
    } catch (err) {
      // 사전 체크와 create 사이 동시 가입(unique 위반) → 409로 정규화
      if (isUniqueViolation(err)) {
        throw new AppException('AUTH_EMAIL_TAKEN');
      }
      throw err;
    }
  }

  async login({ email, password }: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }
    if (!user.passwordHash) {
      // OAuth 전용 계정: 로컬 비번 로그인 비활성
      throw new AppException('AUTH_LOCAL_DISABLED');
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }
    return this.buildResult(user);
  }

  /** access 토큰 검증 후 현재 사용자 프로필 조회(/auth/me). */
  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      // 토큰은 유효하나 계정이 사라진 경우
      throw new AppException('UNAUTHORIZED');
    }
    return toPublicUser(user);
  }

  /**
   * Google OAuth 콜백 분기 (auth-strategy §5의 4단계).
   * 1) OAuthAccount(provider+sub) 있으면 그 User로 로그인
   * 2) 없고 email User도 없으면 신규 가입(passwordHash=null) + OAuthAccount
   * 3) 없고 email User가 있으면 연결 필요 → pending_link JWT 발급
   */
  async handleGoogleLogin(profile: GoogleProfile): Promise<GoogleAuthOutcome> {
    const account = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerId: {
          provider: 'GOOGLE',
          providerId: profile.providerId,
        },
      },
      include: { user: true },
    });
    if (account) {
      return {
        kind: 'authenticated',
        result: await this.buildResult(account.user),
      };
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
    });
    if (existing) {
      // 기존 로컬 계정 존재 → 자동 연결하지 않고 패스워드 확인을 요구
      return this.pendingLink(profile);
    }

    // 신규 가입: 로컬 비번 없이 OAuth만으로 생성(한 트랜잭션에서 연결)
    try {
      const created = await this.prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          passwordHash: null,
          oauthAccounts: {
            create: { provider: 'GOOGLE', providerId: profile.providerId },
          },
        },
      });
      return { kind: 'authenticated', result: await this.buildResult(created) };
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      // 조회와 생성 사이의 경쟁(동시 OAuth 로그인 또는 로컬 signup) → 분기 재평가:
      // 같은 OAuthAccount가 이미 생겼으면 그 User로 로그인, 아니면(email만 선점) 연결 필요.
      const raced = await this.prisma.oAuthAccount.findUnique({
        where: {
          provider_providerId: {
            provider: 'GOOGLE',
            providerId: profile.providerId,
          },
        },
        include: { user: true },
      });
      if (raced) {
        return {
          kind: 'authenticated',
          result: await this.buildResult(raced.user),
        };
      }
      return this.pendingLink(profile);
    }
  }

  /** 연결 필요 분기: 기존 계정과 묶기 위한 pending_link JWT 발급. */
  private async pendingLink(
    profile: GoogleProfile,
  ): Promise<GoogleAuthOutcome> {
    const pendingToken = await this.jwt.signAsync(
      {
        email: profile.email,
        sub: profile.providerId,
      } satisfies PendingLinkPayload,
      { secret: process.env.PENDING_LINK_SECRET, expiresIn: PENDING_LINK_TTL },
    );
    return { kind: 'pending', pendingToken };
  }

  /**
   * OAuth 계정 연결 (auth-strategy §6).
   * pending JWT 검증 → 기존 패스워드 확인 → OAuthAccount 생성 → 토큰 발급.
   * 어느 단계든 실패는 정보 노출을 피해 AUTH_LINK_INVALID(401)로 통일.
   */
  async link({ pending, password }: LinkDto): Promise<AuthResult> {
    let payload: PendingLinkPayload;
    try {
      payload = await this.jwt.verifyAsync<PendingLinkPayload>(pending, {
        secret: process.env.PENDING_LINK_SECRET,
      });
    } catch {
      throw new AppException('AUTH_LINK_INVALID');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: payload.email },
    });
    // OAuth 전용 계정(passwordHash=null)은 확인할 비번이 없어 연결 불가
    if (!user || !user.passwordHash) {
      throw new AppException('AUTH_LINK_INVALID');
    }
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      throw new AppException('AUTH_LINK_INVALID');
    }

    try {
      await this.prisma.oAuthAccount.create({
        data: { userId: user.id, provider: 'GOOGLE', providerId: payload.sub },
      });
    } catch (err) {
      // 이미 연결됨 등 unique 위반 → 재연결을 유효하지 않은 요청으로 처리
      if (isUniqueViolation(err)) {
        throw new AppException('AUTH_LINK_INVALID');
      }
      throw err;
    }

    return this.buildResult(user);
  }

  private async buildResult(user: UserRow): Promise<AuthResult> {
    const pair = await this.tokens.issueTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return { user: toPublicUser(user), ...pair };
  }
}
