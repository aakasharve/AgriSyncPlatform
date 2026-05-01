// Sub-plan 04 Task 8 — extracted from AppRouter.tsx
// All React.lazy() page imports live here so AppRouter.tsx and the route
// render-function modules share a single registry of code-split chunks.

import React from 'react';
import { IS_E2E_HARNESS_ENABLED } from '../../app/featureFlags';

export const ProfilePage = React.lazy(() => import('../../pages/ProfilePage'));
export const SettingsPage = React.lazy(() => import('../../pages/SettingsPage'));
export const VoiceJournalPage = React.lazy(() => import('../../features/voiceJournal/pages/VoiceJournalPage'));
export const SchedulerPage = React.lazy(() => import('../../pages/SchedulerPage'));
export const ProcurementPage = React.lazy(() => import('../../pages/ProcurementPage'));
export const HarvestIncomePage = React.lazy(() => import('../../pages/HarvestIncomePage'));
export const ReflectPage = React.lazy(() => import('../../pages/ReflectPage'));
export const TestE2EPage = IS_E2E_HARNESS_ENABLED
    ? React.lazy(() => import('../../pages/TestE2EPage'))
    : null;
export const ComparePage = React.lazy(() => import('../../pages/ComparePage').then(module => ({ default: module.ComparePage })));
export const FinanceManagerHome = React.lazy(() => import('../../pages/FinanceManagerHome'));
export const LedgerPage = React.lazy(() => import('../../pages/LedgerPage'));
export const PriceBookPage = React.lazy(() => import('../../pages/PriceBookPage'));
export const ReviewInboxPage = React.lazy(() => import('../../pages/ReviewInboxPage'));
export const ReportsPage = React.lazy(() => import('../../pages/ReportsPage'));
export const FinanceSettingsPage = React.lazy(() => import('../../pages/FinanceSettingsPage'));
export const AdminAiOpsPage = React.lazy(() => import('../../features/admin/ai/AdminAiOpsPage').then(module => ({ default: module.AdminAiOpsPage })));
export const AdminOpsPage = React.lazy(() => import('../../features/admin/ops/AdminOpsPage').then(module => ({ default: module.AdminOpsPage })));
export const ReferralsPage = React.lazy(() => import('../../pages/ReferralsPage'));
export const TaskCreationSheet = React.lazy(() => import('../../features/scheduler/components/TaskCreationSheet'));
export const ReviewInboxSheet = React.lazy(() => import('../../features/logs/components/ReviewInboxSheet'));
export const QuickLogSheet = React.lazy(() => import('../../features/logs/components/QuickLogSheet').then(module => ({ default: module.QuickLogSheet })));
export const OnboardingPermissionsPage = React.lazy(() => import('../../pages/OnboardingPermissionsPage'));
export const QrDemoPage = React.lazy(() => import('../../pages/QrDemoPage'));
export const AttentionPage = React.lazy(() => import('../../features/attention/pages/AttentionPage'));
export const TestQueuePage = React.lazy(() => import('../../features/tests/pages/TestQueuePage'));
export const TestDetailPage = React.lazy(() => import('../../features/tests/pages/TestDetailPage'));
export const ComplianceSignalsPage = React.lazy(() => import('../../features/compliance/pages/ComplianceSignalsPage'));
export const ServiceProofPage = React.lazy(() => import('../../features/reports/pages/ServiceProofPage'));
export const JobCardsPage = React.lazy(() => import('../../features/work/pages/JobCardsPage'));
export const JobCardDetailPage = React.lazy(() => import('../../features/work/pages/JobCardDetailPage'));
export const WorkerProfilePage = React.lazy(() => import('../../features/work/pages/WorkerProfilePage'));
// Sub-plan 04 Task 5 — offline conflict resolution.
export const OfflineConflictPage = React.lazy(() => import('../../features/sync/conflict/OfflineConflictPage'));

export const RouteLoader: React.FC = () => (
    React.createElement('div', {
        className: 'flex min-h-[40vh] items-center justify-center text-sm font-semibold text-stone-400'
    }, 'Loading...')
);
