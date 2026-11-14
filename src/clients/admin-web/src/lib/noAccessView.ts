/**
 * What the no-access page may say.
 *
 *   'not-on-team': the account is not on the control room's team at all.
 *   'one-page':    the account is on the team, but the page it asked for is closed to it.
 *   'no-reason':   the page does not know why it was opened for the person in front of it.
 */
export type NoAccessView = 'not-on-team' | 'one-page' | 'no-reason';

/**
 * Names one sign-in: who, and when they signed in. Null when nobody is signed in.
 *
 * A renewal of the access token keeps the sign-in time, so it keeps this name. Signing out and
 * in again gives a new one, even to the same person.
 */
export function signInKey(
  session: { userId: string; signedInAtUtc: string } | null | undefined,
): string | null {
  return session ? `${session.userId}|${session.signedInAtUtc}` : null;
}

/**
 * What a gate sends along when it sends somebody to the no-access page.
 *
 * `account` names the sign-in the reason was found in (see `signInKey`): who was signed in, and
 * since when. The browser keeps this state in its history, where it outlives the session.
 * Somebody else can sign in on the same tab and press Back. So can the same person, after the
 * owner has added them to the team and they have signed in again as the page told them to. A
 * reason that names no sign-in, or was found in another sign-in, is therefore no reason at all.
 */
export interface NoAccessState {
  reason?: 'not-on-team';
  /** The module the closed page belongs to. Never shown. */
  module?: string;
  account?: string;
  /** The address the person asked for. Never shown. */
  from?: string;
}

/**
 * Chooses what the no-access page says, from what came with the navigation (`state`, which can
 * be anything: it is read back from the browser's history) and from who is signed in now.
 *
 * `signedInUserId` is compared with `account` as it is. The gates and the page both give the
 * name of the sign-in (`signInKey`), so a reason counts only in the sign-in it was found in.
 * With no reason that counts, the page says no more than that the page is not open to this
 * account.
 */
export function noAccessView(state: unknown, signedInUserId: string | null): NoAccessView {
  if (typeof state !== 'object' || state === null) return 'no-reason';
  const given = state as { reason?: unknown; module?: unknown; account?: unknown };
  if (typeof given.account !== 'string') return 'no-reason';
  if (signedInUserId === null || given.account !== signedInUserId) return 'no-reason';
  if (given.reason === 'not-on-team') return 'not-on-team';
  if (typeof given.module === 'string' && given.module) return 'one-page';
  return 'no-reason';
}
