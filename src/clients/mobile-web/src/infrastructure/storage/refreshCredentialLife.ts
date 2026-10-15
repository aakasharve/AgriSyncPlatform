// spec: 2026-08-25-prod-cutover-waves
//
// How long the SERVER keeps a refresh credential alive: 30 days
// (User.Application RefreshTokenPolicy.Lifetime; the web refresh cookie is stamped
// with the same value). Two different promises hang off it and must not be confused:
//
//   - OFFLINE REOPENING (AuthTokenStore.PRESENCE_MAX_AGE_MS) is a product choice,
//     14 days: after that the app does not present the user as signed in.
//   - UNFINISHED-LOGOUT PROTECTION (PendingLogoutStore, RefreshSessionStore pending-revoke
//     slot) lasts as long as the credential COULD still be live: until the revoke
//     succeeds, or this lifetime has passed since the logout (the credential was issued
//     at or before the logout, so it has expired by then). Founder 2026-10-12.
//
// Change this together with RefreshTokenPolicy.Lifetime; a backend test pins 30 days.
export const SERVER_REFRESH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
