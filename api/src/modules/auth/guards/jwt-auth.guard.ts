import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppException } from '../../../common/errors/app.exception';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

/** access JWT 검증. 토큰 없음/위조→401 UNAUTHORIZED, 만료→401 AUTH_TOKEN_EXPIRED. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      throw new AppException('UNAUTHORIZED');
    }
    try {
      req.user = this.jwt.verify<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'TokenExpiredError') {
        throw new AppException('AUTH_TOKEN_EXPIRED');
      }
      throw new AppException('UNAUTHORIZED');
    }
  }
}
