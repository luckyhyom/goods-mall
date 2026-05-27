# goods-mall 설계 문서

> 애니메이션 캐릭터 굿즈 쇼핑몰 (포트폴리오/학습용)
> 작성: 2026-05-27
> 상태: **작성 중** — 진행하면서 섹션 추가

---

## 작성 진척

- [x] §1 전체 스택과 폴더 구조
- [x] §2 데이터베이스 스키마
- [ ] §3 인증 전략
- [ ] §4 API 아키텍처 (Clean Architecture 상세)
- [ ] §5 프런트엔드 구조
- [ ] §6 에러 처리 및 검증
- [ ] §7 테스트 전략
- [ ] §8 슬라이스별 상세 범위

관련 문서:
- [DDD 적용 규칙](../../architecture/ddd-rules.md) — 모든 슬라이스에 적용

---

## 0. 결정사항 요약 (브레인스토밍 결과)

| 항목 | 결정 |
|------|------|
| **목적** | MVP 단기 완성 (포트폴리오/학습) |
| **MVP 범위** | 핵심 거래 플로우만 (회원가입 → 상품 → 장바구니 → 주문/결제 시뮬레이션 → 주문내역) |
| **인증** | 이메일+비밀번호 + Google OAuth |
| **배포** | 로컬만 완성 (`docker compose up` 수준) |
| **상품 데이터** | 시드 + 간단 관리자 UI (이미지 업로드 포함) |
| **UI 스타일링** | Tailwind + shadcn/ui |
| **테스트 범위** | 핵심 도메인 로직 단위 테스트만 |
| **저장소 구조** | 단일 레포, 계층 폴더(`api/`, `web/`)로 분리 |
| **API 아키텍처** | 핵심 도메인(`order`, `cart`)에만 Clean Architecture, 나머지는 단순 계층 |
| **진행 방식** | Vertical Slice — 슬라이스별로 풀스택 단위 작업 |

### 슬라이스 계획 (7개)

0. **Bootstrap** — Docker Compose(MariaDB) + NestJS skeleton + Next.js skeleton + Prisma 연결 + `/health`
1. **Auth** — 이메일+패스워드 회원가입/로그인 + Google OAuth + 인증 미들웨어
2. **Catalog** — 상품 목록 페이지 + 상세 페이지 + Prisma seed
3. **Cart** — 장바구니 추가/삭제/수량변경 + 장바구니 페이지 (DDD 적용)
4. **Address** — 마이페이지 주소 관리 (다중 주소 + 기본 주소)
5. **Order** — 주문 생성(결제 시뮬레이션) + 주문내역 (DDD 적용)
6. **Admin** — 관리자 상품 CRUD + 이미지 업로드

---

## §1 전체 스택과 폴더 구조

### 기술 스택

| 영역 | 선택 |
|------|------|
| API 서버 | NestJS (TypeScript) |
| Web | Next.js (App Router, TypeScript) |
| DB | MariaDB |
| ORM | Prisma (`mysql` provider, MariaDB 호환) |
| 인증 | 이메일+패스워드(bcrypt) + Google OAuth |
| 토큰 저장 | HttpOnly Secure Cookie (세션 또는 JWT — §3에서 결정) |
| API 통신 | REST + JSON |
| UI 라이브러리 | Tailwind CSS + shadcn/ui |
| 테스트 | Jest (단위 테스트, 핵심 도메인) |
| 우편번호 | 카카오 우편번호 API (무료, 키 불필요) |
| 로컬 환경 | Docker Compose (MariaDB), 호스트에서 api/web 실행 |

### 폴더 구조

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
│   │   │   ├── api.ts          ← fetch 래퍼
│   │   │   └── auth.ts         ← 세션 확인 헬퍼
│   │   └── types/              ← API 응답 타입 (수동 정의)
│   ├── public/
│   ├── .env.example
│   ├── tailwind.config.ts
│   └── package.json
│
├── docs/
│   ├── architecture/
│   │   └── ddd-rules.md        ← DDD 적용 규칙
│   └── superpowers/
│       └── specs/
│           └── 2026-05-27-goods-mall-design.md   ← 이 문서
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

---

## §2 데이터베이스 스키마

### ERD

