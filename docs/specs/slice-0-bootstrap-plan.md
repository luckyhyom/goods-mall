# Slice 0 — Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up` + api 실행만으로 api→MariaDB가 끝까지 연결된 API 개발 환경을 구축한다.

**Architecture:** 모노레포 툴링 없이 루트에 독립적인 `api/`(NestJS)를 둔다. MariaDB만 Docker로 띄우고 api는 호스트에서 실행한다. `/health`가 Prisma로 DB를 ping해 전 계층 연결을 증명한다.

**Tech Stack:** NestJS 11, MariaDB 11, Prisma 7(`mysql` provider + `@prisma/adapter-mariadb` 드라이버 어댑터), Jest, Docker Compose

> **Prisma 7 주의:** v7은 Rust 엔진을 제거하고 드라이버 어댑터로 전환됐다. `schema.prisma`의 `datasource.url`이 사라지고, 연결정보는 migrate용 `prisma.config.ts`와 런타임 어댑터로 분리된다. 생성 클라이언트는 NestJS(CommonJS) 호환을 위해 `moduleFormat = "cjs"`로 뽑고 `src/generated/prisma`에 출력한다. 자세한 배경은 Task 3 참조.

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
| `api/src/prisma/prisma.service.ts` | PrismaClient 확장 + 어댑터 주입(생성자), onModuleInit 연결 |
| `api/src/prisma/prisma.module.ts` | 전역 PrismaService 제공 |
| `api/src/health/health.controller.ts` | `GET /health` — DB ping 후 상태 반환 |
| `api/src/health/health.controller.spec.ts` | health 단위 테스트 |
| `api/src/health/health.module.ts` | HealthController 모듈 |
| `api/prisma/schema.prisma` | 빈 schema (`prisma-client` 생성기, `moduleFormat=cjs`, output `../src/generated/prisma`; datasource는 `provider`만, url 없음) |
| `api/prisma.config.ts` | (Prisma 7) migrate용 연결정보 — `datasource.url = env("DATABASE_URL")` |
| `api/src/generated/prisma/` | `prisma generate` 산출물 — gitignore, 커밋 안 함 |
| `api/tsconfig.build.json` | 빌드 시 `prisma.config.ts` 제외 (dist 엔트리 경로 보존) |
| `db/init/01-grant-shadow-db.sh` | MariaDB 최초 init 시 앱 유저에 shadow DB용 전역 권한 부여 |
| `api/.env` / `api/.env.example` | `DATABASE_URL`(기존 `PORT`/`CORS_ORIGIN`에 추가) |
| `README.md` | 실행 방법 |

---

## Task 0: 사전 요구사항 (Node 20 LTS)

**문제:** 호스트 nvm default가 v18.15.0이었다. **Prisma 7이 Node `^20.19 || ^22.12 || >=24.0`을 요구**하므로 18.x에선 `prisma` 설치 자체가 preinstall 단계에서 거부된다. 최신 LTS(현재 v24.x = krypton)로 올리고, 매 세션 `nvm use`를 피하도록 nvm default를 최신 LTS로 고정한다.

- [ ] **Step 1: 현재 버전 확인**

Run: `node -v`
Expected: 18.x 등 구버전이면 업그레이드 필요

- [ ] **Step 2: 최신 LTS 설치 + nvm default 고정**

nvm 사용 시:
```bash
nvm install 'lts/*'          # 최신 LTS 설치 (현재 v24.16.0)
nvm alias default 'lts/*'    # 새 셸이 항상 최신 LTS를 쓰도록 default 고정
nvm use 'lts/*'
```
nvm이 없으면 https://nodejs.org 에서 최신 LTS 설치.

- [ ] **Step 3: 버전 재확인 (새 셸 기준)**

Run: `node -v && npm -v`
Expected: `v24.x` (이상), npm 11.x

> 이 슬라이스의 모든 후속 명령은 최신 LTS 활성화 상태에서 실행한다. 커밋 없음(환경 설정).
> Node 24는 NestJS 11 / Prisma 7(>=24.0)을 모두 충족한다.

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

## Task 1.5: shadow DB 권한 부여 (Prisma 7 회고에서 추가)

**배경:** `prisma migrate dev`는 마이그레이션 검증용 임시 *shadow database*를 만든다. 그러려면 앱 유저에게 전역 DB 생성 권한이 필요한데, `MARIADB_USER`는 기본적으로 `MARIADB_DATABASE` 한 곳 권한만 받아 `P3014`가 난다. 새 볼륨에서도 `docker compose up`만으로 동작하도록 init 스크립트로 권한을 부여한다.

**Files:**
- Create: `db/init/01-grant-shadow-db.sh`
- Modify: `docker-compose.yml` (init 스크립트 마운트)

- [ ] **Step 1: init 스크립트 작성**

`db/init/01-grant-shadow-db.sh`:
```sh
#!/bin/sh
set -e
mariadb -u root -p"$MARIADB_ROOT_PASSWORD" <<SQL
GRANT ALL PRIVILEGES ON *.* TO '$MARIADB_USER'@'%';
FLUSH PRIVILEGES;
SQL
```
> `.sql`이 아닌 `.sh`로 둬서 `$MARIADB_USER` 등 env를 참조 → 자격증명 외부화 유지. 로컬 개발 전용.

