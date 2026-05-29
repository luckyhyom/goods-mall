# API 아키텍처

> 모듈마다 다른 아키텍처를 적용. 슬라이스는 자기 모듈에 해당하는 패턴 섹션만 참고.
> DDD 모듈은 [../architecture/ddd-rules.md](../architecture/ddd-rules.md) 도 함께 참고.

---

## 1. 모듈별 아키텍처 매핑

| 모듈 | 아키텍처 | 적용 슬라이스 |
|------|---------|--------------|
| `auth` | 단순 계층 | Slice 1 |
| `user` | 단순 계층 | Slice 1 (가입 시 생성) |
| `address` | 단순 계층 | Slice 4 |
| `product` | 단순 계층 | Slice 2, 6 |
| `cart` | **Clean Architecture + DDD** | Slice 3 |
| `order` | **Clean Architecture + DDD** | Slice 5 |

**원칙:** "모든 모듈을 같은 깊이로 만들지 말 것" — 단순 CRUD에 4계층은 과잉.

---

## 2. 단순 계층 패턴 (auth, user, address, product)

```
src/modules/<name>/
├── <name>.controller.ts        # @Controller
├── <name>.service.ts           # 비즈니스 로직 + Prisma 직접 호출
├── <name>.module.ts
└── dto/
```

`Controller → Service → Prisma`. 도메인 클래스 없음.

### 예시: Product

```ts
// product.controller.ts
@Controller('products')
export class ProductController {
  constructor(private productService: ProductService) {}

  @Get()
  list(@Query() query: ListProductsQueryDto) {
    return this.productService.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.productService.findById(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productService.create(dto);
  }
}

// product.service.ts
@Injectable()
export class ProductService {
  constructor(private prisma: PrismaService) {}

  list(query: ListProductsQueryDto) {
    return this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('상품이 없습니다');
    return product;
  }
}
```

---

## 3. Clean Architecture 패턴 (cart, order)

