import { Button } from '@/components/ui/Button';
import { useAdminAuth } from '@/app/AdminAuthProvider';

interface ServerUnreachableProps {
  /** Asks the server again. */
  onRetry: () => void;
  /** True while that question is in the air: "Try again" cannot be pressed a second time. */
  retrying?: boolean;
}

/**
 * The whole page, when a signed-in person cannot be let in because the server gave no verdict:
 * no answer, too many calls, or a server error. Nobody has been refused, so this is never the
 * "Access denied" page, and the person is not signed out: they can try again, or sign out.
 */
export function ServerUnreachable({ onRetry, retrying = false }: ServerUnreachableProps) {
  const { logout, signingOut } = useAdminAuth();

  return (
    <div className="relative z-10 grid min-h-screen place-items-center p-6">
      <div className="glass-panel w-full max-w-md p-8 text-center">
        <p role="alert" className="mb-6 text-base font-semibold text-text-primary">
          The server could not be reached. Try again.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" disabled={signingOut} onClick={logout}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
          <Button disabled={retrying || signingOut} onClick={() => onRetry()}>
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
