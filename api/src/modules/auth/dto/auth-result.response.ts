import type { TokenPair } from '../token.service';
import type { UserRow } from '../auth.types';
import { PublicUserResponse } from './public-user.response';

/** 가입·로그인·연결 성공 응답: 공개 User + 토큰 쌍. */
export class AuthResultResponse {
  user: PublicUserResponse;
  accessToken: string;
  refreshToken: string;

  constructor(user: UserRow, tokens: TokenPair) {
    this.user = new PublicUserResponse(user);
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
  }
}
