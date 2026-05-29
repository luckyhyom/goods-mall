# Slice 0 — Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up` + api/web 실행만으로 web→api→MariaDB가 끝까지 연결된 풀스택 개발 환경을 구축한다.

**Architecture:** 모노레포 툴링 없이 루트에 독립적인 `api/`(NestJS), `web/`(Next.js App Router)를 둔다. MariaDB만 Docker로 띄우고 api/web은 호스트에서 실행한다. `/health`가 Prisma로 DB를 ping해 전 계층 연결을 증명하고, web 홈이 그 `/health`를 호출해 화면에 표시한다.

**Tech Stack:** NestJS 10, Next.js(App Router, TS), MariaDB 11, Prisma(`mysql` provider), Tailwind CSS, Jest, Docker Compose

**참고 문서:** [foundation.md](./foundation.md)

> **포트 규칙:** api = **4000**, web = **3000** (둘 다 기본 3000이라 api를 옮겨 충돌 회피)
> **DB 접속:** `mysql://goods:goods@localhost:3306/goods_mall`

---

## File Structure

이 슬라이스에서 생성/수정하는 파일과 책임:

| 파일 | 책임 |
|------|------|
| `docker-compose.yml` | MariaDB 컨테이너 정의 (포트 3306, 영속 볼륨) |
| `api/` (nest new 생성물) | NestJS 앱 루트 |
| `api/src/main.ts` | 부트스트랩 — 포트 4000, CORS 활성화 |
| `api/src/app.module.ts` | 루트 모듈 — PrismaModule, HealthModule 조립 |
| `api/src/prisma/prisma.service.ts` | PrismaClient 확장, onModuleInit 연결 |
| `api/src/prisma/prisma.module.ts` | 전역 PrismaService 제공 |
| `api/src/health/health.controller.ts` | `GET /health` — DB ping 후 상태 반환 |
| `api/src/health/health.controller.spec.ts` | health 단위 테스트 |
| `api/src/health/health.module.ts` | HealthController 모듈 |
| `api/prisma/schema.prisma` | 빈 schema (generator + datasource만) |
| `api/.env` / `api/.env.example` | `DATABASE_URL` |
| `web/` (create-next-app 생성물) | Next.js App Router 앱 루트 |
| `web/src/app/page.tsx` | 홈 — API `/health` 호출해 표시 |
| `web/.env.local` / `web/.env.example` | `NEXT_PUBLIC_API_URL` |
| `README.md` | 실행 방법 |

---

## Task 0: 사전 요구사항 (Node 20 LTS)

**문제:** 현재 호스트 Node는 v18.15.0. Next.js는 Node `^18.18.0 || ^19.8.0 || >=20.0.0`을 요구하므로 그대로면 `create-next-app`이 실패한다. Node 20 LTS로 올린다.

- [ ] **Step 1: 현재 버전 확인**

Run: `node -v`
Expected: `v18.15.0` (또는 18.18 미만이면 업그레이드 필요)

- [ ] **Step 2: Node 20 LTS 설치 후 활성화**

nvm 사용 시:
```bash
nvm install 20
nvm use 20
```
nvm이 없으면 https://nodejs.org 에서 20 LTS 설치.

- [ ] **Step 3: 버전 재확인**

Run: `node -v && npm -v`
Expected: `v20.x.x` 이상, npm 10.x

> 이 슬라이스의 모든 후속 명령은 Node 20 활성화 상태에서 실행한다. 커밋 없음(환경 설정).

---

## Task 1: MariaDB (Docker Compose)

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: docker-compose.yml 작성**

```yaml
services:
  mariadb:
    image: mariadb:11
    container_name: goods-mall-mariadb
    restart: unless-stopped
    environment:
      MARIADB_ROOT_PASSWORD: root
      MARIADB_DATABASE: goods_mall
      MARIADB_USER: goods
      MARIADB_PASSWORD: goods
    ports:
      - "3306:3306"
    volumes:
      - mariadb_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  mariadb_data:
```

- [ ] **Step 2: 컨테이너 기동**

Run: `docker compose up -d`
Expected: `Container goods-mall-mariadb  Started`

- [ ] **Step 3: 헬스 상태 확인**

