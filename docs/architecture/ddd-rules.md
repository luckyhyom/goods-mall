# DDD 적용 규칙 (goods-mall)

> 이 문서는 모든 슬라이스에 걸쳐 일관되게 따라야 하는 DDD 적용 원칙을 기록합니다.
> 결정이 바뀌면 이 문서를 갱신하세요.
> 작성: 2026-05-27

---

## 0. 적용 범위 (어디에 DDD를 쓰는가)

| 모듈 | 아키텍처 패턴 | 이유 |
|------|--------------|------|
| `cart` | Clean Architecture (4계층) + DDD | 불변식 보호 필요 (중복 상품, 수량 제한, 총액 계산) |
| `order` | Clean Architecture (4계층) + DDD | 상태 전이, 결제, 재고 차감 등 도메인 로직 풍부 |
| `auth` | 단순 계층 (Controller → Service → Prisma) | 인증 로직은 표준화되어 도메인 가치 낮음 |
| `user` | 단순 계층 | CRUD 위주 |
| `product` | 단순 계층 | CRUD 위주 (관리자 화면용) |

**원칙:** "모든 모듈을 같은 깊이로 만들지 말 것." 단순 CRUD에 4계층은 과잉이다.

---

## 1. Aggregate 설계 원칙

### 1.1 Aggregate Root는 DB 테이블과 1:1일 필요가 없다

- **Repository는 per-Aggregate이지 per-Table이 아니다.**
- Aggregate는 0개, 1개, 또는 N개의 테이블에 분산 저장될 수 있다.
- "Persistence Ignorance" — 도메인 모델은 저장 방식을 모른다.

**적용 예 (이 프로젝트의 Cart):**
- 도메인 코드에는 `Cart` Aggregate Root 클래스가 존재한다.
- DB에는 `cart_items` 테이블만 존재한다 (Cart 테이블 없음).
- `CartRepository.findByUserId(userId)`가 `cart_items` 행들을 모아 `Cart` 객체를 재구성한다.

### 1.2 Cart-CartItem은 같은 Aggregate

- 불변식을 공유하므로 같은 Aggregate에 둔다:
  - 동일 상품 중복 금지
  - 수량 ≤ 재고
  - 총액 = Σ(단가 × 수량)
- 외부에서는 **Cart Root만** 참조한다. CartItem을 직접 조작하지 않는다.
  - `cart.addItem(productId, quantity)` ✓
  - `cartItem.setQuantity(5)` ✗ (Repository로 CartItem만 따로 저장 금지)

### 1.3 Aggregate 간 참조는 ID로만

- `cartItem.productId: string` ✓
- `cartItem.product: Product` ✗ (Product 객체 직접 보유 금지)

### 1.4 트랜잭션 = Aggregate 경계

- **한 트랜잭션에서 하나의 Aggregate만 변경한다.**
- 여러 Aggregate를 같이 변경해야 하면 Domain Event로 비동기 처리한다.
  - 예: 주문 생성 → `OrderPlaced` 이벤트 → Product 재고 차감 핸들러

---

## 2. 폴더 구조 (Aggregate 모듈)

```
src/modules/<aggregate>/
├── domain/
│   ├── <aggregate>.aggregate.ts        # AggregateRoot 상속
│   ├── <child>.entity.ts               # 자식 Entity (Aggregate 내부)
│   ├── value-objects/                  # VO 클래스들
│   ├── events/                         # Domain Event 정의
│   └── <aggregate>.repository.ts       # 인터페이스(abstract class)
├── application/
│   ├── commands/                       # Command + CommandHandler
│   ├── queries/                        # Query + QueryHandler
│   ├── event-handlers/                 # 다른 모듈 이벤트 구독
│   └── dto/                            # use-case 내부 DTO (선택)
├── infrastructure/
│   ├── persistence/
│   │   ├── <aggregate>.prisma.repository.ts
│   │   └── <aggregate>.mapper.ts
│   └── prisma/
├── presentation/
│   ├── <aggregate>.controller.ts
│   ├── dto/                            # Request/Response DTO
│   └── http-<aggregate>.module.ts
└── <aggregate>.module.ts
```

**공유 베이스 클래스:**
```
src/shared/
├── domain/
│   ├── aggregate-root.ts               # AggregateRoot 베이스
│   ├── entity.ts
│   ├── value-object.ts
│   └── domain-event.ts
└── kernel/                             # 공통 타입, 유틸
```

---

## 3. 의존성 방향 (절대 어기지 말 것)

```
presentation ──┐
               ├──→ application ──→ domain
infrastructure ─┘
```

- **domain 디렉토리에는 어떤 외부 import도 없다.**
  - ❌ `@prisma/client` import
  - ❌ `@nestjs/*` import (단, `@nestjs/cqrs`의 `AggregateRoot` 베이스는 예외 허용)
  - ❌ `class-validator` import (검증은 application 또는 presentation)
- **application은 domain의 인터페이스에만 의존한다.**
- **infrastructure는 domain 인터페이스의 구현체를 제공한다.**

---

## 4. 항목별 위치 (체크리스트)

