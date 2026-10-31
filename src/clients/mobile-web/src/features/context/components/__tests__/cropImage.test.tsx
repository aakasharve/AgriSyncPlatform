// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18, founder rulings (b)/(c)) — a crop's picture is found BY
 * ITS MHCR ID under the build's picture address (never bundled, never by a word inside a name), falls back to the
 * app's own photo of the same crop, then to a plain icon; a failed picture is not asked for again.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CROP_IMAGE_FOLDER, cropMasterIdOf, cropPictureCandidates, resetCropPictureFailures, useCropPicture } from '../cropImage';

const BASE = 'https://img.example.test';

describe('cropPictureCandidates', () => {
    it('the master picture by id, then the bundled photo of the same crop', () => {
        expect(cropPictureCandidates({ name: 'Grapes' }, 480, BASE)).toEqual([
            `${BASE}/${CROP_IMAGE_FOLDER}/MHCR-0116-480.webp`, '/images/crops/Black Grapes.jpg',
        ]);
        expect(cropPictureCandidates({ name: 'द्राक्ष' }, 960, BASE)[0]).toBe(`${BASE}/crop-images/v1/MHCR-0116-960.webp`);
    });

    it('never puts one crop\'s picture on another ("Grapefruit" is not grapes)', () => {
        expect(cropPictureCandidates({ name: 'Grapefruit' }, 480, BASE)).toEqual([`${BASE}/crop-images/v1/MHCR-0125-480.webp`]);
        expect(cropPictureCandidates({ name: 'Grapefruit' }, 480, '')).toEqual([]);
    });

    it('without a picture address (not configured for this build) only the app\'s own photos, nothing fetched', () => {
        expect(cropPictureCandidates({ name: 'Sugarcane' }, 480, '')).toEqual(['/images/crops/Sugarcane.jpg']);
        expect(cropPictureCandidates({ name: 'Rice' }, 480, '')).toEqual([]);
    });

    it('reads the crop by its MHCR id first, then its name, then its old icon name', () => {
        expect(cropMasterIdOf({ name: 'whatever he typed', masterId: 'MHCR-0002' })).toBe('MHCR-0002');
        expect(cropMasterIdOf({ name: 'माझी बाग', iconName: 'Grape' })).toBe('MHCR-0116');
    });
});

const Pic: React.FC<{ name: string }> = ({ name }) => {
    const { src, onError } = useCropPicture({ name }, 480);
    return src ? <img data-testid="pic" src={src} alt="" onError={onError} /> : <span data-testid="icon" />;
};

describe('useCropPicture', () => {
    afterEach(() => { cleanup(); resetCropPictureFailures(); });

    it('a failed picture falls to the next, then to the plain icon', () => {
        render(<Pic name="Tomato" />);
        expect(screen.getByTestId('pic')).toHaveAttribute('src', '/images/crops/Tomato.jpg');
        fireEvent.error(screen.getByTestId('pic'));
        expect(screen.getByTestId('icon')).toBeInTheDocument();
    });
});
