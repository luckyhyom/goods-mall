import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException } from '../../../common/errors/app.exception';
import { isUniqueViolation } from '../../../common/prisma/is-unique-violation';
import { TokenService } from '../token.service';
import { issueAuthResult } from '../auth.mappers';
import type {
  AuthResult,
  GoogleAuthOutcome,
  GoogleProfile,
} from '../auth.types';
import { LinkDto } from '../dto/link.dto';

/** pending_link JWT payload */
interface PendingLinkPayload {
  email: string;
  sub: string; // Google providerId
}

/** pending_link JWT 수명 (auth-strategy §5: 5분) */
const PENDING_LINK_TTL: JwtSignOptions['expiresIn'] = '5m';

/** Google OAuth 콜백 분기 + 기존 로컬 계정과의 연결(link). */
@Injectable()
export class OAuthLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Google OAuth 콜백 분기 (auth-strategy §5의 4단계).
   * 1) OAuthAccount(provider+sub) 있으면 그 User로 로그인
   * 2) 없고 email User도 없으면 신규 가입(passwordHash=null) + OAuthAccount
   * 3) 없고 email User가 있으면 연결 필요 → pending_link JWT 발급
   */
  async handleGoogleLogin(profile: GoogleProfile): Promise<GoogleAuthOutcome> {
    const account = await this.findGoogleAccount(profile.providerId);
    if (account) {
      return {
        kind: 'authenticated',
        result: await issueAuthResult(this.tokens, account.user),
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
      return {
        kind: 'authenticated',
        result: await issueAuthResult(this.tokens, created),
      };
    } catch (err) {
      if (!isUniqueViolation(err)) {
        throw err;
      }
      // 조회와 생성 사이의 경쟁(동시 OAuth 로그인 또는 로컬 signup) → 분기 재평가:
      // 같은 OAuthAccount가 이미 생겼으면 그 User로 로그인, 아니면(email만 선점) 연결 필요.
      const raced = await this.findGoogleAccount(profile.providerId);
      if (raced) {
        return {
          kind: 'authenticated',
          result: await issueAuthResult(this.tokens, raced.user),
        };
      }
      return this.pendingLink(profile);
    }
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

    return issueAuthResult(this.tokens, user);
  }

  /** provider+sub로 연결된 Google OAuthAccount를 소유 User와 함께 조회. */
  private findGoogleAccount(providerId: string) {
    return this.prisma.oAuthAccount.findUnique({
      where: { provider_providerId: { provider: 'GOOGLE', providerId } },
      include: { user: true },
    });
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
}
