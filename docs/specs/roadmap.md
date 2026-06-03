# 슬라이스 로드맵

> 각 슬라이스 진행 상태와 다음 단계 추적.
> 슬라이스 완료마다 체크박스 갱신.
>
> **범위:** 백엔드 API 전용. 각 슬라이스는 도메인별 API 절단면을 완성한다.
> 프런트엔드(화면)는 별도 레포에서 이 API를 소비한다.
>
> **새 세션은 [HANDOFF.md](./HANDOFF.md)부터 읽으세요** — 현재 상태·다음 작업·재개 프롬프트 정리.
> API 계약은 [api-spec.md](./api-spec.md) / [openapi.yaml](./openapi.yaml) / [errors/](./errors/).

---

## 진행 상태

- [x] **Slice 0 — Bootstrap**
  - [x] Plan 작성 (`slice-0-bootstrap-plan.md`)
  - [x] 구현
  - [x] 회고
- [ ] **Slice 1 — Auth** (로컬 인증 완료, OAuth 남음)
  - [x] Plan 작성 (`slice-1-auth-plan.md`)
  - [~] 구현 — Phase A(공통 토대)·B(로컬 인증: signup/login/refresh/logout/me + 가드) 완료. Phase C(Google OAuth·계정연결·admin seed) 남음
  - [ ] 회고 (Phase C 후)
- [ ] **Slice 2 — Catalog**
  - [ ] Plan 작성 (`slice-2-catalog-plan.md`)
  - [ ] 구현
  - [ ] 회고
- [ ] **Slice 3 — Cart** (DDD)
  - [ ] Plan 작성 (`slice-3-cart-plan.md`)
  - [ ] 구현
  - [ ] 회고
- [ ] **Slice 4 — Address**
  - [ ] Plan 작성 (`slice-4-address-plan.md`)
  - [ ] 구현
  - [ ] 회고
- [ ] **Slice 5 — Order** (DDD)
  - [ ] Plan 작성 (`slice-5-order-plan.md`)
  - [ ] 구현
  - [ ] 회고
- [ ] **Slice 6 — Admin**
  - [ ] Plan 작성 (`slice-6-admin-plan.md`)
  - [ ] 구현
  - [ ] 회고

---

## 슬라이스별 상세

### Slice 0 — Bootstrap

**핵심 기능:** 개발 환경 구축
- Docker Compose (MariaDB)
- NestJS skeleton
- Prisma 7 어댑터 연결 + 마이그레이션 파이프라인 확립 (빈 schema라 첫 SQL 마이그레이션은 Slice 1에서 생성)
- `/health` 엔드포인트 (DB ping)

**참고 문서:** [foundation.md](./foundation.md)

**Plan:** [slice-0-bootstrap-plan.md](./slice-0-bootstrap-plan.md)

---

### Slice 1 — Auth

**핵심 기능:**
- 이메일/패스워드 회원가입·로그인
- JWT Access + Refresh Token (Rotation + 재사용 감지)
- Google OAuth (URL fragment 콜백)
- 계정 연결 (LOCAL + OAuth)
- JwtAuthGuard / AdminGuard

**구현 전제(공통 토대):** global prefix `/api/v1`, 전역 ValidationPipe→422, RFC 9457 ExceptionFilter, health 503. 자세히는 [HANDOFF.md §3](./HANDOFF.md).

