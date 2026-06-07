import { TokenService } from './token.service';
import type { UserRow } from './auth.types';
import { AuthResultResponse } from './dto/auth-result.response';

/**
 * 사용자에 대해 토큰 쌍을 발급하고 응답 DTO로 조립(로컬·OAuth 공용).
 * DTO 생성자는 순수 매핑이므로, 토큰 발급(IO)은 여기서 담당해 분리한다.
 */
export const issueAuthResult = async (
  tokens: TokenService,
  user: UserRow,
): Promise<AuthResultResponse> => {
  const pair = await tokens.issueTokenPair({
    id: user.id,
    email: user.email,
    role: user.role,
  });
  return new AuthResultResponse(user, pair);
};
