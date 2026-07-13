# Settings → Setup Hub Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the farmer-facing settings (Language, Consent, Export, Erase, Billing) out of the Settings page into the Setup Hub's existing "Settings" group; leave Voice Diary + Harvest config on Settings; gate dev tools behind `import.meta.env.DEV`.

**Architecture:** Frontend-only. The Hub (`features/profile/ProfilePage.tsx` → `SetupHubMenu`) already renders a `settingsItems` list whose rows call `onSelectExtra(id)`. We extend that list and split the handler: "link" items (consent/export/erase) call new nav callbacks routed in `simpleRoutes.tsx`; "inline" items (language already exists, billing new) render as folded sub-screens. The Settings page is slimmed; two dead files are deleted. No DB/backend/AI change.

**Tech Stack:** React 19 + TypeScript + Vite, Vitest, lucide-react icons, Tailwind. Reused components: `SubscriptionCard`, `ConsentScreen`, `ExportRequestScreen`, `ErasureRequestScreen`, `VoiceRetainedConsentToggle`, `HarvestConfigSheet`.

## Global Constraints

- **Behaviour parity** for everything moved — same data, same screens, same actions (Billing "Manage" stays a placeholder alert).
- **Frontend-only**: no changes under `src/apps/**`, no DB, no env, no Dexie version bump, no Zod, no AI prompt.
- **Lint gate is zero-tolerance**: pre-commit runs `eslint --max-warnings 0` on staged mobile-web TS — remove every import/variable a deletion orphans, or the commit is blocked. **No `--no-verify`.**
- **Every `src/**` commit body MUST contain** `spec: settings-to-setuphub-migration` (commit-msg hook, blocking) and subject ≤72 chars, no trailing period.
- **Fonts inherited** — all reused components already use the project fonts; add no new font rules.
- Work only on branch `feat/settings-into-setuphub`. Stage files explicitly (a concurrent session is active — never `git add .` / `git add -A`).

## Change Surface

- **DB:** No DB changes.
- **Backend:** No backend changes.
- **Frontend (mobile-web):**
  - Modify `src/clients/mobile-web/src/features/profile/ProfilePage.tsx` — rewrite `settingsItems`, add `onOpenConsent/onOpenExport/onOpenErasure` props + `handleSelectExtra`, add Billing inline sub-screen, define `HubSection` locally.
  - Modify `src/clients/mobile-web/src/core/navigation/simpleRoutes.tsx` — wire the three nav callbacks in `renderProfileRoute`; repoint `onBack` of `renderConsentRoute` / `renderExportRequestRoute` / `renderErasureRequestRoute` from `'settings'` to `'profile'`.
  - Modify `src/clients/mobile-web/src/pages/SettingsPage.tsx` — remove Language, App Permissions, Consent, Export, Erase, Delete-Crop, Billing blocks + orphaned imports/state; gate Notification tester + Developer Tools behind `import.meta.env.DEV`.
  - Delete `src/clients/mobile-web/src/features/settings/SettingsPage.tsx` (dead duplicate).
  - Delete `src/clients/mobile-web/src/features/profile/components/SetupHubAccordion.tsx` (unused).
  - Dexie: none. Zod: none. env: none.
- **Cross-cutting:** No secrets, no prod infra, no AI prompt bump, no SharedKernel events.

---

### Task 1: Hub Settings group — items, handler, Billing sub-screen (`ProfilePage.tsx`)

**Files:**
- Modify: `src/clients/mobile-web/src/features/profile/ProfilePage.tsx`
- Test: `src/clients/mobile-web/src/features/profile/__tests__/settingsItems.test.ts` (new — pure helper)

**Interfaces:**
- Produces: `ProfilePageProps.onOpenConsent?: () => void`, `onOpenExport?: () => void`, `onOpenErasure?: () => void` (consumed by Task 2).
- Consumes: `farmAdmin.myMemberships: MyFarmDto[]` and `profileFarmId` (already present in the file) for the billing farm.

To make the row-list logic testable without mounting the provider-heavy page, extract a pure builder.

