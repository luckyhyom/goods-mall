import type { Request } from 'express';
import { CookieStateStore, OAUTH_STATE_COOKIE } from './cookie-state.store';

/**
 * 세션 없는 OAuth state(CSRF 방어) store 단위 테스트.
 * store는 nonce를 쿠키에 심고 같은 값을 state로 반환, verify는 1회성 대조한다.
 */
describe('CookieStateStore', () => {
  let store: CookieStateStore;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  const reqWith = (cookieHeader?: string): Request =>
    ({ headers: cookieHeader ? { cookie: cookieHeader } : {}, res } as unknown as Request);

  beforeEach(() => {
    store = new CookieStateStore();
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
  });

  describe('store', () => {
    it('nonce를 HttpOnly+SameSite=Lax 쿠키에 심고 같은 값을 state로 반환', (done) => {
      store.store(reqWith(), {}, (err, state) => {
        expect(err).toBeNull();
        expect(typeof state).toBe('string');
        expect(state).toMatch(/^[0-9a-f]+$/); // 랜덤 hex nonce
        expect(res.cookie).toHaveBeenCalledWith(
          OAUTH_STATE_COOKIE,
          state,
          expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
        );
        done();
      });
    });
  });

  describe('verify', () => {
    it('쿠키와 state가 일치하면 ok=true, 쿠키는 1회용으로 제거', (done) => {
      const nonce = 'abc123';
      store.verify(reqWith(`${OAUTH_STATE_COOKIE}=${nonce}`), nonce, (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(true);
        expect(res.clearCookie).toHaveBeenCalledWith(
          OAUTH_STATE_COOKIE,
          expect.any(Object),
        );
        done();
      });
    });

    it('state가 쿠키와 다르면 ok=false', (done) => {
      store.verify(
        reqWith(`${OAUTH_STATE_COOKIE}=expected`),
        'attacker-supplied',
        (err, ok) => {
          expect(err).toBeNull();
          expect(ok).toBe(false);
          done();
        },
      );
    });

    it('state 쿠키가 없으면(위조 콜백) ok=false', (done) => {
      store.verify(reqWith(), 'whatever', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });

    it('state 파라미터가 비어 있으면 ok=false', (done) => {
      store.verify(reqWith(`${OAUTH_STATE_COOKIE}=expected`), '', (err, ok) => {
        expect(err).toBeNull();
        expect(ok).toBe(false);
        done();
      });
    });
  });
});
