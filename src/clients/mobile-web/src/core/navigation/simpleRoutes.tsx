// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// Small "render-function per route" modules. Each function returns the JSX for
// one route when ctx.currentRoute matches, or null otherwise. AppRouter
// composes them in a fixed order; behavior is byte-for-byte equivalent to the
// pre-decomposition if-cascade.

import React from 'react';
import type { PageView } from '../../types';
import { AppRouterContext } from './routeContext';
import { requestSpeak } from '../speak/speakStore';
import {
    ProfilePage,
    SettingsPage,
    VoiceDiaryPage,
    AdminAiOpsPage,
    AdminOpsPage,
    ReferralsPage,
    OfflineConflictPage,
    SchedulerPage,
    ProcurementPage,
    TestE2EPage,
    HarvestIncomePage,
    FinanceManagerHome,
    LedgerPage,
    PriceBookPage,
    ReviewInboxPage,
    ReportsPage,
    QrDemoPage,
    AttentionPage,
    TestQueuePage,
    TestDetailPage,
    ComplianceSignalsPage,
    ServiceProofPage,
    JobCardsPage,
    JobCardDetailPage,
    WorkerProfilePage,
    LabourFeaturePage,
    PrivacyAndConsentPage,
    ErasureRequestScreen,
    ExportRequestScreen,
    PiiReviewQueuePage,
    AiDraftsPage
} from './lazyComponents';
// Finding F3 — SchedulerPage's "Close Day" destination. See that module's
// header for why this hop is a window event and not a prop path.
import { requestOpenWaitingDrawer } from '../../features/oversight/oversightNavigationEvents';
// Lane FX-1 — the ONE call for the day's हजेरी anchor (the log page's हजेरी card makes the same call).
import { todaysLabourAnchor } from '../../features/logs/components/entry/todayAttendance';
import { buildNoWorkDayPayload } from './noWorkDay';
import { PageBar } from '../../shared/components/ui/placeUi';
import { PlanWorkPage } from '../../features/plannedWork/components/PlanWorkPage';
import { MoneyWithheldPage } from '../../features/finance/components/MoneyWithheldPage';
import { getSessionUserId } from '../../infrastructure/storage/AuthTokenStore';

export const renderProfileRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'profile') return null;
    return (
        <div className="animate-in fade-in slide-in-from-left-4 duration-300">
            <ProfilePage
                profile={ctx.farmerProfile}
                crops={ctx.crops}
                onUpdateProfile={ctx.setFarmerProfile}
                onUpdateCrops={ctx.handleUpdateCrops}
                onOpenScheduleLibrary={(cropId?: string) => {
                    if (typeof window !== 'undefined' && cropId) {
                        window.sessionStorage.setItem('schedule_library_crop_id', cropId);
                    }
                    ctx.setCurrentRoute('schedule');
                }}
                // lane MU-3 — पैसे व हिशोब only for a seat that sees the farm's money (the hub then hides its row).
                onOpenFinanceManager={ctx.maySeeMoney === false ? undefined : () => ctx.setCurrentRoute('finance-manager')}
                onOpenLabour={() => ctx.setCurrentRoute('labour')}
                // spec: plr-d10 (I17, PLR-D9 O4/§6) — Referrals is out of the farmer's hub (it opened a
                // blank English page); export + erase now live inside "गोपनीयता व संमती" (one page).
                onOpenConsent={() => ctx.setCurrentRoute('consent')}
                onOpenQrDemo={() => ctx.setCurrentRoute('qr-demo')}
                onOpenAiDrafts={() => ctx.setCurrentRoute('ai-drafts')}
                onOpenSettings={() => ctx.setCurrentRoute('settings')}
                onOpenVoiceDiary={() => ctx.setCurrentRoute('voiceDiary')}
                onExit={() => ctx.setCurrentRoute('main')}
            />
        </div>
    );
};

