import React from 'react';
import { FarmOperator } from '../../../domain/types/farm.types';

import { SyncIndicator } from './SyncIndicator';
import { useSyncStatus } from '../../../app/hooks/useSyncStatus';

// --- ICONS ---
const Icons = {
    User: () => (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 8C10.2091 8 12 6.20914 12 4C12 1.79086 10.2091 0 8 0C5.79086 0 4 1.79086 4 4C4 6.20914 5.79086 8 8 8Z" />
            <path d="M14 14C14 10.6863 11.3137 8 8 8C4.68629 8 2 10.6863 2 14" strokeLinecap="round" />
        </svg>
    )
};

interface OperatorSessionBarProps {
    currentOperator: FarmOperator;
    ownerName: string;
}

export const OperatorSessionBar: React.FC<OperatorSessionBarProps> = ({
    currentOperator,
    ownerName
}) => {
    const roleLabel = {
        PRIMARY_OWNER: 'Primary Owner',
        SECONDARY_OWNER: 'Secondary Owner',
        MUKADAM: 'Mukadam',
        WORKER: 'Worker',
    }[currentOperator.role] ?? 'Worker';

    // Color config based on role (Visual hierarchy)
    const roleConfig = {
        PRIMARY_OWNER: { bg: 'bg-emerald-100', text: 'text-emerald-900', border: 'border-emerald-200' },
        SECONDARY_OWNER: { bg: 'bg-indigo-100', text: 'text-indigo-900', border: 'border-indigo-200' },
        MUKADAM: { bg: 'bg-blue-100', text: 'text-blue-900', border: 'border-blue-200' },
        WORKER: { bg: 'bg-gray-100', text: 'text-gray-900', border: 'border-gray-200' }
    }[currentOperator.role] || { bg: 'bg-gray-100', text: 'text-gray-900', border: 'border-gray-200' };

    const { status, lastSyncedAt } = useSyncStatus();

    return (
        <div className={`flex items-start justify-between px-3 py-2 rounded-lg border ${roleConfig.bg} ${roleConfig.border}`}>
            <div className="flex items-start gap-2">
                <div className={`p-1.5 rounded-full bg-white/50 ${roleConfig.text}`}>
                    <Icons.User />
                </div>
                <div>
                    <p className={`text-[11px] font-bold ${roleConfig.text}`}>
                        Owner: {ownerName}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                        <p className={`text-[11px] font-semibold ${roleConfig.text}`}>
                            Logged in as: {currentOperator.name}
                        </p>
                        <SyncIndicator status={status} lastSyncedAt={lastSyncedAt} />
                    </div>
                    <p className="text-[10px] opacity-70 uppercase tracking-wide mt-0.5">
                        {roleLabel}
                    </p>
                </div>
            </div>
        </div>
    );
};
