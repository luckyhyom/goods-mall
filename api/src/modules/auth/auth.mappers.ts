import { TokenService } from './token.service';
import type { AuthResult, PublicUser, UserRow } from './auth.types';

/** DB 행에서 응답용 PublicUser만 추출(passwordHash 등 민감 필드 제거). */
export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  createdAt: u.createdAt,
});

/** 사용자에 대해 토큰 쌍을 발급하고 응답용 AuthResult로 조립(로컬·OAuth 공용). */
export const issueAuthResult = async (
  tokens: TokenService,
  user: UserRow,
): Promise<AuthResult> => {
  const pair = await tokens.issueTokenPair({
    id: user.id,
    email: user.email,
    role: user.role,
  });
  return { user: toPublicUser(user), ...pair };
};
