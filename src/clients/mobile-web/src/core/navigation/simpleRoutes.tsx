// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// Small "render-function per route" modules. Each function returns the JSX for
// one route when ctx.currentRoute matches, or null otherwise. AppRouter
// composes them in a fixed order; behavior is byte-for-byte equivalent to the
// pre-decomposition if-cascade.

import React from 'react';
import { AppRouterContext } from './routeContext';
import {
    ProfilePage,
    SettingsPage,
    VoiceJournalPage,
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
    FinanceSettingsPage,
    QrDemoPage,
    AttentionPage,
    TestQueuePage,
    TestDetailPage,
    ComplianceSignalsPage,
    ServiceProofPage,
    JobCardsPage,
    JobCardDetailPage,
    WorkerProfilePage
} from './lazyComponents';

export const renderProfileRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'profile') return null;
    return (
        <div className="animate-in fade-in slide-in-from-left-4 duration-300">
            <ProfilePage
                profile={ctx.farmerProfile}
                crops={ctx.crops}
                onUpdateProfile={ctx.setFarmerProfile}
                onUpdateCrops={ctx.handleUpdateCrops}
                onAddPerson={ctx.handleAddPerson}
                onDeletePerson={ctx.handleDeletePerson}
                onOpenScheduleLibrary={(cropId?: string) => {
                    if (typeof window !== 'undefined' && cropId) {
                        window.sessionStorage.setItem('schedule_library_crop_id', cropId);
                    }
                    ctx.setCurrentRoute('schedule');
                }}
                onOpenFinanceManager={() => ctx.setCurrentRoute('finance-manager')}
                onOpenReferrals={() => ctx.setCurrentRoute('referrals')}
                onOpenQrDemo={() => ctx.setCurrentRoute('qr-demo')}
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

export const renderVoiceJournalRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'voice-journal') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <VoiceJournalPage onBack={() => ctx.setCurrentRoute('settings')} />
        </div>
    );
};

export const renderAiAdminRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'ai-admin') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <AdminAiOpsPage onBack={() => ctx.setCurrentRoute('settings')} />
        </div>
    );
};

export const renderOpsAdminRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'ops-admin') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <AdminOpsPage onBack={() => ctx.setCurrentRoute('settings')} />
        </div>
    );
};

export const renderReferralsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'referrals') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <ReferralsPage />
        </div>
    );
};

export const renderOfflineConflictsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'offline-conflicts') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <OfflineConflictPage onBack={() => ctx.setCurrentRoute('main')} />
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
                onCloseDay={() => {
                    ctx.setCurrentRoute('main');
                    ctx.setMainView('log');
                    ctx.setShowCloseDaySummary(true);
                }}
            />
        </div>
    );
};

export const renderProcurementRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'procurement') return null;
    return <ProcurementPage crops={ctx.crops} />;
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
            onBack={() => ctx.setCurrentRoute('main')}
        />
    );
};

export const renderFinanceManagerRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-manager') return null;
    return (
        <FinanceManagerHome
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
        />
    );
};

export const renderFinanceLedgerRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-ledger') return null;
    return (
        <LedgerPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
        />
    );
};

export const renderFinancePriceBookRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-price-book') return null;
    return (
        <PriceBookPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
        />
    );
};

export const renderFinanceReviewInboxRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-review-inbox') return null;
    return (
        <ReviewInboxPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
        />
    );
};

export const renderFinanceReportsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-reports') return null;
    return (
        <ReportsPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
        />
    );
};

export const renderFinanceSettingsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'finance-settings') return null;
    return (
        <FinanceSettingsPage
            currentRoute={ctx.currentRoute}
            onNavigate={ctx.setCurrentRoute}
        />
    );
};

export const renderQrDemoRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'qr-demo') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <QrDemoPage onBack={() => ctx.setCurrentRoute('profile')} />
        </div>
    );
};

export const renderAttentionRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'attention') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <AttentionPage />
        </div>
    );
};

export const renderTestsRoute = (ctx: AppRouterContext): React.ReactNode => {
    if (ctx.currentRoute !== 'tests') return null;
    return (
        <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <TestQueuePage onNavigate={ctx.setCurrentRoute} />
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
                onBack={() => ctx.setCurrentRoute('tests')}
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
                onBack={() => ctx.setCurrentRoute('attention')}
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
                onBack={() => ctx.setCurrentRoute('finance-reports')}
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
                onBack={() => ctx.setCurrentRoute('jobs')}
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
                onBack={() => ctx.setCurrentRoute('jobs')}
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
    renderVoiceJournalRoute,
    renderAiAdminRoute,
    renderOpsAdminRoute,
    renderReferralsRoute,
    renderOfflineConflictsRoute,
    renderScheduleRoute,
    renderProcurementRoute,
    renderTestE2ERoute,
    renderIncomeRoute,
    renderFinanceManagerRoute,
    renderFinanceLedgerRoute,
    renderFinancePriceBookRoute,
    renderFinanceReviewInboxRoute,
    renderFinanceReportsRoute,
    renderFinanceSettingsRoute,
    renderQrDemoRoute,
    renderAttentionRoute,
    renderTestsRoute,
    renderTestDetailRoute,
    renderComplianceRoute,
    renderServiceProofRoute,
    renderJobsRoute,
    renderJobDetailRoute,
    renderWorkerProfileRoute
];
