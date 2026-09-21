import { Response } from 'express';
import {
  clearRefreshCookie,
  readRefreshCookie,
  RefreshCookieConfig,
  setRefreshCookie,
} from './cookie.util';

const config = (env: string): RefreshCookieConfig => ({
  env,
  apiPrefix: 'api/v1',
  refreshCookieName: 'rt',
});

function fakeResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  } as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
}

describe('refresh cookie helpers', () => {
  const expiresAt = new Date('2030-01-01T00:00:00Z');

  it('sets an HttpOnly, SameSite=Lax cookie scoped to the auth path, with the expiry', () => {
    const res = fakeResponse();
    setRefreshCookie(res, config('development'), 'tok', expiresAt);

    expect(res.cookie).toHaveBeenCalledWith('rt', 'tok', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/auth',
      expires: expiresAt,
    });
  });

  it('marks the cookie Secure in production', () => {
    const res = fakeResponse();
    setRefreshCookie(res, config('production'), 'tok', expiresAt);
    expect(res.cookie.mock.calls[0][2].secure).toBe(true);
  });

  it.each(['development', 'test', 'staging'])(
    'does not mark the cookie Secure in %s',
    (env) => {
      const res = fakeResponse();
      setRefreshCookie(res, config(env), 'tok', expiresAt);
      expect(res.cookie.mock.calls[0][2].secure).toBe(false);
    },
  );

  it('clears with the same attributes it was set with (otherwise browsers keep the cookie)', () => {
    const res = fakeResponse();
    clearRefreshCookie(res, config('production'));
    expect(res.clearCookie).toHaveBeenCalledWith('rt', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  });

  it('reads the cookie by its configured name, and tolerates a missing cookie jar', () => {
    expect(
      readRefreshCookie({ cookies: { rt: 'abc' } }, config('development')),
    ).toBe('abc');
    expect(
      readRefreshCookie({ cookies: {} }, config('development')),
    ).toBeUndefined();
    expect(readRefreshCookie({}, config('development'))).toBeUndefined();
  });
});
