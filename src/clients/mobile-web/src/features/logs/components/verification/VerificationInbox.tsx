import React from 'react';
import { DailyLog } from '../../../../types';
import SathiCard from '../../../sathi/components/SathiCard';
import { Clock, ShieldCheck, AlertTriangle, PenLine } from 'lucide-react';
import VerificationStatusBadge from './VerificationStatusBadge';

interface VerificationInboxProps {
    pendingLogs: DailyLog[];
    onSelectLog: (log: DailyLog) => void;
}

type VerificationGroup = {
    key: string;
    label: string;
    icon: React.ReactNode;
    color: string;
    logs: DailyLog[];
};

function getVerificationStatus(log: DailyLog): string {
    // Try the backend-synced status first, fallback to local verification.
    // `lastVerificationStatus` is a server-injected field that lives on the
    // sync envelope but isn't yet on the DailyLog domain type — narrow as
    // unknown then check before use.
    const maybeBackend = (log as unknown as { lastVerificationStatus?: string }).lastVerificationStatus;
    if (typeof maybeBackend === 'string' && maybeBackend.length > 0) return maybeBackend;

    if (log.verification?.status) return log.verification.status;
    return 'draft';
}

function groupLogsByState(logs: DailyLog[]): VerificationGroup[] {
    const groups: Record<string, DailyLog[]> = {
        draft: [],
        confirmed: [],
        disputed: [],
        correction_pending: [],
        verified: [],
    };

    for (const log of logs) {
        const status = getVerificationStatus(log);
        const normalizedStatus = status
            .trim()
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/[\s-]+/g, '_')
            .toLowerCase();

        if (normalizedStatus in groups) {
            groups[normalizedStatus].push(log);
        } else if (normalizedStatus === 'pending') {
            groups.draft.push(log);
        } else if (normalizedStatus === 'approved') {
            groups.verified.push(log);
        } else if (normalizedStatus === 'rejected') {
            groups.disputed.push(log);
        } else {
            groups.draft.push(log);
        }
    }

    const groupConfigs: VerificationGroup[] = [
        {
            key: 'draft',
            label: 'Pending Confirmation',
            icon: <PenLine size={14} />,
            color: 'text-slate-600',
            logs: groups.draft,
        },
        {
            key: 'disputed',
            label: 'Disputed (Needs Action)',
            icon: <AlertTriangle size={14} />,
            color: 'text-red-600',
            logs: groups.disputed,
        },
        {
            key: 'correction_pending',
            label: 'Correction Pending',
            icon: <Clock size={14} />,
            color: 'text-amber-600',
            logs: groups.correction_pending,
        },
        {
            key: 'confirmed',
            label: 'Awaiting Verification',
            icon: <ShieldCheck size={14} />,
            color: 'text-blue-600',
            logs: groups.confirmed,
        },
        {
            key: 'verified',
            label: 'Verified',
            icon: <ShieldCheck size={14} />,
            color: 'text-emerald-600',
            logs: groups.verified,
        },
    ];

    // Only return groups with logs
    return groupConfigs.filter(g => g.logs.length > 0);
}

const VerificationInbox: React.FC<VerificationInboxProps> = ({ pendingLogs, onSelectLog }) => {
    if (pendingLogs.length === 0) {
        return (
            <div className="p-6">
                <SathiCard
                    message="All Caught Up!"
                    subMessage="There are no pending logs to verify right now."
                    variant="success"
                />
            </div>
        );
    }

    const groups = groupLogsByState(pendingLogs);

    return (
        <div className="p-4 space-y-6">
            <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-stone-700 text-lg">Verification Inbox</h2>
                <span className="bg-amber-100 text-amber-700 font-bold text-xs px-2 py-1 rounded-full">
                    {pendingLogs.length} Total
                </span>
            </div>

            {groups.map(group => (
                <div key={group.key}>
                    {/* Section Header */}
                    <div className="flex items-center gap-2 mb-2">
                        <span className={`${group.color}`}>{group.icon}</span>
                        <h3 className={`text-sm font-bold ${group.color}`}>{group.label}</h3>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500`}>
                            {group.logs.length}
                        </span>
                    </div>

                    {/* Log cards */}
                    <div className="space-y-2">
                        {group.logs.map(log => (
                            <div
                                key={log.id}
                                onClick={() => onSelectLog(log)}
                                className="bg-white p-4 rounded-2xl shadow-sm border border-stone-200 active:scale-[0.98] transition-transform cursor-pointer"
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h3 className="font-bold text-stone-800">
                                            {log.context.selection[0].selectedPlotNames.join(', ')}
                                        </h3>
                                        <p className="text-xs text-stone-400 font-medium">{log.date}</p>
                                    </div>
                                    <VerificationStatusBadge
                                        status={getVerificationStatus(log)}
                                        size="sm"
                                    />
                                </div>

                                <div className="space-y-1">
                                    {log.cropActivities?.length ? (
                                        <p className="text-sm text-stone-600 line-clamp-1">
                                            🚜 {log.cropActivities.map(a => a.workTypes?.join(', ') || a.title).join(', ')}
                                        </p>
                                    ) : null}
                                    {log.irrigation?.length ? (
                                        <p className="text-sm text-stone-600">
                                            💧 {log.irrigation[0].durationHours} hrs {log.irrigation[0].method}
                                        </p>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default VerificationInbox;
