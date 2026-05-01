/**
 * Sub-plan 04 Task 5 — ConflictBadge.
 *
 * Shows the count of unresolved rejected mutations in the app shell. Hidden
 * when the syncMachine reports zero. Click handler is the parent's
 * responsibility — typically setCurrentRoute('offline-conflicts').
 */
import React from 'react';
import { useSelector } from '@xstate/react';
import { getRootStore } from '../../../app/state/RootStore';

interface ConflictBadgeProps {
    onClick?: () => void;
}

export const ConflictBadge: React.FC<ConflictBadgeProps> = ({ onClick }) => {
    const count = useSelector(
        getRootStore().sync,
        snapshot => snapshot.context.rejectedMutations.length,
    );

    if (count === 0) {
        return null;
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-amber-800"
            data-testid="conflict-badge"
            aria-label={`${count} unsynced mutation${count === 1 ? '' : 's'}`}
        >
            <span aria-hidden="true">⚠</span> {count}
        </button>
    );
};
