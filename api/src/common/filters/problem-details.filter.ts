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

/** NestJS HttpException status → 카탈로그 도메인 code (있으면 카탈로그 entry 사용) */
const STATUS_TO_CATALOG: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
};

/** 카탈로그에 없는 상태코드의 일반 폴백(code/title). type 은 about:blank(RFC 9457 기본). */
const GENERIC: Partial<Record<number, { code: string; title: string }>> = {
  [HttpStatus.BAD_REQUEST]: { code: 'BAD_REQUEST', title: 'Bad request' },
  [HttpStatus.CONFLICT]: { code: 'CONFLICT', title: 'Conflict' },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: 'SERVICE_UNAVAILABLE',
    title: 'Service unavailable',
  },
};

interface Resolved {
  status: number;
  code: string;
  title: string;
  type: string;
  detail: string;
  extensions?: Record<string, unknown>;
}

/**
 * 모든 예외를 RFC 9457 application/problem+json 으로 변환한다.
 * code → type/title/status 는 에러 카탈로그(docs/specs/errors/catalog.json 동기화본)가 단일 출처.
 * 카탈로그에 없는 HttpException/일반 status 보유 에러는 상태코드를 보존한다.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const r = this.resolve(exception);

    const problem = {
      type: r.type,
      title: r.title,
      status: r.status,
      code: r.code,
      detail: r.detail,
      instance: req.originalUrl,
      ...r.extensions,
    };

    if (r.status >= 500) {
      this.logger.error(`${r.code} ${req.method} ${req.originalUrl}`, exception);
    }

    res.status(r.status).type('application/problem+json').json(problem);
  }

  private resolve(exception: unknown): Resolved {
    if (exception instanceof AppException) {
      return this.fromCatalog(
        exception.code,
        exception.detailOverride,
        exception.extensions,
      );
    }

    const status = this.extractStatus(exception);
    if (status !== undefined) {
      const mapped = STATUS_TO_CATALOG[status];
      const message = this.extractMessage(exception);
      if (mapped) {
        return this.fromCatalog(mapped, message);
      }
      const g = GENERIC[status];
      return {
        status,
        code: g?.code ?? `HTTP_${status}`,
        title: g?.title ?? 'HTTP error',
        type: 'about:blank',
        detail: message ?? g?.title ?? 'Request failed',
      };
    }

    return this.fromCatalog('INTERNAL_ERROR');
  }

  private fromCatalog(
    code: ErrorCode,
    detail?: string,
    extensions?: Record<string, unknown>,
  ): Resolved {
    const entry = ERROR_CATALOG[code];
    return {
      status: entry.status,
      code,
      title: entry.title,
      type: `${ERROR_BASE_URL}/${code}`,
      detail: detail ?? entry.detail,
      extensions,
    };
  }

  /** HttpException 또는 status/statusCode 를 가진 일반 에러(body-parser 등)에서 4xx/5xx 추출 */
  private extractStatus(exception: unknown): number | undefined {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    const raw = exception as { status?: unknown; statusCode?: unknown };
    const status =
      typeof raw?.status === 'number'
        ? raw.status
        : typeof raw?.statusCode === 'number'
          ? raw.statusCode
          : undefined;
    return status !== undefined && status >= 400 && status < 600
      ? status
      : undefined;
  }

  private extractMessage(exception: unknown): string | undefined {
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') return body;
      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message: unknown }).message;
        return Array.isArray(message) ? message.join(', ') : String(message);
      }
    }
    if (exception instanceof Error && exception.message) {
      return exception.message;
    }
    return undefined;
  }
}