export const renderLabourRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'labour') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <LabourFeaturePage
                // spec: plr-d10 (I17, H19) — मागे returns where he came from (the hub, the log page…);
                // the hub only when there is nowhere he came from. It was fixed to the hub.
                // (I12, WP-6): the work home's "आजची हजेरी" door goes back home, the hub row back to the hub.
                onExit={() => ctx.goBackOr('profile')}
                onGoToLog={(opts) => {
                    // Labour V2 R1 Task 3.1 — the labour mic is a VERIFICATION instrument.
                    // No anchor → no mic. This is the door (the hub hero is already drawn
                    // inactive with the approved reason); gating here as well means no future
                    // caller of onGoToLog can walk past the rule. It gates ONLY the recorder:
                    // the labour route, hub and हजेरी वही render regardless (Correction 11).
                    //
                    // Journey fix D4: a day stated by the SERVER's read-out (a Mukadam on
                    // another phone holds no local log) is an anchor too - the hub says so
                    // via `anchoredByServer` when it drew the hero live for exactly that.
                    //
                    // The day checked is the day a capture made NOW is filed under: the
                    // same rule as the record, its marks and the confirm card's anchor
                    // (attendanceCaptureDay). No parse exists yet, so that is today.
                    if (!opts?.anchoredByServer && todaysLabourAnchor(ctx.history ?? []).state !== 'anchored') return;
                    // spec: 2026-07-13-labour-attendance-approval-design (Task 3.4) —
                    // tag the intent BEFORE navigating so mainView can show a
                    // "why am I here" hint on arrival.
                    ctx.setLogIntent('labour');
                    ctx.setCurrentRoute('main');
                }}
                // spec: 2026-07-13-labour-attendance-approval-design (Task 3.5) —
                // history + ledgerDefaults let the hub render a labour-only
                // "just logged" summary via the SAME generateDayWorkSummary
                // the reflect page uses; lastLabourLogIds says WHICH log(s)
                // to show. All three are optional on LabourFeaturePage so
                // the bare `?preview=labour` mount (no router, no ctx) stays
                // crash-free.
                history={ctx.history}
                ledgerDefaults={ctx.ledgerDefaults}
                lastLabourLogIds={ctx.lastLabourLogIds}
                // काम झालं नाही, पण मजूर आले — the rained-out-day door. The marks
                // are ordinary attendance.mark mutations; THIS records the day as
                // a declared no-work day through the same payload and the same
                // handler the main screen's `आज काम नाही` sheet uses.
                //
                // `handleManualSubmit` refuses silently (`'not_saved'`) while no
                // log scope is selected, and the Labour route is reachable
                // without one. So when the lane opens with NO scope we select
                // the entire farm (a rest day is a farm-wide fact); a scope the
                // farmer already chose is left alone, exactly as the main
                // screen's sheet would use it. The save is only reported as
                // done when the handler says it was.
                onBeginNoWorkLane={() => {
                    if (!ctx.hasActiveLogContext) {
                        ctx.setLogScope({ selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' });
                    }
                }}
                onDeclareNoWorkDay={async (cause) => {
                    const outcome = await ctx.handleManualSubmit(buildNoWorkDayPayload(ctx.todayDateKey, cause));
                    // The manual-save path parks the main log screen on its
                    // "Saved to Ledger" panel; we are not on that screen, and
                    // leaving it armed would greet the farmer with it later.
                    ctx.setStatus('idle');
                    return outcome === 'saved' || outcome === 'saved_with_warning';
                }}
            />
        </div>
    );
};

export const renderSettingsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'settings') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <SettingsPage defaults={ctx.ledgerDefaults} onUpdateDefaults={ctx.setLedgerDefaults} crops={ctx.crops} />
        </div>
    );
};

