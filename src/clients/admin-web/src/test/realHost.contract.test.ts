import net from 'node:net';
import axios from 'axios';
import { describe, expect, it } from 'vitest';
import { adminApi } from '@/lib/api';
import { authStore } from '@/lib/auth';
import { renewSession } from '@/lib/sessionRenewal';
import { installAdapter } from '@/test/stubAdapter';
import { takeRealHostAttempts, tripwireConnect } from '@/test/realHostTripwire';

/**
 * spec: company-mis-real-numbers-2026-11-15 (plan CR-2d D14 (4)). Written by the test-writer.
 *
 * A stubbed 401 in vitest had sent a real session renewal (POST /user/auth/refresh) to
 * `localhost:5048`, the PC test stack's API port, which tests must never touch. aa268066 blocks
 * the network in `setup.ts`; D14 (4) asks for a test that fails if any test reaches a real host.
 *
 * Two halves:
 *  1. The tripwire under every client is armed (`setup.ts` -> `realHostTripwire.ts`): a
 *     connection attempt is refused without dialling, and recorded, so the afterEach in
 *     `setup.ts` fails whichever test made it. That is the "any test" half.
 *  2. The leak D14 (4) found stays closed: the stubbed 401 and the renewal it starts, and an
 *     unstubbed call on either client, reach no host at all.
 *
 * Bite proof (recorded in the commit body): with the block in `setup.ts` removed and the
 * tripwire left in place, half 2 goes red naming `localhost:5048`, and nothing is dialled.
 */

const SESSION = {
  accessToken: 'fake-token-d14',
  refreshToken: null,
  userId: '00000000-0000-0000-0000-0000000000d4',
  expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
  signedInAtUtc: new Date(Date.now() - 3_600_000).toISOString(),
};

/** Lets every queued turn run: a refused socket fails on the next turn, a renewal a few turns later. */
async function settle() {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('no test reaches a real host (plan CR-2d D14 (4))', () => {
  it('has the tripwire on the wire under every client', async () => {
    // Checked FIRST, so that without the tripwire the attempt below is never made.
    expect(net.Socket.prototype.connect, 'setup.ts must arm the tripwire').toBe(tripwireConnect);

    const errors: Error[] = [];
    const socket = new net.Socket();
    socket.on('error', (e: Error) => errors.push(e));
    socket.connect(5048, 'localhost');
    await settle();

    expect(takeRealHostAttempts()).toEqual(['localhost:5048']);
    expect(errors[0]?.message).toMatch(/Tests never reach a real host/);
  });

  it('sends nothing out when a stubbed 401 starts a session renewal (the leak D14 (4) found)', async () => {
    authStore.set(SESSION);
    const stub = installAdapter(async () => ({ status: 401, data: {} }));
    try {
      await adminApi.get('/shramsafal/admin/farms').catch(() => undefined);
      await settle();
    } finally {
      stub.restore();
    }

    expect(takeRealHostAttempts()).toEqual([]);
  });

  it('sends nothing out from a renewal called directly, on axios default instance', async () => {
    authStore.set(SESSION);

    await renewSession().catch(() => undefined);
    await settle();

    expect(takeRealHostAttempts()).toEqual([]);
  });

  it('sends nothing out from an unstubbed call on either client', async () => {
    await adminApi.get('/shramsafal/admin/ops/health').catch(() => undefined);
    await axios.get('http://localhost:5048/shramsafal/admin/ops/health').catch(() => undefined);
    await settle();

    expect(takeRealHostAttempts()).toEqual([]);
  });
});
