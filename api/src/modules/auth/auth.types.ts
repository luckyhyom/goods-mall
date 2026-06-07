/** Google 프로필에서 분기에 필요한 최소 정보(전략이 추출해 전달) */
export interface GoogleProfile {
  providerId: string; // Google sub
  email: string;
  name: string;
}

/**
 * passwordHash까지 포함한 DB 행 (서비스 내부 전용, 응답 미노출).
 * 응답으로 내보낼 때는 PublicUserResponse로 화이트리스트 매핑한다.
 */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  createdAt: Date;
  passwordHash: string | null;
}
