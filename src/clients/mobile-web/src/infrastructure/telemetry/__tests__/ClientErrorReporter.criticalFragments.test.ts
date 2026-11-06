// @vitest-environment node
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F99 leftover L-5).
 *
 * The client-error reporter only reports a failure whose URL contains one of CRITICAL_ENDPOINTS. One fragment,
 * '/ai/extract', matched no route the server has, so a failed bill or sale-slip read was never reported. Every fragment
 * must be part of a real server route (sync-contract/routes/server-rest-routes.txt, which a server test keeps current).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CRITICAL_ENDPOINTS } from '../ClientErrorReporter';

const ROUTES = readFileSync(
    resolve(__dirname, '../../../../../../../sync-contract/routes/server-rest-routes.txt'),
    'utf8',
)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(GET|POST|PUT|PATCH|DELETE) \//.test(line))
    .map((line) => line.split(' ')[1].toLowerCase());

describe('the error reporter\'s critical fragments name real server routes', () => {
    it('reads the route list (the check is not vacuous)', () => {
        expect(ROUTES.length).toBeGreaterThan(100);
    });

    it.each([...CRITICAL_ENDPOINTS])('%s is part of a route the server serves', (fragment) => {
        expect(ROUTES.some((route) => route.includes(fragment))).toBe(true);
    });

    it('the old fragment that matched nothing is gone, and the real extraction routes are covered', () => {
        expect(CRITICAL_ENDPOINTS).not.toContain('/ai/extract');
        expect(CRITICAL_ENDPOINTS).toContain('/ai/receipt-extract');
        expect(CRITICAL_ENDPOINTS).toContain('/ai/patti-extract');
    });
});
