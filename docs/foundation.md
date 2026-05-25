# goods-mall 설계 기반 (Foundation)

> 슬라이스별 상세 설계의 공통 기반. 결정 변경 시 이 문서를 갱신.
> 작성: 2026-05-25 / 갱신: 2026-05-25

---

## 🔖 세션 재개 가이드 (다음에 이어갈 때 먼저 읽기)

### 마지막 세션에서 한 일
- `/superpowers:brainstorming`으로 브레인스토밍 진행
- 기술 스택·아키텍처·CQRS 강도까지 결정 완료 (이 문서 §1~§4)
- Vertical slicing 방식으로 진행하기로 합의 (이 문서 §5~§6)
- 도메인 모델 카탈로그(섹션 2)를 펼치다가 사용자 요청으로 슬라이스로 미룸

### 다음 세션에서 할 수 있는 것 (선택)

**옵션 A — Foundation 마무리 (5개 횡단 섹션)**
다음 사항이 아직 결정되지 않았습니다. 슬라이스 시작 전에 정해두면 슬라이스마다 같은 결정을 반복하지 않습니다.
- §10. 에러 처리 패턴 (도메인 예외 계층, HTTP 매핑, 응답 형식, NestJS Exception Filter)
- §11. 테스트 전략 베이스라인 (단위/통합/E2E 비중, Jest vs Vitest, Playwright 여부)
- §12. 검증 전략 (zod vs class-validator, API 경계 vs 도메인 경계)
- §13. 공통 도메인 빌딩블록 (AggregateRoot, ValueObject, DomainEvent, Result 베이스 클래스)
- §14. 로깅 / 환경변수 / 보안 헤더 (pino vs winston, `@nestjs/config`, helmet 등)

추천: A부터. 이걸 마치면 슬라이스 1을 일관된 패턴으로 시작할 수 있습니다.

**옵션 B — Slice 0 (부트스트랩) 바로 시작**
- NestJS + Next.js + Prisma + MariaDB(Docker Compose) 연결
- `/health` 엔드포인트 하나
- Foundation의 누락된 섹션은 진행 중 즉석 결정

**옵션 C — Slice 1 (인증/회원) 설계 시작**
- Foundation §10~§14를 Slice 1 spec에서 함께 결정하는 방식
- Slice 0(부트스트랩)은 Slice 1에 통합

### 재개 프롬프트 예시 (그대로 복붙 가능)

```
docs/foundation.md를 읽고 마지막 세션 이어가자. 옵션 A로 진행 (남은 5개 섹션).
```

또는:
```
docs/foundation.md를 읽고 Slice 0 부트스트랩부터 시작하자.
```

또는:
```
docs/foundation.md를 읽고 Slice 1 인증/회원 설계부터 시작하자.
```

### 보정이 필요한 사항
- 저장소가 git 미초기화 상태 (`git init` 권장). 재개 시 첫 단계로 처리.
- 이 문서는 `docs/superpowers/specs/...` 규약 대신 `docs/foundation.md` 에 저장됨 (단순화 의도, 필요 시 이동 가능).

---

## 1. 프로젝트 목적

- **학습/포트폴리오**. 실제 운영 아님.
- 결제·배송은 시뮬레이션으로 대체. 학습 가치 큰 부분(도메인 모델링, 인증, 상태 전이)에 집중.

## 2. 기술 스택

| 영역 | 선택 |
|------|------|
| API 서버 | NestJS (TypeScript) |
| Web | Next.js (App Router, TypeScript) |
| DB | MariaDB |
| ORM | Prisma (`mysql` 프로바이더로 MariaDB 호환) |
| 소셜 로그인 | Google OAuth만 |
| 인증 토큰 저장 | HttpOnly Secure Cookie |
| API 통신 | REST + JSON, zod 응답 검증 |
| API 문서화 | OpenAPI (`@nestjs/swagger`) |

## 3. 저장소 / 배포

