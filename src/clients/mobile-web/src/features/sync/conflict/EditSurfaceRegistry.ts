/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * T-IGH-04-CONFLICT-EDIT — registry mapping a `mutationType` to the input
 * surface that can edit a rejected payload of that type.
 *
 * Why a registry: each mutation type was originally created from a specific
 * input surface (LogPage, ManualEntrySheet, ProcurementPage, …). To reuse
 * the same surface for an edit-and-retry flow we need a one-line lookup
 * from `mutationType` → handler. Adding a new editable mutation type is a
 * one-line `registerEditSurface(...)` call.
 *
 * Why an event bus rather than direct router calls: the navigation layer
 * (`core/navigation/AppRouter.tsx` + the `xstate` navigation actor) is
 * owned by sibling agents on parallel branches. To avoid coupling this
 * file to either implementation, handlers dispatch a custom DOM event
 * (`agrisync:edit-mutation`) carrying the mutation id, type, and seeded
 * payload. The navigation layer can subscribe to that event and route +
 * seed in whatever way it prefers (URL push, actor.send, context
 * setState). Until a real listener is wired, we additionally push a
 * `?route={surface}` query param so the next reload lands on the
 * surface and the user can paste-edit manually — see `useAppNavigation`
 * for the URL → route mapping.
 *
 * Sentinel handler: mutation types without a matching input surface
 * today (e.g., `verify_log_v2`, server-only schedule mutations) fall
 * through to `escalateToOwner` — a Marathi confirm dialog that asks
 * the user to ping the farm owner.
 */
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { SyncMutationType } from '../../../infrastructure/sync/SyncMutationCatalog';

/** Routes that an edit handler may target (subset of AppRoute). */
export type EditSurfaceRoute =
    | 'main'           // LogPage / ManualEntrySheet area
    | 'procurement'
    | 'income'
    | 'finance-ledger'
    | 'finance-price-book'
    | 'schedule'
    | 'profile'
    | 'escalate';      // sentinel — no surface, pop a dialog instead

export interface EditSurfaceContext {
    /** Identifier of the rejected mutation row being edited. */
    readonly mutationId: string;
    /** The original mutation type, useful when a handler covers many. */
    readonly mutationType: string;
    /** Payload exactly as it sat in the queue when rejected. */
    readonly payload: unknown;
}

export type EditSurfaceHandler = (ctx: EditSurfaceContext) => void;

/**
 * Event detail dispatched on `agrisync:edit-mutation`. The navigation
 * layer (any sibling agent's implementation) subscribes to this event
 * to route + seed the input surface.
 */
export interface EditMutationEventDetail extends EditSurfaceContext {
    readonly route: EditSurfaceRoute;
}

export const EDIT_MUTATION_EVENT = 'agrisync:edit-mutation';

const registry = new Map<string, EditSurfaceHandler>();

export function registerEditSurface(
    mutationType: SyncMutationType,
    handler: EditSurfaceHandler,
): void {
    registry.set(mutationType, handler);
}

export function getEditSurface(mutationType: string): EditSurfaceHandler | undefined {
    return registry.get(mutationType);
}

/**
 * Test-only: clear all registrations. Not exported via the public
 * conflict surface; tests import this module directly.
 */
export function _resetEditSurfaceRegistry(): void {
    registry.clear();
    registerDefaultEditSurfaces();
}

function dispatchEditEvent(route: EditSurfaceRoute, ctx: EditSurfaceContext): void {
    if (typeof window === 'undefined') return;
    const detail: EditMutationEventDetail = { ...ctx, route };
    try {
        window.dispatchEvent(new CustomEvent(EDIT_MUTATION_EVENT, { detail }));
    } catch {
        // CustomEvent missing in some test envs — fall through quietly.
    }
}

function pushRouteToUrl(route: EditSurfaceRoute): void {
    if (typeof window === 'undefined') return;
    if (route === 'escalate') return;
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('route', route);
        window.history.pushState({}, '', url.toString());
    } catch {
        // URL/history unavailable — handler still emitted the event above.
    }
}

/**
 * Build a generic handler that dispatches the edit event and nudges the
 * URL toward the target route. The navigation listener is expected to
 * also handle initial-state seeding from `event.detail.payload`.
 */
