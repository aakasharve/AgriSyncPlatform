import { Link, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAdminAuth } from '@/app/AdminAuthProvider';

/**
 * The page for a signed-in person the console will not let in. Plain words only: no status
 * number, no address and no internal name is ever shown.
 *
 * Two cases. The account is not on the team at all (the usual one): nothing here will open for
 * it, so the page offers Sign out. Or the account is on the team but one page is closed to it
 * (the page gate sends its module along): the rest of the console still works, so the page
 * offers the way back as well. Which module it was is not shown.
 */
export default function ForbiddenPage() {
  // Sign out here ends on the login page like everywhere else: it used to leave the person on
  // this page, signed out, with nothing to tell them so.
  const { logout, signingOut } = useAdminAuth();
  const location = useLocation();
  const onePageOnly = Boolean((location.state as { module?: string } | null)?.module);

  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-danger to-warning text-white">
          <ShieldOff size={28} strokeWidth={2.5} />
        </div>
        <h1 className="mb-2 text-xl font-extrabold tracking-tight text-text-primary">
          {onePageOnly
            ? 'You do not have access to this page.'
            : 'You do not have access to the control room.'}
        </h1>
        <p className="mb-6 text-sm text-text-secondary">
          {onePageOnly
            ? "This account is on the control room's team, but this page is not open to it. Ask the owner to open it for you."
            : "This account is not on the control room's team. Ask the owner to add you, then sign in again."}
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" disabled={signingOut} onClick={logout}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
          {onePageOnly && (
            <Link to="/">
              <Button>Back to the home page</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
