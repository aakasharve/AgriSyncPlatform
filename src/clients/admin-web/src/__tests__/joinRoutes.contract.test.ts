import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '@/App';
import { NAV } from '@/app/nav';
import { EntitlementGuard } from '@/components/EntitlementGuard';
import { ModuleKeys } from '@/lib/moduleKeys';

/**
 * spec: company-mis-real-numbers-2026-11-15 (plan CR-2d, Review Focus 1, Task 3 Steps 2-3, D3).
 * Written by the test-writer from the plan and each lane's own route table.
 *
 * THE JOIN MUST NOT SILENTLY DROP ONE SIDE. Two lanes changed `App.tsx`; a merge that keeps one
 * side's file loses the other side's routes and still builds. So the expected list below is NOT
 * read from the joined `App.tsx`: it is written out here, lane by lane, from each lane's own route
 * table at the head the plan names, and the joined route table is checked against it.
 *
 * D3's rule: the union of the lanes' route tables, minus the routes the pages lane deleted.
 */

/** Pages lane `task/plr-d10-cr2b-mis-pages` at 0efebfbd, `src/App.tsx` (the September console). */
const PAGES_LANE_0EFEBFBD = [
  '/login', '/403',
  '/', '/home',
  '/ops/live', '/ops/errors',
  '/metrics/nsm',
  '/farms', '/farms/silent-churn', '/farms/suffering',
  '/farmer-health', '/farmer-health/:farmId',
  '/users',
  '/MIS/overview', '/MIS/acquisition', '/MIS/engagement', '/MIS/retention',
  '/MIS/quality', '/MIS/farms', '/MIS/operations', '/MIS',
  '/schedules/templates', '/settings/admins',
  '*',
];

/** CR-2c pages lane `task/plr-d10-cr2c-mis-additions-web` at 01d9775d: the same table, no route added. */
const CR2C_PAGES_01D9775D = [...PAGES_LANE_0EFEBFBD];

/** SMS sign-in `fix/admin-sms-code-sign-in` at f1a69077 (PR 95), `src/App.tsx`. */
const SMS_BRANCH_F1A69077 = [
  '/login', '/403',
  '/',
  '/ops/live', '/ops/errors', '/ops/voice',
  '/metrics/nsm',
  '/farms', '/farms/silent-churn', '/farms/suffering',
  '/farmer-health', '/farmer-health/:farmId',
  '/users',
  '/schedules/templates', '/settings/admins',
  '*',
];

/** Port 1 (Task 3 Step 1): the app-versions route of the recording lane `task/plr-d10-cr1a-errors` at fd535129. */
const PORT_APP_VERSIONS = ['/ops/app-versions'];

/** Port 2 (Task 3 Step 2): the schedule-check route of the go-live line `task/pre-launch-repair-d10-redesign`. */
const PORT_SCHEDULE_CHECK = ['/schedules/check'];

/**
 * Routes the pages lane DELETED, which stay deleted (D3). `/ops/voice`: commit 74ccdf96 (B24,
 * founder 2026-11-17), the Voice Pipeline page is a double of Company MIS Quality.
 */
const PAGES_LANE_DELETIONS = ['/ops/voice'];

/** CR-3 Task A7: the founder's People and access page and its History (inside `FounderOnly`). */
const CR3_PEOPLE = ['/people', '/people/history'];

const EXPECTED = [
  ...new Set([
    ...PAGES_LANE_0EFEBFBD,
    ...CR2C_PAGES_01D9775D,
    ...SMS_BRANCH_F1A69077,
    ...PORT_APP_VERSIONS,
    ...PORT_SCHEDULE_CHECK,
    ...CR3_PEOPLE,
  ]),
].filter((path) => !PAGES_LANE_DELETIONS.includes(path));

/* ── the joined route table, read as data (the same walk routes.contract.test.ts uses) ── */

interface ElementProps {
  children?: ReactNode;
  element?: ReactNode;
  path?: string;
  module?: string;
}

const propsOf = (element: ReactElement) => element.props as ElementProps;

