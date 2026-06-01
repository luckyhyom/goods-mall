# API 스펙 (goods-mall API)

> 백엔드 API 전용 레포의 **엔드포인트 계약 단일 출처**.
> 미래 프런트엔드(별도 레포)가 이 문서를 소비한다.
> 데이터 모델은 [data-model.md](./data-model.md), 아키텍처는 [api-architecture.md](./api-architecture.md), 인증은 [auth-strategy.md](./auth-strategy.md) 참고.

---

## 1. 공통 규약

### 1.1 Base URL · 버저닝

- 모든 API는 **`/api/v1`** 접두사 아래. 구현: `app.setGlobalPrefix('api/v1', { exclude: ['health'] })`
- **예외: `GET /health`** 는 운영/헬스체크 편의상 prefix 밖(`/health`, unversioned)
- 로컬 기준 예: `http://localhost:4000/api/v1/products`

### 1.2 인증 · 권한

- 토큰 전송: `Authorization: Bearer <accessToken>` 헤더
- 가드 표기:
  - 🌐 **공개** — 인증 불필요
  - 🌐+token — 공개 엔드포인트지만 **본문의 토큰/JWT가 권한 증명** (refresh·logout·link)
  - 🔒 **로그인** — `JwtAuthGuard`, 본인 리소스만 접근
  - 👑 **관리자** — `JwtAuthGuard` + `AdminGuard` (role=ADMIN)
- 권한 원칙:
  - `401 Unauthorized` — 토큰 없음/만료/위조 (인증 실패)
  - `403 Forbidden` — 인증됐으나 권한 부족 (예: USER가 admin API 호출)
  - **타인 소유 리소스(주소/주문 등)는 "내 범위에서 없음"으로 `404`** 처리 (존재 은닉)

### 1.3 성공 응답 형식 (봉투 없음)

성공 응답은 wrapper 없이 리소스 DTO를 그대로 반환한다. HTTP status가 이미 성공/실패를 표현하므로 `{ success, data }` 같은 공통 봉투는 두지 않는다.

```jsonc
// 단건
{ "id": "c1", "name": "후드티", "priceWon": 39000 }

// 목록 — 의미 있는 컨테이너 + page
{ "items": [ /* ... */ ], "page": { "limit": 20, "offset": 0, "total": 137 } }

// 도메인 컨테이너 (카트 등)
{ "items": [ /* ... */ ], "totalWon": 78000 }
```

- 생성 성공: **`201 Created`** + 생성된 리소스
- 본문 없는 성공(삭제·로그아웃·카트 비우기): **`204 No Content`** (body 없음)

### 1.4 에러 응답 형식 — RFC 9457 Problem Details

에러는 [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) `application/problem+json` 으로 통일한다. 단일 전역 `ExceptionFilter`가 NestJS 예외를 아래 형태로 변환한다.

```jsonc
// 일반 에러
HTTP/1.1 404 Not Found
Content-Type: application/problem+json
{
  "type": "https://goods-mall.local/problems/product-not-found",
  "title": "Product not found",
  "status": 404,
  "detail": "상품을 찾을 수 없습니다.",
  "instance": "/api/v1/products/zzz",
  "code": "PRODUCT_NOT_FOUND"
}
```

- `code` — HTTP status와 **독립적인 안정 문자열**. 프런트는 메시지(`detail`)가 아니라 **`code`로 분기**한다.
- `type` — 에러 종류 식별용 URI. `goods-mall.local` 호스트는 실제 접속용이 아닌 **문서용 안정 식별자**(로컬 MVP placeholder).
- `title` — 사람이 읽는 짧은 요약(불변), `detail` — 상황별 메시지(가변).

#### 검증 에러 (422)

`class-validator` 검증 실패는 **`422 Unprocessable Entity`** + `errors[]` 확장 필드.

```jsonc
HTTP/1.1 422 Unprocessable Entity
{
  "type": "https://goods-mall.local/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_ERROR",
  "detail": "요청 값이 올바르지 않습니다.",
  "errors": [
    { "field": "email", "code": "INVALID_EMAIL", "message": "올바른 이메일 형식이 아닙니다." },
    { "field": "quantity", "code": "MIN", "message": "1 이상이어야 합니다." }
  ]
}
```

