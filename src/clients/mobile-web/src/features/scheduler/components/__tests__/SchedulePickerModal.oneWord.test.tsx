// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (UI-9a, redesign item 9; founder 2026-11-21: "the word 'शेड्यूल' everywhere, never 'वेळापत्रक'";
 * "shipped schedule names through scheduleNameMr everywhere").
 *
 * The first-adoption sheet (`SchedulePickerModal`) and the change sheet (`MigrationSheet`) write their own Marathi in the page. Draft Marathi - needs
 * review: "कोणतं शेड्यूल वापरायचं?", "हे शेड्यूल सुरू करा", "शेड्यूल बदला", "नवीन शेड्यूल निवडा".
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
    getCropScheduleTemplates: vi.fn(),
    adoptSchedule: vi.fn(),
    migrateSchedule: vi.fn(),
}));
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: api }));

import { SchedulePickerModal } from '../SchedulePickerModal';
import { MigrationSheet } from '../MigrationSheet';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE } from '../../schedulePage/__tests__/scheduleFixtures';

const OLD_WORD = 'वेळापत्रक';
const dto = (id: string, name: string) => ({ id, templateKey: id, cropKey: 'Grapes', name, versionTag: 'v1', isPublished: true, tasks: [] });

describe('SchedulePickerModal: one word, and shipped names in Marathi (item 9)', () => {
    beforeEach(() => {
        api.getCropScheduleTemplates.mockReset().mockResolvedValue([
            dto('t1', 'Grapes - Standard Seasonal Template'),
            dto('t2', 'आमची स्वतःची योजना'),
        ]);
    });
    afterEach(() => cleanup());

    it('the title, the button and the name line say "शेड्यूल"; a shipped name is Marathi, a name a person wrote is as written', async () => {
        const { container } = render(<SchedulePickerModal isOpen cropKey="Grapes" plotId="p" cycleId="c" farmId="f" onClose={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^कोणतं शेड्यूल\s*वापरायचं\?$/); // a line break sits between the two lines
        expect((await screen.findAllByText('द्राक्ष — हंगामी शेड्यूल')).length).toBeGreaterThan(0); // scheduleNameMr of the shipped name (the card and the line below)
        expect(screen.getByText('आमची स्वतःची योजना')).toBeInTheDocument(); // written by a person: shown as written
        expect(screen.queryByText('Grapes - Standard Seasonal Template')).toBeNull();
        expect(screen.getByRole('button', { name: /हे शेड्यूल सुरू करा/ })).toBeInTheDocument();
        // the "chosen" line under the list uses the same Marathi name
        expect(container.textContent).toContain('निवडले: द्राक्ष — हंगामी शेड्यूल');
        expect(container.textContent).not.toContain(OLD_WORD);
    });

    it('no schedule for the crop, and a failed start, are said with the same word', async () => {
        api.getCropScheduleTemplates.mockReset().mockResolvedValue([]);
        const { container, rerender } = render(<SchedulePickerModal isOpen cropKey="Grapes" plotId="p" cycleId="c" farmId="f" onClose={vi.fn()} />);
        expect(await screen.findByText('या पिकासाठी शेड्यूल उपलब्ध नाही.')).toBeInTheDocument();
        expect(container.textContent).not.toContain(OLD_WORD);

        api.getCropScheduleTemplates.mockReset().mockResolvedValue([dto('t1', 'Grapes - Standard Seasonal Template')]);
        api.adoptSchedule.mockReset().mockRejectedValue(new Error('boom'));
        rerender(<SchedulePickerModal isOpen cropKey="Grapes " plotId="p" cycleId="c" farmId="f" onClose={vi.fn()} />);
        const start = await screen.findByRole('button', { name: /हे शेड्यूल सुरू करा/ });
        await waitFor(() => expect(start).not.toBeDisabled());
        fireEvent.click(start);
        expect(await screen.findByText('शेड्यूल सुरू करण्यात अडचण आली. पुन्हा प्रयत्न करा.')).toBeInTheDocument();
        expect(container.textContent).not.toContain(OLD_WORD);
    });
});

describe('MigrationSheet: one word (item 9)', () => {
    beforeEach(() => {
        setScheduleTemplatesFromReferenceData([{ ...SERVER_TEMPLATE, id: '10000000-0000-4000-8000-000000000001', name: 'Grapes - Standard Seasonal Template', cropType: 'Grapes', versionHash: 'h' }]);
    });
    afterEach(() => { cleanup(); setScheduleTemplatesFromReferenceData([]); });

    it('the title, the section heading and the button say "शेड्यूल"; the card shows the shipped name in Marathi', () => {
        const { container } = render(<MigrationSheet isOpen cropKey="Grapes" plotId="p" cycleId="c" farmId="f" onClose={vi.fn()} />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('शेड्यूल बदला');
        expect(screen.getByText('नवीन शेड्यूल निवडा')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'शेड्यूल बदला' })).toBeInTheDocument();
        expect(container.textContent).toContain('द्राक्ष — हंगामी शेड्यूल');
        expect(container.textContent).not.toContain(OLD_WORD);
    });
});