Run: `docker compose ps`
Expected: `goods-mall-mariadb` 가 `Up` 그리고 `(healthy)` 표시 (몇 초 대기 후)

- [ ] **Step 4: 커밋**

```bash
git add docker-compose.yml
git commit -m "chore(db): MariaDB docker compose 추가"
```

---

## Task 2: NestJS 스켈레톤 (api/)

**Files:**
- Create: `api/` (CLI 생성)
- Modify: `api/src/main.ts`
- Modify: `api/src/app.module.ts`
- Delete: `api/src/app.controller.ts`, `api/src/app.controller.spec.ts`, `api/src/app.service.ts`

- [ ] **Step 1: NestJS 프로젝트 생성**

레포 루트에서:
```bash
npx -y @nestjs/cli@latest new api --package-manager npm --skip-git
```
Expected: `api/` 폴더 생성, 의존성 설치 완료. (`--skip-git`로 중첩 .git 미생성)

- [ ] **Step 2: 기본 보일러플레이트 제거**

```bash
rm api/src/app.controller.ts api/src/app.controller.spec.ts api/src/app.service.ts
```

- [ ] **Step 3: app.module.ts를 최소 상태로 교체**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 4: main.ts에 포트 4000 + CORS 적용**

`api/src/main.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: 'http://localhost:3000', credentials: true });
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
bootstrap();
```

- [ ] **Step 5: 빌드 검증 (보일러플레이트 제거 후 컴파일 확인)**

Run: `cd api && npm run build && cd ..`
Expected: 에러 없이 `dist/` 생성

- [ ] **Step 6: .gitignore에 .env / uploads 보장**

`api/.gitignore` 끝에 다음 줄이 없으면 추가:
```
.env
/uploads
```
(루트 `.gitignore`가 이미 `.env`를 무시하지만 api 디렉터리 기준으로도 명시)

- [ ] **Step 7: 커밋**

```bash
git add api
git commit -m "build(api): NestJS 스켈레톤 생성"
```

---

## Task 3: Prisma 연결 + 빈 스키마 마이그레이션

**Files:**
- Create: `api/prisma/schema.prisma`, `api/.env`, `api/.env.example`
- Create: `api/src/prisma/prisma.service.ts`, `api/src/prisma/prisma.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Prisma 의존성 설치**

```bash
cd api
npm install prisma --save-dev
npm install @prisma/client
cd ..
```

- [ ] **Step 2: schema.prisma 작성 (빈 스키마)**

`api/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 3: .env 와 .env.example 작성**

`api/.env`:
```
DATABASE_URL="mysql://goods:goods@localhost:3306/goods_mall"
PORT=4000
```

`api/.env.example`:
```
DATABASE_URL="mysql://goods:goods@localhost:3306/goods_mall"
PORT=4000
```

- [ ] **Step 4: 첫 마이그레이션 실행 (Task 1의 MariaDB가 떠 있어야 함)**

```bash
cd api && npx prisma migrate dev --name init && cd ..
```
Expected: Prisma가 DB에 접속해 `_prisma_migrations` 테이블을 만든다.
- 스키마에 모델이 없으므로 **SQL 마이그레이션 파일은 생성되지 않고** "Already in sync" 류 메시지가 나올 수 있다. 이는 정상 — 연결/마이그레이션 파이프라인이 검증된 상태다. 첫 SQL 마이그레이션은 Slice 1(User 모델)에서 생긴다.
- (회고에서 roadmap의 "첫 마이그레이션(빈 schema)" 문구를 이 실제 동작에 맞게 보정할 것.)

- [ ] **Step 5: 마이그레이션 상태 확인**

Run: `cd api && npx prisma migrate status && cd ..`
Expected: `Database schema is up to date!` (또는 모델 없음으로 인한 동등 메시지, 에러 없음)

- [ ] **Step 6: PrismaService 작성**

`api/src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 7: PrismaModule 작성 (전역)**

`api/src/prisma/prisma.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 8: app.module.ts에 PrismaModule 등록**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 9: 빌드 검증**

Run: `cd api && npm run build && cd ..`
Expected: 에러 없이 컴파일

- [ ] **Step 10: 커밋**

