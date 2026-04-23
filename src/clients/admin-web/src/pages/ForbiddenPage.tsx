import { Link, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAdminAuth } from '@/app/AdminAuthProvider';

export default function ForbiddenPage() {
  const { logout } = useAdminAuth();
  const location = useLocation();
  const state = location.state as { module?: string; from?: string } | null;

  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-danger to-warning text-white">
          <ShieldOff size={28} strokeWidth={2.5} />
        </div>
        <h1 className="mb-2 text-xl font-extrabold tracking-tight text-text-primary">403 · Access denied</h1>
        <p className="mb-6 text-sm text-text-secondary">
          {state?.module ? (
            <>
              Your admin scope does not grant access to{' '}
              <code className="font-mono">{state.module}</code>.
            </>
          ) : (
            <>
              Your account does not have an admin membership for this console. Ask a Platform owner to
              invite you via <code className="font-mono">/settings/admins</code>.
            </>
          )}
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={logout}>
            Sign out
          </Button>
          <Link to="/login">
            <Button>Go to login</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
