import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * 초기 ADMIN 계정 seed (auth-strategy §10).
 * 비밀번호는 시크릿 외부화 원칙에 따라 env(ADMIN_PASSWORD)에서만 받는다.
 * upsert로 멱등 — 반복 실행해도 중복 생성 없이 ADMIN 역할을 보장한다.
 */
async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ?? 'admin@goods-mall.local';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      'ADMIN_PASSWORD 환경변수가 필요합니다 (시크릿 외부화 — .env 참고).',
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb(process.env.DATABASE_URL as string),
  });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    // seed의 목적은 "초기 관리자 보장". 같은 이메일의 기존 계정이 있더라도
    // role뿐 아니라 passwordHash도 env 값으로 맞춰, 기존 비번이 그대로 관리자
    // 권한을 얻는 권한 상승 surprise를 막는다(매 실행이 선언적 desired state).
    const admin = await prisma.user.upsert({
      where: { email },
      update: { role: 'ADMIN', passwordHash },
      create: { email, name: 'Admin', passwordHash, role: 'ADMIN' },
    });
    console.log(`[seed] ADMIN 준비 완료: ${admin.email} (${admin.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed] 실패:', err);
  process.exit(1);
});
