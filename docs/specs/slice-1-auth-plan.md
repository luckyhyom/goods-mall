# Slice 1 — Auth Implementation Plan

> **형식 원칙:** 이 plan은 **작은 스코프 · 코드 미포함**이다. 구현 코드 스니펫·플로우는
> 이미 [auth-strategy.md](./auth-strategy.md)에 있으니 중복하지 않고 참조한다.
> 각 Task는 *무엇을·왜* 만드는지와 검증·커밋만 기술한다. 코드는 구현 시점에 작성.

**Goal:** 인증 엔드포인트(signup/login/refresh/logout/me/google/google-callback/link)를 구현한다.
단, 그 전에 **모든 슬라이스가 의존하는 공통 토대**(global prefix · 422 검증 · RFC 9457 에러 · health 503)부터 세운다.

**참고 문서 (이것만):**
- [api-spec.md](./api-spec.md) §1(공통 규약) · §3(Auth)
- [auth-strategy.md](./auth-strategy.md) — 토큰 정책 · 플로우 · NestJS 구조 · 가드 코드 · env
- [data-model.md](./data-model.md) `## User & OAuthAccount & RefreshToken` 섹션만
- [foundation.md](./foundation.md) — 폴더 구조 · 기술 스택
- [errors/catalog.json](./errors/catalog.json) — `code → type/title/status` 매핑 (ExceptionFilter가 소비)

**스코프 경계 (이번 슬라이스에서 *하지 않는* 것):**
- `IdempotencyKey`, 상품/카트/주문 등 다른 도메인 — 해당 슬라이스로 이연
- rate limit(패스워드 시도 제한) — MVP 범위 외 (auth-strategy §6)
- 프런트엔드 — 별도 레포

---

## Phase A — 공통 토대 (cross-cutting, 인증보다 먼저)

> 이 Phase는 인증과 독립적이며 이후 모든 슬라이스가 의존한다. 먼저 완료·검증한다.

### Task A1: Global prefix `/api/v1`
**파일:** `api/src/main.ts` 수정
- `app.setGlobalPrefix('api/v1', { exclude: ['health'] })` 적용 (api-spec §1.1)
- **검증:** 서버 기동 후 `GET /health` 200(prefix 밖), 미정의 `GET /api/v1/ping`이 404(prefix 안에서 매칭)임을 확인
- **커밋:** `feat(api): /api/v1 글로벌 prefix 적용 (health 제외)`

### Task A2: 전역 ValidationPipe → 422 + `errors[]`
**파일:** `api/src/main.ts`, `api/src/common/` (검증 예외 → 422 변환 지점)
- `class-validator`/`class-transformer` 설치, 전역 `ValidationPipe`(whitelist·transform) 등록
- 검증 실패를 **422 `VALIDATION_ERROR` + `errors:[{field,code,message}]`** 로 매핑 (api-spec §1.4)
  - 기본 `ValidationPipe`는 400을 던지므로, `exceptionFactory`로 422 + `errors[]` 형태를 만든다
  - 중첩/배열 필드는 점·인덱스 표기(`items[0].quantity`) — class-validator property path 사용
- **결정 포인트:** `errors[].code`(예 `INVALID_EMAIL`, `MIN`)를 class-validator constraint 키에서 매핑. 매핑 규칙을 한 곳(util)에 모은다
- **검증:** 임시 DTO로 잘못된 body → 422 + `errors[]` 응답 확인 (Phase B에서 실제 DTO로 재검증)
- **커밋:** `feat(api): 검증 실패를 422 + errors[] (RFC 9457)로 변환`

### Task A3: 전역 ExceptionFilter → RFC 9457 `application/problem+json`
**파일:** `api/src/common/filters/problem-details.filter.ts`(신규), `api/src/main.ts`(등록)
- 모든 미처리 예외를 `application/problem+json`(`type/title/status/code/detail/instance`)으로 변환 (api-spec §1.4)
- **`code → type/title/status` 는 [errors/catalog.json](./errors/catalog.json)을 단일 출처로 사용** — 문자열 하드코딩 대신 카탈로그를 읽어 매핑(런타임 로드 또는 빌드 시 동봉)
- 도메인 에러를 던질 수단: `code` + `status`를 담는 앱 전용 예외 클래스(예 `AppException(code)`)를 `common/`에 정의 → 필터가 카탈로그에서 나머지 필드 채움
- NestJS 기본 `HttpException`(404/401/403 등)도 적절한 공통 `code`로 매핑(`NOT_FOUND`/`UNAUTHORIZED`/`FORBIDDEN`)
- `instance`는 요청 경로(`/api/v1/...`)
- **검증:** 임시 라우트에서 `AppException('AUTH_INVALID_CREDENTIALS')` 던지면 401 + `code` + `type`(catalog와 일치) 응답. `Content-Type: application/problem+json` 헤더 확인
- **커밋:** `feat(api): RFC 9457 ExceptionFilter 추가 (errors 카탈로그 기반)`

