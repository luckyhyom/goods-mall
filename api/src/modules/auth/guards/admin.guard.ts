import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../../../common/errors/app.exception';
import type { JwtPayload } from './jwt-auth.guard';

/** JwtAuthGuard 다음에 적용. role=ADMIN 아니면 403 FORBIDDEN. */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: JwtPayload }>();
    if (req.user?.role !== 'ADMIN') {
      throw new AppException('FORBIDDEN');
    }
    return true;
  }
}
