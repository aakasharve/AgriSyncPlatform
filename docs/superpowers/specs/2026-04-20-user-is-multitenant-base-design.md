---
name: User-as-Multitenant-Base
description: Move /me/context into User.Api, add phone-verified / language / auth-mode fields, reshape the response into pre-computed farm cards for a semi-literate Marathi farmer
type: design-spec
date: 2026-04-20
status: approved
---

# User is the Multi-Tenant Base

## Why

The multi-tenant architecture anchors every tenant (`OwnerAccount`) and every membership (`FarmMembership`) to a `UserId` issued by the **User app**. User is already the identity source. But the "who am I + what can I see" endpoint (`/me/context`) was placed in `Bootstrapper` for expediency, and it composes by reading three DbContexts at once. That violates boundary rules in the [SHRAMSAFAL_MULTIUSER_MULTITENANT_IMPLEMENTATION_PLAN §0A.1 + §0A.4 X3](../../../_COFOUNDER/Projects/AgriSync/Operations/Plans/SHRAMSAFAL_MULTIUSER_MULTITENANT_IMPLEMENTATION_PLAN_2026-04-18.md).

Instead of the plan's full "Outbox + local projections" path (which is invisible infra for a semi-literate farmer), we take the smallest step that moves ownership to the correct app and makes the endpoint dramatically easier to consume on the client.

**End goals for Ramu (semi-literate Marathi farmer):**
- One login (OTP, already done), one "who am I" screen, one tap to switch farm
- Marathi loads before any English text flashes
- Password UI never appears for OTP users
- Banners (verify phone, plan expiring) are *server-decided*, not client-computed

## Scope

### In scope
1. Add 3 identity fields to `User`: `PhoneVerifiedAtUtc`, `PreferredLanguage`, `AuthMode`
2. Relocate `/user/auth/me/context` into `User.Api` (handler in `User.Application`)
3. Reshape response so the client renders, never computes
4. Wire OTP + password flows to set the new fields
5. Delete the old `/user/auth/me` endpoint (returned deprecated `AppMembership`)
6. Update frontend `MeContextService` + `FarmContext` to the new shape

### Out of scope (documented tech debt)
- User-side projection tables (`user.owner_account_projections`, `user.farm_membership_projections`)
- Outbox consumers in `User.Infrastructure.Messaging`
- Full architecture-test compliance for cross-DB reads

Cross-DB composition is **isolated to Bootstrapper adapters** so it has a clear later-swap point.

## Architecture

```
┌─────────────── User.Api ────────────────┐
│  GET /user/auth/me/context              │  ← owns the endpoint surface
│    → GetMeContextHandler                │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  User.Application.UseCases.GetMeContext │  ← pure assembly + flag computation
│    uses 3 ports:                        │
│      IAccountsSnapshotReader            │
│      IFarmMembershipSnapshotReader      │
│      IAffiliationSnapshotReader         │
└──────────────┬──────────────────────────┘
               │ (ports defined in User.Application)
┌──────────────▼──────────────────────────┐
│  Bootstrapper.Adapters (composition)    │  ← cross-DB reads live ONLY here
│    AccountsSnapshotReader               │     (future swap: User.Infrastructure
│    FarmMembershipSnapshotReader         │      projection readers, same ports)
│    AffiliationSnapshotReader            │
└─────────────────────────────────────────┘
```

**Boundary discipline preserved:** `User.Api`, `User.Application`, `User.Infrastructure` do NOT reference Accounts or ShramSafal. Only Bootstrapper (the composition root) does. The ports form the clean swap surface.

## Domain changes

### New enum `AuthMode` (User.Domain.Identity)
```
Password | Otp
```
Default for existing users = `Password`. OTP-registered users = `Otp`. Users can later add a password (AuthMode stays `Otp` unless explicitly flipped — out of scope).

### New value `PreferredLanguage` (User.Domain.Identity)
Stored as ISO code string: `mr` (default), `hi`, `en`. Domain-level helper `PreferredLanguage.Parse(string)` with fallback to `mr`.

### User entity adds
- `PhoneVerifiedAtUtc : DateTime?`
- `PreferredLanguage : string` (default `"mr"`)
- `AuthMode : AuthMode` (default `Password`)

`User.Register` (password path) → `AuthMode = Password`, `PhoneVerifiedAtUtc = null`.
`User.RegisterViaOtp` → `AuthMode = Otp`, `PhoneVerifiedAtUtc = utcNow`.
On successful `VerifyOtpHandler` for an existing user → `MarkPhoneVerified(utcNow)` (idempotent).

### Migration
`20260420_AddUserIdentityAugmentations` adds 3 columns with safe defaults. Backfill:
- `phone_verified_at_utc = NULL` for all existing rows
- `preferred_language = 'mr'`
- `auth_mode = 0` (Password) — existing demo users (Ramu) logged in via password

## Response shape (the Ramu-friendly contract)

