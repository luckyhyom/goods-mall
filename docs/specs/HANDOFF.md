# 다음 세션 핸드오프 (goods-mall API)

> 마지막 갱신: 2026-06-03.
> **새 세션은 이 문서부터 읽으세요.** 그다음 [roadmap.md](./roadmap.md).

---

## 1. 현재 상태

- **Slice 0 (Bootstrap) 완료** — NestJS 11 + Prisma 7(`@prisma/adapter-mariadb`) + MariaDB, `GET /health`
- **프런트엔드 별도 레포로 분리** — 이 레포는 **백엔드 API 전용**. 프런트는 추후 다른 레포에서 이 계약을 소비
- **API 계약 설계 완료** (직전 작업):
  - [api-spec.md](./api-spec.md) — 사람용 계약 문서(공통 규약 + 도메인별 엔드포인트)
  - [openapi.yaml](./openapi.yaml) — 기계용 **OpenAPI 3.1** (redocly lint valid)
  - [errors/](./errors/) — **RFC 9457 에러 카탈로그** (`catalog.json` + `build.mjs` 생성기 + HTML 23개)
- 아직 **구현은 시작 전** (스펙·문서만 존재)

## 2. 확정된 핵심 규약 (api-spec.md §1)

| 항목 | 결정 |
|------|------|
| 성공 응답 | 봉투 없음(bare). 목록 `{ items, page:{limit,offset,total} }`, 카트/주소 등 소량은 `{ items }` |
| 에러 | **RFC 9457** `application/problem+json` + 안정 `code`. 클라이언트는 `code`로 분기 |
| 검증 실패 | **422** + `errors:[{field,code,message}]` |
| 버저닝 | **`/api/v1`** 접두사, `/health`만 prefix 밖 |
| 인증 | JWT Bearer. 401=인증실패, 403=권한부족, 내 리소스 없음=404(은닉) |
| 날짜·금액 | UTC ISO 8601 / `~Won` Int(음수·소수점 불가, KRW) |
| 페이지네이션 | `limit`(기본20,최대100)·`offset` + 기본정렬·tie-breaker, 정렬·필터 whitelist |
| 멱등성 | `POST /orders`에 `Idempotency-Key` 필수(TTL 24h) |
| 상품 삭제 | soft delete(`isActive=false`) |

## 3. 다음 작업 — Slice 1: Auth

**목표:** 인증 엔드포인트 구현 (api-spec.md §3: signup/login/refresh/logout/me/google/google-callback/link)

**구현 전제(공통 토대 — Slice 1에서 함께 세움, 이후 모든 슬라이스가 의존):**
- `main.ts`: `app.setGlobalPrefix('api/v1', { exclude: ['health'] })`
- 전역 `ValidationPipe` → 검증 실패를 **422 + `errors[]`** 로 (RFC 9457 형식)
- 전역 `ExceptionFilter` → NestJS 예외를 **`application/problem+json`**(`type/title/status/code/detail/instance`)로 변환
- `GET /health` DB down 시 **503** 으로 변경(현재 200)

**데이터:** `User` / `OAuthAccount` / `RefreshToken` (data-model.md) → **첫 Prisma migration** 생성

**참고 문서(이것만 읽을 것):**
- [api-spec.md](./api-spec.md) (§1 공통 규약, §3 Auth)
- [auth-strategy.md](./auth-strategy.md)
- [data-model.md](./data-model.md) (`## User & OAuthAccount & RefreshToken` 섹션만)
- [foundation.md](./foundation.md)

## 4. 구현 ↔ 스펙 갭 (아직 코드 미반영)

스펙은 "목표 계약"이라 현재 구현과 차이가 있다. Slice 1에서 함께 해소:
- `/api/v1` 글로벌 prefix 없음 (`api/src/main.ts`)
- `/health` 503 미적용 (`api/src/health/health.controller.ts` 는 200 반환)
- 전역 `ValidationPipe` / RFC 9457 `ExceptionFilter` 없음
- `IdempotencyKey` 모델 미정의 → `data-model.md`에 추가 필요(주문 슬라이스 전까지)

## 5. 세션 재개 프롬프트 (복붙용)

```
docs/specs/HANDOFF.md와 roadmap.md를 읽고, Slice 1 — Auth의 구현 계획을
docs/specs/slice-1-auth-plan.md 에 작성해줘.

참고 문서만 읽을 것(전체 spec 읽지 말 것):
- docs/specs/api-spec.md (§1 공통 규약, §3 Auth)
- docs/specs/auth-strategy.md
- docs/specs/data-model.md (## User & OAuthAccount & RefreshToken 섹션만)
- docs/specs/foundation.md

플랜은 작게·코드 미포함으로. 인증 엔드포인트 전에 공통 토대(global prefix,
ValidationPipe→422, RFC 9457 ExceptionFilter, health 503)부터 포함할 것.
```

## 6. 로컬에서 문서 보기

```bash
cd docs/specs && python3 -m http.server 8080
#  http://localhost:8080/swagger.html        ← API (Swagger UI)
#  http://localhost:8080/errors/index.html   ← 에러 카탈로그
# 에러 페이지 재생성:  node docs/specs/errors/build.mjs
# OpenAPI 검증:        npx --yes @redocly/cli lint docs/specs/openapi.yaml
```
