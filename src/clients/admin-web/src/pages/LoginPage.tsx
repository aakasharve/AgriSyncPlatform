import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Leaf, Wheat, BarChart3, Shield, TriangleAlert } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { type AdminSession } from '@/lib/auth';
import { safeReturnTo } from '@/lib/returnTo';
import { useAdminAuth } from '@/app/AdminAuthProvider';

// Matches User.Application.Contracts.Dtos.AuthResponse exactly
interface LoginResponse {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAtUtc: string;
}

/**
 * SIGN IN — restyled onto the §A token layer, 2026-09-02.
 *
 * ── WHAT THIS PAGE WAS ────────────────────────────────────────────────────
 * It was the last screen in the console still drawn in raw CSS. It carried
 * TWO of the three gradients in the codebase (a three-stop logo fill and the
 * submit button), a 40px blurred translucent panel, an inline rgba colour,
 * nine Tailwind utilities from the stock grey/black/white palette this
 * console does not use, and four literal hex values inside an inline style —
 * every one of them a CONTRACT.md §8 violation, and none of them reachable
 * by the token contract test, which only polices the three UI primitives.
 *
 * (Written without naming those utilities verbatim on purpose: Tailwind v4
 * scans comments as candidate sources, so a class name quoted in prose is a
 * class name COMPILED into the stylesheet. The console already carries four
 * such ghosts from earlier comments. Do not add more.)
 *
 * It also held five of the §B legacy layer's tokens alive on its own.
 *
 * ── WHAT IT IS NOW ────────────────────────────────────────────────────────
 * The same split — brand on the left, form on the right — drawn entirely
 * from tokens. The left plane is `--color-nav`, the same deep green as the
 * console's sidebar, so the first screen an admin sees and every screen after
 * it are visibly the same product. No gradient, no blur, no translucency:
 * flat brand fills, which is what §8 asks for and, at this size, what
 * actually looks better.
 *
 * ── THE ONE THING DELIBERATELY LEFT ALONE ─────────────────────────────────
 * `font-mono` on the phone field. CONTRACT.md §8 bans monospace and six
 * shipped files disagree with it, all six on values a human reads character
 * by character. That disagreement is the founder's to settle (globals.css
 * §A.1 states the count); a styling pass does not get to close it by
 * sweeping one of the six while the other five stand.
 *
 * ── CONTRAST, MEASURED ────────────────────────────────────────────────────
 * This is the one route the CI accessibility budget can actually reach — the
 * Lighthouse job is unauthenticated, so it scores THIS page whatever url it
 * is pointed at, and Task 29 got it to 1.00 by fixing a 2.60:1 failure here.
 * Every pair below was measured, not eyeballed:
 *   white on --color-nav          12.66:1     nav-text on --color-nav   8.56:1
 *   nav-overview on --color-nav    7.65:1     nav-muted on --color-nav  6.65:1
 *   nav-text on --color-nav-raise  7.47:1     text-1 on --color-page   16.78:1
 *   white on --color-brand         8.02:1     text-2 on --color-page    6.17:1
 *   text-1 on --color-tint-red    14.76:1     text-2 on --color-line    4.86:1
 * The lowest figure on the screen is 4.86:1, on the disabled button.
 */
