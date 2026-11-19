import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiBaseUrl } from '@/lib/api';

/**
 * Task 11 — the fallback that presented a configuration mistake as a
 * permissions problem.
 *
 * `.env.local` is gitignored, so a git worktree has no copy of it. The base
 * url then fell back to `http://localhost:5001`, which nothing has ever
 * listened on: every request failed, every screen showed its denied or empty
 * state, and the console read as "my admin account lost its permissions".
 * Task 10 lost a debugging session to exactly this.
 *
 * The environment is passed in rather than mocked, so these assertions run
 * against the same function the shipping module calls with no argument. There
 * is no test-only branch in the resolver.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveApiBaseUrl', () => {
  it('uses the configured value when there is one', () => {
    expect(resolveApiBaseUrl({ VITE_API_BASE_URL: 'https://api.shramsafal.in' })).toBe(
      'https://api.shramsafal.in',
    );
  });

  it('ignores a variable that is present but blank', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveApiBaseUrl({ VITE_API_BASE_URL: '   ' })).toBe('http://localhost:5048');
    expect(warn).toHaveBeenCalled();
  });

  it('never falls back to 5001 again — nothing listens there', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const resolved = resolveApiBaseUrl({});
    expect(resolved).not.toContain('5001');
    // 5048 is the port the API is actually on:
    // AgriSync.Bootstrapper/Properties/launchSettings.json:8.
    expect(resolved).toBe('http://localhost:5048');
  });

  it('says out loud that it fell back, and names the file to create', () => {
    // Silence is the other half of the defect. A default that is wrong AND
    // quiet is indistinguishable from a permissions bug.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolveApiBaseUrl({});

    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('VITE_API_BASE_URL');
    expect(message).toContain('.env.local');
    expect(message).toContain('permissions problem');
  });

  it('escalates to console.error in a production bundle, where there is no localhost to reach', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    resolveApiBaseUrl({ PROD: true });

    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0][0])).toContain('production bundle');
  });

  it('does not throw in a production bundle', () => {
    // lighthouse.yml builds this app with no env at all and scores the static
    // output. A module-level throw would blank the page and take a required
    // performance budget down with it. The build-time refusal that belongs
    // here lives in vite.config.ts and is Task 28's.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => resolveApiBaseUrl({ PROD: true })).not.toThrow();
  });
});
