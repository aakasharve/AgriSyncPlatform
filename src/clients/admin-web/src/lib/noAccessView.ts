/**
 * What the no-access page may say.
 *
 *   'not-on-team': the account is not on the control room's team at all.
 *   'one-page':    the account is on the team, but the page it asked for is closed to it.
 *   'no-reason':   the page does not know why it was opened for the person in front of it.
 */
export type NoAccessView = 'not-on-team' | 'one-page' | 'no-reason';

/**
 * What a gate sends along when it sends somebody to the no-access page.
 *
 * `account` is the id of the signed-in user the reason is true for. The browser keeps this
 * state in its history, where it outlives the session: somebody else can sign in on the same
 * tab and press Back. A reason without an account, or for another account, is therefore no
 * reason at all.
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
 * A reason counts only for the account it was given for. Without one, the page says no more
 * than that the page is not open to this account.
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