function makeRouteHandler(route: EditSurfaceRoute): EditSurfaceHandler {
    return (ctx) => {
        dispatchEditEvent(route, ctx);
        pushRouteToUrl(route);
    };
}

/**
 * Sentinel handler used when no input surface exists today. Shows a
 * Marathi confirm dialog asking the user to escalate to the farm owner
 * (typically Akash). The dialog is intentionally simple — `window.alert`
 * works in every browser the mobile-web app ships to and matches the
 * existing low-literacy UX in OfflineConflictPage.
 */
export const escalateToOwner: EditSurfaceHandler = (ctx) => {
    dispatchEditEvent('escalate', ctx);
    if (typeof window === 'undefined') return;
    const message =
        'या नोंदीचा प्रकार स्वतः बदलता येत नाही. कृपया आकाशला सांगा.\n' +
        '(This mutation type cannot be edited from the app — please ask the farm owner / Akash to resolve it.)\n\n' +
        `Mutation: ${ctx.mutationType}\nId: ${ctx.mutationId}`;
    try {
        window.alert(message);
    } catch {
        // alert unavailable — event already dispatched.
    }
};

/**
 * Default registrations — wire each known mutation type to either an
 * input surface or the escalation sentinel. New editable mutation types
 * should be added here in a single line.
 */
function registerDefaultEditSurfaces(): void {
    // LogPage / ManualEntrySheet flows (mainView === 'log').
    registerEditSurface(SyncMutationName.CreateDailyLog, makeRouteHandler('main'));
    registerEditSurface(SyncMutationName.AddLogTask, makeRouteHandler('main'));
    registerEditSurface(SyncMutationName.AddLocation, makeRouteHandler('main'));

    // Procurement flow.
    registerEditSurface(SyncMutationName.AddCostEntry, makeRouteHandler('procurement'));
    registerEditSurface(SyncMutationName.CorrectCostEntry, makeRouteHandler('procurement'));
    registerEditSurface(SyncMutationName.AllocateGlobalExpense, makeRouteHandler('procurement'));

    // Finance settings / price book.
    registerEditSurface(SyncMutationName.SetPriceConfig, makeRouteHandler('finance-price-book'));

    // Profile / farm setup.
    registerEditSurface(SyncMutationName.CreateFarm, makeRouteHandler('profile'));
    registerEditSurface(SyncMutationName.CreatePlot, makeRouteHandler('profile'));
    registerEditSurface(SyncMutationName.CreateCropCycle, makeRouteHandler('profile'));

    // Schedule authoring flows.
    registerEditSurface(SyncMutationName.SchedulePublish, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.ScheduleEdit, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.ScheduleClone, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.PlanAdd, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.PlanOverride, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.PlanRemove, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.AdoptSchedule, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.MigrateSchedule, makeRouteHandler('schedule'));
    registerEditSurface(SyncMutationName.AbandonSchedule, makeRouteHandler('schedule'));

    // Sentinel / escalate-to-owner — types without an input surface today.
    // Verification is captured implicitly during a log-review pass and there
    // is no standalone "edit verification" sheet, so we escalate instead of
    // routing to the log page (which would seed a verification-only payload
    // into a log-creation form).
    registerEditSurface(SyncMutationName.VerifyLog, escalateToOwner);
    registerEditSurface(SyncMutationName.VerifyLogV2, escalateToOwner);
    registerEditSurface(SyncMutationName.CreateAttachment, escalateToOwner);
    registerEditSurface(SyncMutationName.ComplianceAcknowledge, escalateToOwner);
    registerEditSurface(SyncMutationName.ComplianceResolve, escalateToOwner);
    registerEditSurface(SyncMutationName.TestinstanceCollected, escalateToOwner);
    registerEditSurface(SyncMutationName.TestinstanceReported, escalateToOwner);
    registerEditSurface(SyncMutationName.JobcardCreate, escalateToOwner);
    registerEditSurface(SyncMutationName.JobcardAssign, escalateToOwner);
    registerEditSurface(SyncMutationName.JobcardStart, escalateToOwner);
    registerEditSurface(SyncMutationName.JobcardComplete, escalateToOwner);
    registerEditSurface(SyncMutationName.JobcardSettle, escalateToOwner);
    registerEditSurface(SyncMutationName.JobcardCancel, escalateToOwner);
}

registerDefaultEditSurfaces();
