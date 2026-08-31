import {
  AlertTriangle,
  Calendar,
  Frown,
  HeartPulse,
  Home as HomeIcon,
  Mic,
  Settings as SettingsIcon,
  Star,
  TrendingDown,
  Users as UsersIcon,
  Wheat,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { ModuleKeys, type ModuleKey } from '@/lib/moduleKeys';

/**
 * ONE LIST OF DESTINATIONS. The sidebar and the command palette read it.
 *
 * ── Why this file exists, and it is not tidiness ──────────────────────────
 * There were two hardcoded destination lists: `AdminShell`'s twelve-item NAV
 * and `CommandPalette`'s eleven-item COMMANDS. Nothing tied them together, so
 * they drifted — and the drift was not theoretical. **Farmer Health was in
 * the sidebar and absent from the palette** (`CommandPalette.tsx:7-19`,
 * verified 2026-08-31 before this task: eleven entries, no farmer-health). An
 * operator who navigates by keyboard could not reach the screen the whole DWC
 * feature was built for, and no screenshot of either surface shows it.
 *
 * The prototype has the same shape and gets it right for the same reason: its
 * palette builds from `data.nav` rather than from a second literal
 * (`app.js:717-721`).
 *
 * Two call sites is normally below the Rule of Three, and normally the
 * duplication would stand. It does not here because the two copies are not
 * merely similar — they are two statements of the SAME fact ("these are the
 * screens this console has"), and one of them was already false.
 *
 * ── What each field is for ────────────────────────────────────────────────
 * `module` is the NEW field and it is the palette's whole reason to read this
 * file rather than keep its own list. It is the module key the route is
 * guarded by in `App.tsx`, or `null` for the three routes that are
 * deliberately ungated (Preservation Register A4). The palette filters every
 * entry through `canRead(module)` so it stops offering destinations that
 * bounce the reader straight to `/403`.
 *
 * `null` here means "no guard", NOT "no permission needed to be useful". The
 * three nulls are `/`, `/schedules/templates` and `/settings/admins`, and
 * each is ungated because no ModuleKey exists that would let anyone back in —
 * see the comments beside them in `App.tsx`.
 *
 * ⚠️ This map must agree with the `EntitlementGuard` actually declared on each
 * route. It is not imported from `App.tsx` (a route table is JSX, not data),
 * so the agreement is asserted instead: `CommandPalette.test.tsx` walks the
 * real route tree and compares. A key changed in one place and not the other
 * turns the test red rather than turning a palette entry into a `/403`.
 */

/**
 * Six groups, not five. CONTRACT.md §2 confirms it and says why: WVFD is
 * alone in Product because it is neither an Operations item nor a Farms item.
 *
 * ONE difference from the prototype, kept deliberately: v3 files Live Health
 * under Overview, the live console files it under Operations. Moving it is a
 * visible change to the founder's navigation with no instruction behind it,
 * so the console's own grouping wins — machinery beats mockup, and where the
 * mockup is merely different rather than better, so does the incumbent.
 */
export const GROUP_ORDER = [
  'Overview',
  'Operations',
  'Product',
  'Farms',
  'Schedules',
  'Admin',
] as const;

export type NavGroup = (typeof GROUP_ORDER)[number];

export interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  /**
   * KEEP THIS, EVEN THOUGH NOTHING SETS IT (Preservation Register A53).
   *
   * It renders nothing today, so it appears in no screenshot, so a port
   * driven by screenshots removes it as dead code — and then someone
   * "invents" it later as a new feature. It is the natural home for a live
   * alert or suffering count, which the v3 Home screen already computes.
   * The pill in `AdminShell` is the whole of the slot; populating it is a
   * screen's job.
   */
  badge?: number;
  group: NavGroup;
  /** The route's `EntitlementGuard` module key, or `null` when ungated (A4). */
  module: ModuleKey | null;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Home', Icon: HomeIcon, group: 'Overview', module: null },
  { to: '/ops/live', label: 'Live Health', Icon: Zap, group: 'Operations', module: ModuleKeys.OpsLive },
  { to: '/ops/errors', label: 'API Errors', Icon: AlertTriangle, group: 'Operations', module: ModuleKeys.OpsErrors },
  { to: '/ops/voice', label: 'Voice Pipeline', Icon: Mic, group: 'Operations', module: ModuleKeys.OpsVoice },
  { to: '/metrics/nsm', label: 'WVFD', Icon: Star, group: 'Product', module: ModuleKeys.MetricsNsm },
  { to: '/farms', label: 'All Farms', Icon: Wheat, group: 'Farms', module: ModuleKeys.FarmsList },
  { to: '/farms/silent-churn', label: 'Silent Churn', Icon: TrendingDown, group: 'Farms', module: ModuleKeys.FarmsSilentChurn },
  { to: '/farms/suffering', label: 'Suffering', Icon: Frown, group: 'Farms', module: ModuleKeys.FarmsSuffering },
  { to: '/farmer-health', label: 'Farmer Health', Icon: HeartPulse, group: 'Farms', module: ModuleKeys.FarmerHealth },
  { to: '/schedules/templates', label: 'Templates', Icon: Calendar, group: 'Schedules', module: null },
  { to: '/users', label: 'Users', Icon: UsersIcon, group: 'Admin', module: ModuleKeys.AdminUsers },
  { to: '/settings/admins', label: 'Settings', Icon: SettingsIcon, group: 'Admin', module: null },
];

/**
 * `/farmer-health/:farmId` — the per-farm drilldown (A22).
 *
 * It is a destination the palette can reach and the sidebar cannot, because
 * it needs a farm id and the sidebar has no farm in hand. Gated on the same
 * key as the landing page it drills out of, which is what `App.tsx` declares
 * and what `routes.contract.test.ts` already pins.
 */
export const DRILLDOWN_PATH = '/farmer-health';
export const DRILLDOWN_MODULE: ModuleKey = ModuleKeys.FarmerHealth;