```mermaid
erDiagram
    User ||--o{ Address : "보유"
    User ||--o{ CartItem : "담음"
    User ||--o{ Order : "주문"
    Product ||--o{ CartItem : "참조"
    Order ||--o{ OrderItem : "포함"
    Product ||--o{ OrderItem : "스냅샷"

    User {
        string id PK
        string email UK
        string passwordHash "nullable"
        string name
        Role role "USER or ADMIN"
        Provider provider "LOCAL or GOOGLE"
        string providerId "nullable, Google sub"
        datetime createdAt
    }

    Address {
        string id PK
        string userId FK
        string label "집/회사 등"
        string recipientName
        string phone
        varchar zipCode "5자리"
        string sido
        string sigungu
        string bname "법정동"
        string roadName "도로명+번지, 시구 제외"
        string detailAddress
        boolean isDefault
        datetime createdAt
        datetime updatedAt
    }

    Product {
        string id PK
        string name
        text description
        int priceWon "원 단위 정수"
        int stock
        string imageUrl
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    CartItem {
        string id PK
        string userId FK
        string productId FK
        int quantity
        datetime updatedAt
    }

    Order {
        string id PK
        string orderNumber UK "ORD-YYYYMMDD-XXXX"
        string userId FK
        OrderStatus status "PENDING, PAID, CANCELED"
        int totalWon "주문 시점 스냅샷"
        string recipientName
        string phone
        varchar zipCode
        string sido
        string sigungu
        string bname
        string roadName
        string detailAddress
        datetime paidAt "nullable"
        datetime createdAt
    }

    OrderItem {
        string id PK
        string orderId FK
        string productId FK
        string productName "스냅샷"
        int productPriceWon "스냅샷"
        int quantity
    }
```

### Prisma 모델

```prisma
// schema.prisma
generator client {
  provider = "prisma-client-js"
}

generator erd {
  provider = "prisma-erd-generator"
  output   = "../docs/erd.md"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

enum Provider {
  LOCAL
  GOOGLE
}

enum OrderStatus {
  PENDING
  PAID
  CANCELED
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String?  // Google OAuth만 쓰면 null
  name         String
  role         Role     @default(USER)
  provider     Provider @default(LOCAL)
  providerId   String?  // Google sub
  createdAt    DateTime @default(now())

  addresses Address[]
  cartItems CartItem[]
  orders    Order[]

  @@unique([provider, providerId])
}

model Address {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  label         String   // "집", "회사" 등 사용자 정의

  recipientName String
  phone         String

  zipCode       String   @db.VarChar(5)
  sido          String   // "서울특별시"
  sigungu       String   // "강남구"
  bname         String   // "역삼동" (법정동)
  roadName      String   // "테헤란로 123" (도로명 + 번지)
  detailAddress String   // "ABC빌딩 456호" (사용자 입력)

  isDefault     Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@index([userId])
}

model Product {
  id          String   @id @default(cuid())
  name        String
  description String   @db.Text
  priceWon    Int      // 원 단위 정수 (소수점 회피)
  stock       Int      @default(0)
  imageUrl    String   // /uploads/xxx.jpg 또는 외부 URL
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  cartItems  CartItem[]
  orderItems OrderItem[]
}

// 주의: Cart 테이블 없음. Cart 도메인 클래스는 코드에만 존재 (CartRepository가 CartItem 행들을 모아 재구성).
model CartItem {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  quantity  Int
  updatedAt DateTime @updatedAt

  @@unique([userId, productId])  // 한 유저가 같은 상품 중복 담기 금지
  @@index([userId])              // "내 카트 조회" 자주 사용
}

model Order {
  id          String      @id @default(cuid())
  orderNumber String      @unique  // "ORD-YYYYMMDD-XXXX"
  userId      String
  user        User        @relation(fields: [userId], references: [id])
  status      OrderStatus @default(PENDING)
  totalWon    Int

  // 배송지 스냅샷 (주문 시점 Address에서 복사, FK 없음)
  recipientName String
  phone         String
  zipCode       String   @db.VarChar(5)
  sido          String
  sigungu       String
  bname         String
  roadName      String
  detailAddress String

  items     OrderItem[]
  paidAt    DateTime?
  createdAt DateTime    @default(now())

  @@index([userId, createdAt])  // "내 주문 내역" 최신순 조회용
}

model OrderItem {
  id              String  @id @default(cuid())
  orderId         String
  order           Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  productId       String
  product         Product @relation(fields: [productId], references: [id])

  // 스냅샷 (주문 시점에 복사)
  productName     String
  productPriceWon Int
  quantity        Int
}
```