- [ ] **Step 1: Write the failing test**

Create `src/clients/mobile-web/src/features/profile/__tests__/settingsItems.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSettingsExtraIds } from '../settingsItems';

describe('buildSettingsExtraIds', () => {
    it('always includes language, consent, export, erase in order', () => {
        expect(buildSettingsExtraIds(false)).toEqual(['language', 'consent', 'export', 'erase']);
    });
    it('appends billing only for owners', () => {
        expect(buildSettingsExtraIds(true)).toEqual(['language', 'consent', 'export', 'erase', 'billing']);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix src/clients/mobile-web test -- settingsItems`
Expected: FAIL — `Cannot find module '../settingsItems'`.

- [ ] **Step 3: Create the helper**

Create `src/clients/mobile-web/src/features/profile/settingsItems.ts`:

```ts
/** The Hub "Settings" group row ids, in display order. `billing` is owner-only. */
export type SettingsExtraId = 'language' | 'consent' | 'export' | 'erase' | 'billing';

export function buildSettingsExtraIds(isOwner: boolean): SettingsExtraId[] {
    const base: SettingsExtraId[] = ['language', 'consent', 'export', 'erase'];
    return isOwner ? [...base, 'billing'] : base;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm --prefix src/clients/mobile-web test -- settingsItems`
Expected: PASS (2 tests).

- [ ] **Step 5: Update `ProfilePage.tsx` imports**

Replace the lucide import line (currently `import { User, Sprout, Zap, Tractor, FlaskConical, ArrowLeft, Globe, Shield, Mic } from 'lucide-react';`) with:

```tsx
import { User, Sprout, Zap, Tractor, FlaskConical, ArrowLeft, Globe, Shield, Download, Trash2, CreditCard } from 'lucide-react';
```

(`Mic` removed — the voice row is gone; `Download`, `Trash2`, `CreditCard` added for the new rows.)

Replace `import type { HubSection } from './components/SetupHubAccordion';` with a local type (SetupHubAccordion is deleted in Task 4):

```tsx
// Local Hub section type (was imported from the now-removed SetupHubAccordion).
type HubSection = { id: ProfileTab; label: string; icon: React.ReactNode; body: React.ReactNode };
```

Add near the other imports:

```tsx
import SubscriptionCard from '../admin/billing/SubscriptionCard';
import { buildSettingsExtraIds } from './settingsItems';
```

Note: `type HubSection` must be declared after `ProfileTab` (which is defined at module scope) — place it just below the `ProfileTab` union.

- [ ] **Step 6: Add the three nav props**

In `interface ProfilePageProps`, after `onOpenReferrals?: () => void;` add:

```tsx
    onOpenConsent?: () => void;
    onOpenExport?: () => void;
    onOpenErasure?: () => void;
```

In the component destructure (the `({ profile, crops, ... onExit, initialTab })` block), add `onOpenConsent, onOpenExport, onOpenErasure,` alongside `onOpenReferrals`.

- [ ] **Step 7: Replace `settingsItems` + add the select handler**

Replace the current block (the `const langLabel = ...` + `const settingsItems = [ language, permissions, voice ]`) with:

```tsx
                const langLabel = language === 'mr' ? 'मराठी' : 'English';
                // Billing farm = the app's current farm (or first membership) — MyFarmDto carries the subscription.
                const billingFarm = farmAdmin.myMemberships.find(m => m.farmId === profileFarmId) ?? farmAdmin.myMemberships[0];
                const isOwner = billingFarm?.role === 'PrimaryOwner';
                const settingsMeta: Record<string, { label: string; icon: React.ReactNode; subtitle?: string }> = {
                    language: { label: 'भाषा · Language', icon: <Globe size={20} />, subtitle: langLabel },
                    consent: { label: 'गोपनीयता · Consent', icon: <Shield size={20} />, subtitle: 'तुमच्या परवानग्या · Your permissions' },
                    export: { label: 'डेटा डाउनलोड · Export my data', icon: <Download size={20} />, subtitle: 'सर्व डेटाची प्रत · A copy of your data' },
                    erase: { label: 'डेटा पुसा · Erase my data', icon: <Trash2 size={20} />, subtitle: 'कायमचा पुसा · Permanent' },
                    billing: { label: 'बिलिंग · Billing', icon: <CreditCard size={20} />, subtitle: 'तुमचा प्लॅन · Your plan' },
                };
                const settingsItems = buildSettingsExtraIds(isOwner).map(id => ({ id, ...settingsMeta[id] }));

                const handleSelectExtra = (id: string) => {
                    if (id === 'consent') return onOpenConsent?.();
                    if (id === 'export') return onOpenExport?.();
                    if (id === 'erase') return onOpenErasure?.();
                    setActiveExtra(id); // 'language' | 'billing' — folded sub-screens
                };
```