- 중첩/배열 필드는 점·인덱스 표기: `items[0].quantity`, `address.zipCode`

### 1.5 상태 코드 정책

| 코드 | 사용 |
|------|------|
| 200 | 조회·command 성공(상태 반환) |
| 201 | 리소스 생성 |
| 204 | 본문 없는 성공(삭제·로그아웃·카트 비우기) |
| 400 | 잘못된 요청(필수 헤더 누락 등) |
| 401 | 인증 실패/만료 |
| 403 | 권한 부족 |
| 404 | 리소스 없음(타인 리소스 은닉 포함) |
| 409 | 상태 충돌(상태 전이 불가, 멱등성 키 충돌, 재고 부족) |
| 422 | 검증 실패 |
| 503 | 의존 서비스 다운(`/health` DB down) |

### 1.6 날짜 · 금액 규약

- **날짜/시간**: 전부 **UTC ISO 8601** 문자열(`2026-06-01T12:34:56.789Z`). `createdAt`·`updatedAt`·`paidAt`·`expiresAt` 동일. 로컬 타임존 문자열 금지.
- **금액**: `~Won` 정수(`Int`). **음수 불가 · 소수점 금지 · 통화 KRW 고정**. (`priceWon`, `totalWon`, `subtotalWon`, `productPriceWon`)

### 1.7 페이지네이션 · 정렬 · 필터

- 쿼리: `limit`(기본 **20**, 최대 **100**), `offset`(기본 0)
- **페이지네이션 목록** 응답: `{ items, page: { limit, offset, total } }` (products · orders · admin 목록 — 형태 통일)
- **소량 고정 목록**(카트·주소처럼 1유저당 소수)은 `page` 없이 `{ items, … }` — 페이지네이션 미적용(의도적 예외)
- **기본 정렬 + tie-breaker 고정** — offset 안정성 보장. 정렬·필터 파라미터는 **whitelist만** 허용(임의 필드 정렬 금지)
- `sort` 값은 엔드포인트별 enum으로 정의

### 1.8 멱등성 — `POST /orders`

주문 생성은 네트워크 재시도 중 중복 주문을 막기 위해 **`Idempotency-Key` 헤더 필수**.

- 헤더: `Idempotency-Key: <uuid>`
- 스코프: `(userId, Idempotency-Key)` 고유
- 규칙:
  - 같은 키 + **같은 본문** → 최초 결과(201)를 **그대로 재반환**(새 주문 생성 안 함)
  - 같은 키 + **다른 본문** → `409 IDEMPOTENCY_KEY_CONFLICT`
  - 처리 중(in-flight) 동일 키 재요청 → `409 IDEMPOTENCY_KEY_CONFLICT`
  - 키 누락 → `400 IDEMPOTENCY_KEY_REQUIRED`
- **TTL 24h** (이후 동일 키 재사용 가능)
- *구현 메모(계약 외):* 키→응답 저장용 `IdempotencyKey` 테이블 필요 → `data-model.md`에 모델 추가 예정

### 1.9 에러 코드 카탈로그

도메인 prefix로 네이밍. 공통보다 **도메인 에러 코드를 우선** 정의한다.

| 도메인 | code (HTTP) |
|--------|-------------|
| 공통 | `VALIDATION_ERROR`(422) · `UNAUTHORIZED`(401) · `FORBIDDEN`(403) · `NOT_FOUND`(404) · `INTERNAL_ERROR`(500) |
| AUTH | `AUTH_EMAIL_TAKEN`(409) · `AUTH_INVALID_CREDENTIALS`(401) · `AUTH_LOCAL_DISABLED`(401, OAuth 전용 계정) · `AUTH_TOKEN_EXPIRED`(401) · `AUTH_REFRESH_INVALID`(401) · `AUTH_REFRESH_REUSED`(401, 재사용 감지) · `AUTH_LINK_INVALID`(401, pending/password 불일치) |
| PRODUCT | `PRODUCT_NOT_FOUND`(404) · `PRODUCT_OUT_OF_STOCK`(409) |
| CART | `CART_EMPTY`(409) · `CART_ITEM_NOT_FOUND`(404) |
| ADDRESS | `ADDRESS_NOT_FOUND`(404) |
| ORDER | `ORDER_NOT_FOUND`(404) · `ORDER_NOT_PENDING`(409) · `ORDER_ALREADY_PAID`(409) · `ORDER_ALREADY_CANCELED`(409) · `IDEMPOTENCY_KEY_REQUIRED`(400) · `IDEMPOTENCY_KEY_CONFLICT`(409) |

