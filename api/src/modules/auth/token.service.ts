import { Injectable } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors/app.exception';

/** access 토큰 payload 생성을 위한 최소 사용자 정보 */
export interface TokenUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const hash = (plaintext: string): string =>
  createHash('sha256').update(plaintext).digest('hex');

/**
 * Access(JWT) + Opaque Refresh 토큰의 발급·rotation·재사용 감지.
 * refresh 평문은 응답으로만 전달하고 DB에는 sha256 해시만 저장한다.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async issueTokenPair(user: TokenUser): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: (process.env.JWT_ACCESS_TTL ??
          '15m') as JwtSignOptions['expiresIn'],
      },
    );

    const refreshToken = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hash(refreshToken),
        expiresAt: this.refreshExpiry(),
      },
    });

    return { accessToken, refreshToken };
  }

  /** rotation: 정상 토큰이면 기존 것을 revoke 하고 새 쌍을 발급. */
  async rotate(refreshToken: string): Promise<TokenPair> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(refreshToken) },
      include: { user: true },
    });

    if (!record) {
      throw new AppException('AUTH_REFRESH_INVALID');
    }

    // 재사용 감지(도난 의심): 이미 revoke된 토큰 제시 → 패밀리 전체 무효화
    if (record.revokedAt) {
      await this.revokeFamily(record.userId);
      throw new AppException('AUTH_REFRESH_REUSED');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new AppException('AUTH_TOKEN_EXPIRED');
    }

    // 원자적 claim: revokedAt이 여전히 null일 때만 revoke. 동시 rotate 시
    // 한 요청만 count=1을 얻고, 진 요청은 count=0 → 재사용으로 간주(1회용 보장).
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      await this.revokeFamily(record.userId);
      throw new AppException('AUTH_REFRESH_REUSED');
    }

    return this.issueTokenPair({
      id: record.user.id,
      email: record.user.email,
      role: record.user.role,
    });
  }

  /** logout: 해당 refresh를 revoke. 알 수 없는 토큰은 멱등하게 무시. */
  async revoke(refreshToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(refreshToken) },
    });
    if (!record) return;
    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });
  }

  /** 도난 의심 시 해당 유저의 살아있는 refresh 토큰을 일괄 무효화(패밀리 무효화). */
  private async revokeFamily(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private refreshExpiry(): Date {
    const days = Number(process.env.REFRESH_TTL_DAYS ?? '3');
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