폴더 구조와 책임은 [DDD 적용 규칙 §2](../architecture/ddd-rules.md#2-폴더-구조-aggregate-모듈) 참고.

**요약:**
- `domain/` — AggregateRoot(**자체 베이스, 프레임워크 무관**), Entity, ValueObject, Repository 인터페이스, Domain Event
- `application/` — Command/Query/Handler, EventHandler, use-case DTO
- `infrastructure/` — Prisma Repository 구현, Mapper
- `presentation/` — Controller, Request/Response DTO

> **계층별 프레임워크 의존 원칙:** `domain/`은 `@nestjs/cqrs`·`@nestjs/common`을
> import하지 않는 **순수 TypeScript**. 데코레이터·`EventBus`·DI 같은 프레임워크 요소는
> `application`·`infrastructure`·`presentation` 계층에서만 쓴다. 도메인은 이벤트를
> **기록(record)** 만 하고, **발행(publish)** 은 application 핸들러가 담당한다([§4](#4-aggregate-root-패턴-순수-도메인), [§6](#6-command--query-분리)).

### 모듈 와이어링 (Repository 바인딩)

```ts
@Module({
  imports: [CqrsModule, PrismaModule],
  controllers: [CartController],
  providers: [
    // Command/Query/Event handlers
    AddItemHandler,
    RemoveItemHandler,
    ChangeQuantityHandler,
    ClearCartHandler,
    GetCartHandler,

    // Repository 바인딩 (의존성 역전)
    { provide: CartRepository, useClass: CartPrismaRepository },
  ],
})
export class CartModule {}
```

---

## 4. Aggregate Root 패턴 (순수 도메인)

`@nestjs/cqrs`의 `AggregateRoot`를 상속하지 않는다. 대신 `shared/domain`에 **프레임워크
무관한 자체 베이스**를 두어 도메인을 순수 TypeScript로 유지한다.

```ts
// shared/domain/domain-event.ts — import 0개
export interface DomainEvent {
  readonly occurredAt: Date;
}

// shared/domain/aggregate-root.ts — import 0개
export abstract class AggregateRoot {
  private _events: DomainEvent[] = [];

  /** 일어난 일을 "기록"만 한다. 발행은 application 핸들러가 EventBus로. */
  protected addEvent(event: DomainEvent): void {
    this._events.push(event);
  }

  /** 핸들러가 저장 성공 후 꺼내 발행한다. 호출 시 버퍼를 비운다. */
  pullEvents(): DomainEvent[] {
    const events = this._events;
    this._events = [];
    return events;
  }
}
```

```ts
// modules/cart/domain/cart.aggregate.ts — @nestjs/cqrs import 없음
import { AggregateRoot } from '../../../shared/domain/aggregate-root';

export class Cart extends AggregateRoot {
  private constructor(
    public readonly userId: string,
    private _items: CartItem[],
  ) { super(); }

  static reconstitute(userId: string, items: CartItem[]) {
    return new Cart(userId, items);
  }

  static empty(userId: string) {
    return new Cart(userId, []);
  }

  addItem(productId: string, quantity: number): void {
    // 1. 불변식 검증 + 상태 변경 (이벤트 기록은 상태를 자동으로 바꾸지 않는다)
    const existing = this._items.find((i) => i.productId === productId);
    if (existing) {
      existing.increaseQuantity(quantity);   // @@unique([userId, productId]) — 중복 시 수량 합산
    } else {
      this._items.push(CartItem.create(productId, quantity));
    }

    // 2. 변경된 상태에 대한 도메인 이벤트 "기록" (발행 ✗, 버퍼에 쌓기만)
    this.addEvent(new CartItemAddedEvent(this.userId, productId, quantity));
  }
}
```

> ⚠️ **상태 변경과 이벤트 기록은 별개다.** `addEvent()`는 이벤트 버퍼에만 쌓고 `_items`를
> 건드리지 않는다. 따라서 항상 **상태 변경 먼저, 그 다음 `addEvent()`** 순서로 둘 다 해야
> 한다. 빠뜨리면 §5의 `save()`(=`_items` 기준 전체 교체)에 변경이 반영되지 않는다.
>
> 도메인은 이벤트를 **기록**만 한다. **발행**(`EventBus.publish`)은 application 핸들러가
> `pullEvents()`로 꺼내 수행한다([§6](#6-command--query-분리)) — 프레임워크 의존은 경계 밖에.

자식 Entity와 Value Object는 [data-model.md ## CartItem](./data-model.md#cartitem-cart-테이블-없는-aggregate-패턴) 의 도메인 코드 미리보기 참고.

---

## 5. Repository 패턴 (인터페이스 + 구현체)

```ts
// domain/cart.repository.ts (인터페이스)
export abstract class CartRepository {
  abstract findByUserId(userId: string): Promise<Cart>;
  abstract save(cart: Cart): Promise<void>;
}

// infrastructure/cart.prisma.repository.ts (구현)
@Injectable()
export class CartPrismaRepository implements CartRepository {
  constructor(private prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<Cart> {
    const rows = await this.prisma.cartItem.findMany({ where: { userId } });
    return CartMapper.toDomain(userId, rows);
  }

  async save(cart: Cart): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { userId: cart.userId } });
      const rows = CartMapper.toPersistence(cart);
      if (rows.length > 0) await tx.cartItem.createMany({ data: rows });
    });
  }
}
```

---

## 6. Command / Query 분리

**Command (쓰기)** — Aggregate 통과 강제:

```ts
@CommandHandler(AddItemCommand)
export class AddItemHandler implements ICommandHandler<AddItemCommand> {
  constructor(
    private cartRepo: CartRepository,
    private productRepo: ProductRepository,   // read-only
    private eventBus: EventBus,               // 프레임워크는 application 계층에서만
  ) {}

  async execute(cmd: AddItemCommand): Promise<void> {
    // 1. Product 검증
    const product = await this.productRepo.findById(cmd.productId);
    if (!product?.isActive) throw new ProductNotAvailableError(cmd.productId);
    if (product.stock < cmd.quantity) throw new InsufficientStockError(/*...*/);

    // 2. Aggregate 로드 → 행위 → 저장 (순수 도메인, mergeObjectContext 불필요)
    const cart = await this.cartRepo.findByUserId(cmd.userId);
    cart.addItem(cmd.productId, cmd.quantity);
    await this.cartRepo.save(cart);

    // 3. 저장 성공 후, 도메인이 기록한 이벤트를 핸들러가 발행
    cart.pullEvents().forEach((event) => this.eventBus.publish(event));
  }
}
```

**Query (읽기)** — 도메인 우회 허용 (CQRS Query side):

```ts
@QueryHandler(GetCartQuery)
export class GetCartHandler implements IQueryHandler<GetCartQuery> {
  constructor(private prisma: PrismaService) {}

  async execute(q: GetCartQuery) {
    // Prisma 직접 호출 → 화면용 DTO 반환
    const items = await this.prisma.cartItem.findMany({
      where: { userId: q.userId },
      include: { product: true },
    });
    return {
      items: items.map(i => ({
        productId: i.productId,
        productName: i.product.name,
        productImage: i.product.imageUrl,
        priceWon: i.product.priceWon,
        quantity: i.quantity,
        subtotalWon: i.product.priceWon * i.quantity,
      })),
      totalWon: items.reduce((s, i) => s + i.product.priceWon * i.quantity, 0),
    };
  }
}
```

---

## 7. 모듈 간 통신 — Domain Event

다른 Aggregate에 부수효과를 일으킬 때는 직접 호출하지 말고 이벤트로:

```ts
// order/domain/events/order-placed.event.ts
export class OrderPlacedEvent {
  constructor(
    public orderId: string,
    public items: { productId: string; quantity: number }[],
  ) {}
}

// product 모듈에서 구독 (재고 차감)
@EventsHandler(OrderPlacedEvent)
export class DecrementStockHandler implements IEventHandler<OrderPlacedEvent> {
  constructor(private prisma: PrismaService) {}

  async handle(event: OrderPlacedEvent) {
    await this.prisma.$transaction(
      event.items.map((i) =>
        this.prisma.product.update({
          where: { id: i.productId },
          data: { stock: { decrement: i.quantity } },
        }),
      ),
    );
  }
}
```

**이점:**
- order 모듈은 product 모듈을 모름
- 새 부수효과 추가 시 핸들러만 추가
- 향후 메시지 브로커로 이전 쉬움

---

## 8. 트랜잭션 경계 ([DDD 규칙 §1.4](../architecture/ddd-rules.md))

- 한 트랜잭션에서 **하나의 Aggregate**만 변경
- 다른 Aggregate에 일으키는 부수효과는 Domain Event로 분리 (**별도 트랜잭션**)
- ⚠️ **기본 `EventBus`는 인메모리·동기 발행이다.** `eventBus.publish` 호출 시 같은 콜스택에서
  핸들러가 즉시 실행되고, 분리되는 것은 **트랜잭션 경계뿐**이다 — 진짜 eventual consistency가
  아니다("약간 뒤"가 아니라 "바로, 단 다른 트랜잭션으로").
- 트레이드오프: 후속 핸들러(예: 재고 차감)가 실패해도 **이미 커밋된 앞 트랜잭션은 롤백되지
  않는다** → 보상 로직 없음. MVP에서는 의식적으로 허용.
- 진짜 비동기/eventual consistency 또는 보상이 필요하면 메시지 브로커 + Saga 도입 (MVP 범위 외).
  전환점은 §6 핸들러의 `eventBus.publish` 한 줄 — 여기를 브로커 발행으로 교체하면 된다.

---

## 9. NestJS CQRS 설정

```ts
// app.module.ts
@Module({
  imports: [
    CqrsModule.forRoot(),
    PrismaModule,
    AuthModule,
    UserModule,
    AddressModule,
    ProductModule,
    CartModule,
    OrderModule,
  ],
})
export class AppModule {}
```

`CqrsModule`이 `CommandBus`, `QueryBus`, `EventBus`를 자동 제공 — 이들은
**application·presentation 계층에서만** 사용한다. `domain` 계층은 `@nestjs/cqrs`를
import하지 않으며([§4](#4-aggregate-root-패턴-순수-도메인)), 도메인이 기록한 이벤트는
핸들러가 `pullEvents()`로 꺼내 `EventBus`로 발행한다([§6](#6-command--query-분리)).