- [ ] **Step 2: docker-compose에 마운트**

`docker-compose.yml`의 `volumes`에 추가:
```yaml
    volumes:
      - mariadb_data:/var/lib/mysql
      - ./db/init:/docker-entrypoint-initdb.d:ro
```
> init 스크립트는 데이터 디렉터리가 비어 있을 때(최초 1회)만 실행된다. **이미 떠 있는 기존 볼륨**에는 1회 수동 적용:
> ```bash
> docker exec -e MYSQL_PWD=root goods-mall-mariadb \
>   mariadb -u root -e "GRANT ALL PRIVILEGES ON *.* TO 'goods'@'%'; FLUSH PRIVILEGES;"
> ```

- [ ] **Step 3: 커밋**

```bash
git add docker-compose.yml db/
git commit -m "chore(db): shadow DB 생성용 권한 부여 init 스크립트 추가"
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

## Task 3: Prisma 7 어댑터 연결 + 빈 스키마 마이그레이션

> **회고 메모(실제 구현 결과):** 설치된 Prisma는 **7.x**였고, v6 이하의 고전 패턴(`schema`에 `url`, 무인자 `PrismaClient`)이 통하지 않았다. 아래는 Prisma 7 기준으로 보정된 절차다. 마주친 오류와 해결: ①`P1012 url no longer supported`→`prisma.config.ts`로 분리 ②`P3014 shadow DB 권한 거부`→Task 1.5의 init 스크립트 ③런타임 `exports is not defined`(ESM/CJS 충돌)→생성기 `moduleFormat=cjs` ④`dist/main.js` 엔트리 깨짐→생성물을 `src` 하위로 + build에서 `prisma.config.ts` 제외.

**Files:**
- Create: `api/prisma/schema.prisma`, `api/prisma.config.ts`
- Modify: `api/.env`, `api/.env.example` (DATABASE_URL 추가), `api/tsconfig.build.json`, `api/.gitignore`
- Create: `api/src/prisma/prisma.service.ts`, `api/src/prisma/prisma.module.ts`
- Modify: `api/src/app.module.ts`

- [ ] **Step 1: Prisma 의존성 설치 (어댑터 포함)**

```bash
cd api
npm install prisma --save-dev
npm install @prisma/client @prisma/adapter-mariadb
cd ..
```
> Prisma 7은 DB I/O를 JS 드라이버 어댑터에 위임하므로 MariaDB/MySQL용 `@prisma/adapter-mariadb`가 필수다.

- [ ] **Step 2: schema.prisma 작성 (Prisma 7 빈 스키마)**

`api/prisma/schema.prisma`:
```prisma
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "cjs"
  importFileExtension = ""
}

datasource db {
  provider = "mysql"
}
```
> v7 변화: 생성기는 `prisma-client`(엔진리스), `output` 필수, NestJS(CommonJS) 호환 위해 `moduleFormat = "cjs"`. datasource에 **url을 두지 않는다**(두면 P1012).
> `importFileExtension = ""`: 기본값(`js`)이면 생성 코드가 `./x.js`를 import하는데 실제 파일은 `.ts`라 **jest(ts-jest) 리졸버가 모듈을 못 찾는다**(Task 4에서 발현). 확장자를 비우면 빌드·jest 양쪽이 해석 가능.

- [ ] **Step 3: prisma.config.ts 작성 (migrate 연결정보)**

`api/prisma.config.ts`:
```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
```

- [ ] **Step 4: .env / .env.example에 DATABASE_URL 추가**

기존 `PORT`/`CORS_ORIGIN`을 보존하고 아래를 **추가**(덮어쓰기 아님):
```
# 데이터베이스
DATABASE_URL="mysql://goods:goods@localhost:3306/goods_mall"
```
`.env`와 `.env.example` 양쪽 모두.

- [ ] **Step 5: 빌드 엔트리 보존 — tsconfig.build.json / .gitignore**

`api/tsconfig.build.json`의 `exclude`에 `prisma.config.ts`를 추가한다(이 파일이 컴파일에 끼면 rootDir가 올라가 `dist/main.js`가 `dist/src/main.js`로 밀린다).
```json
"exclude": ["node_modules", "test", "dist", "**/*spec.ts", "prisma.config.ts"]
```
`api/.gitignore`에 생성물 디렉터리 추가:
```
# Prisma 생성 클라이언트 (prisma generate로 재생성)
/src/generated
```

- [ ] **Step 6: 첫 마이그레이션 실행 (MariaDB가 떠 있고 Task 1.5 권한이 적용된 상태)**

```bash
cd api && npx prisma migrate dev --name init && cd ..
```
Expected: `Loaded Prisma config from prisma.config.ts` → DB 접속 → 모델이 없으므로 **SQL 마이그레이션 파일은 생성되지 않고** `Already in sync` 메시지. 이는 정상 — 연결/마이그레이션 파이프라인이 검증된 상태다. 첫 SQL 마이그레이션은 Slice 1(User 모델)에서 생긴다.
> `P3014`(shadow DB 권한 거부)가 나면 Task 1.5의 grant가 적용되지 않은 것 — 먼저 그것을 수행한다.

- [ ] **Step 7: 클라이언트 생성 + 상태 확인**

```bash
cd api && npx prisma generate && npx prisma migrate status && cd ..
```
Expected: `Generated Prisma Client (7.x) to ./src/generated/prisma`, 그리고 `Database schema is up to date!`

- [ ] **Step 8: PrismaService 작성 (어댑터 주입)**

`api/src/prisma/prisma.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ adapter: new PrismaMariaDb(process.env.DATABASE_URL as string) });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
```
> `PrismaMariaDb` 생성자는 연결 문자열(string)을 직접 받으므로 단일 `DATABASE_URL`을 재사용한다. 런타임 `process.env`는 `ConfigModule.forRoot({ isGlobal: true })`가 채운다.

- [ ] **Step 9: PrismaModule 작성 (전역)**

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

- [ ] **Step 10: app.module.ts에 PrismaModule 등록 (ConfigModule 유지)**

`api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 11: 빌드 + 런타임 연결 검증**