---

## 2. 공통 DTO

```jsonc
// User (응답용 — passwordHash 절대 노출 안 함)
User = { "id", "email", "name", "role": "USER|ADMIN", "createdAt" }

// 인증 토큰 묶음
AuthResult = { "user": User, "accessToken", "refreshToken" }

// 배송지 스냅샷(주문에 박제)
AddressSnapshot = {
  "recipientName", "phone", "zipCode",
  "sido", "sigungu", "bname", "roadName", "detailAddress"
}
```

---

## 3. Auth (Slice 1)

상세 플로우·토큰 정책은 [auth-strategy.md](./auth-strategy.md) 참고.

### POST `/auth/signup` — 🌐
회원가입.
- Body: `{ email, password, name }`
- 201 → `AuthResult`
- 에러: `VALIDATION_ERROR`(422), `AUTH_EMAIL_TAKEN`(409)

### POST `/auth/login` — 🌐
- Body: `{ email, password }`
- 200 → `AuthResult`
- 에러: `AUTH_INVALID_CREDENTIALS`(401), `AUTH_LOCAL_DISABLED`(401, OAuth 전용 계정)

### POST `/auth/refresh` — 🌐+refreshToken
토큰 rotation. **의도적 비멱등**(매 호출 새 refresh 발급, 기존 revoke).
- Body: `{ refreshToken }`
- 200 → `{ accessToken, refreshToken }`
- 에러: `AUTH_REFRESH_INVALID`(401), `AUTH_TOKEN_EXPIRED`(401), `AUTH_REFRESH_REUSED`(401 — 해당 유저 전체 토큰 무효화)

### POST `/auth/logout` — 🌐+refreshToken
- Body: `{ refreshToken }`
- 204 (해당 refresh revoke)

### GET `/auth/me` — 🔒
- 200 → `{ user: User }`

### GET `/auth/google` — 🌐
Google 인증 페이지로 302 리디렉트.

### GET `/auth/google/callback` — 🌐
Google 콜백. 결과에 따라 fragment redirect:
- 신규/기존 로그인 → `302 {WEB_BASE_URL}/auth/oauth-success#accessToken=…&refreshToken=…`
- 계정 연결 필요 → `302 {WEB_BASE_URL}/auth/link?pending=<pending_jwt>`

### POST `/auth/link` — 🌐+pendingToken
LOCAL 계정에 OAuth 연결(기존 패스워드 확인).
- Body: `{ pending, password }`
- 200 → `AuthResult`
- 에러: `AUTH_LINK_INVALID`(401)

---

## 4. Product / Catalog (Slice 2) — 공개 읽기

### GET `/products` — 🌐
상품 목록.
- Query:
  - `q` (string, 선택) — 이름 검색
  - `minPriceWon`, `maxPriceWon` (int, 선택)
  - `sort` (enum: `latest`(기본) · `price_asc` · `price_desc`) — tie-breaker `id desc`
  - `limit`(기본 20, 최대 100), `offset`(기본 0)
- 200 → `{ items: ProductSummary[], page }`
  - `ProductSummary = { id, name, priceWon, stock, imageUrl }`
- 노출 범위: `isActive=true` 만 (관리자 목록은 §8 참고)

### GET `/products/:id` — 🌐
- 200 → `Product = { id, name, description, priceWon, stock, imageUrl, isActive, createdAt, updatedAt }`
- 에러: `PRODUCT_NOT_FOUND`(404)

