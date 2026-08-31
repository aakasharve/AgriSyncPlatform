import { Link, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAdminAuth } from '@/app/AdminAuthProvider';

/**
 * /403 — where a denial lands, and the only page in the console DELIBERATELY
 * outside RequireScope (App.tsx). Put it inside and an unresolved scope would
 * redirect to a page that redirects. It is also, until Task 10 put one in the
 * shell, the only place in the whole console that could sign a person out; it
 * keeps that control because a denied user still needs it.
 *
 * Three states, from three different gates:
 *   `module`           — EntitlementGuard refused one specific module.
 *   `scopeUnavailable` — RequireScope could not GET AN ANSWER. New in Task 11:
 *                        a 500 or a dropped connection on /admin/me/scope used
 *                        to land here under the heading "403 · Access denied",
 *                        which tells an admin their access was taken away when
 *                        the truth is that the question could not be asked.
 *                        That is a lie in the most alarming direction, and it
 *                        is the same defect class as a failed request drawn as
 *                        a clean bill of health.
 *   nothing            — no admin membership at all.
 *
 * Both original message variants are unchanged, word for word. The new one
 * sits in front of them and claims less, not more.
 *
 * The five server denial codes are NOT branched on here. /403 has no producer
 * that carries one, and a branch with no producer is exactly the dead code
 * that gets deleted next year as unused. They are spent where they arrive
 * instead: `formatError` (components/state/honestState.ts) turns each into a
 * sentence, and every LoadFailed and ErrorState panel in the console renders
 * through it.
 */
interface ForbiddenState {
  module?: string;
  from?: string;
  scopeUnavailable?: boolean;
}

export default function ForbiddenPage() {
  const { logout } = useAdminAuth();
  const location = useLocation();
  const state = location.state as ForbiddenState | null;

  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-danger to-warning text-white">
          <ShieldOff size={28} strokeWidth={2.5} />
        </div>
        <h1 className="mb-2 text-xl font-extrabold tracking-tight text-text-primary">
          {state?.scopeUnavailable ? 'We could not check your access' : '403 · Access denied'}
        </h1>
        <p className="mb-6 text-sm text-text-secondary">
          {state?.scopeUnavailable ? (
            <>
              This is not a permissions problem — the check itself failed to answer. Nothing about
              your account has changed. Try again in a moment.
            </>
          ) : state?.module ? (
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
