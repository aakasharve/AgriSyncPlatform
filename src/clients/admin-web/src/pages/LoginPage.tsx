import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Wheat, BarChart3, Shield, TriangleAlert } from 'lucide-react';
import { adminApi, isSignOutOwed, tellServerSignedOut, watchOwedSignOut } from '@/lib/api';
import type { AdminSession } from '@/lib/auth';
import { deviceIdentity } from '@/lib/deviceIdentity';
import { safeReturnTo } from '@/lib/returnTo';
// The sentences, and the rules that choose between them, live in a plain module so that they
// can be tested without this page.
import {
  TEXT,
  answerRefusalText,
  checkCodeRefusalText,
  formatWait,
  passwordRefusalText,
  readRefusal,
  sendCodeRefusalText,
  signedOutNotice,
  toSession,
} from '@/lib/signInMessages';
import { useAdminAuth } from '@/app/AdminAuthProvider';
import { PersonName } from '@/components/ui/PersonName';

// 200 answer of POST /user/auth/login. On the web the refresh token is a cookie, so the body
// never carries one. The last two fields come only from an API that holds a sign-in on a
// browser the account has not confirmed yet; an API without that rule sends neither.
interface LoginResponse {
  userId: string;
  accessToken: string;
  expiresAtUtc: string;
  deviceCheckRequired?: boolean;
  accountName?: string | null;
}

// 200 answer of POST /user/auth/start-otp
interface StartOtpResponse {
  expiresAtUtc: string;
  resendAfterSeconds: number;
  provider: string;
}

// 200 answer of POST /user/auth/verify-otp. On the web the refresh token is a cookie, so the
// body never carries one. The last two fields come only from an API that holds a sign-in on a
// browser the account has not confirmed yet; an API without that rule sends neither.
interface VerifyOtpResponse {
  userId: string;
  accessToken: string;
  expiresAtUtc: string;
  createdNewUser: boolean;
  deviceCheckRequired?: boolean;
  accountName?: string | null;
}

// 200 answer of POST /user/auth/device-check: "yes" carries the session, "no" only the outcome.
interface DeviceCheckResponse {
  outcome: 'confirmed' | 'declined';
  userId?: string;
  accessToken?: string;
  expiresAtUtc?: string;
  deviceCheckRequired?: boolean;
}

type Way = 'code' | 'password';
type CodeStep = 'phone' | 'code' | 'account';

// What the page says about a sign-out the server could not be told about: while it is still
// owed, and once the page has managed to tell the server.
const OWED_SIGN_OUT_TEXT = {
  owed: 'You are signed out on this browser. The server could not be told just now; this page will tell it as soon as the server can be reached.',
  told: 'The server has now been told. You are fully signed out.',
} as const;

// The September console's classes for this page (see the note below), shared by both ways in.
const FIELD_CLASS =
  'glass-quiet w-full rounded-chip border-control-edge px-4 py-3.5 text-body font-medium text-text-1 transition-colors focus:border-brand';

const PRIMARY_BUTTON_CLASS =
  'w-full rounded-chip bg-brand py-4 text-body font-bold text-page shadow-surface transition-colors hover:bg-brand-press disabled:bg-line disabled:text-text-2';

const SECONDARY_BUTTON_CLASS =
  'glass-quiet w-full rounded-chip border-control-edge py-4 text-body font-bold text-text-1 transition-colors hover:bg-wash disabled:opacity-50';

const NOTE_CLASS = 'mb-4 rounded-chip bg-tint-grey px-4 py-3 text-body font-medium text-text-1';

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
 *
 * ── CR-2d JOIN: THE SMS SIGN-IN, IN THIS TOKEN LAYER ──────────────────────
 * The page is the SMS sign-in's (PR 95): two ways in (an SMS code, the
 * default, and a password), the account question, the signed-out notices,
 * and always the home page after a sign-in. Every handler, state, sentence
 * and role is that branch's, unchanged; only its classes were moved onto
 * this file's tokens, reusing the classes above (the form card, the field,
 * the primary button, the error line) and the console's own selection colours
 * (`brand-wash` + `brand`, as in OrgSwitcher) for the way toggle. The pairs
 * measured above were measured before the join: the added elements (the way
 * toggle, the code step, the account question, the two notices) were not
 * re-measured.
 */