```bash
cd api && npm run build && cd ..
```
Expected: 에러 없이 컴파일되고 **`dist/main.js`가 존재**(엔트리 보존).
이어 잠깐 부팅해 어댑터 연결을 확인:
```bash
cd api && node dist/main.js   # "API listening on http://localhost:4000" 뜨고 크래시 없으면 OK, Ctrl+C
```
> `exports is not defined in ES module scope`가 나면 생성기 `moduleFormat=cjs` 누락 — Step 2 확인 후 `rm -rf src/generated && npx prisma generate`.

- [ ] **Step 12: 커밋**

```bash
git add api/prisma api/prisma.config.ts api/src/prisma api/src/app.module.ts \
        api/.env.example api/.gitignore api/tsconfig.build.json api/package.json
git commit -m "feat(api): Prisma 7 어댑터 연결 및 마이그레이션 구성"
```
> `api/.env`, `api/src/generated`는 `.gitignore`로 제외됨 — 커밋되지 않는 것이 정상. (루트 `.gitignore`가 `package-lock.json`도 무시)

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

## Task 5: README + 최종 검증 + roadmap 갱신

**Files:**
- Create: `README.md`
- Modify: `docs/specs/roadmap.md`

- [ ] **Step 1: README 작성**

`README.md`:
```markdown
# goods-mall (API)

포트폴리오/학습용 굿즈 쇼핑몰 MVP의 백엔드 API. 설계 문서는 [docs/specs](./docs/specs).

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
```

`curl -s http://localhost:4000/health` → `{"status":"ok","db":"up"}` 이면 성공.
```

- [ ] **Step 2: 전체 통합 재검증 (클린 체크)**

순서대로 실행해 모두 성공하는지 확인:
1. `docker compose ps` → mariadb `Up (healthy)`
2. `cd api && npm run build && cd ..` → 컴파일 성공
3. `cd api && npx jest && cd ..` → 모든 테스트 PASS
4. `curl -s http://localhost:4000/health` (서버 기동 상태) → `{"status":"ok","db":"up"}`

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

**1. Spec coverage (roadmap Slice 0 핵심 기능):**
- Docker Compose (MariaDB) → Task 1 (+ shadow DB 권한 Task 1.5) ✅
- NestJS skeleton → Task 2 ✅
- Prisma 연결 + 첫 마이그레이션 → Task 3 ✅ (Prisma 7 어댑터 기준, 빈 스키마 동작 한계 명시)
- `/health` 엔드포인트 → Task 4 ✅

**2. Placeholder scan:** TBD/TODO/"적절히 처리" 없음. 모든 코드/명령 구체화됨.

**3. Type consistency:** `PrismaService.$queryRaw`, `HealthController.check()`, `Health` 타입, `NEXT_PUBLIC_API_URL`이 정의-사용 간 일치. 포트(api 4000 / web 3000) 전 task 일관.

**알려진 한계 (의도된 결정):**
- 빈 스키마 → 첫 SQL 마이그레이션 파일 없음 (Slice 1로 이연). Task 3 Step 6 및 Task 7 Step 4에 명시.
- 루트 `.gitignore`가 `package-lock.json`을 무시 → 재현성보다 단순성 우선한 기존 결정 유지. (커밋 명령의 lock 파일 add는 무시되어도 무해)
- **Prisma 7 전환(회고 보정):** 플랜 초안은 Prisma 6 이하 기준이었으나 실제 설치본은 7.x였다. v7은 드라이버 어댑터(`@prisma/adapter-mariadb`) + `prisma.config.ts` + `moduleFormat=cjs` + `src/generated` 출력으로 구성한다. Task 3와 File Structure를 이에 맞게 보정 완료.
- shadow DB용 전역 권한 부여는 로컬 개발 전용. 운영 환경에선 별도 마이그레이션 전략 필요(Slice 후반/배포 시 재검토).
