import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app.exception';
import {
  ERROR_BASE_URL,
  ERROR_CATALOG,
  type ErrorCode,
} from '../errors/error-catalog.generated';

/** NestJS HttpException 의 status → 공통 카탈로그 code 매핑 */
const STATUS_CODE: Record<number, ErrorCode> = {
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
};

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  instance: string;
  [ext: string]: unknown;
}

/**
 * 모든 예외를 RFC 9457 application/problem+json 으로 변환한다.
 * code → type/title/status 는 에러 카탈로그(docs/specs/errors/catalog.json 동기화본)가 단일 출처.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { code, detail, extensions } = this.resolve(exception);
    const entry = ERROR_CATALOG[code];

    const problem: ProblemDetails = {
      type: `${ERROR_BASE_URL}/${code}`,
      title: entry.title,
      status: entry.status,
      code,
      detail: detail ?? entry.detail,
      instance: req.originalUrl,
      ...extensions,
    };

    if (entry.status >= 500) {
      this.logger.error(`${code} ${req.method} ${req.originalUrl}`, exception);
    }

    res
      .status(entry.status)
      .type('application/problem+json')
      .json(problem);
  }

  private resolve(exception: unknown): {
    code: ErrorCode;
    detail?: string;
    extensions?: Record<string, unknown>;
  } {
    if (exception instanceof AppException) {
      return {
        code: exception.code,
        detail: exception.detailOverride,
        extensions: exception.extensions,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_CODE[status] ?? 'INTERNAL_ERROR';
      // NestJS 기본 메시지를 detail 로 보존(카탈로그 기본보다 구체적일 때)
      const body = exception.getResponse();
      const detail =
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : undefined;
      return { code, detail };
    }
    return { code: 'INTERNAL_ERROR' };
  }
}
