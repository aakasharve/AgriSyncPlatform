import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Leaf, Wheat, BarChart3, Shield } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { type AdminSession } from '@/lib/auth';
import { useAdminAuth } from '@/app/AdminAuthProvider';

// Matches User.Application.Contracts.Dtos.AuthResponse exactly
interface LoginResponse {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAtUtc: string;
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

// Every sentence the SMS-code way can show. Plain English: never a status number, never a raw error.
const TEXT = {
  unreachable: 'The server could not be reached. Check your connection and try again.',
  wentWrong: 'Something went wrong. Please try again in a little while.',
  badPhone: 'That phone number does not look right. Enter a 10-digit mobile number.',
  notSent: 'The code could not be sent just now. Please try again in a little while.',
  wrongCode: 'That code is not right. Check the SMS and try again.',
  expiredCode: 'That code has expired. Send a new code.',
  noCodeWaiting: 'There is no code waiting for this number. Send a new code.',
  missingCode: 'Enter the code from the SMS.',
  tooMany: 'Too many tries. Please wait a while, then try again.',
  notCompleted: 'The sign-in could not be completed. Please start again.',
  questionClosed: 'This sign-in is no longer waiting for an answer. Send a new code to start again.',
  answerNotSaved: 'Your answer could not be saved. Please try again.',
  declined:
    'You were not signed in, because you said this account is not yours. Check the phone number and try again.',
  newCodeSent: 'A new code has been sent.',
} as const;

interface Refusal {
  /** The HTTP status of the answer, or null when there was no answer. */
  status: number | null;
  /** True when the request got no answer at all (offline, timed out, blocked). */
  unreachable: boolean;
  /** The server's error code, e.g. "otp.mismatch". Used to choose a sentence, never shown. */
  code: string | null;
  /** The server's own sentence. Shown only for "too many" (429). */
  message: string | null;
}

function readRefusal(err: unknown): Refusal {
  if (!isAxiosError(err)) return { status: null, unreachable: false, code: null, message: null };
  if (!err.response) return { status: null, unreachable: true, code: null, message: null };
  const body = err.response.data as { error?: unknown; message?: unknown } | null | undefined;
  const code = typeof body?.error === 'string' ? body.error : null;
  const message =
    typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : null;
  return { status: err.response.status, unreachable: false, code, message };
}

function sendCodeRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  if (r.status === 429) return r.message ?? TEXT.tooMany;
  // 400 is a number the server could not read, unless the SMS provider itself failed.
  if (r.status === 400) return r.code?.startsWith('msg91.') ? TEXT.notSent : TEXT.badPhone;
  return TEXT.wentWrong;
}

function checkCodeRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  switch (r.status) {
    case 401:
      return TEXT.wrongCode;
    case 410:
      return TEXT.expiredCode;
    case 429:
      return r.message ?? TEXT.tooMany;
    case 404:
      return TEXT.noCodeWaiting;
    case 400:
      return r.code === 'otp.invalid_code' ? TEXT.missingCode : TEXT.badPhone;
    default:
      return TEXT.wentWrong;
  }
}

function answerRefusalText(r: Refusal): string {
  if (r.unreachable) return TEXT.unreachable;
  if (r.status === 429) return r.message ?? TEXT.tooMany;
  return TEXT.answerNotSaved;
}

// A session is built only from an answer that really carries one.
function toSession(
  data: { userId?: unknown; accessToken?: unknown; expiresAtUtc?: unknown } | null | undefined,
): AdminSession | null {
  if (!data) return null;
  const { userId, accessToken, expiresAtUtc } = data;
  if (typeof userId !== 'string' || !userId) return null;
  if (typeof accessToken !== 'string' || !accessToken) return null;
  if (typeof expiresAtUtc !== 'string' || !expiresAtUtc) return null;
  // A code sign-in has no refresh token in this page: on the web it is a cookie the browser holds.
  return { accessToken, refreshToken: null, userId, expiresAtUtc };
}

