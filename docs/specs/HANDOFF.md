# 다음 세션 핸드오프 (goods-mall API)

> 마지막 갱신: 2026-06-04.
> **새 세션은 이 문서부터 읽으세요.** 그다음 [roadmap.md](./roadmap.md).

---

## 1. 현재 상태

- **Slice 0 (Bootstrap) 완료** — NestJS 11 + Prisma 7 + MariaDB, `GET /health`
- **API 계약 설계 완료** — [api-spec.md](./api-spec.md) / [openapi.yaml](./openapi.yaml) / [errors/](./errors/)
- **Slice 1 (Auth) 완료** — Phase A·B·C·D 전부. 빌드 클린, 테스트 **32/32** 통과
  - 계획: [slice-1-auth-plan.md](./slice-1-auth-plan.md)
  - 코드 리뷰 **1차**(Phase B 후, §7)·**2차**(Phase C 후, §8) 모두 반영
- **다음 = Slice 2 (Catalog)** — 아래 §3. 먼저 plan 작성부터.
- **프런트엔드 별도 레포** — 이 레포는 백엔드 API 전용

## 2. Slice 1에서 구현된 것 (코드 존재)

**Phase A — 공통 토대 (`api/src/common/`, `main.ts`):** 이후 모든 슬라이스가 의존
- `/api/v1` 글로벌 prefix (`/health`만 제외)
- 전역 `ValidationPipe` → 검증 실패를 **422 `VALIDATION_ERROR` + `errors[]`**
- 전역 `ProblemDetailsFilter` → 모든 예외를 **RFC 9457 `application/problem+json`**
- `GET /health` DB down 시 **503**

**Phase B — 로컬 인증 (`api/src/modules/auth/`):**
- `User`/`OAuthAccount`/`RefreshToken` 모델 + 첫 마이그레이션(`auth_init`)
- `TokenService` — access(JWT)+opaque refresh 발급, rotation, **재사용 감지(패밀리 무효화)**
- `POST /auth/signup`(201) · `/auth/login`(200) · `/auth/refresh`(200) · `/auth/logout`(204)
- `GET /auth/me`(🔒) + `JwtAuthGuard` · `AdminGuard` · `@CurrentUser()`

**Phase C — Google OAuth·계정연결·admin seed (`api/src/modules/auth/`):**
- `strategies/google.strategy.ts` — `passport-google-oauth20` 전략. 프로필(sub/email/name)
  추출만 하는 **얇은** 전략, **`email_verified=true`만 수락**. 콜백 4단계 분기는
  `AuthService.handleGoogleLogin`(판별 합집합 `{kind:'authenticated'|'pending'}` 반환)에
  두어 단위 테스트로 검증.
- `GET /auth/google`·`/auth/google/callback`(성공=fragment, 연결필요=`?pending` redirect)
  · `POST /auth/link`(pending JWT + 기존 패스워드 확인 → OAuthAccount 생성)
- **OAuth CSRF 방어:** `strategies/cookie-state.store.ts` — 세션 없는 state store. nonce를
  `HttpOnly`+`SameSite=Lax` 쿠키에 심고 `state`로 전송, 콜백에서 1회성 대조(RFC 9700 §4.7).
  실패(state 불일치·미검증 이메일)는 `guards/google-callback.guard.ts`가
  `WEB_BASE_URL/auth/oauth-error`로 redirect(JSON 401 대신).
- `prisma/seed.ts` + `prisma.config.ts`의 `migrations.seed` — 멱등 ADMIN upsert.
  비번은 `ADMIN_PASSWORD` env에서만(시크릿 외부화).
- env 추가: `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`, `WEB_BASE_URL`, `PENDING_LINK_SECRET`,
  `ADMIN_EMAIL/PASSWORD` (`.env.example`·`.env`).

**에러 카탈로그 단일 출처:** `docs/specs/errors/catalog.json` →
`npm run sync:errors`가 `api/src/common/errors/error-catalog.generated.ts`(gitignore) 생성.
`prebuild`/`pretest`/`start:dev`가 자동 실행. 필터·`AppException`이 이걸 소비.

## 3. 다음 작업 — Slice 2: Catalog (상품 목록·상세)

> 절단면: 공개 읽기 API. 인증 슬라이스의 **단순 계층 패턴**을 그대로 따른다(DDD는 Cart/Order에서).
> **먼저 plan을 작성**하고 사용자 검토 후 구현(roadmap의 세션 재개 가이드 참고).

**범위(api-spec §4):**
- `GET /products` — 페이지네이션(api-spec §1.7) · 정렬/필터
- `GET /products/:id` — 상세, 없으면 `NOT_FOUND`(404)
- `prisma/seed.ts`에 더미 상품 10~30개 추가(기존 ADMIN seed와 공존)