| 구성요소 | 위치 |
|---|---|
| Repository **인터페이스** (abstract class) | `domain/<aggregate>.repository.ts` |
| Repository **구현체** (Prisma) | `infrastructure/persistence/<aggregate>.prisma.repository.ts` |
| Mapper (Prisma row ↔ 도메인) | `infrastructure/persistence/<aggregate>.mapper.ts` |
| Request/Response DTO | `presentation/dto/` |
| use-case 내부 DTO (선택) | `application/dto/` |
| Command/CommandHandler | `application/commands/` |
| Query/QueryHandler | `application/queries/` |
| Domain Event 정의 | `domain/events/` |
| Event Handler 구독 | `application/event-handlers/` |
| AggregateRoot/Entity/VO 베이스 | `src/shared/domain/` |
| ValueObject (Money, Email 등) | `domain/value-objects/` |

---

## 5. Mapper 패턴 (필수)

```ts
// infrastructure/persistence/cart.mapper.ts
export class CartMapper {
  static toDomain(userId: string, rows: PrismaCartItem[]): Cart {
    const items = rows.map(r => new CartItem(r.productId, r.quantity));
    return Cart.reconstitute(userId, items);
  }

  static toPersistence(cart: Cart): PrismaCartItem[] {
    return cart.items.map(i => ({
      userId: cart.userId,
      productId: i.productId,
      quantity: i.quantity,
    }));
  }
}
```

**규칙:**
- Prisma 모델을 도메인에서 직접 쓰지 않는다.
- 도메인 객체의 재구성은 `reconstitute()` 정적 메서드 등으로, 일반 `new`와 구분한다 (일반 생성은 비즈니스 룰 통과, 재구성은 룰 우회).

---

## 6. CQRS (선택적, 균형 있게)

### 6.1 사용 도구
- `@nestjs/cqrs`의 `CommandBus`, `QueryBus`, `EventBus`, `AggregateRoot` 사용.

### 6.2 적용 강도
- **Write (Command)**: 항상 Aggregate를 통과. 도메인 행위 메서드 호출 → Repository 저장.
- **Read (Query)**: 도메인 우회 허용. QueryHandler가 Prisma 직접 호출 → DTO 반환.
  - 이유: N+1 회피, 화면 전용 조인이 많을 때 도메인 객체 재구성이 낭비.

### 6.3 Domain Event
- AggregateRoot 내부에서 `this.apply(new XxxEvent(...))` 호출.
- 트랜잭션 커밋 후 `EventBus`가 핸들러를 호출.
- 처음에는 in-memory `EventEmitter`로 충분. 메시지 브로커는 필요해질 때 도입.

---

## 7. 도메인 모델 작성 규칙

### 7.1 Anemic Domain 금지
- ❌ getter/setter만 있는 Entity + Service에 모든 로직
- ✅ Entity/Aggregate에 비즈니스 메서드 (`cart.addItem`, `order.markPaid`)

### 7.2 불변식은 도메인에서 강제
- 생성자 또는 정적 팩토리에서 검증
- 메서드 실행 시 사후 상태 검증
- 외부 입력은 application/presentation에서 사전 검증, 도메인은 "도메인 규칙" 검증만

### 7.3 Value Object 적극 활용
- `Money`, `Email`, `OrderNumber`, `Quantity` 같은 개념을 string/number로 두지 않음
- VO는 불변, 동등성은 값 기반

---

## 8. 흔한 함정 (피해야 할 것)

- ❌ 모든 모듈을 4계층 DDD로 — 단순 CRUD에는 과잉
- ❌ Anemic Domain — 폴더만 DDD인 가짜 DDD
- ❌ 모든 Read 쿼리를 Repository 강제 통과 — 화면 전용 쿼리는 Query Handler에서 Prisma 직접 OK
- ❌ CQRS를 모든 모듈에 적용 — 복잡한 Aggregate에만
- ❌ Mapper 생략하고 Prisma 모델을 도메인에서 직접 사용 — Persistence Ignorance 깨짐
- ❌ Repository 인터페이스를 infrastructure에 두기 — 의존성 방향 깨짐

---

## 9. "처음부터 지키기" vs "나중에 도입"

### 처음부터 지킬 것 (어기면 큰 부채)
- Aggregate 경계와 불변식 보호 위치
- Repository 인터페이스를 domain에 두기
- Mapper 분리 (Prisma 모델을 도메인에서 직접 안 쓰기)
- 트랜잭션 = Aggregate 경계
- 의존성 방향 (domain ← application ← presentation/infrastructure)

### 나중에 도입해도 되는 것
- 외부 메시지 브로커 (처음엔 in-memory EventBus)
- 읽기 모델 분리 (처음엔 같은 DB)
- 이벤트 소싱 (이 프로젝트에서는 도입하지 않음)

---

## 참고 자료

- [Khalil Stemmler — How to Design & Persist Aggregates](https://khalilstemmler.com/articles/typescript-domain-driven-design/aggregate-design-persistence/)
- [Microsoft Learn — Infrastructure persistence layer with EF Core](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-implementation-entity-framework-core)
- [Vaughn Vernon — Effective Aggregate Design Part I (PDF)](https://www.dddcommunity.org/wp-content/uploads/files/pdf_articles/Vernon_2011_1.pdf)
- [InformIT — Rule: Design Small Aggregates](https://www.informit.com/articles/article.aspx?p=2020371&seqNum=3)
- [NestJS 공식 — CQRS](https://docs.nestjs.com/recipes/cqrs)
- [dev.to/bendix — Applying DDD principles to a NestJS project](https://dev.to/bendix/applying-domain-driven-design-principles-to-a-nest-js-project-5f7b)
- [GitHub — kyhsa93/nestjs-rest-cqrs-example](https://github.com/kyhsa93/nestjs-rest-cqrs-example)
