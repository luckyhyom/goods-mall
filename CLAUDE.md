## 코딩 규칙 (요약 — 본문은 링크 참조)

- **단순 계층 모듈**(auth/user/product): **`auth` 모듈이 레퍼런스 구현** — 새 모듈은 auth를 보고 따른다.
  - Request DTO = `dto/*.request.ts`/`XxxRequest`(class-validator). Response DTO = `dto/*.response.ts`/`XxxResponse`(**생성자 화이트리스트** 매핑).

## 작업 규칙

- 테스트: **`npm test`** (`api/`에서). `npx jest` 금지 — ts-jest 미적용.
- `npm install`은 반드시 `api/`에서 (cwd가 상위면 상위 package.json에 깔림).