# goods-mall

포트폴리오/학습용 굿즈 쇼핑몰 MVP. 설계 문서는 [docs/specs](./docs/specs).

## 사전 요구사항
- Node 20 LTS 이상 (Prisma 7은 `^20.19 || ^22.12 || >=24` 요구)
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

## 구조

| 디렉터리 | 역할 |
|----------|------|
| `api/`   | NestJS 11 + Prisma 7(`@prisma/adapter-mariadb`) API 서버 |
| `web/`   | Next.js(App Router, TS, Tailwind) 프런트 — Vercel 단독 배포 대상 |
| `db/`    | MariaDB Docker init 스크립트 |
| `docs/`  | 설계 문서 · 슬라이스 로드맵 |