- [ ] **Step 8: Add the Billing sub-screen + delete the "Coming soon" catch-all**

Keep the existing `if (activeExtra === 'language') { ... }` block unchanged. **Replace** the block that follows it (the `if (activeExtra) { const extraTitle = ... Coming soon ... }`) with:

```tsx
                if (activeExtra === 'billing') {
                    return (
                        <div>
                            {header('बिलिंग · Billing', () => setActiveExtra(null))}
                            <SubscriptionCard
                                subscription={billingFarm?.subscription}
                                role={billingFarm?.role ?? ''}
                                onManageBilling={() => window.alert('Billing portal coming soon. Contact support@shramsafal.in.')}
                            />
                        </div>
                    );
                }
```

- [ ] **Step 9: Point the menu at the new handler**

In the `<SetupHubMenu ... />` render, change `onSelectExtra={setActiveExtra}` to `onSelectExtra={handleSelectExtra}`.

- [ ] **Step 10: Typecheck + lint + tests**

Run: `npm --prefix src/clients/mobile-web run typecheck`
Expected: no errors.
Run: `npm --prefix src/clients/mobile-web run lint`
Expected: 0 warnings (confirms no orphaned import like `Mic`).
Run: `npm --prefix src/clients/mobile-web test -- settingsItems`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/clients/mobile-web/src/features/profile/ProfilePage.tsx src/clients/mobile-web/src/features/profile/settingsItems.ts src/clients/mobile-web/src/features/profile/__tests__/settingsItems.test.ts
git commit -m "feat(profile): migrate settings rows into the Setup Hub group" -m "spec: settings-to-setuphub-migration"
```

---

### Task 2: Route wiring — nav callbacks + Back-nav repoint (`simpleRoutes.tsx`)

**Files:**
- Modify: `src/clients/mobile-web/src/core/navigation/simpleRoutes.tsx`
- Test: `src/clients/mobile-web/src/core/navigation/__tests__/settings-migration-routes.test.tsx` (new)

**Interfaces:**
- Consumes: `ProfilePageProps.onOpenConsent/onOpenExport/onOpenErasure` from Task 1.

Caller check already done: consent/export/erasure are navigated to **only** from the (being-slimmed) Settings page, so a plain repoint to `'profile'` is safe — no origin-tracking needed.

- [ ] **Step 1: Write the failing test** (mirrors the existing `AppRouter.feature-gate.test.tsx` makeCtx pattern)

Create `src/clients/mobile-web/src/core/navigation/__tests__/settings-migration-routes.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import { renderConsentRoute, renderExportRequestRoute, renderErasureRequestRoute } from '../simpleRoutes';

function ctxWith(currentRoute: string, setCurrentRoute = vi.fn()): AppRouterContext {
    return { currentRoute, setCurrentRoute } as unknown as AppRouterContext;
}

