import { describe, expect, it } from 'vitest';
import { adminApi } from '@/lib/api';
import { installAdapter } from '@/test/stubAdapter';

/**
 * THE SUITE'S TRANSPORT, PINNED — Task 29.
 *
 * `src/test/setup.ts` replaces axios's real XHR adapter with one that fails
 * every request no test has stubbed. This file is why that cannot be deleted
 * as tidy-up, and it asserts the two properties the fix rests on.
 *
 * The defect it closes is measured in setup.ts's own header: with the real
 * adapter as the baseline, a request left in flight by one test was dispatched
 * during the next one, answered **401** by the developer's own API on
 * `localhost:5048`, and the module-singleton response interceptor then cleared
 * `admin.session.v1` — out from under a test that had just written it. The
 * console mounted anonymous and rendered the sign-in screen where a page was
 * expected. Five tasks read that as file parallelism.
 */
describe('an unstubbed request never reaches a real server (Task 29)', () => {
  it('is rejected by the test transport rather than dialled', async () => {
    await expect(adminApi.get('/shramsafal/admin/ops/health')).rejects.toThrow(
      /reached the transport with no stub installed/,
    );
  });

  it('names the method and the url, so a leak can be attributed', async () => {
    await expect(adminApi.post('/user/auth/login', {})).rejects.toThrow(
      /POST \/user\/auth\/login/,
    );
  });

  /**
   * The load-bearing half. A leaked request must not be able to reach the
   * 401 branch of `lib/api.ts`, because that branch clears the session for
   * the WHOLE file — it is a module singleton, not a per-test object.
   *
   * An axios error carries `response.status`; this one carries no `response`
   * at all, which is what makes every status branch unreachable.
   */
  it('carries no HTTP response, so no status branch of the interceptor can fire', async () => {
    localStorage.setItem('admin.session.v1', JSON.stringify({ accessToken: 'x' }));

    await expect(adminApi.get('/shramsafal/admin/me/scope')).rejects.toSatisfy(
      (e: unknown) => (e as { response?: unknown }).response === undefined,
    );

    expect(localStorage.getItem('admin.session.v1')).not.toBeNull();
  });

  /**
   * And it is re-armed per test, so a `restore()` in the middle of a test body
   * — `deepLink.contract.test.tsx` does exactly that, to swap a 401 server for
   * a working one — hands the wire back to this transport and not to the
   * network.
   */
  it('is what installAdapter().restore() restores to', async () => {
    const stub = installAdapter(async () => ({ status: 200, data: { ok: true } }));
    await expect(adminApi.get('/anything')).resolves.toMatchObject({ status: 200 });

    stub.restore();

    await expect(adminApi.get('/anything')).rejects.toThrow(
      /reached the transport with no stub installed/,
    );
  });
});