**참고 문서:**
- [foundation.md](./foundation.md)
- [api-spec.md](./api-spec.md) (§1 공통 규약, §3 Auth)
- [auth-strategy.md](./auth-strategy.md)
- [data-model.md ## User & OAuthAccount & RefreshToken](./data-model.md#user--oauthaccount--refreshtoken)

**Plan:** [slice-1-auth-plan.md](./slice-1-auth-plan.md)

**진행:** Phase A(prefix·422·RFC9457·health503)·B(로컬 인증 전체) 완료, 빌드/테스트 통과.
남은 Phase C(Google OAuth·계정연결·admin seed)는 `GOOGLE_CLIENT_ID/SECRET` 자격증명
확보 후 진행. 상세는 [HANDOFF.md](./HANDOFF.md).

---

### Slice 2 — Catalog

**핵심 기능:**
- 상품 목록 API (페이지네이션)
- 상품 상세 API
- Prisma seed (10~30개 더미 상품)

**참고 문서:**
- [foundation.md](./foundation.md)
- [api-architecture.md ## 2. 단순 계층 패턴](./api-architecture.md#2-단순-계층-패턴-auth-user-address-product)
- [data-model.md ## Product](./data-model.md#product)

**Plan:** _(작성 후 링크)_

---

### Slice 3 — Cart (DDD)

**핵심 기능:**
- 장바구니 추가 / 삭제 / 수량 변경 / 비우기
- Cart Aggregate (테이블 없는 패턴) + CartItem Entity + Quantity VO
- Repository 인터페이스 + Prisma 구현 + Mapper
- AddItem/RemoveItem/ChangeQuantity/Clear Command Handler
- GetCart Query Handler (Prisma 직접)

**참고 문서:**
- [foundation.md](./foundation.md)
- [api-architecture.md](./api-architecture.md) (Clean Architecture 패턴 전체)
- [../architecture/ddd-rules.md](../architecture/ddd-rules.md)
- [data-model.md ## CartItem](./data-model.md#cartitem-cart-테이블-없는-aggregate-패턴)

**Plan:** _(작성 후 링크)_

---

### Slice 4 — Address

**핵심 기능:**
- 주소 목록 / 추가 / 수정 / 삭제 API
- 기본 주소 설정 (`isDefault` 1개 유지)
- `extractRoadName` 유틸 (우편번호 검색은 클라이언트에서 호출, 결과를 저장)

**참고 문서:**
- [foundation.md](./foundation.md)
- [data-model.md ## Address](./data-model.md#address)

**Plan:** _(작성 후 링크)_

---

### Slice 5 — Order (DDD)

**핵심 기능:**
- 주문 생성 API (장바구니 → 배송지 선택 → 결제 시뮬레이션)
- Order Aggregate + OrderItem Entity
- 주문 생성 (Cart → Order 변환, 상품·주소 스냅샷)
- 결제 시뮬레이션 (PENDING → PAID)
- `OrderPlacedEvent` → Product 재고 차감 핸들러
- 주문내역 / 주문 상세 조회 API
- `orderNumber` 발급 ("ORD-YYYYMMDD-XXXX")

**참고 문서:**
- [foundation.md](./foundation.md)
- [api-architecture.md](./api-architecture.md) (Clean Architecture 전체 + Domain Event)
- [../architecture/ddd-rules.md](../architecture/ddd-rules.md)
- [data-model.md ## Order & OrderItem](./data-model.md#order--orderitem)
- [data-model.md ## Address](./data-model.md#address) (배송지 스냅샷 출처)
- [data-model.md ## CartItem](./data-model.md#cartitem-cart-테이블-없는-aggregate-패턴) (주문 전 카트 조회)

**Plan:** _(작성 후 링크)_

---

### Slice 6 — Admin

**핵심 기능:**
- 관리자 상품 CRUD API
- 이미지 업로드 (Multer + 로컬 디스크 `uploads/`)
- ServeStaticModule로 `/uploads` 정적 서빙
- AdminGuard로 권한 체크

**참고 문서:**
- [foundation.md](./foundation.md)
- [api-architecture.md ## 2. 단순 계층 패턴](./api-architecture.md#2-단순-계층-패턴-auth-user-address-product)
- [data-model.md ## Product](./data-model.md#product)

**Plan:** _(작성 후 링크)_

---

## 세션 재개 가이드

새 세션을 시작할 때 다음 프롬프트를 그대로 복사해 사용하세요:

```
docs/specs/roadmap.md를 먼저 읽고, 첫 번째 미완료 슬라이스의 plan을 작성해줘.
plan 작성 시 해당 슬라이스의 "참고 문서" 목록에 명시된 파일들만 읽어서
컨텍스트에 포함시켜줘 (전체 spec을 모두 읽지 말 것).

plan 형식은 superpowers:writing-plans 스킬의 구조를 사용하되, 출력 위치는
docs/specs/slice-N-<name>-plan.md.

작성 후 사용자 검토 → 실행 스킬(subagent-driven-development 또는
executing-plans)로 구현.
```

또는 슬라이스를 명시:
```
docs/specs/roadmap.md의 "Slice 1 — Auth" 항목을 참고해
plan을 docs/specs/slice-1-auth-plan.md에 작성해줘.

참고 문서만 읽을 것:
- docs/specs/foundation.md
- docs/specs/auth-strategy.md
- docs/specs/data-model.md (## User & OAuthAccount & RefreshToken 섹션만)

plan 형식: superpowers:writing-plans 스킬의 TDD 태스크 구조.
```

### 슬라이스 완료 후 갱신할 것

1. 이 문서(`roadmap.md`)의 진행 상태 체크박스 갱신
2. 해당 슬라이스 항목의 "Plan:" 링크 채우기
3. 회고에서 Foundation 갱신 필요 사항 발견 시 해당 문서 수정 + 커밋
