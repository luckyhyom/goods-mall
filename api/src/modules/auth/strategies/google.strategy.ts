import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy,
  type Profile,
  type VerifyCallback,
} from 'passport-google-oauth20';
import { AppException } from '../../../common/errors/app.exception';
import type { GoogleProfile } from '../auth.service';

/**
 * Google OAuth 전략 — 의도적으로 얇게 유지한다.
 * code↔profile 교환은 passport가 처리하고, 여기서는 분기에 필요한 최소 정보
 * (sub/email/name)만 추출해 넘긴다. 실제 4단계 분기는 AuthService가 담당하므로
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
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      // email 스코프 동의 거부 등 — 로그인 진행 불가
      done(new AppException('UNAUTHORIZED'), false);
      return;
    }
    const result: GoogleProfile = {
      providerId: profile.id,
      email,
      name: profile.displayName ?? email,
    };
    done(null, result);
  }
}