describe('privacy routes Back returns to the Hub after migration', () => {
    it.each([
        ['consent', renderConsentRoute],
        ['dataRights/export', renderExportRequestRoute],
        ['dataRights/erasure', renderErasureRequestRoute],
    ])('%s onBack navigates to profile', (route, render) => {
        const setCurrentRoute = vi.fn();
        const node = render(ctxWith(route, setCurrentRoute)) as React.ReactElement;
        expect(node).not.toBeNull();
        // The screen is the single child of the animation wrapper; call its onBack.
        const screen = (node.props.children) as React.ReactElement<{ onBack: () => void }>;
        screen.props.onBack();
        expect(setCurrentRoute).toHaveBeenCalledWith('profile');
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm --prefix src/clients/mobile-web test -- settings-migration-routes`
Expected: FAIL — `onBack` still calls `setCurrentRoute('settings')`.

- [ ] **Step 3: Repoint the three renderers' Back**

In `simpleRoutes.tsx`, in `renderConsentRoute`, `renderErasureRequestRoute`, and `renderExportRequestRoute`, change each `onBack={() => ctx.setCurrentRoute('settings')}` to `onBack={() => ctx.setCurrentRoute('profile')}`. (Leave `renderVoiceDiaryRoute`, `renderAiAdminRoute`, `renderOpsAdminRoute` unchanged — they still return to Settings.)

- [ ] **Step 4: Wire the three nav callbacks into ProfilePage**

In `renderProfileRoute`, inside the `<ProfilePage ... />`, after `onOpenReferrals={() => ctx.setCurrentRoute('referrals')}` add:

```tsx
                onOpenConsent={() => ctx.setCurrentRoute('consent')}
                onOpenExport={() => ctx.setCurrentRoute('dataRights/export')}
                onOpenErasure={() => ctx.setCurrentRoute('dataRights/erasure')}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix src/clients/mobile-web test -- settings-migration-routes`
Expected: PASS (3 cases).

- [ ] **Step 6: Typecheck + lint**

Run: `npm --prefix src/clients/mobile-web run typecheck && npm --prefix src/clients/mobile-web run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/clients/mobile-web/src/core/navigation/simpleRoutes.tsx src/clients/mobile-web/src/core/navigation/__tests__/settings-migration-routes.test.tsx
git commit -m "feat(nav): route Hub settings links + return privacy screens to Hub" -m "spec: settings-to-setuphub-migration"
```

---

### Task 3: Slim the Settings page + gate dev tools (`pages/SettingsPage.tsx`)

**Files:**
- Modify: `src/clients/mobile-web/src/pages/SettingsPage.tsx`

Removals are by their distinctive JSX anchors. **After each removal, run lint** — it names every orphaned import so you delete exactly the right ones.

- [ ] **Step 1: Remove the migrated / dropped JSX blocks**

Delete these blocks (identified by their comment/heading anchors), keeping everything else:
1. `{t('settings.general')}` heading + `{/* 0. Language Selector */}` glass-panel (the whole language block).
2. `{/* App Permissions */}` — the "App Configuration" heading `<div className="pt-4">` + the App Permissions glass-panel (through the "Browser Settings" button).
3. `{/* spec: ...06.4 — Privacy/Consent entry. */}` — the "Privacy" heading + the Consent glass-panel (`data-testid="settings-open-consent"`).
4. `{/* spec: ...08.6 — DPDP §11 Export entry. */}` — the Export glass-panel (`data-testid="settings-open-data-export"`).
5. `{/* spec: ...08.6 — DPDP §12 Erasure entry. */}` — the Erase glass-panel (`data-testid="settings-open-data-erasure"`).
6. `{/* Manage Crops Data */}` — the "Manage Farm Data" heading + the Delete Crop Data glass-panel.
7. `{/* Billing — PrimaryOwner only ... */}` — the entire `{currentFarm && currentFarm.role === 'PrimaryOwner' && ( ... )}` block.

**Keep:** the Voice Journal glass-panel (`setCurrentRoute('voiceDiary')`), the `VoiceRetainedConsentToggle`, the "Pricing moved to Finance Manager" ledger note, and the Harvest Configuration accordion + `HarvestConfigSheet` modal.

- [ ] **Step 2: Remove the now-dead Billing state + effect**

Delete the `useUiPref('shramsafal_current_farm_id', ...)`/`currentFarm`/`useEffect(getMyFarms...)` block (the billing-farm resolution, roughly lines 40–53) and the `languages` array constant (the language selector's data). Remove `setLanguage` from the `useLanguage()` destructure (keep `t` and `language`).

- [ ] **Step 3: Gate the dev tools behind `import.meta.env.DEV`**

Wrap the `<NotificationTestComponent />` line and the `{/* Developer Tools */}` glass-panel together:

```tsx
            {import.meta.env.DEV && (
                <>
                    <NotificationTestComponent />
                    <div className="glass-panel p-5 mt-6">
                        {/* ...existing Developer Tools content unchanged... */}
                    </div>
                </>
            )}
```

- [ ] **Step 4: Fix the import line — run lint to find orphans**

Run: `npm --prefix src/clients/mobile-web run lint`
Expected: it lists unused imports. Remove exactly these from the top-of-file imports (orphaned by Steps 1–2): `Globe`, `Shield`, `MapPin`, `Camera`, `Trash2` (from the lucide import), `SubscriptionCard`, `getMyFarms`, `type MyFarmDto`, `useUiPref`, and `Language` (from `../i18n/translations`). **Keep** `BookOpen, FlaskConical, Bot, Coins, Leaf, Check, Pencil, ChevronDown, Mic, Activity`, `NotificationTestComponent`, `HarvestConfigSheet`, `CropSymbol`, `getHarvestConfig`, `VoiceRetainedConsentToggle`, `toVoiceDiaryLocale`, `useLanguage`, `useAppNavigationState`, and the type imports still referenced. Re-run lint until it reports **0 warnings**.

- [ ] **Step 5: Typecheck + full test suite**

Run: `npm --prefix src/clients/mobile-web run typecheck`
Expected: clean (if `AppRouter.feature-gate.test.tsx` or any test asserted the removed `data-testid`s, update those assertions).
Run: `npm --prefix src/clients/mobile-web test`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/clients/mobile-web/src/pages/SettingsPage.tsx
git commit -m "refactor(settings): slim Settings to Voice Diary + Harvest; gate dev tools" -m "spec: settings-to-setuphub-migration"
```

---

### Task 4: Delete dead code

**Files:**
- Delete: `src/clients/mobile-web/src/features/settings/SettingsPage.tsx`
- Delete: `src/clients/mobile-web/src/features/profile/components/SetupHubAccordion.tsx`

- [ ] **Step 1: Confirm zero references**

Run: `npx --prefix src/clients/mobile-web rg -n "features/settings/SettingsPage|SetupHubAccordion" src/clients/mobile-web/src`
Expected: the only hit is `ProfilePage.tsx` importing `HubSection` — already replaced with a local type in Task 1. If any other reference exists, STOP and re-scope.

- [ ] **Step 2: Delete the files**

```bash
git rm src/clients/mobile-web/src/features/settings/SettingsPage.tsx src/clients/mobile-web/src/features/profile/components/SetupHubAccordion.tsx
```

- [ ] **Step 3: Typecheck + lint + tests**

Run: `npm --prefix src/clients/mobile-web run typecheck && npm --prefix src/clients/mobile-web run lint && npm --prefix src/clients/mobile-web test`
Expected: all green (proves nothing depended on the deleted files).

- [ ] **Step 4: Commit**

```bash
git add -u src/clients/mobile-web/src
git commit -m "chore(profile): delete dead duplicate Settings + unused SetupHubAccordion" -m "spec: settings-to-setuphub-migration"
```

---

### Task 5: Full verification + production build

**Files:** none (verification only).

- [ ] **Step 1: Full gates green**

Run: `npm --prefix src/clients/mobile-web run typecheck`
Run: `npm --prefix src/clients/mobile-web run lint`
Run: `npm --prefix src/clients/mobile-web test`
Expected: all pass.

- [ ] **Step 2: Production build succeeds**

Run: `npm --prefix src/clients/mobile-web run build:prod`
Expected: build completes; note the emitted `index-*.js` hash for the deploy proof.

- [ ] **Step 3: Local visual check (feeds the Founder Acceptance Gate)**

Run the app locally (or the isolated Hub preview), confirm the Hub "Settings" group shows **Language, Consent, Export, Erase** (+ **Billing** as owner), tapping Consent/Export/Erase opens the right screen and **Back returns to the Hub**, and the ⚙️ gear opens the slim Settings page (Voice Diary + Harvest config only; no dev tools in a prod build).

---

## 🛑 Founder Acceptance Gate

**Founder verifies via these pointers before ANY deploy step. Code-complete ≠ approved.**

| # | What to check | How | Expected |
|---|---|---|---|
| 1 | Migrated rows appear | Open the Hub (avatar) → Settings group | Language, Consent, Export, Erase rows (+ Billing if owner) |
| 2 | Privacy links work + Back | Tap Consent, then Export, then Erase; press Back on each | Correct screen opens; Back lands on the **Hub**, not old Settings |
| 3 | Billing (owner) | As a PrimaryOwner, tap Billing | Plan card renders; "Manage" shows the placeholder alert (unchanged) |
| 4 | Voice Diary untouched | ⚙️ gear → Settings | Voice Journal + consent toggle still open the Voice Diary; unchanged |
| 5 | Harvest config untouched | ⚙️ gear → Settings → Harvest configuration | Per-plot config + editor open as before |
| 6 | Dev tools hidden | On the prod build, open Settings | No Notification tester, no Developer Tools |
| 7 | Nothing else regressed | Farm-setup rows, Finance, Referrals, Logout in the Hub | All behave as before |

**Founder approved: [ ]**

---

## Deployment Plan + prod proof

**No deploy step runs until the Founder Acceptance Gate is ticked.** Frontend-only, build-once-promote (matches PR #43's lane). No DB, no backend, no prod wake.

- [ ] **D1 — Merge to main** (founder-gated): open PR `feat/settings-into-setuphub` → `main`, reference `spec: settings-to-setuphub-migration`, pass CI `gate`, resolve threads (no `--admin`). Founder merges.
- [ ] **D2 — Build the promoted artifact:** `npm --prefix src/clients/mobile-web run build:prod` from the merged `main`; record the `index-*.js` hash.
- [ ] **D3 — Promote:** `aws s3 sync src/clients/mobile-web/dist s3://shramsafal-app-prod --delete --exclude "apk/*" --exclude "deploy/*"` with `index.html` set no-cache; then CloudFront `EFLL3RCLOOO60` invalidation `/*`.
- [ ] **D4 — Prod proof:** `app.shramsafal.in` returns 200 and serves the new `index-*.js` hash; logged-in Hub Settings group shows the migrated rows; gear opens the slim Settings; a prod build shows no dev tools. Capture the `/` entry-hash match as evidence.
- [ ] **D5 — Tracker:** add a `DEPLOYMENT_TRACKER.md` Mobile-web row (date, bundle hash, "Settings→Setup-Hub migration", prod-proof evidence). Approved ≠ deployed; written ≠ live.

---

## Self-Review

- **Spec coverage:** Language (existing, kept), Consent/Export/Erase (Task 1 rows + Task 2 routing), Billing (Task 1 sub-screen), App Permissions dropped (Task 3 removal), Delete Crop Data dropped (Task 3), Voice Diary + Harvest kept (Task 3), dev tools gated (Task 3), dead code deleted (Task 4), back-nav (Task 2), deployment (D1–D5). All spec sections mapped.
- **Placeholder scan:** none — every step carries exact code/commands. (The Billing "Manage" alert is intentional parity, not a placeholder.)
- **Type consistency:** `onOpenConsent/onOpenExport/onOpenErasure` defined in Task 1, consumed in Task 2. `HubSection` local type matches the shape ProfilePage's `sections` array already uses (`{id, label, icon, body}`). `SubscriptionCard` gets `subscription: SubscriptionSnapshotDto | null` via `MyFarmDto.subscription` (exact type parity, verified). `buildSettingsExtraIds` name consistent across Task 1 helper, implementation, and test.