function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const element = node as ReactElement;
  out.push(element);
  const props = propsOf(element);
  if (props.children !== undefined) flatten(props.children, out);
  if (props.element !== undefined) flatten(props.element, out);
  return out;
}

const routeElements = flatten(App() as ReactElement).filter((e) => e.type === Route);
const declared = routeElements
  .map((r) => propsOf(r).path)
  .filter((path): path is string => typeof path === 'string');

function guardOf(path: string): string | null {
  const route = routeElements.find((r) => propsOf(r).path === path);
  const guard = route ? flatten(propsOf(route).element).find((e) => e.type === EntitlementGuard) : undefined;
  return guard ? (propsOf(guard).module ?? null) : null;
}

/** The paths inside the signed-in shell (the one Route with children and no path). */
function insideShell(): string[] {
  const shell = routeElements.find((r) => propsOf(r).path === undefined);
  return flatten(propsOf(shell as ReactElement).children)
    .filter((e) => e.type === Route)
    .map((e) => propsOf(e).path)
    .filter((path): path is string => typeof path === 'string');
}

describe('the join keeps every route of every lane (plan CR-2d Review Focus 1, D3)', () => {
  it('Every_route_of_every_lane_is_registered', () => {
    const missing = EXPECTED.filter((path) => !declared.includes(path));
    const unexpected = declared.filter((path) => !EXPECTED.includes(path));

    expect(missing, `routes a lane has that the join dropped: ${missing.join(', ')}`).toEqual([]);
    expect(unexpected, `routes no lane declares: ${unexpected.join(', ')}`).toEqual([]);
    // Each route once: a path declared twice means one of the two elements is unreachable.
    expect(declared.length, 'a path is declared twice').toBe(new Set(declared).size);
    // The pages lane's deletion is not brought back by the SMS branch's older table.
    for (const gone of PAGES_LANE_DELETIONS) expect(declared).not.toContain(gone);
    expect(declared).toHaveLength(28);
  });

  it('People_pages_are_routed_inside_the_shell_and_in_the_menu_for_the_founder_only', () => {
    expect(insideShell()).toEqual(expect.arrayContaining(['/people', '/people/history']));
    const entry = NAV.find((item) => item.to === '/people');
    expect(entry?.label).toBe('People and access');
    expect(entry?.group).toBe('Admin');
    expect(entry?.founderOnly).toBe(true);
    expect(entry?.module).toBeNull();
    // "Settings" is "My access" now, at the same address, for everyone.
    const mine = NAV.find((item) => item.to === '/settings/admins');
    expect(mine?.label).toBe('My access');
    expect(mine?.founderOnly).toBeUndefined();
  });

  it('Templates_is_guarded_by_the_schedules_tick', () => {
    // K28: an FPO seat has no schedules tick (`schedules.review` is the founder's and a ticked team
    // seat's), so it is refused here. Before CR-3 the route was ungated and FPO seats opened it.
    expect(guardOf('/schedules/templates')).toBe(ModuleKeys.ScheduleReview);
    const entry = NAV.find((item) => item.to === '/schedules/templates');
    expect(entry?.module).toBe(ModuleKeys.ScheduleReview);
  });

  it('Schedule_check_page_is_routed', () => {
    // As on the go-live line: inside the signed-in shell, behind its own module key, and with no
    // menu entry (D3: it has none on the go-live line; the templates page links to it).
    expect(declared).toContain('/schedules/check');
    expect(insideShell()).toContain('/schedules/check');
    expect(guardOf('/schedules/check')).toBe(ModuleKeys.ScheduleReview);
    expect(NAV.map((item) => item.to)).not.toContain('/schedules/check');
  });

  it('routes the app-versions page under Operations, on the key the server route checks', () => {
    // Task 3 Step 1: routed and in the menu of the September shell under Operations. The recording
    // lane gated it on ops.live (fd535129), the key its server route checks.
    expect(insideShell()).toContain('/ops/app-versions');
    expect(guardOf('/ops/app-versions')).toBe(ModuleKeys.OpsLive);
    const entry = NAV.find((item) => item.to === '/ops/app-versions');
    expect(entry?.group).toBe('Operations');
    expect(entry?.module).toBe(ModuleKeys.OpsLive);
  });
});
