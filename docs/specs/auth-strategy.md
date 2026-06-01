# 인증 전략

> Slice 1 (Auth) 에서 적용. 다른 슬라이스는 JwtAuthGuard만 사용.
> 관련 모델은 [data-model.md ## User & OAuthAccount & RefreshToken](./data-model.md#user--oauthaccount--refreshtoken) 참고.

---

## 1. 핵심 결정

| 항목 | 결정 |
|------|------|
| **방식** | JWT (Access) + Opaque Refresh Token (Rotation + 재사용 감지) |
| **전송** | `Authorization: Bearer <token>` 헤더 (웹·모바일 통일) |
| **계정 통합** | 이메일 일치 + LOCAL 계정 존재 시 기존 패스워드 입력 후 OAuth 연결 |
| **OAuth 제공자** | Google (다른 제공자는 추후 확장) |
| **모바일 지원** | 헤더 기반 일원화, 동일 엔드포인트가 웹/모바일 모두 지원 |

---

## 2. 토큰 보관·전송 (웹·모바일 통일)

| 항목 | 웹 | 모바일 |
|------|-----|-------|
| Access 보관 | JS 메모리 (인메모리 스토어) | Keychain / Keystore |
| Refresh 보관 | localStorage + 메모리 | Keychain / Keystore |
| 토큰 전송 | `Authorization: Bearer <token>` | 동일 |
| 토큰 응답 | JSON body `{ user, accessToken, refreshToken }` | 동일 |

---

## 3. 보안 완화 조치 (쿠키 HttpOnly 포기에 대한 보완)

| 조치 | 설명 |
|------|------|
| **짧은 Access TTL** | 15분 |
| **짧은 Refresh TTL** | 3일 (XSS 도난 시 피해 시간 축소) |
| **Refresh Rotation** | 매 사용 시 새 refresh 발급, 기존은 `revokedAt` 설정 |
| **재사용 감지** | revoked된 refresh 재사용 시 해당 유저의 모든 토큰 무효화 |
| **엄격한 CSP** | `Content-Security-Policy` 헤더로 XSS 차단 강화 |
| **사용자 입력 sanitize** | React 기본 escape + DOMPurify |
| **`tokenHash`만 저장** | 평문 refresh는 DB에 저장 안 함 (sha256) |

---

## 4. 인증 플로우

```
[POST /auth/signup]
  body: { email, password, name }
  → 이메일 중복 체크
  → bcrypt.hash(password, 12)
  → User 생성
  → access + refresh 발급 (DB에 hash 저장)
  → 201 { user, accessToken, refreshToken }

[POST /auth/login]
  body: { email, password }
  → User 조회 (이메일)
  → passwordHash null → "Google로 로그인하세요" 에러
  → bcrypt.compare
  → access + refresh 발급
  → 200 { user, accessToken, refreshToken }

[POST /auth/refresh]
  body: { refreshToken }
  → sha256(refreshToken)로 RefreshToken 조회
  → 만료 → 401
  → revokedAt 있는 경우 → 도난 의심: 해당 userId 전체 토큰 revoke + 401
  → 정상: 기존 토큰 revoke + 새 access + 새 refresh 발급
  → 200 { accessToken, refreshToken }

[POST /auth/logout]
  body: { refreshToken }
  → 해당 refresh revoke
  → 204

[GET /auth/me]  (JwtAuthGuard 적용)
  → JWT 검증 → req.user
  → 200 { user }
```

---

## 5. Google OAuth + URL fragment 콜백

OAuth 콜백에서 토큰 전달 — 쿠키 없는 환경에서 MVP는 **URL fragment** 방식.

```
[GET /auth/google]
  → Google 인증 페이지 리디렉트 (Passport-Google)

[GET /auth/google/callback?code=...]
  → Google profile 교환 (sub, email, name)

  단계 1: OAuthAccount 조회 (provider=GOOGLE, providerId=sub)
    있음 → 그 User로 access+refresh 발급 → 단계 4

  단계 2: User 조회 (email)
    없음 → 신규 가입
      User 생성 (passwordHash=null)
      OAuthAccount 생성
      access+refresh 발급 → 단계 4

    있음 → 계정 연결 필요 → 단계 3

  단계 3: pending_link JWT 발급 (TTL 5분, payload: { email, sub })
    → redirect: `${WEB_BASE_URL}/auth/link?pending=<pending_jwt>`

  단계 4: redirect to fragment
    → `${WEB_BASE_URL}/auth/oauth-success#accessToken=...&refreshToken=...`
    → 프런트가 hash 추출 → 저장 → history.replaceState로 hash 제거 → 홈
```

**fragment 선택 이유:**
- URL fragment(`#...`)는 HTTP 요청에 포함되지 않음 (서버로 전송 안 됨)
- referer 헤더에도 포함되지 않음
- 브라우저 history에는 잠깐 남지만 `history.replaceState`로 즉시 제거 가능

---

## 6. 계정 연결 (Account Linking)

```
[POST /auth/link]
  body: { pending: string, password: string }
  → pending JWT 검증 (서명, 만료)
  → User(email=pending.email) 조회
  → User.passwordHash 있고 bcrypt.compare 성공 → 통과
    null 또는 실패 → 401
  → OAuthAccount 생성 (userId=User.id, provider=GOOGLE, providerId=pending.sub)
  → access+refresh 발급
  → 200 { user, accessToken, refreshToken }
```

**엣지 케이스:**
- LOCAL passwordHash가 null인 OAuth 전용 계정에 다른 OAuth를 추가하려 한다면 → "다른 방법으로 로그인 후 마이페이지에서 연결" 안내
- 패스워드 시도 횟수 제한: MVP 범위 외 (나중에 rate limit 추가)

---

## 7. NestJS 구현 구조

```
src/modules/auth/
├── auth.controller.ts          # 엔드포인트
├── auth.service.ts             # 비즈니스 로직
├── token.service.ts            # access/refresh 발급·검증·rotation
├── strategies/
│   ├── jwt.strategy.ts         # passport-jwt (access 검증)
│   └── google.strategy.ts      # passport-google-oauth20
├── guards/
│   ├── jwt-auth.guard.ts       # @UseGuards(JwtAuthGuard)
│   └── admin.guard.ts
├── decorators/
│   └── current-user.decorator.ts
└── dto/
    ├── signup.dto.ts
    ├── login.dto.ts
    ├── refresh.dto.ts
    └── link.dto.ts
```

**라이브러리:**
- `@nestjs/jwt` — JWT 발급/검증
- `@nestjs/passport`, `passport`, `passport-jwt` — JWT 인증
- `passport-google-oauth20` — Google OAuth
- `bcrypt` — 패스워드 해시 (rounds=12)
- `crypto` (Node 내장) — refresh 토큰 sha256

---

## 8. 인증 가드 패턴

```ts
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) return false;
    try {
      req.user = this.jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET });
      return true;
    } catch {
      return false;
    }
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return ctx.switchToHttp().getRequest().user?.role === 'ADMIN';
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().user,
);
```

---

## 9. 환경 변수

```
JWT_ACCESS_SECRET=...
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=3

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

PENDING_LINK_SECRET=...               # pending_link JWT 서명용

WEB_BASE_URL=http://localhost:3001
```

---

## 10. 권한 모델

| Role | 권한 |
|------|------|
| `USER` | 자기 카트/주문/주소만 조회·수정 |
| `ADMIN` | + 상품 CRUD, 모든 주문 조회 |

- 첫 ADMIN은 seed에서 생성: `{ email: 'admin@goods-mall.local', password: 'changeme', role: 'ADMIN' }`
- 일반 가입은 모두 USER

---

## 11. 모바일 지원

본 설계는 처음부터 헤더 기반 일원화되어 있어, 모바일 클라이언트 추가 시 **백엔드 변경 없이** 지원 가능. 단, OAuth 콜백은 모바일에서 custom URL scheme(`myapp://oauth-success`)으로 redirect URL만 변경.

추가 모바일 전용 권장:
- OAuth는 AppAuth(iOS) / Android Custom Tab 사용
- PKCE 적용 (모바일은 client secret 보관 못 함)
- 토큰은 Keychain / EncryptedSharedPreferences에 저장
