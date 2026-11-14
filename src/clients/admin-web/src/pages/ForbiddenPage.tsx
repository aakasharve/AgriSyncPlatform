import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAdminAuth } from '@/app/AdminAuthProvider';
import { noAccessView, type NoAccessView } from '@/lib/noAccessView';

// Everything the page can say. `wayBack` is the button to the home page: it is left out when
// nothing in the console will open for the account.
const SAYS: Record<NoAccessView, { heading: string; sentence: string; wayBack: boolean }> = {
  'not-on-team': {
    heading: 'You do not have access to the control room.',
    sentence:
      "This account is not on the control room's team. Ask the owner to add you, then sign in again.",
    wayBack: false,
  },
  'one-page': {
    heading: 'You do not have access to this page.',
    sentence:
      "This account is on the control room's team, but this page is not open to it. Ask the owner to open it for you.",
    wayBack: true,
  },
  'no-reason': {
    heading: 'You do not have access to this page.',
    sentence: 'This page is not open to this account.',
    wayBack: true,
  },
};

/**
 * The page for a signed-in person the console will not let in. Plain words only: no status
 * number, no address and no internal name is ever shown.
 *
 * Three cases (chosen by `noAccessView`). The account is not on the team at all: nothing here
 * will open for it, so the page offers Sign out. Or the account is on the team but one page is
 * closed to it (the page gate sends its module along): the rest of the console still works, so
 * the page offers the way back as well. Which module it was is not shown. Or the page was
 * opened with no reason it can trust: it then says only that the page is not open to this
 * account, and offers both buttons.
 *
 * A reason is trusted only for the account the gate named with it. The browser keeps what a
 * gate sent in its history: when one person signs out and another signs in on the same tab,
 * "Back" opens this page with the first person's reason, and the second is not told it.
 */
export default function ForbiddenPage() {
  // Sign out here ends on the login page like everywhere else: it used to leave the person on
  // this page, signed out, with nothing to tell them so.
  const { logout, signingOut, session } = useAdminAuth();
  const location = useLocation();
  // The session is forgotten at the press of Sign out, while this page is still on the screen
  // waiting for the server. What the page said at the press stays until the login page opens.
  const [saidAtSignOut, setSaidAtSignOut] = useState<NoAccessView | null>(null);
  const view = saidAtSignOut ?? noAccessView(location.state, session?.userId ?? null);
  const { heading, sentence, wayBack } = SAYS[view];

  function onSignOut() {
    setSaidAtSignOut(view);
    logout();
  }

  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-danger to-warning text-white">
          <ShieldOff size={28} strokeWidth={2.5} />
        </div>
        <h1 className="mb-2 text-xl font-extrabold tracking-tight text-text-primary">{heading}</h1>
        <p className="mb-6 text-sm text-text-secondary">{sentence}</p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" disabled={signingOut} onClick={onSignOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
          {wayBack && (
            <Link to="/">
              <Button>Back to the home page</Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
