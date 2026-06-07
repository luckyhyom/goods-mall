import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type StrategyOptions,
  type VerifyCallback,
} from 'passport-google-oauth20';
import { AppException } from '../../../common/errors/app.exception';
import type { GoogleProfile } from '../auth.types';
import { CookieStateStore } from './cookie-state.store';

/**
 * Google OAuth 전략 — 의도적으로 얇게 유지한다.
 * code↔profile 교환은 passport가 처리하고, 여기서는 분기에 필요한 최소 정보
 * (sub/email/name)만 추출해 넘긴다. 실제 4단계 분기는 OAuthLinkService가 담당하므로
 * 단위 테스트가 가능하다.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      callbackURL: process.env.GOOGLE_CALLBACK_URL as string,
      scope: ['email', 'profile'],
      // 세션 없는 CSRF 방어: state nonce를 쿠키로 관리(RFC 9700 §4.7).
      // store는 passport-oauth2 옵션이라 google 타입에 없어 캐스팅한다.
      store: new CookieStateStore(),
    } as unknown as StrategyOptions);
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const primary = profile.emails?.[0];
    // 미검증 이메일은 계정 선점(account pre-emption) 위험이 있으므로,
    // Google이 소유를 검증한(email_verified=true) 이메일만 계정 키로 수락한다.
    if (!primary?.value || primary.verified !== true) {
      // email 스코프 거부 또는 미검증 — 로그인 진행 불가
      done(new AppException('UNAUTHORIZED'), false);
      return;
    }
    const result: GoogleProfile = {
      providerId: profile.id,
      email: primary.value,
      name: profile.displayName ?? primary.value,
    };
    done(null, result);
  }
}
