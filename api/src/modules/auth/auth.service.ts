import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { TokenService } from './token.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

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

interface UserRow extends PublicUser {
  passwordHash: string | null;
}

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
  ) {}

  async signup({ email, password, name }: SignupDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppException('AUTH_EMAIL_TAKEN');
    }
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email, name, passwordHash },
    });
    return this.buildResult(user);
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

  private async buildResult(user: UserRow): Promise<AuthResult> {
    const pair = await this.tokens.issueTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    return { user: toPublicUser(user), ...pair };
  }
}