function formatWait(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`;
}

const PRIMARY_BUTTON_CLASS =
  'w-full rounded-xl py-4 text-[16px] font-extrabold text-white transition-all disabled:opacity-70';

function primaryButtonStyle(busy: boolean): CSSProperties {
  return {
    background: busy ? '#888' : 'linear-gradient(135deg, #00c853 0%, #52c0be 100%)',
    boxShadow: busy ? 'none' : '0 6px 20px rgba(0,200,83,0.35)',
  };
}

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
  const [notice, setNotice] = useState<string | null>(null);
  const auth = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

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

  // Both ways in end here: the same stored session and the same redirect.
  function signIn(session: AdminSession) {
    // Admin access is decided server-side by GET /admin/me/scope after login
    // (W0-B pivot — tokens are identity, not authorization). If the user has
    // no memberships, RequireScope will send them to /403.
    auth.login(session);
    const returnTo = (location.state as { from?: string } | null)?.from ?? '/';
    navigate(returnTo, { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const { data } = await adminApi.post<LoginResponse>('/user/auth/login', { phone, password });
      const session: AdminSession = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        userId: data.userId,
        expiresAtUtc: data.expiresAtUtc,
      };
      signIn(session);
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed. Check phone + password.';
      setError(msg);
      setSubmitting(false);
    }
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
    setNotice(null);
    setPassword('');
    backToPhoneStep();
  }

  function changeNumber() {
    setError(null);
    setNotice(null);
    backToPhoneStep();
  }

  // Step 1 of the code way, and "Send a new code" on step 2.
  async function sendCode(isResend: boolean) {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    setResending(isResend);
    try {
      const { data } = await adminApi.post<StartOtpResponse>(
        '/user/auth/start-otp',
        { phone },
        { withCredentials: true },
      );
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
    setNotice(null);
    setSubmitting(true);
    let data: VerifyOtpResponse;
    try {
      // With credentials: this answer sets the refresh cookie, and a browser keeps a cookie from
      // another origin only when the request was sent with credentials.
      ({ data } = await adminApi.post<VerifyOtpResponse>(
        '/user/auth/verify-otp',
        { phone, otp: otp.trim() },
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
    if (data?.deviceCheckRequired === true) {
      // Held: the server has not let this browser in yet, with or without a name to ask about.
      // The token in this answer opens nothing, so it is not stored and not kept; the refresh
      // cookie alone names the held sign-in when the question is answered.
      const name = typeof data.accountName === 'string' ? data.accountName.trim() : '';
      setAccountName(name || null);
      setStep('account');
      setSubmitting(false);
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
    setNotice(null);
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
        setError(TEXT.questionClosed);
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
    /* Full-viewport split: shader+brand left / solid-white form right */
    <div className="relative z-10 flex h-screen">

      {/* ── LEFT PANEL — glass over shader ── */}
      <div className="hidden flex-col items-start justify-between p-14 lg:flex"
        style={{ width: '55%' }}>
        {/* logo */}
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-green via-brand-teal to-brand-sky text-white shadow-[0_6px_20px_rgba(0,200,83,0.45)]">
            <Leaf size={22} strokeWidth={2.5} />
          </div>
          <span className="text-[17px] font-extrabold tracking-tight text-text-primary">AgriSync Admin</span>
        </div>

        {/* headline */}
        <div>
          <h1 className="mb-4 text-[42px] font-extrabold leading-tight tracking-[-0.03em] text-text-primary"
            style={{textShadow:'0 2px 12px rgba(0,0,0,0.08)'}}>
            Every signal<br />your farm<br />operation needs.
          </h1>
          <p className="mb-10 text-[16px] font-medium text-text-secondary"
            style={{maxWidth:400}}>
            Live health, WVFD trends, farmer suffering watchlist,
            voice pipeline metrics — all in one place.
          </p>

          {/* Feature bullets */}
          <div className="flex flex-col gap-3">
            {[
              { Icon: BarChart3, label: 'WVFD & retention analytics' },
              { Icon: Wheat,     label: 'Farm browser with tier breakdown' },
              { Icon: Shield,    label: 'Live API health · auto-refresh 30s' },
            ].map(({ Icon, label }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg bg-white/70 text-brand-leaf shadow-sm backdrop-blur-sm">
                  <Icon size={16} strokeWidth={2.5} />
                </div>
                <span className="text-[14px] font-semibold text-text-primary">{label}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[12px] font-medium text-text-muted">
          ShramSafal · Operations Console · v1.0
        </p>
      </div>

      {/* ── RIGHT PANEL — solid white, no shader ── */}
      <div className="flex flex-1 items-center justify-center"
        style={{
          background: 'rgba(255,255,255,0.97)',
          backdropFilter: 'blur(40px)',
          borderLeft: '1px solid rgba(82,192,190,0.2)',
        }}>
        <form
          onSubmit={way === 'password' ? onSubmit : onCodeSubmit}
          className="w-full"
          style={{maxWidth:420, padding:'0 48px'}}
        >
          {/* Mobile logo (hidden on large screens) */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-green to-brand-teal text-white">
              <Leaf size={22} strokeWidth={2.5} />
            </div>
            <span className="text-[17px] font-extrabold text-black">AgriSync Admin</span>
          </div>

          <h2 className="mb-1 text-[28px] font-extrabold tracking-tight text-black">Sign in</h2>
          <p className="mb-8 text-[15px] font-medium text-gray-500">
            Admin access only · enter your credentials
          </p>

          {/* The two ways in. Shown on the first step only. */}
          {step === 'phone' && (
            <div
              role="group"
              aria-label="How to sign in"
              className="mb-6 grid grid-cols-2 gap-1 rounded-xl border-2 border-gray-200 bg-gray-50 p-1"
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
                  className={`rounded-lg py-2.5 text-[14px] font-bold transition-colors ${
                    way === key ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {step === 'phone' && (
            <label className={`${way === 'password' ? 'mb-4' : 'mb-6'} block`}>
              <span className="mb-2 block text-[14px] font-bold text-black">Phone number</span>
              <input
                type="tel"
                autoFocus
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3.5 font-mono text-[16px] font-semibold text-black outline-none transition-colors focus:border-brand-teal focus:bg-white"
                placeholder="10 digits"
              />
            </label>
          )}

          {way === 'password' && (
            <label className="mb-6 block">
              <span className="mb-2 block text-[14px] font-bold text-black">Password</span>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3.5 text-[16px] font-semibold text-black outline-none transition-colors focus:border-brand-teal focus:bg-white"
              />
            </label>
          )}

          {step === 'code' && (
            <>
              <p className="mb-4 text-[14px] font-medium text-gray-500">
                We sent a code by SMS to{' '}
                <span className="font-mono font-semibold text-black">{phone}</span>.
              </p>
              <label className="mb-6 block">
                <span className="mb-2 block text-[14px] font-bold text-black">Code from the SMS</span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3.5 font-mono text-[16px] font-semibold text-black outline-none transition-colors focus:border-brand-teal focus:bg-white"
                />
              </label>
            </>
          )}

          {step === 'account' && (
            <p className="mb-6 text-[16px] font-semibold text-black">
              {accountName
                ? <>This number belongs to <span className="font-extrabold">{accountName}</span>. Is that you?</>
                : 'This number already has an account. Is that you?'}
            </p>
          )}

          {notice && (
            <div
              role="status"
              className="mb-4 rounded-xl border-2 border-gray-200 bg-gray-50 px-4 py-3 text-[14px] font-semibold text-gray-700"
            >
              {notice}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-[14px] font-semibold text-red-600"
            >
              {error}
            </div>
          )}

          {step !== 'account' ? (
            <button
              type="submit"
              disabled={submitting}
              className={PRIMARY_BUTTON_CLASS}
              style={primaryButtonStyle(submitting)}
            >
              {submitLabel}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => void answerAccountQuestion('yes')}
                className={PRIMARY_BUTTON_CLASS}
                style={primaryButtonStyle(submitting)}
              >
                Yes, it is me
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void answerAccountQuestion('no')}
                className="w-full rounded-xl border-2 border-gray-200 bg-white py-4 text-[16px] font-extrabold text-black transition-colors hover:border-gray-400 disabled:opacity-70"
              >
                No
              </button>
            </div>
          )}

          {step === 'code' && (
            <div className="mt-5 flex flex-col items-center gap-3">
              <button
                type="button"
                disabled={submitting || resendIn > 0}
                onClick={() => void sendCode(true)}
                className="text-[14px] font-bold text-black underline underline-offset-4 disabled:text-gray-400 disabled:no-underline"
              >
                {resending
                  ? 'Sending…'
                  : resendIn > 0
                    ? `Send a new code in ${formatWait(resendIn)}`
                    : 'Send a new code'}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={changeNumber}
                className="text-[14px] font-semibold text-gray-500 hover:text-black disabled:opacity-70"
              >
                Use a different number
              </button>
            </div>
          )}

          <p className="mt-6 text-center text-[12px] font-medium text-gray-400">
            Not an admin? This console is restricted access.
          </p>
        </form>
      </div>
    </div>
  );
}