// spec: voice-diary-e2e-2026-05-17 (D.18) — V1 voice-journal RENAMED to voiceDiary (camelCase).
// spec: plr-d10 (I17, PLR-D9 O8) — "keep my recordings" now sits on this page itself, so the leftover
// Settings page is no longer a farmer's door (its route stays for deep links and the DEV tools).
export const renderVoiceDiaryRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'voiceDiary') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <VoiceDiaryPage
                onBack={() => ctx.goBackOr('profile')}
                // Lane OF (founder D-59) — an understood recording is checked and saved here, through the voice save.
                waiting={ctx.saveCheckedDraft ? {
                    crops: ctx.crops,
                    profile: ctx.farmerProfile,
                    history: ctx.history,
                    save: ctx.saveCheckedDraft,
                    returnTo: { route: 'voiceDiary', mainView: ctx.mainView },
                    farmId: ctx.activeFarmId, // fix 1 (M5): a recording of another farm is never saved into this one

                    toast: (message, type) => window.dispatchEvent(new CustomEvent('agrisync:toast', { detail: { message, type } })), // fix 2 (N4): a failure is a failure
                } : undefined}
            />
        </div>
    );
};

export const renderAiAdminRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'ai-admin') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <AdminAiOpsPage onBack={() => ctx.goBackOr('settings')} />
        </div>
    );
};

export const renderOpsAdminRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'ops-admin') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <AdminOpsPage onBack={() => ctx.goBackOr('settings')} />
        </div>
    );
};

// spec: plr-d10 (I17, PLR-D9 O4) — no longer a hub row; the route stays for a deep link, and it is
// no longer a dead end: one title bar with मागे (the page itself was blank behind no back).
export const renderReferralsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'referrals') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <PageBar title="रेफरल्स" onBack={() => ctx.goBackOr('profile')} />
            <ReferralsPage />
        </div>
    );
};

export const renderOfflineConflictsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'offline-conflicts') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <OfflineConflictPage onBack={() => ctx.goBackOr('main')} />
        </div>
    );
};

// Lane L8c-2 (founder D-24, D-26, P5) - the plan section. A planner (the primary owner, or a holder of PlanWork or AssignWork, as the
// server answers it) gets the form and the list; everyone else gets the work handed to him. The conflict page is where a parked step
// is retried or discarded.
export const renderPlanWorkRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'plan-work') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <PlanWorkPage
                farmId={ctx.activeFarmId}
                userId={ctx.meUserId ?? null}
                crops={ctx.crops}
                farmerProfile={ctx.farmerProfile}
                mayPlan={ctx.mayOpenPlanner ?? false}
                mayAssign={ctx.mayAssignWork ?? false}
                onBack={() => ctx.goBackOr('main')}
                onOpenConflicts={() => ctx.setCurrentRoute('offline-conflicts')}
            />
        </div>
    );
};

export const renderScheduleRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'schedule') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <SchedulerPage
                crops={ctx.crops}
                logs={ctx.history}
                tasks={ctx.plannedTasks}
                onUpdateCrops={ctx.handleUpdateCrops}
                userResources={ctx.userResources}
                onAddResource={(resource) => ctx.setUserResources(prev => [...prev, resource])}
                onOpenTaskCreator={() => ctx.setShowTaskCreationSheet(true)}
                // FINDING F3 — this button used to route to the log screen
                // and set `showCloseDaySummary`, a flag whose only readers
                // commit `0e4ad118` deleted: it navigated and then did
                // nothing. Spec §4.2 moved the whole Daily Closure card into
                // the waiting drawer, so that is where "Close Day" goes now.
                // It stays ON this page (an overlay, not a route change —
                // `OversightOverlay.tsx`), so the scheduler underneath is
                // never unmounted and there is nothing to navigate back
                // from.
                onCloseDay={() => requestOpenWaitingDrawer()}
                // spec: plr-d10 (I15) — the redesigned शेड्यूल has one page bar with one big "← मागे".
                onBack={() => ctx.goBackOr('main')}
            />
        </div>
    );
};

export const renderProcurementRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'procurement') return null;
    // spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — the redesigned खरेदी: one मागे,
    // "बोलून सांगा / हाताने लिहा" open THE ONE mic (lane MIC-1: he picks the crop and plot there, may type in its
    // "बोलता येत नसेल तर इथे लिहा" sheet, and lands back here), and a row into पैसे व हिशोब.
    return (
        <ProcurementPage
            crops={ctx.crops}
            onBack={() => ctx.goBackOr('main')}
            onTell={() => { requestSpeak({ purpose: 'addToDay', returnTo: { route: 'procurement', mainView: ctx.mainView } }); }}
            onGo={(route) => ctx.setCurrentRoute(route)}
        />
    );
};

