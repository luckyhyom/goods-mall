import type { UserRow } from '../auth.types';

/**
 * 응답에 노출되는 User (signup·login·link·/auth/me).
 * passwordHash 절대 미노출 — api-spec §2.
 *
 * 생성자가 허용 필드만 복사하는 화이트리스트 방식이라, User에 민감 필드가
 * 추가돼도 기본적으로 응답에서 제외된다(블랙리스트 누락 위험 없음).
 */
export class PublicUserResponse {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  createdAt: Date;

  constructor(u: UserRow) {
    this.id = u.id;
    this.email = u.email;
    this.name = u.name;
    this.role = u.role;
    this.createdAt = u.createdAt;
  }
}
