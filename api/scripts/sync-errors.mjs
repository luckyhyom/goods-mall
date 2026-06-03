// docs/specs/errors/catalog.json 을 API 런타임용 타입 모듈로 변환한다.
// 에러 카탈로그의 단일 출처는 docs/specs/errors/catalog.json 이며,
// 이 스크립트가 생성하는 error-catalog.generated.ts 는 절대 직접 수정하지 않는다.
// (생성물은 gitignore; prebuild/pretest/start:dev 에서 자동 실행됨)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const SRC = join(scriptDir, '../../docs/specs/errors/catalog.json');
const OUT = join(scriptDir, '../src/common/errors/error-catalog.generated.ts');

const { baseUrl, errors } = JSON.parse(readFileSync(SRC, 'utf8'));

// 런타임 필터가 쓰는 필드만 추림: code → { status, title, detail }
const entries = errors
  .map(
    (e) =>
      `  ${JSON.stringify(e.code)}: { status: ${e.status}, title: ${JSON.stringify(
        e.title,
      )}, detail: ${JSON.stringify(e.detail)} },`,
  )
  .join('\n');

const out = `// 자동 생성 파일 — 직접 수정 금지.
// 출처: docs/specs/errors/catalog.json (npm run sync:errors 로 재생성)
export const ERROR_BASE_URL = ${JSON.stringify(baseUrl)};

export interface ErrorCatalogEntry {
  status: number;
  title: string;
  detail: string;
}

export const ERROR_CATALOG = {
${entries}
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');
console.log(`[sync-errors] ${errors.length} codes → ${OUT}`);