export const renderTestE2ERoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'test-e2e' || !TestE2EPage) return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <TestE2EPage />
        </div>
    );
};

export const renderIncomeRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'income') return null;
    return (
        <HarvestIncomePage
            context={ctx.currentLogContext}
            crops={ctx.crops}
            onBack={() => ctx.goBackOr('main')}
            onGo={(route) => ctx.setCurrentRoute(route)}
        />
    );
};

export const renderFinanceManagerRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-manager') return null;
    if (ctx.maySeeMoney === false) return <MoneyWithheldPage onBack={() => ctx.goBackOr('main')} />; // lane MU-3
    return (
        <FinanceManagerHome
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
            onBack={() => ctx.goBackOr('main')}
        />
    );
};

export const renderFinanceLedgerRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-ledger') return null;
    if (ctx.maySeeMoney === false) return <MoneyWithheldPage onBack={() => ctx.goBackOr('main')} />; // lane MU-3
    return (
        <LedgerPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
            onBack={() => ctx.goBackOr('finance-manager')}
            isPrimaryHolder={ctx.farmRole === 'PrimaryOwner'}
            selfUserId={getSessionUserId()}
        />
    );
};

export const renderFinancePriceBookRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-price-book') return null;
    if (ctx.maySeeMoney === false) return <MoneyWithheldPage onBack={() => ctx.goBackOr('main')} />; // lane MU-3
    return (
        <PriceBookPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
            onBack={() => ctx.goBackOr('finance-manager')}
            // lane RATE-1 part A (D-72) — the farm's OWN list: which farm, who he is, and the names of who set each rate.
            farmId={ctx.activeFarmId}
            isPrimaryHolder={ctx.farmRole === 'PrimaryOwner'}
            selfUserId={getSessionUserId()}
            operatorNameById={ctx.operatorNameById}
        />
    );
};

export const renderFinanceReviewInboxRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-review-inbox') return null;
    if (ctx.maySeeMoney === false) return <MoneyWithheldPage onBack={() => ctx.goBackOr('main')} />; // lane MU-3
    return (
        <ReviewInboxPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
            onBack={() => ctx.goBackOr('finance-manager')}
        />
    );
};

export const renderFinanceReportsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-reports') return null;
    if (ctx.maySeeMoney === false) return <MoneyWithheldPage onBack={() => ctx.goBackOr('main')} />; // lane MU-3
    return (
        <ReportsPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
            onBack={() => ctx.goBackOr('finance-manager')}
        />
    );
};

export const renderQrDemoRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'qr-demo') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <QrDemoPage onBack={() => ctx.goBackOr('profile')} />
        </div>
    );
};

// spec: plr-d10 (I14 — H14, H15 / T3, H16) — लक्ष द्या: one "← मागे" (back where he came from); each card's
// button opens where it can be done (`features/attention/attentionActions.ts`); late to-dos from the SAME
// task store as करायची कामे, so a tick on either page clears both.
export const renderAttentionRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'attention') return null;
    const openView = (view: PageView) => { ctx.setMainView(view); ctx.setCurrentRoute('main'); };
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <AttentionPage
                onBack={() => ctx.goBackOr('main')}
                hiddenViews={ctx.hiddenViews}
                onGo={(target) => {
                    if (target.kind === 'view') {
                        // "तुकडा पहा": the overview opens narrowed to that plot (read once by ReflectPage).
                        if (target.view === 'reflect' && target.plotId) ctx.setReflectFocusPlotId?.(target.plotId);
                        openView(target.view);
                    } else if (target.kind === 'tests') ctx.setCurrentRoute('tests');
                    else if (target.kind === 'route') ctx.setCurrentRoute(target.route);
                }}
                tasks={ctx.plannedTasks}
                crops={ctx.crops}
                onUpdateTask={(task) => ctx.handleUpdateTask(task.id, task)}
                onOpenTodos={() => openView('reflect')}
                // spec: plr-d10 (I22, D-1) — "काम नोंदवा": lane MIC-1 — THE ONE mic on that step's plot (no pickers), and
                // back to लक्ष द्या after; a waiting draft is never moved (`speakFlow.startDecision`). A plot this phone does
                // not hold opens the mic with the crop → plot choice. Opening it clears nothing on लक्ष द्या.
                onRecordWork={(step) => {
                    const crop = ctx.crops.find(c => (c.plots ?? []).some(p => p.id === step.plotId));
                    requestSpeak({
                        purpose: 'attention',
                        context: crop ? { place: { cropId: crop.id, plotId: step.plotId } } : {},
                        returnTo: { route: 'attention', mainView: ctx.mainView },
                    });
                }}
                // "पुढे ठरवा" — lane L8b-1 (founder D-73): whoever holds "कामाचं नियोजन करणे" (PlanWork) on this farm, as
                // the server answers it — the primary owner always; a मुकादम or सहमालक only when the owner gave it. The
                // server's ScheduleChangeGate asks the same authority on the move itself.
                canReschedule={ctx.mayPlanWork ?? ctx.farmRole === 'PrimaryOwner'}
            />
        </div>
    );
};

