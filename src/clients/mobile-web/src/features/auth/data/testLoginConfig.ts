/**
 * Single source of truth for the founder test-login phone.
 * spec: test-login-bypass-frontend-wiring-2026-06-01
 *
 * The phone is supplied at build time via `VITE_TEST_LOGIN_PHONE`
 * (committed in `.env.production`; non-secret public demo number). When
 * unset, the test-login affordance does not render at all. Isolating the
 * env read here keeps it (a) the only place the literal can live and
 * (b) trivially mockable in unit tests without fighting Vite's
 * `import.meta.env` inlining.
 */
interface ViteImportMeta {
    env?: { VITE_TEST_LOGIN_PHONE?: unknown };
}

export const getTestLoginPhone = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_TEST_LOGIN_PHONE;
    return typeof raw === 'string' ? raw.trim() : '';
};
