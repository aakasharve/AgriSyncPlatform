import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
      const returnTo = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(returnTo, { replace: true });
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Login failed. Check phone + password.';
      setError(msg);
      setSubmitting(false);
    }
  }

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
        <form onSubmit={onSubmit} className="w-full" style={{maxWidth:420, padding:'0 48px'}}>
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

          <label className="mb-4 block">
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

          {error && (
            <div className="mb-4 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-[14px] font-semibold text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl py-4 text-[16px] font-extrabold text-white transition-all disabled:opacity-70"
            style={{
              background: submitting
                ? '#888'
                : 'linear-gradient(135deg, #00c853 0%, #52c0be 100%)',
              boxShadow: submitting ? 'none' : '0 6px 20px rgba(0,200,83,0.35)',
            }}
          >
            {submitting ? 'Signing in…' : 'Sign in →'}
          </button>

          <p className="mt-6 text-center text-[12px] font-medium text-gray-400">
            Not an admin? This console is restricted access.
          </p>
        </form>
      </div>
    </div>
  );
}