- **저장소**: 분리된 두 디렉토리 (`goods-mall-api`, `goods-mall-web`). 필요 시 모노레포 전환.
- **API 서버 배포**: AWS EC2 (t4g.micro 무료 티어). Docker + PM2 또는 systemd.
- **Web 배포**: Vercel.
- **DB**: AWS RDS MariaDB 또는 EC2 동일 인스턴스에 컨테이너로 (학습 단계).
- **로컬 개발**: Docker Compose로 MariaDB 컨테이너.

## 4. 아키텍처 패턴

### Clean Architecture (모듈별 4 레이어)

```
modules/<bounded-context>/
├── domain/              ← 외부 의존성 0. Prisma·NestJS import 금지.
│   ├── <aggregate>.ts
│   ├── value-objects/
│   ├── events/
│   └── <aggregate>.repository.ts   (인터페이스만)
├── application/
│   ├── commands/        ← @CommandHandler
│   ├── queries/         ← @QueryHandler
│   ├── events/          ← @EventsHandler (부수효과)
│   └── dto/
├── infrastructure/
│   ├── prisma-<x>.repository.ts    (도메인 Repository 구현체)
│   └── <x>.mapper.ts               (Prisma row ↔ 도메인 변환)
└── presentation/
    ├── <x>.controller.ts
    └── <x>.module.ts
```

**의존성 방향**: presentation/infrastructure → application → domain. 역방향 금지.

### DDD 적용 방식

- **순수 도메인 코드**: 도메인 클래스에는 `@prisma/client`, `@nestjs/*` 등 외부 import 0.
- **영속화 분리**: Prisma 모델 ↔ 도메인 모델은 Mapper로 변환.
- **Aggregate Root만 Repository 보유**. 자식 Entity는 Aggregate를 통해서만 접근.
- **Aggregate 간 참조는 ID로만** (객체 직접 보관 금지).
- **Value Object**: 검증·동등성·불변성. flat columns 또는 JSON으로 저장 + Mapper로 변환.
- **Domain Event**: Aggregate에 `pullEvents()` 패턴, Application에서 EventBus로 발행.

### CQRS (선택적, 최대 L3까지)

- 도구: `@nestjs/cqrs`.
- **L2 (기본)**: Command/Query 객체 + Handler 분리. 도메인 행위 풍부한 모듈에 적용.
- **L3 (필요 시)**: Query Handler가 도메인 Repository 우회, Prisma 직접 조회 → DTO 반환. 목록·대시보드처럼 N+1/조인 많은 화면에 적용.
- **적용 안 함**: 단순 CRUD 모듈은 일반 Service로도 충분. 일관성 강제하지 않음.
- **L4(Event Sourcing) 이상은 도입 안 함**.

## 5. MVP 범위 (참고)

| 기능 | 슬라이스 |
|------|---------|
| 회원가입 / 로그인 / 소셜로그인(Google) | 1 |
| 상품 목록 / 상세 / 카테고리 / 검색 | 2 |
| 장바구니 | 3 |
| 주문 (결제 시뮬레이션) / 주문 내역 | 4 |
| 리뷰 | 5 |
| 관리자 (상품 CRUD) | 6 |

슬라이스 순서·범위는 진행 중 조정 가능.

## 6. 진행 방식

- **Vertical Slice**: 한 번에 한 슬라이스만 상세 설계 → 구현 → 다음 슬라이스.
- 슬라이스 단위로 spec 문서 작성: `docs/slices/<n>-<name>.md`
- 슬라이스 완료 후 회고하여 이 foundation 문서를 갱신.

## 7. 미정·이후 결정 항목

- 이미지 저장소 (S3 / Cloudflare R2 / Vercel Blob): 슬라이스 2(상품)에서 결정.
- 인증 토큰 전략 상세 (만료/리프레시 정책): 슬라이스 1에서 결정.
- 검색 구현 방식 (DB LIKE / 인덱스 / 외부 검색엔진): 슬라이스 2에서 결정.
- 결제 시뮬레이션 방식: 슬라이스 4에서 결정.
- 테스트 전략 (단위/통합/E2E 비중): 슬라이스 1에서 첫 셋업 시 결정.
