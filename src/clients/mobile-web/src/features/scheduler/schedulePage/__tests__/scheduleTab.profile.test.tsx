// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, item 1) - the profile card: made by, source and checked by as three SEPARATE lines, from the shared words;
 * an unchecked schedule says so; no institution logo image anywhere (SM-17).
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { parseScheduleTask } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { shownDayOfStored, type DayCardsDetail } from '../../dayCards/dayCardsTypes';
import { ScheduleProfileCard } from '../ScheduleProfileCard';

const t = parseScheduleTask({ taskKey: 'k', name: 'काम', kind: 'work', basis: 'stated', timing: { timer: 'day', fromDay: 1, toDay: 1, repeat: 'once' }, sources: [{ document: 'ICAR-NRCG ची प्रकाशनं' }] });
if (!t.ok) throw new Error(t.error);
const detail = (checked: boolean): DayCardsDetail => ({
    templateId: 'd0d0d0d0-0000-4000-8000-0000000000a1', chainId: null, version: 1, contentHash: 'h', kind: 'reference', name: 'द्राक्ष — फळछाटणी', cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: 'श्रमसफल' }, check: { state: checked ? 'Checked' : 'NotChecked', isChecked: checked, checkedBy: checked ? 'तपासनीस' : null, checkedAtUtc: null }, stages: [],
    tasks: [{ task: t.value, contentHash: 'x', shown: { from: shownDayOfStored(1), to: shownDayOfStored(1), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: checked }], challenges: [], skipped: 0,
});
afterEach(() => cleanup());
describe('profile card', () => {
    it('three separate lines and no logo', async () => {
        render(<ScheduleProfileCard templateId="x" plotName="G1" load={async () => ({ ok: true, detail: detail(false), source: 'phone', stale: false })} />);
        expect(await screen.findByTestId('line-made-by')).toHaveTextContent('संस्था · श्रमसफल');
        expect(screen.getByTestId('line-source')).toHaveTextContent('ICAR-NRCG ची प्रकाशनं');
        expect(screen.getByTestId('line-checked-by')).toHaveTextContent('अजून कुणी तपासलेलं नाही');
        expect(screen.getByTestId('profile-unchecked')).toBeInTheDocument();
        expect(document.querySelectorAll('img').length).toBe(0);
    });
    it('a checked schedule names who checked it and has no unchecked line', async () => {
        render(<ScheduleProfileCard templateId="x" plotName="G1" load={async () => ({ ok: true, detail: detail(true), source: 'phone', stale: false })} />);
        expect(await screen.findByTestId('line-checked-by')).toHaveTextContent('तपासनीस');
        expect(screen.queryByTestId('profile-unchecked')).toBeNull();
    });
    it('draws nothing until the version is known', async () => {
        const { container } = render(<ScheduleProfileCard templateId="x" plotName="G1" load={async () => ({ ok: false, reason: 'offline-no-copy' })} />);
        await new Promise(r => setTimeout(r, 20));
        expect(container).toBeEmptyDOMElement();
    });
});
