import { request } from '@playwright/test';

const BACKEND_URL = process.env.E2E_API_URL ?? 'http://localhost:5000';

export interface E2ESeed {
  userId: string;
  phone: string;
  password: string;
  farmId: string;
}

export type SeedFixture = 'ramu' | 'admin_two_orgs';

export async function resetAndSeed(fixture: SeedFixture = 'ramu'): Promise<E2ESeed> {
  const ctx = await request.newContext();
  const reset = await ctx.post(`${BACKEND_URL}/__e2e/reset`);
  if (!reset.ok()) {
    throw new Error(`E2E reset failed: ${reset.status()} ${await reset.text()}`);
  }
  const seed = await ctx.post(`${BACKEND_URL}/__e2e/seed`, { data: { fixture } });
  if (!seed.ok()) {
    throw new Error(`E2E seed failed: ${seed.status()} ${await seed.text()}`);
  }
  return (await seed.json()) as E2ESeed;
}

export async function setFailPushes(reason: string | null): Promise<void> {
  const ctx = await request.newContext();
  const res = await ctx.post(`${BACKEND_URL}/__e2e/fail-pushes`, { data: { reason } });
  if (!res.ok()) {
    throw new Error(`E2E fail-pushes toggle failed: ${res.status()} ${await res.text()}`);
  }
}