```jsonc
GET /user/auth/me/context

{
  "me": {
    "userId": "…",
    "displayName": "Ramu Patil",
    "phoneMasked": "******9999",
    "phoneVerifiedAtUtc": "2026-04-18T…" | null,
    "preferredLanguage": "mr",
    "authMode": "Otp"
  },
  "farms": [
    {
      "farmId": "…",
      "name": "Ramu's Grape Farm",
      "farmCode": "ABC123",
      "ownerAccountId": "…",
      "role": "PrimaryOwner",
      "status": "Active",
      "joinedVia": "PrimaryOwnerBootstrap",
      "plan": "Pro",                // Free | Trial | Pro | PastDue | Expired
      "planValidUntilUtc": "2027-04-…" | null,
      "capabilities": {
        "canInvite":     true,      // PrimaryOwner | SecondaryOwner
        "canVerify":     true,      // PrimaryOwner | SecondaryOwner | Mukadam
        "canAddCost":    true,      // PrimaryOwner | SecondaryOwner
        "canSeeBilling": true       // PrimaryOwner only
      }
    }
  ],
  "share": {
    "referralCode": "RAMU01" | null,
    "referralsTotal": 3,
    "referralsQualified": 1,
    "benefitsEarned": 1
  },
  "alerts": [
    // {"kind":"verify_phone",   "severity":"info"}
    // {"kind":"plan_expiring",  "severity":"warn",  "farmId":"…", "daysLeft":3}
    // {"kind":"plan_expired",   "severity":"error", "farmId":"…"}
    // {"kind":"no_farms_yet",   "severity":"info"}
  ],
  "serverTimeUtc": "2026-04-20T…"
}
```

### Server-computed flags
| Field | Rule |
|---|---|
| `plan = "Pro"`       | active subscription with `PlanCode = "ShramSafalPro"` |
| `plan = "Trial"`     | subscription `Trialing` |
| `plan = "PastDue"`   | subscription `PastDue` |
| `plan = "Expired"`   | subscription `Expired` or `Canceled` |
| `plan = "Free"`      | no subscription row, or unmatched |
| `canInvite`          | role ∈ {PrimaryOwner, SecondaryOwner} |
| `canVerify`          | role ∈ {PrimaryOwner, SecondaryOwner, Mukadam} |
| `canAddCost`         | role ∈ {PrimaryOwner, SecondaryOwner} |
| `canSeeBilling`      | role = PrimaryOwner AND farm.ownerAccountId primary-owner-user = caller |

### Alerts
| Kind | Trigger |
|---|---|
| `verify_phone`   | `phoneVerifiedAtUtc == null` |
| `plan_expiring`  | any farm where subscription PastDue OR active sub with `planValidUntilUtc - now ≤ 7 days` |
| `plan_expired`   | any farm where subscription Expired or Canceled in last 30 days |
| `no_farms_yet`   | `farms.length == 0` |

## Frontend changes

### `MeContextService.ts`
Replace `MeContext` interface with the new shape. Keep cache TTL + invalidate. Remove `ownerAccounts` + `memberships` + `affiliation` fields; add `me`, `farms`, `share`, `alerts`.

### `FarmContext.tsx`
- `currentMembership` → `currentFarm : MeFarm | null`
- `allMemberships` → `farms : MeFarm[]`
- `currentFarmId` resolution logic stays (localStorage → first farm fallback)

### Downstream consumers
Any component previously reading `membership.role` now reads `currentFarm.capabilities.*`. All role-checking conditionals should prefer capabilities. Audit + update in-place.

## Endpoints affected

| Endpoint | Before | After |
|---|---|---|
| `GET /user/auth/me/context` | Bootstrapper, 3-DB join | **User.Api**, 3 ports → Bootstrapper adapters (same 3 DBs under the hood, but isolated) |
| `GET /user/auth/me`         | Returns deprecated AppMembership | **Deleted** |
| `GET /user/auth/start-otp` / `verify-otp` | unchanged | unchanged (now set `PhoneVerifiedAtUtc` + `AuthMode=Otp`) |

## Tests

- Domain: `User_RegisterViaOtp_SetsAuthModeOtpAndPhoneVerified`
- Domain: `User_MarkPhoneVerified_IsIdempotent`
- Handler: `GetMeContext_ComputesCapabilitiesByRole`
- Handler: `GetMeContext_ReturnsNoFarmsYetAlertWhenEmpty`
- Handler: `GetMeContext_PlanExpiringAlert_WhenPastDueOrNear`
- Integration: `/user/auth/me/context` returns new shape for seeded Ramu
- Frontend: FarmContext tests already exist — adapt to new shape

## Future migration (deferred)

When projections are introduced:
1. Create `user.owner_account_projections` + `user.farm_membership_projections` tables
2. Add Outbox consumers in `User.Infrastructure.Messaging`
3. Add `User.Infrastructure.Persistence.Readers.*` implementing the 3 ports
4. Swap DI registrations in Bootstrapper
5. Delete Bootstrapper adapters

The port surface stays unchanged — zero change to endpoints, handlers, or frontend.

## Non-goals

- No JWT shape change (still identity-only per `814ec70`)
- No new frontend screens (FarmContextSwitcher UI lives in a separate design)
- No subscription purchase flow change
- No worker-retention / membership revocation logic change
