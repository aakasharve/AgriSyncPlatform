import React from 'react';
import { FEATURE_FLAGS } from '../featureFlags';

interface AppShellProps {
    children: React.ReactNode;
    className?: string;
}

const AppShell: React.FC<AppShellProps> = ({ children, className }) => {
    const shellClassName = [
        'fixed inset-0 flex flex-col overflow-hidden bg-surface-100 bg-subtle-mesh text-stone-800',
        className
    ]
        .filter(Boolean)
        .join(' ');

    return (
        // spec voice-flow-v2-2026-11-23 — the v2 full-screen frame (`V2Shell`) is drawn into this element so it sits in the app's own
        // layer order (above the bottom bar, below the toast and the approval sheet). Flag off: no marker, exactly as before.
        <div className={shellClassName} data-app-shell={FEATURE_FLAGS.voiceFlowV2 ? '' : undefined}>
            <div className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden bg-surface-100 md:max-w-[640px] xl:max-w-[720px] md:border-x md:border-stone-200/80 md:shadow-[0_24px_80px_rgba(28,25,23,0.12)]">
                <div aria-hidden="true" className="w-full shrink-0 pt-safe-area bg-surface-100" />
                <div className="flex-1 min-h-0 overflow-hidden pl-safe-area pr-safe-area">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default AppShell;