**참고 문서(이것만):**
- [foundation.md](./foundation.md)
- [api-architecture.md §2 단순 계층 패턴](./api-architecture.md#2-단순-계층-패턴-auth-user-address-product)
- [data-model.md ## Product](./data-model.md#product)
- [api-spec.md](./api-spec.md) §1.7(페이지네이션) · §4(Product)

**선행:** `Product` 모델이 `data-model.md`엔 있으나 `schema.prisma`엔 아직 없음 →
모델 추가 + 마이그레이션(`product_init`)부터. User 역참조(§4)는 추가 안 해도 됨.

## 4. 회고 메모 / 미결 사항

- **logout-revoke vs rotation-revoke 미구분 (미반영, 검토만):** logout으로 revoke된 토큰을
  다시 제시하면 "재사용"으로 간주돼 패밀리 전체가 무효화된다. 보안상 안전한 기본값이나, 정상
  로그아웃 후 stale 탭이 모든 세션을 날릴 수 있음. 구분 필요 시 `RefreshToken`에 revoke 사유
  컬럼 추가 검토. **Slice 1 범위에선 의도적으로 미반영.**
- **User 역참조 관계:** `addresses/cartItems/orders`는 각 슬라이스에서 추가(현재 생략).
  `OrderStatus` enum도 Order 슬라이스에서.
- **`IdempotencyKey` 모델:** 주문(Slice 5) 전까지 `data-model.md`에 추가 필요.

## 5. 세션 재개 프롬프트 (복붙용)

```
docs/specs/HANDOFF.md와 roadmap.md를 읽고, Slice 2 — Catalog의 plan을
docs/specs/slice-2-catalog-plan.md에 작성해줘.
참고 문서만 읽을 것: foundation.md, api-architecture.md(§2 단순 계층),
data-model.md(## Product 섹션만), api-spec.md(§1.7·§4).
plan 형식은 superpowers:writing-plans의 TDD 태스크 구조. 작성 후 검토받고 구현.
테스트는 npm test로 실행(npx jest 금지 — ts-jest 미적용).
```

## 6. 로컬에서 실행 · 문서 보기

```bash
# API (api/ 에서 — npm install은 반드시 api/ 에서, §7 참고)
cp .env.example .env     # 최초 1회, 시크릿 채우기
npm install              # 최초 1회
npx prisma migrate dev   # 최초 1회
npx prisma db seed       # 최초 1회 — 초기 ADMIN 생성(ADMIN_PASSWORD 필요)
npm run start:dev        # → http://localhost:4000
npm test                 # 테스트 (npx jest 쓰지 말 것 — ts-jest 미적용)

# 서버 종료는 포트 기준으로 (§8 운영 교훈)
lsof -ti tcp:4000 | xargs -r kill

# 문서 (docs/specs 에서)
python3 -m http.server 8080
#  http://localhost:8080/swagger.html       ← API
#  http://localhost:8080/errors/index.html  ← 에러 카탈로그
```

## 7. 코드 리뷰 1차 반영 (2026-06-04, Phase B 후)

외부 리뷰 6건 모두 검증 후 수정 완료(원자적 커밋). 다음 작업 시 같은 패턴 주의:
- **bcrypt 유령 의존성** → `api/package.json`에 명시(`278dfcb`). `npm install`은 반드시
  `api/`에서 — cwd가 상위면 상위 `package.json`에 깔린다(모듈 해석이 상위로 올라가 가려짐).
- **refresh rotation 경합** → 조건부 `updateMany(id, revokedAt:null)` 원자적 claim(`648cb4c`).
  새 코드도 "확인 후 수정" 2-step 대신 조건부 update로 동시성 보장할 것.
- **signup P2002** → create를 try/catch로 감싸 unique 위반을 409로(`aee458e`).
- **ExceptionFilter 상태코드 보존** → 매핑 안 된 HttpException/`status` 보유 에러(body-parser
  malformed JSON 등)를 500으로 떨구지 않고 상태코드 보존, 카탈로그 없으면 `about:blank`(`6cd6dae`).
- **문서 동기화** → openapi.yaml `type` 예시, roadmap 포인터 정정(`113bd51`).

## 8. 코드 리뷰 2차 반영 (2026-06-04, Phase C 후)

외부 리뷰 4건 모두 검증 후 수정(원자적 커밋). 다음 OAuth 확장(Kakao/Naver)·동시성 작업 시 주의:
- **[High] OAuth login CSRF** → state 검증 부재로 공격자 계정 강제 로그인 가능했음. 세션 없는
  `CookieStateStore`로 nonce를 `HttpOnly`+`SameSite=Lax`+5분 쿠키에 심고 `state` 1회성 대조
  (RFC 9700 §4.7). 콜백 실패는 `WEB_BASE_URL/auth/oauth-error` redirect(`dc32ff0`).
  **새 OAuth provider도 이 store를 재사용**할 것.
- **[Med] 미검증 이메일** → `email_verified=true`만 계정 키로 수락(아니면 UNAUTHORIZED).
  이메일 클레임 기반 계정 선점 방지(`a5317db`).
- **[Med] 신규 가입 P2002** → `handleGoogleLogin`의 create를 try/catch. 경쟁 시 OAuthAccount
  재조회→로그인, email만 선점이면 pending으로 분기 재평가(signup과 동일 패턴)(`2d10ad1`).
- **[Med] seed 비번 미갱신** → upsert `update`에 `passwordHash` 포함. 같은 이메일의 기존 일반
  계정이 옛 비번 그대로 관리자 권한을 얻는 권한 상승 surprise 방지(`a18bd3c`).

**운영 교훈:** `nest start`는 자식 `node dist/src/main`을 fork하므로 `pkill -f "nest start"`로는
포트를 쥔 자식이 안 죽는다. 스모크 테스트 후 서버는 **포트 기준 종료**(`lsof -ti tcp:4000 | xargs kill`).
(이번에 70분 묵은 좀비 서버를 새 코드로 착각해 디버깅이 한참 헛돌았음 — 의심될 땐 격리 프로브로
"코드 자체"를 먼저 검증하면 환경 문제로 빠르게 좁혀짐.)

남은 후속(미수정, 검토만): §4의 **logout-revoke vs rotation-revoke 구분**.
