import { ERROR_CATALOG, type ErrorCode } from './error-catalog.generated';

/**
 * 도메인 에러를 던지는 단일 수단.
 * `code`만 주면 status/title/detail/type 은 에러 카탈로그(단일 출처)에서 채운다.
 * ProblemDetailsFilter 가 이 예외를 RFC 9457 application/problem+json 으로 변환한다.
 */
export class AppException extends Error {
  readonly code: ErrorCode;
  /** 카탈로그 기본 detail 대신 이번 발생 건에 쓸 메시지(선택) */
  readonly detailOverride?: string;
  /** problem+json 에 덧붙일 확장 멤버(예: 검증 errors[]) */
  readonly extensions?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options?: { detail?: string; extensions?: Record<string, unknown> },
  ) {
    super(ERROR_CATALOG[code].title);
    this.code = code;
    this.detailOverride = options?.detail;
    this.extensions = options?.extensions;
  }
}
