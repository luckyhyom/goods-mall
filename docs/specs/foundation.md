# goods-mall Foundation

> 모든 슬라이스에 공통 적용되는 기반.
> 변경 시 모든 슬라이스에 영향 — 신중히.
>
> **범위:** 이 레포는 **백엔드 API 전용**이다. 프런트엔드(Next.js)는 별도 레포로
> 분리 예정이며, 본 문서의 API 계약(엔드포인트·데이터 모델·인증)을 소비한다.

---

## 진행 철학

이 문서를 포함한 `docs/specs/`는 "완성된 설계"가 아니라 **진화적 로드맵**입니다.

- **공통 토대**(이 문서, `data-model.md`, `api-architecture.md`, `auth-strategy.md`, `ddd-rules.md`)는 모든 슬라이스에서 따른다
- **각 슬라이스의 상세**는 슬라이스 시작 시점에 plan 문서로 작성 (`slice-N-<name>-plan.md`)
- 슬라이스 진행 중 발견한 보완점은 회고에서 Foundation에 반영

**최소 모듈 단위로 진행**하며, 각 슬라이스 사이클:
1. `slice-N-<name>-plan.md` 작성
2. 구현
3. 회고 — Foundation 갱신 필요 여부 확인 + `roadmap.md` 체크리스트 갱신

---

## 핵심 결정 요약

| 항목 | 결정 |
|------|------|
| **목적** | MVP 단기 완성 (포트폴리오/학습용 굿즈 쇼핑몰) |
| **MVP 범위** | 핵심 거래 플로우 (회원가입 → 상품 → 장바구니 → 주문/결제 시뮬레이션 → 주문내역) |
| **배포** | 로컬만 완성 (`docker compose up`) |
| **진행 방식** | 슬라이스 단위 — 도메인별 API 절단면 |
| **테스트 범위** | 핵심 도메인 로직 단위 테스트만 |

상세 결정은 주제별 문서 참조:
- 인증/OAuth → [auth-strategy.md](./auth-strategy.md)
- 데이터 모델 → [data-model.md](./data-model.md)
- API 아키텍처 → [api-architecture.md](./api-architecture.md)
- DDD 적용 규칙 → [../architecture/ddd-rules.md](../architecture/ddd-rules.md)
- 슬라이스 진행 추적 → [roadmap.md](./roadmap.md)

---

## 기술 스택

| 영역 | 선택 |
|------|------|
| API 서버 | NestJS (TypeScript) |
| DB | MariaDB |
| ORM | Prisma (`mysql` provider, MariaDB 호환) |
| 인증 | 이메일+패스워드(bcrypt) + Google OAuth |
| 토큰 방식 | JWT (Access) + Opaque Refresh Token (Rotation) — 자세한 내용은 [auth-strategy.md](./auth-strategy.md) |
| 토큰 전송 | `Authorization: Bearer <token>` 헤더 (웹·모바일 통일) |
| API 통신 | REST + JSON |
| 테스트 | Jest (단위 테스트, 핵심 도메인) |
| 로컬 환경 | Docker Compose (MariaDB), 호스트에서 api 실행 |

---

## 폴더 구조

```
goods-mall/
├── api/                        ← NestJS
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/           ← 단순 계층
│   │   │   ├── user/           ← 단순 계층
│   │   │   ├── address/        ← 단순 계층
│   │   │   ├── product/        ← 단순 계층
│   │   │   ├── cart/           ← Clean Architecture (4계층)
│   │   │   └── order/          ← Clean Architecture (4계층)
│   │   ├── shared/
│   │   │   ├── domain/         ← AggregateRoot, Entity, ValueObject 베이스 (프레임워크 무관)
│   │   │   └── kernel/         ← 공통 타입, 유틸
│   │   ├── prisma/
│   │   │   └── prisma.service.ts
│   │   ├── common/             ← 공통 가드/필터/인터셉터
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts
│   │   └── migrations/
│   ├── test/                   ← 도메인 단위 테스트
│   ├── uploads/                ← gitignored, 상품 이미지
│   ├── .env.example
│   ├── tsconfig.json
│   └── package.json
│
├── docs/
│   ├── architecture/
│   │   └── ddd-rules.md
│   └── specs/
│       ├── foundation.md       ← 이 문서
│       ├── data-model.md
│       ├── auth-strategy.md
│       ├── api-architecture.md
│       ├── roadmap.md
│       └── slice-N-<name>-plan.md  ← 슬라이스별
│
├── docker-compose.yml          ← MariaDB
├── .gitignore
└── README.md
```

### 핵심 결정 사항

- `api`는 독립적인 `package.json` — 모노레포 툴링 없이 단순하게
- 프런트엔드는 별도 레포에서 API 응답 타입을 **수동으로 동기화** (OpenAPI 자동 생성은 학습 부담 추가되므로 보류)
- 이미지는 NestJS의 `ServeStaticModule`로 `/uploads`를 정적 서빙
- 로컬 개발: MariaDB만 Docker로, api는 호스트에서 실행 (빠른 hot reload)
