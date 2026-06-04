import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request } from 'express';

/** OAuth state nonce를 담는 쿠키 이름 */
export const OAUTH_STATE_COOKIE = 'g_oauth_state';
/** 콜백 경로에만 전송되도록 path 제한 (top-level GET 콜백에 SameSite=Lax로 전송됨) */
const COOKIE_PATH = '/api/v1/auth/google';
const MAX_AGE_MS = 5 * 60 * 1000;

type StoreCallback = (err: Error | null, state?: string) => void;
type VerifyCallback = (
  err: Error | null,
  ok?: boolean,
  info?: { message: string },
) => void;

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  // dev는 http(localhost)라 secure 쿠키가 전송되지 않으므로 prod에서만 켠다
  secure: process.env.NODE_ENV === 'production',
  path: COOKIE_PATH,
});

/**
 * 세션 없는 OAuth CSRF 방어용 state store (RFC 9700 §4.7).
 *
 * 인가 요청 시 랜덤 nonce를 HttpOnly+SameSite=Lax 쿠키에 저장하고 같은 값을
 * `state` 파라미터로 전송한다. 콜백에서 쿠키와 state를 1회성으로 대조하므로,
 * 공격자는 피해자의 쿠키를 설정할 수 없어 위조된 콜백의 state가 일치하지 않는다.
 *
 * passport-oauth2는 메서드 arity로 호출 형태를 정한다(여기선 둘 다 3):
 * - `store(req, meta, cb)` → cb(err, state)로 state 파라미터 값 반환
 * - `verify(req, state, cb)` → cb(err, ok, info)
 */
export class CookieStateStore {
  store(req: Request, _meta: unknown, callback: StoreCallback): void {
    const nonce = randomBytes(16).toString('hex');
    req.res?.cookie(OAUTH_STATE_COOKIE, nonce, {
      ...cookieOptions(),
      maxAge: MAX_AGE_MS,
    });
    callback(null, nonce);
  }

  verify(req: Request, providedState: string, callback: VerifyCallback): void {
    const expected = this.readCookie(req, OAUTH_STATE_COOKIE);
    // 1회용: 결과와 무관하게 쿠키를 즉시 제거(재사용 방지)
    req.res?.clearCookie(OAUTH_STATE_COOKIE, { path: COOKIE_PATH });

    if (
      !expected ||
      !providedState ||
      !this.safeEqual(expected, providedState)
    ) {
      callback(null, false, { message: 'Invalid OAuth state' });
      return;
    }
    callback(null, true);
  }

  private readCookie(req: Request, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) {
        return decodeURIComponent(part.slice(eq + 1).trim());
      }
    }
    return undefined;
  }

  private safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    // timingSafeEqual은 길이가 다르면 throw → 길이부터 비교
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
