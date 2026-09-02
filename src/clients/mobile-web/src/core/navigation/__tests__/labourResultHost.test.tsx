// Labour V2 R1 Task 3.4b — LabourResultHost latch semantics.
// @vitest-environment jsdom
//
// The बदल करा edit surface is the byte-for-byte ManualEntry(attendanceOnly)
// call, which CONSUMES the draft on mount (useManualEntryHydration →
// onDataConsumed → setDraftLog(null)). Without the latch, that consumption
// flips the landing branch from <AttendanceResult> to a bare <ManualEntry>,
// React replaces the subtree on the type change, and the freshly hydrated
// form remounts EMPTY — the farmer's spoken हजेरी evaporates on the
// CORRECTION button (rule 1 / D9.6). These tests pin the latch mechanics
// that prevent that, using a probe child that consumes-on-mount exactly the
// way the real edit surface does.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { LabourResultHost } from '../mainView';

afterEach(cleanup);

/** Mount/unmount-instrumented child with internal state — a stand-in for the
 *  hydrated ManualEntry instance whose state must survive consumption. */
const counters = { mounts: 0, unmounts: 0 };
const Probe: React.FC<{ onMount?: () => void }> = ({ onMount }) => {
    const [typed, setTyped] = React.useState('');
    React.useEffect(() => {
        counters.mounts += 1;
        onMount?.();
        return () => { counters.unmounts += 1; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
        <div>
            <span data-testid="typed">{typed}</span>
            <button data-testid="type" onClick={() => setTyped('edited-by-farmer')}>type</button>
        </div>
    );
};

/** Parent owning the draft, wired the way mainView's branch is: children are
 *  present only while the draft stands; the probe consumes it on mount. */
const Harness: React.FC<{ consumeOnMount: boolean }> = ({ consumeOnMount }) => {
    const [draft, setDraft] = React.useState<string | null>('the-parse');
    return (
        <LabourResultHost renderManualEntry={() => <div data-testid="bare-fallthrough" />}>
            {draft != null ? (
                <Probe onMount={consumeOnMount ? () => setDraft(null) : undefined} />
            ) : null}
        </LabourResultHost>
    );
};

describe('LabourResultHost — the consumed draft does not unmount the standing surface', () => {
    it('a child that consumes the draft on mount stays mounted, state intact', () => {
        counters.mounts = 0; counters.unmounts = 0;
        render(<Harness consumeOnMount />);
        // Consumption ran (draft is null now) — yet the probe neither
        // remounted nor fell through to the bare ManualEntry.
        expect(counters.mounts).toBe(1);
        expect(counters.unmounts).toBe(0);
        expect(screen.queryByTestId('bare-fallthrough')).toBeNull();
        // The farmer's in-progress edit survives subsequent interaction.
        fireEvent.click(screen.getByTestId('type'));
        expect(screen.getByTestId('typed')).toHaveTextContent('edited-by-farmer');
        expect(counters.mounts).toBe(1);
    });
    it('with no draft ever present, the frame falls through to the ManualEntry render', () => {
        render(
            <LabourResultHost renderManualEntry={() => <div data-testid="bare-fallthrough" />}>
                {null}
            </LabourResultHost>,
        );
        expect(screen.getByTestId('bare-fallthrough')).toBeInTheDocument();
    });
});
