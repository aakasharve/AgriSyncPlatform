# Multi-Farm Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganise the Profile so the farmer is the anchor and their farms appear as separated, family-grouped 7/12 holdings; tapping a farm opens that farm's own page (team + crops), reusing the existing multi-tenant infra.

**Architecture:** Pure presentation-layer change in `src/clients/mobile-web`. The farm list already arrives via `getMyFarms()` → `MyFarmDto[]` (held in `useFarmAdminState.myMemberships`). We add a redesigned farm-list on the Profile menu and a per-farm drill-in that sets the active farm (existing `FarmContext`) before showing that farm's sections. Tenure / 7-12 / member-type are graceful UI labels with safe defaults; no backend or DB change in Phase 1.

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind + lucide-react; Vitest + React Testing Library for tests.

**Spec:** `docs/superpowers/specs/2026-07-11-multifarm-profile-design.md` (Spec ID `multifarm-profile-2026-07-11`).

## Global Constraints

- **UI-only, no infra damage** (founder): no backend/DB change in Phase 1; small additive tweaks only; "not a huge rebuild or recode."
- **No emoji** for iconography except the existing 👨‍🌾 avatar; use lucide line-icons.
- **Bilingual** Marathi · English on every user-facing string.
- **Fonts:** Noto Sans/Serif Devanagari for Marathi, DM Sans for English/numbers (already global; don't override).
- **Design language (locked):** soft rounded cards, blended gradient header, emerald accent, tenure tags (Owned=emerald / Leased=amber), member-type badges (Family=emerald / Leased=amber / Temporary=orange), strong `active:scale` tap feedback, theme-consistent with app.
- **Existing test suite (258 tests) must stay green;** frontend-only so architecture tests are unaffected.
- **Pre-commit is `eslint --max-warnings 0`** (stricter than CI) — zero warnings.
- **Data shape (verified):** `MyFarmDto = { farmId: string; name: string; role: string; farmCode: string | null; subscription: SubscriptionSnapshotDto | null }` from `features/onboarding/qr/inviteApi.ts`.

## Change Surface

- **DB:** No.
- **Backend:** No.
- **Frontend:** Yes — new `FarmListCard` + `FarmsSection` components; `farmLabels` helper; wiring in `SetupHubMenu.tsx` and `ProfilePage.tsx`.
- **Cross-cutting:** No.

---

## File Structure

- **Create** `src/clients/mobile-web/src/features/profile/components/farmLabels.ts` — pure label helpers (tenure, member-type, 7/12) with graceful defaults. One responsibility: mapping data → display strings.
- **Create** `src/clients/mobile-web/src/features/profile/components/FarmListCard.tsx` — one farm card (name, 7/12 label, tenure tag, role, subscription dot). Presentational; no data fetching.
- **Create** `src/clients/mobile-web/src/features/profile/components/FarmsSection.tsx` — "Your Farms" block: family header + name-sorted list of `FarmListCard`s + "Add a farm" CTA. Presentational; receives farms + handlers.
- **Modify** `src/clients/mobile-web/src/features/profile/components/SetupHubMenu.tsx` — render `FarmsSection` between farmer summary and farm-setup sections (new optional props).
- **Modify** `src/clients/mobile-web/src/features/profile/ProfilePage.tsx` — add `activeFarmId` selection; farm tap switches `FarmContext` and opens that farm's page; menu passes farms to `SetupHubMenu`.
- **Test** `src/clients/mobile-web/src/features/profile/components/__tests__/farmLabels.test.ts`
- **Test** `src/clients/mobile-web/src/features/profile/components/__tests__/FarmListCard.test.tsx`
- **Test** `src/clients/mobile-web/src/features/profile/components/__tests__/FarmsSection.test.tsx`

---

## Task 1: Label helpers (`farmLabels.ts`)

**Files:**
- Create: `src/clients/mobile-web/src/features/profile/components/farmLabels.ts`
- Test: `src/clients/mobile-web/src/features/profile/components/__tests__/farmLabels.test.ts`

**Interfaces:**
- Produces:
  - `type Tenure = 'owned' | 'leased'`
  - `tenureLabel(t: Tenure): { key: Tenure; mr: string; en: string }`
  - `type MemberType = 'family' | 'leased' | 'temporary'`
  - `memberTypeLabel(m: MemberType): { key: MemberType; mr: string; en: string }`
  - `sevenTwelveLabel(farmCode: string | null): string | null` — returns `null` when absent so callers can hide the row.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/farmLabels.test.ts
import { describe, it, expect } from 'vitest';
import { tenureLabel, memberTypeLabel, sevenTwelveLabel } from '../farmLabels';

describe('farmLabels', () => {
  it('gives bilingual tenure labels', () => {
    expect(tenureLabel('owned').mr).toBe('मालकीची');
    expect(tenureLabel('leased').en).toBe('Leased');
  });
  it('gives bilingual member-type labels', () => {
    expect(memberTypeLabel('temporary').mr).toBe('तात्पुरता');
    expect(memberTypeLabel('family').en).toBe('Family');
  });
  it('formats a 7/12 label from farmCode, or null when missing', () => {
    expect(sevenTwelveLabel('GT-4702')).toBe('७/१२ · GT-4702');
    expect(sevenTwelveLabel(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/clients/mobile-web run test -- farmLabels`
Expected: FAIL — cannot find module `../farmLabels`.

- [ ] **Step 3: Write minimal implementation**

```ts
// farmLabels.ts
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure display-label helpers for the multi-farm Profile. Phase 1 keeps
 * tenure / member-type UI-only (no persistence); these map a value to a
 * bilingual label, defaulting gracefully so a missing value never crashes.
 */
export type Tenure = 'owned' | 'leased';
export type MemberType = 'family' | 'leased' | 'temporary';

const TENURE: Record<Tenure, { mr: string; en: string }> = {
    owned: { mr: 'मालकीची', en: 'Owned' },
    leased: { mr: 'भाडेपट्टा', en: 'Leased' },
};
const MEMBER: Record<MemberType, { mr: string; en: string }> = {
    family: { mr: 'कुटुंब', en: 'Family' },
    leased: { mr: 'भाडेपट्टा', en: 'Leased' },
    temporary: { mr: 'तात्पुरता', en: 'Temporary' },
};

export const tenureLabel = (t: Tenure) => ({ key: t, ...TENURE[t] });
export const memberTypeLabel = (m: MemberType) => ({ key: m, ...MEMBER[m] });
export const sevenTwelveLabel = (farmCode: string | null): string | null =>
    farmCode ? `७/१२ · ${farmCode}` : null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/clients/mobile-web run test -- farmLabels`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/profile/components/farmLabels.ts src/clients/mobile-web/src/features/profile/components/__tests__/farmLabels.test.ts
git commit -m "feat(profile): bilingual tenure/member-type/7-12 label helpers

spec: multifarm-profile-2026-07-11"
```

---

## Task 2: `FarmListCard` component

**Files:**
- Create: `src/clients/mobile-web/src/features/profile/components/FarmListCard.tsx`
- Test: `src/clients/mobile-web/src/features/profile/components/__tests__/FarmListCard.test.tsx`

**Interfaces:**
- Consumes: `tenureLabel`, `sevenTwelveLabel` (Task 1); `MyFarmDto` (`inviteApi.ts`).
- Produces:
  - `interface FarmListCardProps { farm: MyFarmDto; tenure?: import('./farmLabels').Tenure; onOpen: (farmId: string) => void; language: 'mr' | 'en' }`
  - `const FarmListCard: React.FC<FarmListCardProps>` (default export)

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/FarmListCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FarmListCard from '../FarmListCard';
import type { MyFarmDto } from '../../../onboarding/qr/inviteApi';

const farm: MyFarmDto = { farmId: 'f1', name: 'पुरुषोत्तमशेत', role: 'PrimaryOwner', farmCode: 'GT-4702', subscription: null };

describe('FarmListCard', () => {
  it('shows farm name, 7/12 and an Owned tag, and fires onOpen on click', () => {
    const onOpen = vi.fn();
    render(<FarmListCard farm={farm} tenure="owned" onOpen={onOpen} language="mr" />);
    expect(screen.getByText('पुरुषोत्तमशेत')).toBeInTheDocument();
    expect(screen.getByText(/GT-4702/)).toBeInTheDocument();
    expect(screen.getByText('मालकीची')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith('f1');
  });
  it('hides the 7/12 line when farmCode is null', () => {
    render(<FarmListCard farm={{ ...farm, farmCode: null }} onOpen={() => {}} language="en" />);
    expect(screen.queryByText(/७\/१२/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/clients/mobile-web run test -- FarmListCard`
Expected: FAIL — cannot find module `../FarmListCard`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// FarmListCard.tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One farm as a soft rounded card in the Profile's "Your Farms" list.
 * A farm = one 7/12 holding. Presentational only — receives its farm +
 * a tenure hint and reports taps upward. Matches the approved mockup.
 */
import React from 'react';
import { Sprout, FileText, ChevronRight } from 'lucide-react';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import { tenureLabel, sevenTwelveLabel, type Tenure } from './farmLabels';

export interface FarmListCardProps {
    farm: MyFarmDto;
    tenure?: Tenure;
    onOpen: (farmId: string) => void;
    language: 'mr' | 'en';
}

const FarmListCard: React.FC<FarmListCardProps> = ({ farm, tenure = 'owned', onOpen, language }) => {
    const t = tenureLabel(tenure);
    const seven = sevenTwelveLabel(farm.farmCode);
    const isOwned = tenure === 'owned';
    return (
        <button
            type="button"
            onClick={() => onOpen(farm.farmId)}
            className="group flex w-full items-center gap-3 rounded-[20px] border border-slate-100 bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(20,40,30,0.05)] transition-all active:scale-[0.985] hover:border-emerald-200/70 hover:shadow-[0_8px_18px_-10px_rgba(20,40,30,0.18)]"
        >
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[13px] bg-emerald-50 text-emerald-600">
                <Sprout size={20} />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-bold text-slate-800">{farm.name}</span>
                {seven && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-slate-400">
                        <FileText size={12} /> {seven}
                    </span>
                )}
            </span>
            <span className={`flex-shrink-0 rounded-lg px-2 py-1 text-[9.5px] font-extrabold uppercase tracking-tight ${isOwned ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-700'}`}>
                {language === 'mr' ? t.mr : t.en}
            </span>
            <ChevronRight size={18} className="flex-shrink-0 text-slate-300 transition-transform group-active:translate-x-0.5" />
        </button>
    );
};

export default FarmListCard;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/clients/mobile-web run test -- FarmListCard`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/profile/components/FarmListCard.tsx src/clients/mobile-web/src/features/profile/components/__tests__/FarmListCard.test.tsx
git commit -m "feat(profile): FarmListCard — a farm as a 7/12 holding card

spec: multifarm-profile-2026-07-11"
```

---

## Task 3: `FarmsSection` (family-grouped, name-sorted list)

**Files:**
- Create: `src/clients/mobile-web/src/features/profile/components/FarmsSection.tsx`
- Test: `src/clients/mobile-web/src/features/profile/components/__tests__/FarmsSection.test.tsx`

**Interfaces:**
- Consumes: `FarmListCard` (Task 2); `MyFarmDto`.
- Produces:
  - `interface FarmsSectionProps { farms: MyFarmDto[]; familyName?: string; onOpenFarm: (farmId: string) => void; onAddFarm?: () => void; language: 'mr' | 'en' }`
  - `const FarmsSection: React.FC<FarmsSectionProps>` (default export). Sorts farms by `name` (locale-aware) before rendering.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/FarmsSection.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FarmsSection from '../FarmsSection';
import type { MyFarmDto } from '../../../onboarding/qr/inviteApi';

const f = (name: string): MyFarmDto => ({ farmId: name, name, role: 'PrimaryOwner', farmCode: null, subscription: null });

describe('FarmsSection', () => {
  it('renders farms sorted by name and shows the family header with count', () => {
    render(<FarmsSection farms={[f('नाशिक'), f('खार्डी')]} familyName="आर्वे कुटुंब" onOpenFarm={() => {}} language="mr" />);
    expect(screen.getByText('आर्वे कुटुंब')).toBeInTheDocument();
    const names = screen.getAllByText(/नाशिक|खार्डी/).map(n => n.textContent);
    expect(names[0]).toBe('खार्डी'); // locale sort puts खार्डी before नाशिक
  });
  it('renders nothing but the Add CTA when there are no farms', () => {
    render(<FarmsSection farms={[]} onOpenFarm={() => {}} onAddFarm={() => {}} language="en" />);
    expect(screen.getByText(/Add a farm/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix src/clients/mobile-web run test -- FarmsSection`
Expected: FAIL — cannot find module `../FarmsSection`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// FarmsSection.tsx
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Your Farms" block on the Profile menu. Farms are one-per-7/12 holdings,
 * visually separated, sorted by name, and grouped under a light family
 * header (grouping is UI-only — no data merge). Presentational.
 */
import React from 'react';
import { Layers, Plus } from 'lucide-react';
import type { MyFarmDto } from '../../onboarding/qr/inviteApi';
import FarmListCard from './FarmListCard';

export interface FarmsSectionProps {
    farms: MyFarmDto[];
    familyName?: string;
    onOpenFarm: (farmId: string) => void;
    onAddFarm?: () => void;
    language: 'mr' | 'en';
}

const FarmsSection: React.FC<FarmsSectionProps> = ({ farms, familyName, onOpenFarm, onAddFarm, language }) => {
    const sorted = [...farms].sort((a, b) => a.name.localeCompare(b.name, 'mr'));
    return (
        <div className="mt-4">
            {familyName && (
                <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Layers size={15} /></span>
                    <span className="text-[13px] font-bold text-slate-700">{familyName}</span>
                    <span className="text-[10.5px] text-slate-400">{sorted.length} {language === 'mr' ? 'शेती' : 'farms'}</span>
                </div>
            )}
            <div className={`flex flex-col gap-2.5 ${familyName ? 'ml-3.5 border-l-2 border-dashed border-violet-100 pl-2.5' : ''}`}>
                {sorted.map(farm => (
                    <FarmListCard key={farm.farmId} farm={farm} onOpen={onOpenFarm} language={language} />
                ))}
                {onAddFarm && (
                    <button
                        type="button"
                        onClick={onAddFarm}
                        className="flex items-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-emerald-200 bg-emerald-50 p-3.5 text-left transition-all active:scale-[0.985]"
                    >
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white"><Plus size={18} /></span>
                        <span className="text-[13.5px] font-bold text-emerald-800">{language === 'mr' ? 'शेत जोडा · Add a farm' : 'Add a farm'}</span>
                    </button>
                )}
            </div>
        </div>
    );
};

export default FarmsSection;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix src/clients/mobile-web run test -- FarmsSection`
Expected: PASS (2 tests). If the locale-sort assertion is environment-sensitive, assert set-membership + presence of both names instead of index order.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/profile/components/FarmsSection.tsx src/clients/mobile-web/src/features/profile/components/__tests__/FarmsSection.test.tsx
git commit -m "feat(profile): FarmsSection — family-grouped, name-sorted farm list

spec: multifarm-profile-2026-07-11"
```

---

## Task 4: Render `FarmsSection` inside `SetupHubMenu`

**Files:**
- Modify: `src/clients/mobile-web/src/features/profile/components/SetupHubMenu.tsx`

**Interfaces:**
- Consumes: `FarmsSection` (Task 3).
- Produces (new optional props on `SetupHubMenuProps`):
  - `farms?: import('../../onboarding/qr/inviteApi').MyFarmDto[]`
  - `familyName?: string`
  - `onOpenFarm?: (farmId: string) => void`
  - `onAddFarm?: () => void`
  - `language?: 'mr' | 'en'`

- [ ] **Step 1: Add the props to the interface**

In `SetupHubMenuProps`, after `farmName?: string;` add:

```tsx
    farms?: import('../../onboarding/qr/inviteApi').MyFarmDto[];
    familyName?: string;
    onOpenFarm?: (farmId: string) => void;
    onAddFarm?: () => void;
    language?: 'mr' | 'en';
```

- [ ] **Step 2: Import and render the section**

Add import at top: `import FarmsSection from './FarmsSection';`

Destructure the new props in the component signature, then render `FarmsSection` immediately after the profile-summary `</div>` (before the `शेती सेटअप · Farm setup` GroupLabel), guarded so it only shows when there is ≥1 farm:

```tsx
{farms && farms.length > 0 && onOpenFarm && (
    <FarmsSection
        farms={farms}
        familyName={familyName}
        onOpenFarm={onOpenFarm}
        onAddFarm={onAddFarm}
        language={language ?? 'mr'}
    />
)}
```

- [ ] **Step 3: Typecheck**

Run: `npm --prefix src/clients/mobile-web run typecheck`
Expected: PASS (no errors). New props are optional → existing callers unaffected.

- [ ] **Step 4: Commit**

```bash
git add src/clients/mobile-web/src/features/profile/components/SetupHubMenu.tsx
git commit -m "feat(profile): SetupHubMenu renders the Your-Farms section

spec: multifarm-profile-2026-07-11"
```

---

## Task 5: Wire farm drill-in in `ProfilePage`

**Files:**
- Modify: `src/clients/mobile-web/src/features/profile/ProfilePage.tsx`

**Interfaces:**
- Consumes: `useFarmContext()` (already imported) for `setCurrentFarmId`; `farmAdmin.myMemberships` (the `MyFarmDto[]`); `SetupHubMenu` new props (Task 4).
- Produces: no new exports; internal `handleOpenFarm` that switches farm context and drills in.

- [ ] **Step 1: Confirm the farm-context setter name**

Run: `Grep "setCurrentFarmId\|currentFarmId\|switchFarm" src/clients/mobile-web/src/core/session/FarmContext.tsx`
Expected: find the setter exposed by `useFarmContext()`. Use its exact name below (shown here as `setCurrentFarmId`). If the context exposes a different switch method, use that; do NOT invent one.

- [ ] **Step 2: Add the handler + pass props to SetupHubMenu**

In the component body (near the other `useFarmContext` usage), add:

```tsx
const { currentFarmId: profileFarmId, setCurrentFarmId } = useFarmContext();

const handleOpenFarm = React.useCallback((farmId: string) => {
    setCurrentFarmId?.(farmId);
    const picked = farmAdmin.myMemberships.find(m => m.farmId === farmId);
    if (picked) {
        farmAdmin.setMyFarm({ farmId: picked.farmId, name: picked.name, role: picked.role, subscription: picked.subscription ?? null });
    }
    setActiveTab('identity'); // open the farm's own page (its team + details)
}, [setCurrentFarmId, farmAdmin]);
```

In the `<SetupHubMenu ... />` element (the `!current` branch), add:

```tsx
farms={farmAdmin.myMemberships}
familyName={profile.name ? `${profile.name.split(' ')[0]} कुटुंब` : undefined}
onOpenFarm={handleOpenFarm}
language={language}
```

- [ ] **Step 3: Typecheck + run the profile snapshot tests**

Run: `npm --prefix src/clients/mobile-web run typecheck`
Then: `npm --prefix src/clients/mobile-web run test -- ProfilePage`
Expected: typecheck PASS; snapshot tests either PASS or produce an intentional snapshot diff (the new Your-Farms block). Review the diff; if it reflects the new section correctly, update snapshots with `-u`.

- [ ] **Step 4: Update snapshots if the diff is intended**

Run: `npm --prefix src/clients/mobile-web run test -- ProfilePage -u`
Expected: snapshots rewritten to include the farm list. Eyeball the `.snap` diff before committing.

- [ ] **Step 5: Commit**

```bash
git add src/clients/mobile-web/src/features/profile/ProfilePage.tsx src/clients/mobile-web/src/features/profile/__tests__/__snapshots__/ProfilePage.snapshot.test.tsx.snap src/clients/mobile-web/src/pages/__tests__/__snapshots__/ProfilePage.snapshot.test.tsx.snap
git commit -m "feat(profile): farm drill-in — tap a farm to open its own page

spec: multifarm-profile-2026-07-11"
```

---

## Task 6: Full-suite green + lint + local visual check

**Files:** none (verification task).

- [ ] **Step 1: Run the whole mobile-web suite**

Run: `npm --prefix src/clients/mobile-web run test`
Expected: all tests pass (258 prior + the new ones).

- [ ] **Step 2: Lint at pre-commit strictness**

Run: `npm --prefix src/clients/mobile-web run lint`
Expected: 0 errors, 0 warnings (pre-commit is `--max-warnings 0`).

- [ ] **Step 3: Local visual verification (founder-facing)**

Boot the stack (`npm --prefix src/clients/mobile-web run dev` against backend :5048, login `8888888888`/`Testuser@123`), open Profile: confirm the Your-Farms list renders Purvesh's seeded farm(s), tapping a farm opens its page, and the `← मागे` back returns to the menu. Capture a screenshot for the founder.

- [ ] **Step 4: No commit** (verification only).

---

## Founder Acceptance Gate

BEFORE any deployment step, the founder must verify via these pointers and tick each:

- [ ] Profile opens to the person + a "Your Farms" list (seeded farm visible).
- [ ] Each farm card shows name + 7/12 (farmCode) + tenure tag; tapping opens that farm's page.
- [ ] `← मागे` returns to the menu from every farm/section page.
- [ ] Design matches the approved mockup (soft cards, emerald line-icons, no captions, no emoji besides the avatar).
- [ ] Existing single-farm behaviour (team, weather, boundary, crops) still works under the opened farm.

## Deployment

- [ ] Not applicable until the Founder Acceptance Gate is cleared. Phase 1 is frontend-only; it ships with the next web/APK build via the normal lane — no backend deploy, no migration. Record a `DEPLOYMENT_TRACKER.md` row when it goes live.

---

## Phase 2 (separate plan, only if founder wants stored tenure/7-12)

Additive nullable `Farm.Tenure` + explicit survey field + optional member-type tag; additive non-destructive migration; extends `MyFarmDto`. Out of scope here.

## Self-Review

- **Spec coverage:** person-anchor (Task 5 + existing summary) ✓; farms as separated 7/12 holdings (Tasks 2–4) ✓; family grouping UI-only (Task 3) ✓; name sort (Task 3) ✓; per-farm drill-in to its team/crops (Task 5, reuses existing sections) ✓; tenure/member-type/7-12 graceful labels (Task 1) ✓; no infra change (Change Surface) ✓. Member-type badges on the team list reuse the existing `TeamMemberCard` and are a display-only follow-up within IdentitySection — noted, not a blocker for Phase 1's drill-in.
- **Placeholder scan:** no TBD/TODO; every code step shows code; commands have expected output.
- **Type consistency:** `MyFarmDto`, `Tenure`, `MemberType`, `FarmListCardProps`, `FarmsSectionProps` are used consistently across tasks; `setMyFarm` signature matches `useFarmAdminState`'s `MyFarmSummary`.