### Task A4: `/health` DB down 시 503
**파일:** `api/src/health/health.controller.ts`, `health.controller.spec.ts` 수정
- 현재 DB down에도 200을 반환 → **DB ping 실패 시 503** 으로 변경 (api-spec §1.5, HANDOFF §4)
- **TDD:** 기존 spec의 "down" 케이스를 503 기대로 수정 → 구현 → green
- **검증:** `npx jest health` green; (선택) DB 정지 후 `GET /health` 503
- **커밋:** `fix(api): DB 다운 시 /health를 503으로 반환`

---

## Phase B — 로컬 인증 (signup/login/refresh/logout/me)

> auth-strategy §4(플로우) · §7(NestJS 구조) · §8(가드) · §9(env)에 코드/구조가 이미 있음. 그대로 따른다.

### Task B1: Prisma 모델 + 첫 SQL 마이그레이션
**파일:** `api/prisma/schema.prisma` 수정
- `Role`/`OAuthProvider` enum + `User`/`OAuthAccount`/`RefreshToken` 모델 추가 (data-model.md 해당 섹션 그대로)
- 이번 슬라이스 범위 밖 모델(Address/Product/CartItem/Order...)은 **아직 추가하지 않음** — 단, User에 걸린 관계 필드는 컴파일을 위해 최소만(또는 해당 슬라이스에서 관계 추가). 관계 대상 모델이 없으면 일단 User의 역참조 필드를 생략하고 각 슬라이스에서 양방향 관계를 채운다
- `npx prisma migrate dev --name auth_init` → **첫 SQL 마이그레이션 파일 생성**(slice-0에선 빈 스키마라 없었음), `npx prisma generate`
- **검증:** `migrate status` up to date; 생성된 마이그레이션 SQL에 3개 테이블·unique(`@@unique([provider,providerId])`, `[userId,provider]`, `RefreshToken.tokenHash`) 존재 확인
- **커밋:** `feat(auth): User·OAuthAccount·RefreshToken 모델 및 첫 마이그레이션`

### Task B2: Auth 모듈 골격 + TokenService
**파일:** `api/src/modules/auth/` (auth-strategy §7 구조: controller/service/token.service/strategies/guards/decorators/dto)
- 의존성: `@nestjs/jwt @nestjs/passport passport passport-jwt bcrypt` (+ types)
- `TokenService`: access 발급/검증(JWT), refresh 발급(평문 반환 + `sha256` DB 저장)·검증·**rotation**·**재사용 감지**(auth-strategy §3, §4 refresh 플로우)
- env 추가: `JWT_ACCESS_SECRET/JWT_ACCESS_TTL/REFRESH_TTL_DAYS` (`.env`, `.env.example` — 시크릿 외부화 원칙)
- **TDD 우선순위:** TokenService의 rotation·재사용 감지 로직은 핵심 도메인 → 단위 테스트 작성(foundation: 핵심 도메인만 테스트)
- **검증:** `npx jest token` green
- **커밋:** `feat(auth): JWT/refresh 토큰 발급·rotation·재사용 감지 TokenService`

### Task B3: signup / login
**파일:** `auth.controller.ts`, `auth.service.ts`, `dto/signup.dto.ts`, `dto/login.dto.ts`
- `POST /auth/signup`(🌐): 이메일 중복→`AUTH_EMAIL_TAKEN`(409), `bcrypt.hash(.,12)`, 201 `AuthResult` (api-spec §3, auth-strategy §4)
- `POST /auth/login`(🌐): passwordHash null→`AUTH_LOCAL_DISABLED`(401), 불일치→`AUTH_INVALID_CREDENTIALS`(401), 200 `AuthResult`
- DTO에 class-validator 규칙 → Phase A2의 422 동작을 실제로 검증
- **응답 규약:** `User` DTO에 `passwordHash` 절대 미노출 (api-spec §2)
- **검증:** TDD(service 단위) + 수동 `curl` 로 signup→login→`AuthResult` 흐름; 잘못된 email로 422
- **커밋:** `feat(auth): 회원가입·로그인 엔드포인트`

### Task B4: refresh / logout
**파일:** `auth.controller.ts`, `dto/refresh.dto.ts`
- `POST /auth/refresh`(🌐+refreshToken): rotation. 만료→`AUTH_TOKEN_EXPIRED`, 무효→`AUTH_REFRESH_INVALID`, revoked 재사용→`AUTH_REFRESH_REUSED`(유저 전체 토큰 revoke) 모두 401, 정상 200 `{accessToken,refreshToken}`
- `POST /auth/logout`(🌐+refreshToken): 해당 refresh revoke, 204
- **검증:** 재사용 감지 시나리오 단위 테스트(이미 B2에서 일부) + 수동 curl
- **커밋:** `feat(auth): 토큰 갱신(rotation)·로그아웃 엔드포인트`