### 주요 설계 결정과 근거

| 결정 | 근거 |
|------|------|
| **가격은 `Int` (원 단위)** | 부동소수 오류 회피, 한국 원화는 소수점 없음 |
| **OrderItem에 상품 스냅샷** | 상품 가격/이름 변경되어도 과거 주문은 그대로 유지 |
| **Cart 테이블 없음** | DDD 원칙: Aggregate ≠ Table 1:1. Cart 자체에 의미 있는 상태가 없으므로 cart_items만 두고 Repository가 재구성. 자세한 근거는 [DDD 적용 규칙 §1.1](../../architecture/ddd-rules.md) 참고 |
| **`CartItem.userId` 직접 보유** | Cart 테이블 제거에 따른 자연스러운 결과. `@@unique([userId, productId])`로 중복 방지 |
| **다중 주소 + `isDefault` 플래그** | 실제 이커머스 UX. 한 유저가 여러 주소를 등록할 수 있고 기본 주소는 1개 |
| **Address 완전 정규화** (sido/sigungu/bname/roadName) | 지역별 통계 쿼리 가능, 카카오 API 응답과 매핑 가능 |
| **Order에 주소 스냅샷** | 사용자가 주소를 수정/삭제해도 과거 주문은 영구 보존. FK 없이 스냅샷만 |
| **orderNumber 별도 필드** | URL/화면에 cuid 직접 노출 안 함. "ORD-YYYYMMDD-XXXX" 사람이 읽기 좋은 형식 |
| **Soft delete 미적용** | MVP 범위 초과. `Product.isActive`로 진열만 제어 |
| **카테고리/리뷰/검색 테이블 없음** | MVP 핵심 거래 플로우에 불필요 |

### Cart 도메인 코드 미리보기

```ts
// src/modules/cart/domain/cart.aggregate.ts
export class Cart extends AggregateRoot {
  private constructor(
    public readonly userId: string,
    private _items: CartItem[],
  ) { super(); }

  static reconstitute(userId: string, items: CartItem[]): Cart {
    return new Cart(userId, items);
  }

  static empty(userId: string): Cart {
    return new Cart(userId, []);
  }

  addItem(productId: string, quantity: number): void {
    // 불변식 검증, 도메인 이벤트 발행
  }

  removeItem(productId: string): void { /* ... */ }
  changeQuantity(productId: string, quantity: number): void { /* ... */ }
  clear(): void { /* ... */ }
  getTotalWon(productPrices: Map<string, number>): number { /* ... */ }
}
```

### CartRepository 구현 패턴

```ts
// src/modules/cart/infrastructure/persistence/cart.prisma.repository.ts
export class CartPrismaRepository implements CartRepository {
  async findByUserId(userId: string): Promise<Cart> {
    const rows = await this.prisma.cartItem.findMany({ where: { userId } });
    return CartMapper.toDomain(userId, rows);
  }

  async save(cart: Cart): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { userId: cart.userId } });
      const rows = CartMapper.toPersistence(cart);
      if (rows.length > 0) {
        await tx.cartItem.createMany({ data: rows });
      }
    });
  }
}
```

### 카카오 우편번호 API 매핑

```ts
// 카카오 API 응답
{
  zonecode: "06234",
  sido: "서울",
  sigungu: "강남구",
  bname: "역삼동",
  roadAddress: "서울 강남구 테헤란로 123",
  // ...
}

// → Address 저장
{
  zipCode: data.zonecode,
  sido: data.sido,           // "서울"
  sigungu: data.sigungu,     // "강남구"
  bname: data.bname,         // "역삼동"
  roadName: extractRoadName( // "테헤란로 123" (시/구 제외)
    data.roadAddress,
    data.sido,
    data.sigungu,
  ),
  detailAddress: userInput,
}
```

`extractRoadName`은 `shared/util/address.ts`에 분리.

---

## §3 인증 전략 (작성 예정)

_다음 세션에서 작성_

## §4 API 아키텍처 (작성 예정)

_다음 세션에서 작성_

## §5 프런트엔드 구조 (작성 예정)

_다음 세션에서 작성_

## §6 에러 처리 및 검증 (작성 예정)

_다음 세션에서 작성_

## §7 테스트 전략 (작성 예정)

_다음 세션에서 작성_

## §8 슬라이스별 상세 범위 (작성 예정)

_다음 세션에서 작성_
