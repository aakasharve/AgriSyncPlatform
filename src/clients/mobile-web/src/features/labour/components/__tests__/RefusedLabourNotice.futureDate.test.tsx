// @vitest-environment jsdom
/**
 * PLR-D10 L3a (I23 / N6, founder D-16 "no future हजेरी") — a mark the server refused because its
 * day has not happened yet stays visible to the farmer (P10: never dropped silently) with that
 * reason, and never with a reason the server did not give.
 */
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import RefusedLabourNotice from '../RefusedLabourNotice';
import { ATTENDANCE_COPY } from '../../attendanceCopy';
import type { RefusedLabourMark } from '../../data/attendanceRefused';

const mark = (over: Partial<RefusedLabourMark>): RefusedLabourMark => ({
    clientRequestId: 'r1', fieldOperatorId: 'op-1', workDate: '2026-10-30', dayMark: 'Full',
    missingResponsibility: false, futureDate: false, ...over,
});

describe('RefusedLabourNotice — a future day', () => {
    afterEach(() => cleanup());

    it('says why: the day has not happened yet', () => {
        render(<RefusedLabourNotice state={{ marks: [mark({ futureDate: true })], noWorkDeclarationRefused: false, clientRequestIds: ['r1'] }}
            nameOf={() => 'गणेश'} onRetry={() => undefined} />);
        expect(screen.getByTestId('labour-refused-reason')).toHaveTextContent(ATTENDANCE_COPY.refusedFutureDate);
        expect(screen.queryByText(ATTENDANCE_COPY.refusedMissingResponsibility)).toBeNull();
    });

    it('claims no future-day reason it was not told', () => {
        render(<RefusedLabourNotice state={{ marks: [mark({})], noWorkDeclarationRefused: false, clientRequestIds: ['r1'] }}
            nameOf={() => 'गणेश'} onRetry={() => undefined} />);
        expect(screen.queryByTestId('labour-refused-reason')).toBeNull();
    });
});
