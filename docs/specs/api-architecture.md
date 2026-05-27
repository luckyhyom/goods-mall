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
- `domain/` — AggregateRoot, Entity, ValueObject, Repository 인터페이스, Domain Event
- `application/` — Command/Query/Handler, EventHandler, use-case DTO
- `infrastructure/` — Prisma Repository 구현, Mapper
- `presentation/` — Controller, Request/Response DTO

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

## 4. Aggregate Root 패턴

```ts
// domain/cart.aggregate.ts
import { AggregateRoot } from '@nestjs/cqrs';

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
    // 불변식 검증
    this.apply(new CartItemAddedEvent(this.userId, productId, quantity));
  }
}
```

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
    private eventPublisher: EventPublisher,
  ) {}

  async execute(cmd: AddItemCommand): Promise<void> {
    // 1. Product 검증
    const product = await this.productRepo.findById(cmd.productId);
    if (!product?.isActive) throw new ProductNotAvailableError(cmd.productId);
    if (product.stock < cmd.quantity) throw new InsufficientStockError(/*...*/);

    // 2. Aggregate 로드 → 행위 → 저장
    const cart = this.eventPublisher.mergeObjectContext(
      await this.cartRepo.findByUserId(cmd.userId),
    );
    cart.addItem(cmd.productId, cmd.quantity);
    await this.cartRepo.save(cart);

    // 3. 도메인 이벤트 발행
    cart.commit();
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
- 여러 Aggregate를 변경해야 하면 Domain Event로 비동기
- 트레이드오프: eventual consistency (재고 차감이 약간 뒤 일어남)
- 강한 일관성 필요 시 Saga 패턴 도입 (MVP 범위 외)

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

`CqrsModule`이 `CommandBus`, `QueryBus`, `EventBus`를 자동 제공.
