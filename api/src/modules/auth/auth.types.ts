/** 응답용 User (passwordHash 절대 미노출 — api-spec §2) */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

/** Google 프로필에서 분기에 필요한 최소 정보(전략이 추출해 전달) */
export interface GoogleProfile {
  providerId: string; // Google sub
  email: string;
  name: string;
}

/**
 * Google 콜백 결과. 컨트롤러는 `kind`만 보고 리다이렉트를 분기한다.
 * - authenticated: 로그인 성공 → fragment redirect
 * - pending: 기존 로컬 계정과 연결 필요 → `?pending=<jwt>` redirect
 */
export type GoogleAuthOutcome =
  | { kind: 'authenticated'; result: AuthResult }
  | { kind: 'pending'; pendingToken: string };

/** passwordHash까지 포함한 DB 행 (서비스 내부 전용, 응답 미노출) */
export interface UserRow extends PublicUser {
  passwordHash: string | null;
}