### Task B5: JwtAuthGuard + CurrentUser + `/auth/me`
**파일:** `guards/jwt-auth.guard.ts`, `guards/admin.guard.ts`, `decorators/current-user.decorator.ts`, controller (auth-strategy §8에 코드 있음)
- `GET /auth/me`(🔒): `JwtAuthGuard` → `req.user`, 200 `{user}`
- `AdminGuard`도 함께 정의(다른 슬라이스가 의존; 여기선 me에 미적용이라도 준비)
- 토큰 없음/만료/위조 → 401 `UNAUTHORIZED`/`AUTH_TOKEN_EXPIRED` (api-spec §1.2)
- **검증:** 토큰 있이/없이 `/auth/me` → 200/401
- **커밋:** `feat(auth): JwtAuthGuard·CurrentUser 및 /auth/me`

---

## Phase C — Google OAuth + 계정 연결

> auth-strategy §5(콜백·fragment) · §6(linking)에 단계별 플로우가 이미 있음.

### Task C1: Google OAuth (`/auth/google`, `/auth/google/callback`)
**파일:** `strategies/google.strategy.ts`, controller (auth-strategy §5)
- 의존성 `passport-google-oauth20`; env `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`, `WEB_BASE_URL`
- 콜백 4단계(auth-strategy §5): OAuthAccount 조회 → User(email) 조회 → 신규가입 또는 pending_link 분기 → fragment redirect
- redirect: 로그인 성공 시 `#accessToken=…&refreshToken=…`, 연결 필요 시 `?pending=<jwt>` (api-spec §3)
- **검증:** (로컬 Google 자격증명 필요) 수동 OAuth 1회 또는 strategy validate 단위 테스트로 분기 검증
- **커밋:** `feat(auth): Google OAuth 로그인·콜백 (fragment redirect)`

### Task C2: 계정 연결 (`/auth/link`)
**파일:** `dto/link.dto.ts`, controller, env `PENDING_LINK_SECRET` (auth-strategy §6)
- `POST /auth/link`(🌐+pendingToken): pending JWT 검증 → 기존 패스워드 확인(bcrypt) → OAuthAccount 생성 → 200 `AuthResult`
- 실패(pending 만료/패스워드 불일치/OAuth전용계정)→`AUTH_LINK_INVALID`(401)
- **검증:** pending JWT 생성→link 흐름 단위/수동 테스트
- **커밋:** `feat(auth): OAuth 계정 연결 엔드포인트`

### Task C3: Admin seed
**파일:** `api/prisma/seed.ts` (auth-strategy §10)
- 첫 ADMIN 시드: `admin@goods-mall.local` (비밀번호는 env/플레이스홀더, 시크릿 외부화)
- **검증:** seed 실행 후 ADMIN 1명 존재
- **커밋:** `chore(auth): 초기 ADMIN 계정 seed`

---

## Phase D — 마무리

### Task D1: 통합 검증
- `cd api && npm run build` 성공
- `npx jest` 전체 green
- 수동 시나리오: signup → me(401 없이) → refresh → logout → refresh(실패) → 재사용(전체 revoke)
- 잘못된 입력 → 422 `errors[]`; 도메인 에러 → `application/problem+json` + `code`(카탈로그 일치)

### Task D2: 회고 + roadmap 갱신
- `roadmap.md` Slice 1 체크박스·`**Plan:**` 링크 갱신
- 회고에서 발견점이 있으면 `foundation.md`/`data-model.md`에 반영(예: User 역참조 관계 처리 방식, IdempotencyKey 추가 시점)
- HANDOFF.md를 다음 슬라이스(Slice 2 — Catalog) 기준으로 갱신
- **커밋:** `docs(spec): Slice 1 완료 반영 및 핸드오프 갱신`

---

## Self-Review 체크리스트
- [ ] api-spec §3의 8개 엔드포인트 전부 Task에 매핑 (signup·login·refresh·logout·me·google·google/callback·link)
- [ ] 공통 토대 4종(prefix·422·RFC9457·health503)이 인증보다 **먼저**
- [ ] 에러 `code`가 errors/catalog.json과 1:1 (하드코딩 아님)
- [ ] `passwordHash` 응답 미노출, refresh는 `tokenHash`만 DB 저장
- [ ] 시크릿 전부 `.env`/`.env.example` 외부화
- [ ] 각 커밋 단위가 원자적이고 빌드 성공 (commit-rules 준수)