```bash
git add api/prisma api/src/prisma api/src/app.module.ts api/.env.example api/package.json api/package-lock.json
git commit -m "feat(api): Prisma 연결 및 빈 스키마 마이그레이션 설정"
```
> `api/.env`는 `.gitignore`로 제외됨 — 커밋되지 않는 것이 정상.

---

## Task 4: `/health` 엔드포인트 (TDD)

**Files:**
- Test: `api/src/health/health.controller.spec.ts`
- Create: `api/src/health/health.controller.ts`, `api/src/health/health.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`api/src/health/health.controller.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };

  beforeEach(async () => {
    prismaMock.$queryRaw.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: prismaMock }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('DB ping 성공 시 status ok, db up 반환', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ '1': 1 }]);
    await expect(controller.check()).resolves.toEqual({ status: 'ok', db: 'up' });
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('DB ping 실패 시 status error, db down 반환', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(controller.check()).resolves.toEqual({ status: 'error', db: 'down' });
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd api && npx jest health.controller --silent=false; cd ..`
Expected: FAIL — `Cannot find module './health.controller'` (아직 구현 없음)

- [ ] **Step 3: HealthController 구현**

`api/src/health/health.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      return { status: 'error', db: 'down' };
    }
  }
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd api && npx jest health.controller; cd ..`
Expected: PASS — 2 tests passed

- [ ] **Step 5: HealthModule 작성 및 app.module 등록**

`api/src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [PrismaModule, HealthModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 6: 실제 서버에서 수동 검증 (MariaDB 기동 상태)**

터미널 A: `cd api && npm run start:dev`
터미널 B: `curl -s http://localhost:4000/health`
Expected: `{"status":"ok","db":"up"}`

- [ ] **Step 7: 커밋**

```bash
git add api/src/health api/src/app.module.ts
git commit -m "feat(api): DB ping 포함 /health 엔드포인트 추가"
```

---

## Task 5: Next.js 스켈레톤 (web/)

**Files:**
- Create: `web/` (CLI 생성)

- [ ] **Step 1: Next.js 프로젝트 생성**

레포 루트에서 (Node 20 활성화 상태):
```bash
npx -y create-next-app@latest web \
  --typescript --eslint --tailwind --app --src-dir \
  --import-alias "@/*" --use-npm --disable-git
```
Expected: `web/` 폴더 생성, 의존성 설치 완료. 남는 프롬프트가 있으면 기본값(Enter) 선택.

- [ ] **Step 2: 중첩 git 저장소 제거 (생성됐을 경우 안전장치)**

```bash
rm -rf web/.git
```
Expected: 에러 없음(없으면 그대로 통과). 루트 단일 저장소 유지.

- [ ] **Step 3: 개발 서버 기동 확인**

Run: `cd web && npm run dev` (터미널에서 실행 후 확인)
Expected: `http://localhost:3000` 에서 Next.js 기본 페이지 렌더링. 확인 후 Ctrl+C.

- [ ] **Step 4: 커밋**

```bash
git add web
git commit -m "build(web): Next.js App Router 스켈레톤 생성"
```

---

## Task 6: web → api `/health` 통합

**Files:**
- Create: `web/.env.local`, `web/.env.example`
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: 환경변수 파일 작성**

`web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

`web/.env.example`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

- [ ] **Step 2: 홈 페이지를 health 표시용으로 교체**

`web/src/app/page.tsx`:
```tsx
type Health = { status: string; db?: string };

async function getHealth(): Promise<Health> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/health`, {
      cache: 'no-store',
    });
    if (!res.ok) return { status: 'error' };
    return (await res.json()) as Health;
  } catch {
    return { status: 'unreachable' };
  }
}

export default async function Home() {
  const health = await getHealth();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <h1 className="text-3xl font-bold">goods-mall</h1>
      <p className="text-sm text-gray-500">
        API: <span className="font-mono">{health.status}</span>
        {health.db ? ` · DB: ${health.db}` : ''}
      </p>
    </main>
  );
}
```

- [ ] **Step 3: 통합 수동 검증 (3개 모두 기동)**

1. `docker compose up -d` (MariaDB)
2. 터미널 A: `cd api && npm run start:dev`
3. 터미널 B: `cd web && npm run dev`
4. 브라우저: `http://localhost:3000`

Expected: 페이지에 `API: ok · DB: up` 표시 → web→api→DB 전 계층 연결 확인

- [ ] **Step 4: 커밋**

```bash
git add web/src/app/page.tsx web/.env.example
git commit -m "feat(web): 홈에서 API health 상태 표시"
```
> `web/.env.local`은 `.gitignore`로 제외됨 — 정상.

---

## Task 7: README + 최종 검증 + roadmap 갱신

**Files:**
- Create: `README.md`
- Modify: `docs/specs/roadmap.md`

- [ ] **Step 1: README 작성**

`README.md`:
```markdown
# goods-mall

포트폴리오/학습용 굿즈 쇼핑몰 MVP. 설계 문서는 [docs/specs](./docs/specs).

## 사전 요구사항
- Node 20 LTS 이상
- Docker

## 로컬 실행

```bash
# 1. DB 기동
docker compose up -d

# 2. API (포트 4000)
cd api
cp .env.example .env   # 최초 1회
npm install            # 최초 1회
npx prisma migrate dev # 최초 1회
npm run start:dev

# 3. Web (포트 3000) — 새 터미널
cd web
cp .env.example .env.local  # 최초 1회
npm install                 # 최초 1회
npm run dev
```

브라우저에서 http://localhost:3000 접속 → `API: ok · DB: up` 표시되면 성공.
```

- [ ] **Step 2: 전체 통합 재검증 (클린 체크)**

순서대로 실행해 모두 성공하는지 확인:
1. `docker compose ps` → mariadb `Up (healthy)`
2. `cd api && npm run build && cd ..` → 컴파일 성공
3. `cd api && npx jest && cd ..` → 모든 테스트 PASS
4. `curl -s http://localhost:4000/health` (서버 기동 상태) → `{"status":"ok","db":"up"}`
5. http://localhost:3000 → `API: ok · DB: up`

- [ ] **Step 3: roadmap 체크박스 갱신**

`docs/specs/roadmap.md`의 Slice 0 항목 갱신:
```markdown
- [x] **Slice 0 — Bootstrap**
  - [x] Plan 작성 (`slice-0-bootstrap-plan.md`)
  - [x] 구현
  - [x] 회고
```
그리고 Slice 0 상세의 `**Plan:**` 줄을 `**Plan:** [slice-0-bootstrap-plan.md](./slice-0-bootstrap-plan.md)`로 채운다.

- [ ] **Step 4: 회고 반영 (필요 시 Foundation 보정)**

Task 3에서 확인한 "빈 스키마는 SQL 마이그레이션 파일을 만들지 않는다"는 사실을 roadmap의 Slice 0 설명 문구에 반영 (예: "Prisma 연결 + 마이그레이션 파이프라인 확립 (첫 SQL 마이그레이션은 Slice 1)").

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/specs/roadmap.md
git commit -m "docs: README 작성 및 Slice 0 완료 반영"
```

---

## Self-Review (작성자 체크 결과)

**1. Spec coverage (roadmap Slice 0 핵심 기능 5개):**
- Docker Compose (MariaDB) → Task 1 ✅
- NestJS skeleton → Task 2 ✅
- Next.js App Router skeleton → Task 5 ✅
- Prisma 연결 + 첫 마이그레이션 → Task 3 ✅ (빈 스키마 동작 한계 명시)
- `/health` 엔드포인트 → Task 4 ✅
- (추가) 풀스택 통합 증명 → Task 6 ✅

**2. Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드/명령 구체화됨.

**3. Type consistency:** `PrismaService.$queryRaw`, `HealthController.check()`, `Health` 타입, `NEXT_PUBLIC_API_URL`이 정의-사용 간 일치. 포트(api 4000 / web 3000) 전 task 일관.

**알려진 한계 (의도된 결정):**
- 빈 스키마 → 첫 SQL 마이그레이션 파일 없음 (Slice 1로 이연). Task 3 Step 4 및 Task 7 Step 4에 명시.
- 루트 `.gitignore`가 `package-lock.json`을 무시 → 재현성보다 단순성 우선한 기존 결정 유지. (커밋 명령의 lock 파일 add는 무시되어도 무해)