export const renderTestsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'tests') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            {/* spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — one मागे, and "सांगा" opens THE ONE mic
                (lane MIC-1: crop → plot there, then back here). */}
            <TestQueuePage
                onNavigate={ctx.setCurrentRoute}
                onBack={() => ctx.goBackOr('main')}
                onTell={() => { requestSpeak({ purpose: 'addToDay', returnTo: { route: 'tests', mainView: ctx.mainView } }); }}
            />
        </div>
    );
};

export const renderTestDetailRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'test-detail') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <TestDetailPage
                testInstanceId={(() => {
                    if (typeof window === 'undefined') return '';
                    const match = window.location.pathname.match(/\/tests\/([^/?#]+)/);
                    return match?.[1] ?? '';
                })()}
                onBack={() => ctx.goBackOr('tests')}
                // lane L8b-1 fix round 1 (L1; D-73) — "योजनेत घाला" follows PlanWork, as "पुढे ठरवा" does.
                mayPlanWork={ctx.mayPlanWork ?? ctx.farmRole === 'PrimaryOwner'}
            />
        </div>
    );
};

// CEI Phase 3 — compliance signals page
export const renderComplianceRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'compliance') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <ComplianceSignalsPage
                onNavigate={ctx.setCurrentRoute}
                onBack={() => ctx.goBackOr('attention')}
            />
        </div>
    );
};

// CEI Phase 3 — service proof export page (§23.2)
export const renderServiceProofRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'service-proof') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <ServiceProofPage
                onNavigate={ctx.setCurrentRoute}
                onBack={() => ctx.goBackOr('finance-reports')}
            />
        </div>
    );
};

// CEI Phase 4 §4.8 — Job Cards list
export const renderJobsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'jobs') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <JobCardsPage
                onNavigateToDetail={(jobCardId) => {
                    if (typeof window !== 'undefined') {
                        window.sessionStorage.setItem('job_card_id', jobCardId);
                    }
                    ctx.setCurrentRoute('job-detail');
                }}
            />
        </div>
    );
};

// CEI Phase 4 §4.8 — Job Card detail
export const renderJobDetailRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'job-detail') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <JobCardDetailPage
                jobCardId={(() => {
                    if (typeof window === 'undefined') return '';
                    return window.sessionStorage.getItem('job_card_id') ?? '';
                })()}
                onBack={() => ctx.goBackOr('jobs')}
                onNavigateToLedger={() => ctx.setCurrentRoute('finance-ledger')}
                onNavigateToWorker={(userId) => {
                    if (typeof window !== 'undefined') {
                        window.sessionStorage.setItem('worker_profile_user_id', userId);
                    }
                    ctx.setCurrentRoute('worker-profile');
                }}
            />
        </div>
    );
};

