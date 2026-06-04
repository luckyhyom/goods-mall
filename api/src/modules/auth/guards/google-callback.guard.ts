import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** 콜백 인증 실패(state 불일치·미검증 이메일 등)를 표시하는 sentinel 키 */
export const OAUTH_FAILED = Symbol('oauth_failed');

export interface OAuthFailure {
  [OAUTH_FAILED]: true;
}

/**
 * Google 콜백 전용 가드. 기본 AuthGuard는 실패 시 401을 throw하지만, 콜백은
 * 브라우저 top-level 네비게이션이므로 JSON 401 대신 프런트 에러 페이지로
 * redirect 해야 한다. 실패를 throw하지 않고 sentinel을 req.user로 통과시켜
 * 컨트롤러가 redirect를 수행하게 한다.
 */
@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err || !user) {
      return { [OAUTH_FAILED]: true } as TUser;
    }
    return user;
  }
}
