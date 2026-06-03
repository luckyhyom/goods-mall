import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../guards/jwt-auth.guard';

/** JwtAuthGuard 가 채운 req.user(access JWT payload)를 핸들러 인자로 주입. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload | undefined =>
    ctx.switchToHttp().getRequest<Request & { user?: JwtPayload }>().user,
);
