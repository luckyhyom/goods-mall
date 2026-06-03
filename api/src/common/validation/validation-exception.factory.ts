import type { ValidationError } from 'class-validator';
import { AppException } from '../errors/app.exception';

/** class-validator constraint 키 → 안정 에러 코드. 없으면 UPPER_SNAKE 폴백. */
const CONSTRAINT_CODE: Record<string, string> = {
  isNotEmpty: 'REQUIRED',
  isDefined: 'REQUIRED',
  isEmail: 'INVALID_EMAIL',
  isString: 'INVALID_TYPE',
  isInt: 'INVALID_TYPE',
  isNumber: 'INVALID_TYPE',
  isBoolean: 'INVALID_TYPE',
  minLength: 'MIN_LENGTH',
  maxLength: 'MAX_LENGTH',
  min: 'MIN',
  max: 'MAX',
};

const toCode = (constraint: string): string =>
  CONSTRAINT_CODE[constraint] ??
  constraint.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

export interface FieldError {
  field: string;
  code: string;
  message: string;
}

/** 중첩/배열을 점·인덱스 표기(`items[0].quantity`)로 평탄화한다. */
function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  const out: FieldError[] = [];
  for (const err of errors) {
    const field = parent ? `${parent}.${err.property}` : err.property;
    if (err.constraints) {
      for (const [constraint, message] of Object.entries(err.constraints)) {
        out.push({ field, code: toCode(constraint), message });
      }
    }
    if (err.children?.length) {
      // 배열 요소는 property 가 인덱스 → items.0.x 를 items[0].x 로 보정
      const nested = flatten(err.children, field).map((e) => ({
        ...e,
        field: e.field.replace(/\.(\d+)(\.|$)/g, '[$1]$2'),
      }));
      out.push(...nested);
    }
  }
  return out;
}

/** 전역 ValidationPipe 의 exceptionFactory. 검증 실패를 422 VALIDATION_ERROR 로. */
export function validationExceptionFactory(errors: ValidationError[]): AppException {
  return new AppException('VALIDATION_ERROR', {
    extensions: { errors: flatten(errors) },
  });
}