// spec: data-principle-spine-2026-05-05/06.4 — Consent settings screen. plr-d10 (I17, PLR-D9 §6 line
// 106): ONE "गोपनीयता व संमती" place — the three consents, a copy of my data, and erase with its confirm.
export const renderConsentRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'consent') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <PrivacyAndConsentPage onBack={() => ctx.goBackOr('profile')} />
        </div>
    );
};

// spec: data-principle-spine-2026-05-05/08.6 — DPDP §12 self-serve erasure.
export const renderErasureRequestRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'dataRights/erasure') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <ErasureRequestScreen onBack={() => ctx.goBackOr('profile')} />
        </div>
    );
};

// spec: data-principle-spine-2026-05-05/08.6 — DPDP §11 self-serve export.
export const renderExportRequestRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'dataRights/export') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <ExportRequestScreen onBack={() => ctx.goBackOr('profile')} />
        </div>
    );
};

// spec: data-principle-spine-2026-05-05/10.4 — admin PII review queue.
export const renderPiiReviewRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'piiReview') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <PiiReviewQueuePage />
        </div>
    );
};

// spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — offline
// voice-note drafts (pendingAiJobs.result) waiting for the farmer to confirm
// or discard them into a log.
export const renderAiDraftsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'ai-drafts') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <AiDraftsPage onBack={() => ctx.goBackOr('profile')} />
        </div>
    );
};

// CEI Phase 4 §4.8 — Worker profile
export const renderWorkerProfileRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'worker-profile') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <WorkerProfilePage
                userId={(() => {
                    if (typeof window === 'undefined') return '';
                    return window.sessionStorage.getItem('worker_profile_user_id') ?? '';
                })()}
                onBack={() => ctx.goBackOr('jobs')}
                onNavigateToJobCard={(jobCardId) => {
                    if (typeof window !== 'undefined') {
                        window.sessionStorage.setItem('job_card_id', jobCardId);
                    }
                    ctx.setCurrentRoute('job-detail');
                }}
            />
        </div>
    );
};

/**
 * Ordered list of all simple-route render functions. AppRouter renders them
 * inline; each returns null when its route doesn't match. Order matches the
 * pre-decomposition if-cascade in AppRouter.tsx for byte-for-byte equivalence.
 */
export const SIMPLE_ROUTE_RENDERERS: Array<(ctx: AppRouterContext) => React.ReactNode> = [
    renderProfileRoute,
    renderSettingsRoute,
    renderVoiceDiaryRoute,
    renderAiAdminRoute,
    renderOpsAdminRoute,
    renderReferralsRoute,
    renderOfflineConflictsRoute,
    renderPlanWorkRoute,
    renderScheduleRoute,
    renderProcurementRoute,
    renderTestE2ERoute,
    renderIncomeRoute,
    renderFinanceManagerRoute,
    renderFinanceLedgerRoute,
    renderFinancePriceBookRoute,
    renderFinanceReviewInboxRoute,
    renderFinanceReportsRoute,
    renderQrDemoRoute,
    renderAttentionRoute,
    renderTestsRoute,
    renderTestDetailRoute,
    renderComplianceRoute,
    renderServiceProofRoute,
    renderJobsRoute,
    renderJobDetailRoute,
    renderWorkerProfileRoute,
    renderLabourRoute,
    renderConsentRoute,
    renderErasureRequestRoute,
    renderExportRequestRoute,
    renderPiiReviewRoute,
    renderAiDraftsRoute
];

/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H20) — every simple route, rendered in order.
 * When `resetKey` moves (he tapped the bottom-bar item or सेट-अप केंद्र he is already in), the place is
 * remounted, so it opens at its FIRST screen: a setup page, the language page or the schedule editor
 * kept in a page's own state is closed. Before, that tap did nothing at all.
 */
export const SimpleRoutes: React.FC<{ ctx: AppRouterContext; resetKey: number }> = ({ ctx, resetKey }) => (
    <React.Fragment key={resetKey}>
        {SIMPLE_ROUTE_RENDERERS.map((render, idx) => (
            <React.Fragment key={idx}>{render(ctx)}</React.Fragment>
        ))}
    </React.Fragment>
);