---

## 5. Cart (Slice 3) — 🔒 내 카트

Cart는 테이블 없는 Aggregate(= `cart_items` 행 집합). 응답은 상품 정보를 join한 화면용 DTO.

```jsonc
CartItem = { "productId", "productName", "productImage", "priceWon", "quantity", "subtotalWon" }
Cart     = { "items": CartItem[], "totalWon" }
```

### GET `/cart` — 🔒
- 200 → `Cart`

### POST `/cart/items` — 🔒
담기. 같은 상품이면 수량 합산(`@@unique([userId, productId])`).
- Body: `{ productId, quantity }` (quantity ≥ 1)
- 200 → `Cart`
- 에러: `PRODUCT_NOT_FOUND`(404), `PRODUCT_OUT_OF_STOCK`(409), `VALIDATION_ERROR`(422)

### PATCH `/cart/items/:productId` — 🔒
수량 변경(절대값).
- Body: `{ quantity }` (quantity ≥ 1)
- 200 → `Cart`
- 에러: `CART_ITEM_NOT_FOUND`(404), `PRODUCT_OUT_OF_STOCK`(409), `VALIDATION_ERROR`(422)

### DELETE `/cart/items/:productId` — 🔒
항목 삭제.
- 204
- 에러: `CART_ITEM_NOT_FOUND`(404)

### DELETE `/cart` — 🔒
전체 비우기.
- 204

---

## 6. Address (Slice 4) — 🔒 내 주소

```jsonc
Address = {
  "id", "label", "recipientName", "phone",
  "zipCode", "sido", "sigungu", "bname", "roadName", "detailAddress",
  "isDefault", "createdAt", "updatedAt"
}
```

> 우편번호 검색(카카오 API)은 **클라이언트에서 호출**하고, 그 결과(zipCode/sido/sigungu/bname/roadName)를 본문에 담아 저장한다. 서버는 검색 API를 호출하지 않는다.

### GET `/addresses` — 🔒
- 200 → `{ items: Address[] }` (보통 소량 — 페이지네이션 없음, 기본 주소 우선·최신순)

### POST `/addresses` — 🔒
- Body: `{ label, recipientName, phone, zipCode, sido, sigungu, bname, roadName, detailAddress, isDefault? }`
- 201 → `Address`
- `isDefault=true`로 추가 시 기존 기본 주소는 해제(기본은 항상 1개)
- 에러: `VALIDATION_ERROR`(422)

### PATCH `/addresses/:id` — 🔒
부분 수정.
- Body: 위 필드의 부분집합
- 200 → `Address`
- 에러: `ADDRESS_NOT_FOUND`(404), `VALIDATION_ERROR`(422)

### DELETE `/addresses/:id` — 🔒
- 204
- 에러: `ADDRESS_NOT_FOUND`(404)

### POST `/addresses/:id/default` — 🔒
기본 주소 지정(command). 다른 주소의 `isDefault` 자동 해제.
- 200 → `Address`
- 에러: `ADDRESS_NOT_FOUND`(404)

---

## 7. Order (Slice 5) — 🔒 내 주문

```jsonc
OrderItem    = { "productId", "productName", "productPriceWon", "quantity" }
OrderSummary = { "orderNumber", "status", "totalWon", "itemCount", "createdAt", "paidAt" }
Order        = {
  "orderNumber", "status": "PENDING|PAID|CANCELED", "totalWon",
  "recipient": AddressSnapshot,
  "items": OrderItem[],
  "createdAt", "paidAt"
}
```

> 주문은 `orderNumber`("ORD-YYYYMMDD-XXXX")로 조회한다. 내부 cuid `id`는 외부 노출하지 않는다.

### POST `/orders` — 🔒 · `Idempotency-Key` 필수
현재 카트 + 선택 배송지로 주문 생성. 상품·배송지 스냅샷 박제, **주문 시점 재고 재검증**.
- Header: `Idempotency-Key: <uuid>` (§1.8)
- Body: `{ addressId }` (카트는 서버 보유)
- 201 → `Order` (status=PENDING)
- 에러: `CART_EMPTY`(409), `PRODUCT_OUT_OF_STOCK`(409), `ADDRESS_NOT_FOUND`(404), `IDEMPOTENCY_KEY_REQUIRED`(400), `IDEMPOTENCY_KEY_CONFLICT`(409)

