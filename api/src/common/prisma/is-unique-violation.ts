/** Prisma 고유 제약 위반(P2002) 여부 — 클래스 import 결합 없이 duck-typing */
export const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code?: unknown }).code === 'P2002';