export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auth = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await adminApi.post<LoginResponse>('/user/auth/login', { phone, password });
      const session: AdminSession = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        userId: data.userId,
        expiresAtUtc: data.expiresAtUtc,
      };
      // Admin access is decided server-side by GET /admin/me/scope after login
      // (W0-B pivot — tokens are identity, not authorization). If the user has
      // no memberships, RequireScope will send them to /403.
      auth.login(session);
      // `from` is now the whole url — path AND query — because that is where
      // page, search, tier, weeks, days and org all live (App.tsx RequireAuth,
      // lib/returnTo.ts). `safeReturnTo` refuses anything that would leave
      // this console; `navigate` parses the query string for us.
      const returnTo = safeReturnTo((location.state as { from?: unknown } | null)?.from);
      navigate(returnTo, { replace: true });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed. Check phone + password.';
      setError(msg);
      setSubmitting(false);
    }
  }

  const fieldClass =
    'w-full rounded-chip border border-line bg-page px-4 py-3 text-[16px] font-medium text-text-1 transition-colors focus:border-brand';

  return (
    <div className="flex min-h-screen bg-page">
      {/* ── LEFT PLANE — the brand, in the console's own navigation green ── */}
      <div className="hidden w-[55%] flex-col items-start justify-between bg-nav p-14 lg:flex">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-chip bg-nav-overview text-nav">
            <Leaf size={22} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <span className="text-h3 font-bold text-page">AgriSync Admin</span>
        </div>

        <div className="max-w-[26ch]">
          <h1 className="mb-5 text-[44px] leading-[1.08] font-bold tracking-[-0.03em] text-page">
            Every signal your farm operation needs.
          </h1>
          <p className="mb-10 max-w-[42ch] text-[17px] text-nav-text">
            Live health, WVFD trends, farmer suffering watchlist, voice pipeline metrics — all in
            one place.
          </p>

          <div className="flex flex-col gap-3">
            {[
              { Icon: BarChart3, label: 'WVFD & retention analytics' },
              { Icon: Wheat, label: 'Farm browser with tier breakdown' },
              { Icon: Shield, label: 'Live API health · auto-refresh 30s' },
            ].map(({ Icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-chip bg-nav-raise text-nav-overview">
                  <Icon size={17} strokeWidth={2.2} aria-hidden="true" />
                </span>
                <span className="text-body font-medium text-nav-text">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-caption font-medium text-nav-muted">
          ShramSafal · Operations Console · v1.0
        </p>
      </div>

      {/* ── RIGHT PLANE — the form, on white ── */}
      <div className="flex flex-1 items-center justify-center border-line px-6 lg:border-l">
        <form onSubmit={onSubmit} className="w-full max-w-[420px] py-10">
          {/* The mark again for anyone below lg, where the left plane is gone */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-11 w-11 place-items-center rounded-chip bg-brand text-page">
              <Leaf size={22} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <span className="text-h3 font-bold text-text-1">AgriSync Admin</span>
          </div>

          <h2 className="mb-1 text-h1 font-bold text-text-1">Sign in</h2>
          <p className="mb-8 text-body text-text-2">Admin access only · enter your credentials</p>

          <label className="mb-4 block">
            <span className="mb-2 block text-caption font-semibold text-text-1">Phone number</span>
            <input
              type="tel"
              autoFocus
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={`${fieldClass} font-mono`}
              placeholder="10 digits"
            />
          </label>

          <label className="mb-6 block">
            <span className="mb-2 block text-caption font-semibold text-text-1">Password</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={fieldClass}
            />
          </label>

          {error && (
            /* The failure hue on the icon, the ink colour on the sentence.
               `text-red` on `bg-tint-red` is 4.13:1 — fine for a 13px badge,
               short of AA for a paragraph a person has to read while their
               sign-in has just failed. */
            <div className="mb-5 flex items-start gap-2.5 rounded-chip bg-tint-red px-4 py-3 text-body font-medium text-text-1">
              <TriangleAlert size={18} className="mt-0.5 flex-none text-red" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-chip bg-brand py-4 text-[16px] font-bold text-page transition-colors hover:bg-brand-press disabled:bg-line disabled:text-text-2"
          >
            {submitting ? 'Signing in…' : 'Sign in →'}
          </button>

          {/* TASK 29 — `text-gray-400` (#99a1af) on white is 2.60:1, and this
              line is 12px, so WCAG AA asks for 4.5:1. It was the ONLY
              accessibility failure Lighthouse found on the whole console, and
              it is on the one route the CI budget can actually reach: the job
              is unauthenticated, so `.github/workflows/lighthouse.yml` scores
              THIS page whatever url it is pointed at. `--color-text-2`
              (#55655c) is 6.17:1 and is already the console's caption colour,
              so this stops being a second grey as well as a failing one. */}
          <p className="mt-6 text-center text-caption font-medium text-text-2">
            Not an admin? This console is restricted access.
          </p>
        </form>
      </div>
    </div>
  );
}