> ⚠️ 카트에 담을 땐 성공했어도, 주문 생성 시점 재고 부족이면 `PRODUCT_OUT_OF_STOCK`가 날 수 있다.

### GET `/orders` — 🔒
내 주문내역(최신순).
- Query: `limit`(기본 20, 최대 100), `offset`
- 200 → `{ items: OrderSummary[], page }`

### GET `/orders/:orderNumber` — 🔒
- 200 → `Order`
- 에러: `ORDER_NOT_FOUND`(404, 타인 주문 포함)

### POST `/orders/:orderNumber/pay` — 🔒
결제 시뮬레이션. `PENDING → PAID` (+ `paidAt`). `OrderPlacedEvent` → 재고 차감.
- 200 → `Order`
- 에러: `ORDER_NOT_FOUND`(404), `ORDER_NOT_PENDING`(409), `ORDER_ALREADY_PAID`(409)

### POST `/orders/:orderNumber/cancel` — 🔒
주문 취소. `PENDING → CANCELED`.
- 200 → `Order`
- 에러: `ORDER_NOT_FOUND`(404), `ORDER_NOT_PENDING`(409), `ORDER_ALREADY_CANCELED`(409)

---

## 8. Admin (Slice 6) — 👑

### GET `/admin/products` — 👑
관리자 상품 목록(**비활성 포함**).
- Query: `q`, `isActive`(선택 필터), `sort`(`latest`·`price_asc`·`price_desc`), `limit`/`offset`
- 200 → `{ items: Product[], page }`

### GET `/admin/products/:id` — 👑
수정 화면 진입용(비활성 포함).
- 200 → `Product`
- 에러: `PRODUCT_NOT_FOUND`(404)

### POST `/admin/products` — 👑
상품 생성. 이미지는 **`imageUrl` 문자열**로 받는다(MVP — multipart 업로드는 후순위).
- Body: `{ name, description, priceWon, stock, imageUrl, isActive? }`
- 201 → `Product`
- 에러: `VALIDATION_ERROR`(422)

### PATCH `/admin/products/:id` — 👑
부분 수정.
- Body: 위 필드의 부분집합
- 200 → `Product`
- 에러: `PRODUCT_NOT_FOUND`(404), `VALIDATION_ERROR`(422)

### DELETE `/admin/products/:id` — 👑
**Soft delete** — 실제로는 `isActive=false`로 비활성화(주문 이력 보존을 위해 hard delete 안 함).
- 204
- 에러: `PRODUCT_NOT_FOUND`(404)

### GET `/admin/orders` — 👑
전체 주문 조회.
- Query: `status`(선택 필터: `PENDING`·`PAID`·`CANCELED`), `limit`/`offset` — 최신순
- 200 → `{ items: AdminOrderSummary[], page }`
  - `AdminOrderSummary = { orderNumber, status, totalWon, itemCount, userId, createdAt, paidAt }`

---

## 9. System

### GET `/health` — 🌐 (prefix 밖, `/health`)
DB ping.
- 200 → `{ "status": "ok", "db": "up" }`
- **503** → `{ "status": "error", "db": "down" }` (DB 연결 실패 시)

---

## 부록 — 미해결/후순위

- **이미지 multipart 업로드**(`POST /admin/products/:id/image`, Multer + `uploads/` + ServeStaticModule) — MVP 이후. 현재는 `imageUrl` 문자열만.
- **`IdempotencyKey` 모델** — `data-model.md`에 추가 필요(§1.8).
- **OpenAPI 자동화** — 규모 확대 시 `@nestjs/swagger` 데코레이터로 코드에서 생성 검토(현재는 수동 마크다운).
- 향후 데이터 증가 시 목록 페이지네이션을 cursor 방식으로 전환 검토(현 계약은 유지).
