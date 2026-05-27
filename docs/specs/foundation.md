# goods-mall Foundation

> 모든 슬라이스에 공통 적용되는 기반.
> 변경 시 모든 슬라이스에 영향 — 신중히.

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
| **진행 방식** | Vertical Slice — 슬라이스별 풀스택 단위 |
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
| Web | Next.js (App Router, TypeScript) |
| DB | MariaDB |
| ORM | Prisma (`mysql` provider, MariaDB 호환) |
| 인증 | 이메일+패스워드(bcrypt) + Google OAuth |
| 토큰 방식 | JWT (Access) + Opaque Refresh Token (Rotation) — 자세한 내용은 [auth-strategy.md](./auth-strategy.md) |
| 토큰 전송 | `Authorization: Bearer <token>` 헤더 (웹·모바일 통일) |
| API 통신 | REST + JSON |
| UI 라이브러리 | Tailwind CSS + shadcn/ui |
| 테스트 | Jest (단위 테스트, 핵심 도메인) |
| 우편번호 | 카카오 우편번호 API (무료, 키 불필요) |
| 로컬 환경 | Docker Compose (MariaDB), 호스트에서 api/web 실행 |

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
│   │   │   ├── domain/         ← AggregateRoot, Entity, ValueObject 베이스
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
├── web/                        ← Next.js (App Router)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (auth)/         ← 로그인/회원가입 (no header)
│   │   │   ├── (shop)/         ← 상품/카트/주문 (header 포함)
│   │   │   ├── (mypage)/       ← 마이페이지(주소/주문내역)
│   │   │   ├── admin/          ← 관리자 페이지
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   └── ui/             ← shadcn/ui 생성 컴포넌트
│   │   ├── lib/
│   │   │   ├── api.ts          ← fetch 래퍼 (자동 refresh 포함)
│   │   │   └── auth-store.ts   ← Zustand 인증 상태
│   │   └── types/              ← API 응답 타입 (수동 정의)
│   ├── public/
│   ├── .env.example
│   ├── tailwind.config.ts
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

- `api`, `web`는 각자 독립적인 `package.json` — 모노레포 툴링 없이 단순하게
- 타입 공유는 `web/src/types/`에 **수동으로 동기화** (OpenAPI 자동 생성은 학습 부담 추가되므로 보류)
- 이미지는 NestJS의 `ServeStaticModule`로 `/uploads`를 정적 서빙
- 로컬 개발: MariaDB만 Docker로, api와 web은 호스트에서 실행 (빠른 hot reload)
