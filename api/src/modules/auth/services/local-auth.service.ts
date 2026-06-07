import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException } from '../../../common/errors/app.exception';
import { isUniqueViolation } from '../../../common/prisma/is-unique-violation';
import { TokenService } from '../token.service';
import { issueAuthResult } from '../auth.mappers';
import type { AuthResult } from '../auth.types';
import { SignupDto } from '../dto/signup.dto';
import { LoginDto } from '../dto/login.dto';

const BCRYPT_ROUNDS = 12;

/** 로컬 자격증명(email+password) 기반 가입·로그인. */
@Injectable()
export class LocalAuthService {
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
    try {
      const user = await this.prisma.user.create({
        data: { email, name, passwordHash },
      });
      return issueAuthResult(this.tokens, user);
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
    return issueAuthResult(this.tokens, user);
  }
}
