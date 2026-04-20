/**
 * GrowthLedgerList — read-only list of recent growth events.
 */
import React from 'react';
import { UserPlus, Award, Users, Clock } from 'lucide-react';

export interface GrowthEventItem {
    id: string;
    eventType: 'FarmerReferred' | 'ReferralQualified' | 'WorkerActivated' | 'WorkerRetained30d';
    occurredAtUtc: string;
    metadata?: string | null;
}

interface GrowthLedgerListProps {
    events: GrowthEventItem[];
}

const EVENT_CONFIG: Record<GrowthEventItem['eventType'], {
    icon: React.ReactNode;
    mr: string;
    en: string;
    colorClass: string;
}> = {
    FarmerReferred: {
        icon: <UserPlus size={18} />,
        mr: 'शेतकरी आमंत्रित',
        en: 'Farmer referred',
        colorClass: 'bg-blue-100 text-blue-600',
    },
    ReferralQualified: {
        icon: <Award size={18} />,
        mr: 'रेफरल पात्र',
        en: 'Referral qualified',
        colorClass: 'bg-emerald-100 text-emerald-600',
    },
    WorkerActivated: {
        icon: <Users size={18} />,
        mr: 'कामगार सक्रिय',
        en: 'Worker activated',
        colorClass: 'bg-orange-100 text-orange-600',
    },
    WorkerRetained30d: {
        icon: <Clock size={18} />,
        mr: '३० दिवस टिकला',
        en: 'Worker retained 30 days',
        colorClass: 'bg-purple-100 text-purple-600',
    },
};

const GrowthLedgerList: React.FC<GrowthLedgerListProps> = ({ events }) => {
    if (events.length === 0) {
        return (
            <div className="rounded-2xl border border-stone-100 bg-stone-50 p-6 text-center">
                <p className="text-sm font-bold text-stone-500">अजून कोणतीही घटना नाही</p>
                <p className="text-xs text-stone-400 mt-1">No growth events yet</p>
            </div>
        );
    }

    return (
        <ul className="space-y-2">
            {events.map(evt => {
                const config = EVENT_CONFIG[evt.eventType];
                const date = new Date(evt.occurredAtUtc).toLocaleDateString('en-IN', {
                    day: 'numeric', month: 'short', year: 'numeric',
                });
                return (
                    <li key={evt.id} className="flex items-center gap-3 rounded-2xl border border-stone-100 bg-white px-4 py-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${config.colorClass}`}>
                            {config.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-stone-800">{config.mr}</div>
                            <div className="text-xs text-stone-500">{config.en}</div>
                        </div>
                        <div className="text-xs text-stone-400 shrink-0">{date}</div>
                    </li>
                );
            })}
        </ul>
    );
};

export default GrowthLedgerList;