export default function LoginPage() {
  const [way, setWay] = useState<Way>('code');
  const [step, setStep] = useState<CodeStep>('phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [accountName, setAccountName] = useState<string | null>(null);
  // The wait the server gave before a new code may be asked for (a fresh object each time, so
  // the same wait can start again), and the whole seconds left to show.
  const [resendWait, setResendWait] = useState({ seconds: 0 });
  const [resendIn, setResendIn] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opens with the reason when the console signed the person out; gone at their first action.
  const [notice, setNotice] = useState<string | null>(signedOutNotice);
  // A sign-out the server could not be told about: still owed, or told by this page just now.
  // Read from the browser's store, so the sentence is there again each time the page opens,
  // for as long as the sign-out is owed.
  const [owedSignOut, setOwedSignOut] = useState<'owed' | 'told' | null>(() =>
    isSignOutOwed() ? 'owed' : null,
  );
  const auth = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Whenever the page opens it tries to tell the server about an owed sign-out, and says how
  // that went. While the sign-out is still owed and this page stays open, it tries again every
  // 30 seconds and when the browser comes back online, which is what the sentence promises;
  // the trying stops when the page is left. (When nothing is owed the server is asked nothing.)
  useEffect(
    () => watchOwedSignOut((outcome) => setOwedSignOut(outcome === 'none' ? null : outcome)),
    [],
  );

  // The person has begun to act: what the page opened with has been read. A sign-out that is
  // still owed is not read and done with, so that sentence stays until the server is told.
  function clearNotices() {
    setNotice(null);
    setOwedSignOut((was) => (was === 'owed' ? was : null));
  }

  // The countdown reads the clock on every tick, so the wait it shows is still right after the
  // tab has been in the background.
  useEffect(() => {
    if (resendWait.seconds === 0) return;
    const deadline = Date.now() + resendWait.seconds * 1000;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setResendIn(left);
      if (left === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [resendWait]);

  function startResendCountdown(seconds: number) {
    setResendWait({ seconds });
    setResendIn(seconds);
  }

  // Both ways in end here: the same stored session and the same first page.
  function signIn(session: AdminSession) {
    try {
      // Admin access is decided server-side by GET /admin/me/scope after login
      // (W0-B pivot — tokens are identity, not authorization). If the user has
      // no memberships, RequireScope will send them to /403.
      auth.login(session);
    } catch {
      void undoRefusedSignIn();
      return;
    }
    // The page the person asked for before signing in (Preservation Register A9; plan CR-2d
    // D14 (1)): `from` is the whole url RequireAuth captured, path AND query. `safeReturnTo`
    // accepts only a path inside this console, never an outside address, and gives the root
    // when nothing was asked for. Nothing from a previous person can be here: every end of a
    // session loads this page afresh, with no router state.
    navigate(safeReturnTo((location.state as { from?: unknown } | null)?.from), { replace: true });
  }

  // The browser would not store the session, so nobody is signed in. The page says why and goes
  // back to its first step; it never stays on "Signing in".
  async function undoRefusedSignIn() {
    // The server did sign this browser in and gave it a refresh cookie. It is asked to take that
    // back first (it never throws, and waits five seconds at most), so that no sign-in the
    // person cannot use is left standing, and so that this call cannot land on top of their
    // next try.
    await tellServerSignedOut();
    setPassword('');
    backToPhoneStep();
    setError(TEXT.storageRefused);
    setSubmitting(false);
  }

  // Held: the server has not let this browser in yet, with or without a name to ask about. The
  // token in that answer opens nothing, so it is not stored and not kept; the refresh cookie
  // alone names the held sign-in when the question is answered.
  function askAccountQuestion(name: unknown) {
    setAccountName(typeof name === 'string' && name.trim() ? name.trim() : null);
    setStep('account');
    setSubmitting(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    clearNotices();
    setSubmitting(true);
    let data: LoginResponse;
    try {
      // With credentials, like the code way: the answer sets the refresh cookie, and the browser
      // keeps it only then. Without it this session could not be renewed.
      ({ data } = await adminApi.post<LoginResponse>(
        '/user/auth/login',
        { phone, password, ...deviceIdentity() },
        { withCredentials: true },
      ));
    } catch (err) {
      setError(passwordRefusalText(readRefusal(err)));
      setSubmitting(false);
      return;
    }

    // The server accepted this sign-in, so a sign-out owed for the one before is owed no longer.
    setOwedSignOut(null);
    if (data?.deviceCheckRequired === true) {
      // Now that the page names its browser, a server that asks the account question asks it
      // after a password too, the first time in each browser.
      setPassword('');
      askAccountQuestion(data.accountName);
      return;
    }

    const session = toSession(data);
    if (!session) {
      setPassword('');
      setError(TEXT.notCompleted);
      setSubmitting(false);
      return;
    }
    signIn(session);
  }

  function backToPhoneStep() {
    setStep('phone');
    setOtp('');
    setAccountName(null);
    startResendCountdown(0);
  }

  function chooseWay(next: Way) {
    if (next === way) return;
    setWay(next);
    setError(null);
    clearNotices();
    setPassword('');
    backToPhoneStep();
  }

  function changeNumber() {
    setError(null);
    clearNotices();
    backToPhoneStep();
  }

  // Step 1 of the code way, and "Send a new code" on step 2.
  async function sendCode(isResend: boolean) {
    setError(null);
    clearNotices();
    setSubmitting(true);
    setResending(isResend);
    try {
      // No credentials: this call sets no cookie and reads none.
      const { data } = await adminApi.post<StartOtpResponse>('/user/auth/start-otp', { phone });
      const wait = Number(data?.resendAfterSeconds);
      startResendCountdown(Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : 0);
      setOtp('');
      setStep('code');
      if (isResend) setNotice(TEXT.newCodeSent);
    } catch (err) {
      setError(sendCodeRefusalText(readRefusal(err)));
    }
    setSubmitting(false);
    setResending(false);
  }

  // Step 2 of the code way.
  async function checkCode() {
    setError(null);
    clearNotices();
    setSubmitting(true);
    let data: VerifyOtpResponse;
    try {
      // With credentials: this answer sets the refresh cookie, and a browser keeps a cookie from
      // another origin only when the request was sent with credentials.
      ({ data } = await adminApi.post<VerifyOtpResponse>(
        '/user/auth/verify-otp',
        { phone, otp: otp.trim(), ...deviceIdentity() },
        { withCredentials: true },
      ));
    } catch (err) {
      const refusal = readRefusal(err);
      // This code is dead (expired, used up, or never there), so a new one may be asked for at once.
      if (refusal.status === 410 || refusal.status === 404 || refusal.code === 'otp.locked_out') {
        startResendCountdown(0);
      }
      setError(checkCodeRefusalText(refusal));
      setSubmitting(false);
      return;
    }

    setOtp('');
    // The server accepted this sign-in, so a sign-out owed for the one before is owed no longer.
    setOwedSignOut(null);
    if (data?.deviceCheckRequired === true) {
      askAccountQuestion(data.accountName);
      return;
    }

    const session = toSession(data);
    if (!session) {
      backToPhoneStep();
      setError(TEXT.notCompleted);
      setSubmitting(false);
      return;
    }
    signIn(session);
  }

  // Step 3 of the code way, only when the server asked the account question.
  async function answerAccountQuestion(answer: 'yes' | 'no') {
    setError(null);
    clearNotices();
    setSubmitting(true);
    let data: DeviceCheckResponse;
    try {
      // With credentials: the server finds the held sign-in by the refresh cookie alone.
      ({ data } = await adminApi.post<DeviceCheckResponse>(
        '/user/auth/device-check',
        { answer },
        { withCredentials: true },
      ));
    } catch (err) {
      const refusal = readRefusal(err);
      if (refusal.status === 401) {
        // The server has no open question for this browser any more.
        backToPhoneStep();
        setError(way === 'code' ? TEXT.questionClosed : TEXT.questionClosedPassword);
      } else {
        setError(answerRefusalText(refusal));
      }
      setSubmitting(false);
      return;
    }

    if (answer === 'no') {
      backToPhoneStep();
      setNotice(TEXT.declined);
      setSubmitting(false);
      return;
    }

    // "Yes" signs in with the token this call returns, and only when the server says confirmed.
    const confirmed = data?.outcome === 'confirmed' && data.deviceCheckRequired !== true;
    const session = confirmed ? toSession(data) : null;
    if (!session) {
      backToPhoneStep();
      setError(TEXT.notCompleted);
      setSubmitting(false);
      return;
    }
    signIn(session);
  }

  function onCodeSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (step === 'phone') void sendCode(false);
    else if (step === 'code') void checkCode();
    // The account question is answered by its two buttons, never by the Enter key.
  }

  const signingIn = submitting && !resending;
  const submitLabel =
    way === 'code' && step === 'phone'
      ? (submitting ? 'Sending…' : 'Send me a code →')
      : (signingIn ? 'Signing in…' : 'Sign in →');

  return (
    /* No background of its own any more. The luminous ground painted on
       `body` (globals.css §A.12) shows through both planes, so the frosted
       hero and the frosted form sit on the same field of light. */
    <div className="flex min-h-screen">
      {/* ── LEFT PLANE — the brand, on mint glass ──────────────────────────
          It was `bg-nav`, which until 2026-09-02 was #0e3a2b: a near-black
          green covering 55% of the sign-in screen. That is half of what the
          founder meant by "the overall colour theme is too dark", and the
          other half was the sidebar behind it. The plane is the same token,
          relit — so the hero followed the console without a second decision.

          Every word here is now dark ink on a light pane, and the numbers
          are §A.11's: the plane resolves to #d6eee3, the heading ink reads
          13.78:1 on it and the supporting line 8.02:1. */}
      <div className="glass-nav relative hidden w-[55%] flex-col items-start justify-between p-14 lg:flex">
        <div className="flex items-center gap-3">
          {/* The mark rides a cream disc with a brass ring — see
              --color-mark-disc. This hero plane is mint; the shield is green.
              mobile-web already learned that the hard way. */}
          <span
            className="grid h-12 w-12 flex-none place-items-center rounded-full"
            style={{
              background: 'var(--color-mark-disc)',
              boxShadow: '0 0 0 1.5px var(--color-mark-ring), var(--shadow-surface)',
            }}
          >
            <img
              src="/brand/logo-mark.webp"
              alt=""
              aria-hidden="true"
              width={30}
              height={30}
              loading="eager"
              decoding="async"
              className="size-[30px] object-contain"
            />
          </span>
          <span className="leading-tight">
            <img
              src="/brand/logo-text.webp"
              alt="Shram Safal"
              width={900}
              height={270}
              loading="eager"
              decoding="async"
              className="block h-6 w-auto object-contain"
            />
            <span className="block text-caption text-text-2">Admin console</span>
          </span>
        </div>

        <div className="max-w-[26ch]">
          <h1 className="mb-5 text-[48px] leading-[1.1] font-bold tracking-[-0.03em] text-text-1">
            Every signal your farm operation needs.
          </h1>
          <p className="mb-10 max-w-[42ch] text-body text-nav-text">
            Company numbers, the farms to call today, live server health and checked farm-days, in
            one place.
          </p>

          <div className="flex flex-col gap-3">
            {[
              { Icon: BarChart3, label: 'Company numbers on real data' },
              { Icon: Wheat, label: 'Every farm, with its tier and checked days' },
              { Icon: Shield, label: 'Live server health and its alert checks' },
            ].map(({ Icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="grid h-11 w-11 flex-none place-items-center rounded-chip bg-nav-raise text-nav-overview">
                  <Icon size={19} strokeWidth={2.2} aria-hidden="true" />
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

      {/* ── RIGHT PLANE — the form, on a frosted card ── */}
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <form
          onSubmit={way === 'password' && step === 'phone' ? onSubmit : onCodeSubmit}
          className="glass-panel w-full max-w-[440px] rounded-panel p-8"
        >
          {/* The mark again for anyone below lg, where the left plane is gone */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
          <span
              className="grid h-12 w-12 flex-none place-items-center rounded-full"
              style={{
                background: 'var(--color-mark-disc)',
                boxShadow: '0 0 0 1.5px var(--color-mark-ring), var(--shadow-surface)',
              }}
            >
              <img
                src="/brand/logo-mark.webp"
                alt=""
                aria-hidden="true"
                width={30}
                height={30}
                loading="eager"
                decoding="async"
                className="size-[30px] object-contain"
              />
            </span>
            <span className="leading-tight">
              <img
              src="/brand/logo-text.webp"
              alt="Shram Safal"
              width={900}
              height={270}
              loading="eager"
              decoding="async"
              className="block h-6 w-auto object-contain"
            />
              <span className="block text-caption text-text-2">Admin console</span>
            </span>
          </div>

          <h2 className="mb-1 text-h1 font-bold text-text-1">Sign in</h2>
          <p className="mb-8 text-body text-text-2">Admin access only · enter your credentials</p>

          {/* The two ways in. Shown on the first step only. */}
          {step === 'phone' && (
            <div
              role="group"
              aria-label="How to sign in"
              className="glass-quiet mb-6 grid grid-cols-2 gap-1 rounded-chip border-control-edge p-1"
            >
              {([
                { key: 'code', label: 'SMS code' },
                { key: 'password', label: 'Password' },
              ] as const).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={way === key}
                  disabled={submitting}
                  onClick={() => chooseWay(key)}
                  className={`rounded-chip py-2.5 text-body font-semibold transition-colors ${
                    way === key ? 'bg-brand-wash text-brand' : 'text-text-2 hover:text-text-1'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {step === 'phone' && (
            <label className={`${way === 'password' ? 'mb-4' : 'mb-6'} block`}>
              <span className="mb-2 block text-caption font-semibold text-text-1">Phone number</span>
              <input
                type="tel"
                autoFocus
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={`${FIELD_CLASS} font-mono`}
                placeholder="10 digits"
              />
            </label>
          )}

          {way === 'password' && step === 'phone' && (
            <label className="mb-6 block">
              <span className="mb-2 block text-caption font-semibold text-text-1">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
          )}

          {step === 'code' && (
            <>
              <p className="mb-4 text-body text-text-2">
                We sent a code by SMS to{' '}
                <span className="font-mono font-semibold text-text-1">{phone}</span>.
              </p>
              <label className="mb-6 block">
                <span className="mb-2 block text-caption font-semibold text-text-1">Code from the SMS</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className={`${FIELD_CLASS} font-mono`}
                />
              </label>
            </>
          )}

          {step === 'account' && (
            <p className="mb-6 text-body font-semibold text-text-1">
              {/* A person's name goes through PersonName (font rule: a Marathi name is set in
                  Noto Sans Devanagari). */}
              {accountName
                ? <>This number belongs to <PersonName name={accountName} className="font-bold" />. Is that you?</>
                : 'This number already has an account. Is that you?'}
            </p>
          )}

          {notice && (
            <div role="status" className={NOTE_CLASS}>
              {notice}
            </div>
          )}

          {owedSignOut && (
            <div role="status" className={NOTE_CLASS}>
              {OWED_SIGN_OUT_TEXT[owedSignOut]}
            </div>
          )}

          {error && (
            /* The failure hue on the icon, the ink colour on the sentence.
               `text-red` on `bg-tint-red` is 4.13:1 — fine for a 13px badge,
               short of AA for a paragraph a person has to read while their
               sign-in has just failed. */
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-chip bg-tint-red px-4 py-3 text-body font-medium text-text-1"
            >
              <TriangleAlert size={18} className="mt-0.5 flex-none text-red" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {step !== 'account' ? (
            <button type="submit" disabled={submitting} className={PRIMARY_BUTTON_CLASS}>
              {submitLabel}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void answerAccountQuestion('yes')}
                className={PRIMARY_BUTTON_CLASS}
              >
                Yes, it is me
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void answerAccountQuestion('no')}
                className={SECONDARY_BUTTON_CLASS}
              >
                No
              </button>
            </div>
          )}

          {/* After the first step there is always a way back to it, so nobody is stuck. */}
          {step !== 'phone' && (
            <div className="mt-5 flex flex-col items-center gap-3">
              {step === 'code' && (
                <button
                  type="button"
                  disabled={submitting || resendIn > 0}
                  onClick={() => void sendCode(true)}
                  className="text-body font-semibold text-text-1 underline underline-offset-4 disabled:text-text-2 disabled:no-underline"
                >
                  {resending
                    ? 'Sending…'
                    : resendIn > 0
                      ? `Send a new code in ${formatWait(resendIn)}`
                      : 'Send a new code'}
                </button>
              )}
              <button
                type="button"
                disabled={submitting}
                onClick={changeNumber}
                className="text-body font-medium text-text-2 hover:text-text-1 disabled:opacity-50"
              >
                Use a different number
              </button>
            </div>
          )}

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
