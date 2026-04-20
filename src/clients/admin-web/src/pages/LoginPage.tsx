import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Leaf } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { isAdminSession, type AdminSession } from '@/lib/auth';
import { useAdminAuth } from '@/app/AdminAuthProvider';
import { Button } from '@/components/ui/Button';

interface LoginResponse {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  phone: string;
  displayName: string | null;
  memberships: { app: string; role: string }[];
  expiresAt: string;
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
        refreshToken: data.refreshToken,
        userId: data.userId,
        phone: data.phone,
        displayName: data.displayName,
        memberships: data.memberships,
        expiresAt: data.expiresAt,
      };
      if (!isAdminSession(session)) {
        setError('This account does not have admin access.');
        setSubmitting(false);
        return;
      }
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
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <form onSubmit={onSubmit} className="glass-panel w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-green via-brand-teal to-brand-sky text-white shadow-[0_4px_12px_rgba(0,200,83,0.35)]">
            <Leaf size={20} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-text-primary">AgriSync Admin</h1>
            <p className="text-xs text-text-muted">Operations console · admin access only</p>
          </div>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold text-text-primary">Phone</span>
          <input
            type="tel"
            autoFocus
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border-2 border-surface-border bg-white/70 px-3 py-2 font-mono text-sm text-text-primary outline-none focus:border-brand-teal dark:bg-white/10"
            placeholder="10 digits"
          />
        </label>
        <label className="mb-5 block">
          <span className="mb-1 block text-xs font-semibold text-text-primary">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border-2 border-surface-border bg-white/70 px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-teal dark:bg-white/10"
          />
        </label>

        {error && (
          <div className="mb-3 rounded-md border-2 border-danger/40 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
            {error}
          </div>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
