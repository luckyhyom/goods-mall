# 다음 세션 핸드오프 (goods-mall API)

> 마지막 갱신: 2026-06-04.
> **새 세션은 이 문서부터 읽으세요.** 그다음 [roadmap.md](./roadmap.md).

---

## 1. 현재 상태

- **Slice 0 (Bootstrap) 완료** — NestJS 11 + Prisma 7 + MariaDB, `GET /health`
- **API 계약 설계 완료** — [api-spec.md](./api-spec.md) / [openapi.yaml](./openapi.yaml) / [errors/](./errors/)
- **Slice 1 (Auth) — Phase A·B 완료, Phase C(OAuth) 남음**
  - 계획: [slice-1-auth-plan.md](./slice-1-auth-plan.md)
  - **코드 리뷰 1차 반영 완료** (6건 수정, 아래 §7). 빌드 클린, 테스트 **17/17** 통과
- **프런트엔드 별도 레포** — 이 레포는 백엔드 API 전용

## 2. Slice 1에서 지금까지 구현된 것 (코드 존재)

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

**에러 카탈로그 단일 출처:** `docs/specs/errors/catalog.json` →
`npm run sync:errors`가 `api/src/common/errors/error-catalog.generated.ts`(gitignore) 생성.
`prebuild`/`pretest`/`start:dev`가 자동 실행. 필터·`AppException`이 이걸 소비.

## 3. 다음 작업 — Slice 1 Phase C: Google OAuth + 계정 연결 + admin seed

> **선행 조건:** Google Cloud 콘솔에서 OAuth 클라이언트를 만들어
> `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 확보 (없으면 end-to-end 검증 불가).

**구현 (slice-1-auth-plan.md Phase C):**
- **C1** `passport-google-oauth20` 전략 + `GET /auth/google`·`/auth/google/callback`
  — 콜백 4단계(auth-strategy §5), 성공 시 `#accessToken=…&refreshToken=…` fragment redirect,
  연결 필요 시 `?pending=<jwt>` redirect
- **C2** `POST /auth/link` — pending JWT 검증 + 기존 패스워드 확인 후 OAuthAccount 생성
- **C3** `prisma/seed.ts` — 첫 ADMIN 계정(auth-strategy §10)
- env 추가: `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`, `WEB_BASE_URL`, `PENDING_LINK_SECRET`

**그 후 Phase D:** 통합 검증 + 회고(아래 4번 반영) + roadmap 체크박스 완료.

**참고 문서(이것만):** [auth-strategy.md](./auth-strategy.md) §5·§6·§10, [api-spec.md](./api-spec.md) §3

## 4. 회고 메모 (Phase C/D에서 반영 검토)

- **logout-revoke vs rotation-revoke 미구분:** logout으로 revoke된 토큰을 다시 제시하면
  "재사용"으로 간주돼 패밀리 전체가 무효화된다. 보안상 안전한 기본값이나, 정상 로그아웃 후
  stale 탭이 모든 세션을 날릴 수 있음. 구분 필요 시 RefreshToken에 revoke 사유 컬럼 추가 검토.
- **`type` URL 정정 완료:** 옛 `goods-mall.local/problems/*` → 실제 계약인
  `https://docs.goods-mall.dev/errors/<CODE>`. api-spec.md·openapi.yaml 모두 수정됨(catalog.json과 일치).
- **User 역참조 관계:** `addresses/cartItems/orders`는 각 슬라이스에서 추가(현재 생략). `OrderStatus` enum도 Order 슬라이스에서.
- **`IdempotencyKey` 모델:** 주문(Slice 5) 전까지 `data-model.md`에 추가 필요.

## 5. 세션 재개 프롬프트 (복붙용)

```
docs/specs/HANDOFF.md와 slice-1-auth-plan.md(Phase C)를 읽고,
Slice 1 Phase C — Google OAuth·계정연결·admin seed를 구현해줘.
참고 문서만 읽을 것: auth-strategy.md §5·§6·§10, api-spec.md §3.
테스트는 npm test로 실행(npx jest 금지). 콜백 분기 로직은 단위 테스트로 검증.
```

## 6. 로컬에서 실행 · 문서 보기

```bash
# API (api/ 에서)
cp .env.example .env   # 최초 1회, 시크릿 채우기
npm install            # 최초 1회
npx prisma migrate dev # 최초 1회
npm run start:dev      # → http://localhost:4000
npm test               # 테스트 (npx jest 쓰지 말 것 — ts-jest 미적용)

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

남은 후속(미수정, 검토만): §4의 **logout-revoke vs rotation-revoke 구분**.
