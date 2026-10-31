// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18, PENDING D-25 default) — adding a crop from the founder's
 * crop master: core tiles, search by any name in either language, hidden crops never offered, names strictly in the
 * app's language, and a crop the list lacks added as typed.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CropMasterPicker from '../components/CropMasterPicker';
import { ALL_CROPS } from '../../../domain/crops/cropMaster';

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN = /[A-Za-z]/;

const renderPicker = (language: string, onFarm: string[] = []) => {
    const onPick = vi.fn();
    render(<CropMasterPicker language={language} onFarm={new Set(onFarm)} onFarmNames={new Set()} onPick={onPick} />);
    return onPick;
};

describe('CropMasterPicker', () => {
    afterEach(() => cleanup());

    it('Marathi mode: the 43 core crops as tiles, Marathi names only', () => {
        renderPicker('mr');
        const tiles = within(screen.getByTestId('crop-tiles')).getAllByRole('button');
        expect(tiles).toHaveLength(43);
        expect(screen.getByTestId('crop-tile-MHCR-0001')).toHaveTextContent('भात');
        expect(screen.getByTestId('crop-tiles').textContent).not.toMatch(LATIN);
    });

    it('English mode: the same tiles in English only', () => {
        renderPicker('en');
        expect(screen.getByTestId('crop-tile-MHCR-0001')).toHaveTextContent('Rice');
        expect(screen.getByTestId('crop-tiles').textContent).not.toMatch(DEVANAGARI);
    });

    it('finds a searchable crop by an alternate name and hands back the master row', () => {
        const onPick = renderPicker('mr');
        fireEvent.change(screen.getByTestId('crop-search'), { target: { value: 'Grapevine' } });
        fireEvent.click(screen.getByTestId('crop-result-MHCR-0116'));
        expect(onPick).toHaveBeenCalledWith({ kind: 'master', row: expect.objectContaining({ id: 'MHCR-0116', en: 'Grapes', mr: 'द्राक्ष' }) });
    });

    it('a hidden crop is not offered; a name the list lacks can be added as typed', () => {
        const hidden = ALL_CROPS.find(r => r.vis === 'hidden')!;
        const onPick = renderPicker('en');
        fireEvent.change(screen.getByTestId('crop-search'), { target: { value: hidden.en } });
        expect(screen.queryByTestId(`crop-result-${hidden.id}`)).toBeNull();
        fireEvent.click(screen.getByTestId('crop-add-typed'));
        expect(onPick).toHaveBeenCalledWith({ kind: 'typed', name: hidden.en });
    });

    it('a crop already on the farm shows as added and cannot be picked again', () => {
        const onPick = renderPicker('mr', ['MHCR-0001']);
        const tile = screen.getByTestId('crop-tile-MHCR-0001');
        expect(tile).toBeDisabled();
        expect(tile).toHaveTextContent('जोडलेलं');
        fireEvent.click(tile);
        expect(onPick).not.toHaveBeenCalled();
    });
});
