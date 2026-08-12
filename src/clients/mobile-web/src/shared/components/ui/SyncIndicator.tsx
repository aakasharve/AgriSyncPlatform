import React from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';
import {
    SYNC_HONESTY_I18N_KEYS,
    type SyncHonestyState,
} from '../../../features/sync/status/syncHonestyState';

// --- ICONS ---
// Labour Phase 2 / T1 deleted the `Pending` spinner. An animated dashed dot is
// the visual form of "we are sending this right now" — a claim this component
// made permanently and could never substantiate, because its label came from a
// Dexie table nothing drains. There is no in-flight state any more, so there is
// no in-flight icon. Same 10x10 viewBox on every remaining icon: zero layout delta.
//
// L5b measured a second reason to delete it: `animate-spin-slow` has no
// keyframes anywhere in this client, so the spinner never actually spun.
// Removing it is a zero-pixel, zero-motion delta.
const Icons = {
    OnPhone: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <circle cx="5" cy="5" r="3" fill="currentColor" />
        </svg>
    ),
    OnServer: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M8 3L4 7L2 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    NeedsFix: (props: React.SVGProps<SVGSVGElement>) => (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M5 2V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="5" cy="7.5" r="0.5" fill="currentColor" />
        </svg>
    )
};

interface SyncIndicatorProps {
    status: SyncHonestyState;
    pendingCount?: number;
    failedCount?: number;
    lastSyncedAt?: Date;
    onClick?: () => void;
    testId?: string;
}

// `lastSyncedAt` stays on the props interface — AppHeader passes it — but is
// deliberately NOT destructured: this component has never rendered it, and the
// staged-file lint gate runs at --max-warnings 0. Do not "tidy" it out of the
// interface; that would break the call sites. Give it a renderer or leave it.
export const SyncIndicator: React.FC<SyncIndicatorProps> = ({
    status,
    pendingCount = 0,
    failedCount = 0,
    onClick,
    testId
}) => {
    const { t } = useLanguage();

    // Colours are deliberately unchanged from what each real-world situation
    // renders today: a queued record was amber, a settled queue was muted, a
    // failure was red. Only the CLAIM changed, not the palette. (Contrast on
    // all three is below AA and was already below AA before this change —
    // pre-existing, unchanged here on purpose, and owned by the design system
    // rather than by a labour trust phase.)
    const config = {
        ON_PHONE: {
            color: 'text-amber-600',
            bg: 'bg-amber-50',
            Icon: Icons.OnPhone,
            labelKey: SYNC_HONESTY_I18N_KEYS.ON_PHONE
        },
        ON_SERVER: {
            color: 'text-stone-400',
            bg: 'bg-transparent',
            Icon: Icons.OnServer,
            labelKey: SYNC_HONESTY_I18N_KEYS.ON_SERVER
        },
        NEEDS_FIX: {
            color: 'text-red-600',
            bg: 'bg-red-50',
            Icon: Icons.NeedsFix,
            labelKey: SYNC_HONESTY_I18N_KEYS.NEEDS_FIX
        }
    }[status];

    const { Icon, color, bg, labelKey } = config;
    const label = t(labelKey);

    return (
        <button
            onClick={onClick}
            data-testid={testId}
            className={`relative flex items-center gap-1.5 px-2 py-1 rounded-full transition-all duration-300 ${color} ${bg} hover:bg-opacity-80 active:scale-95`}
            aria-label={label}
        >
            <Icon className="w-2.5 h-2.5" />
            <span className="text-[10px] font-bold tracking-wide opacity-90 pb-[1px]">{label}</span>

            {/* Notification Badge */}
            {(pendingCount > 0 || failedCount > 0) && (
                <span className={`absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full text-[8px] font-black text-white ${failedCount > 0 ? 'bg-red-500' : 'bg-amber-500'}`}>
                    {failedCount > 0 ? failedCount : pendingCount}
                </span>
            )}
        </button>
    );
};
