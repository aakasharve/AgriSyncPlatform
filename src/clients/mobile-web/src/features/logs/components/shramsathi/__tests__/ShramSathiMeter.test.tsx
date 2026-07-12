/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import ShramSathiMeter from '../ShramSathiMeter';
import { DFES_TUNING } from '../../../services/dfesTuning';

afterEach(() => {
    cleanup();
});

describe('ShramSathiMeter', () => {
    it('shows the arriving silhouette with 20 progress ticks before Shram Sathi arrives', () => {
        render(
            <ShramSathiMeter
                arrived={false}
                arrivingProgress={7}
                score={{ value: 8.1 }}
                gaps={[]}
            />
        );

        expect(screen.getByTestId('shramsathi-meter')).toBeInTheDocument();
        expect(screen.getByTestId('shramsathi-figure')).toHaveAttribute('data-arrived', '0');
        expect(screen.queryByTestId('shramsathi-score')).not.toBeInTheDocument();
        expect(screen.getAllByTestId('shramsathi-arriving-tick')).toHaveLength(DFES_TUNING.richDayThreshold);
    });

    it('shows the Devanagari /10 score and warm expression after arrival', () => {
        render(
            <ShramSathiMeter
                arrived={true}
                arrivingProgress={20}
                score={{ value: 9.2 }}
                gaps={[
                    { id: 'carrier-volume', question: 'किती पाण्यात फवारणी केली?' },
                    { id: 'diesel', question: 'डिझेल किती लागलं?' },
                    { id: 'labour', question: 'रोजगार किती होता?' },
                    { id: 'extra', question: 'हे का दिलंत?' },
                ]}
            />
        );

        expect(screen.getByTestId('shramsathi-figure')).toHaveAttribute('data-arrived', '1');
        expect(screen.getByTestId('shramsathi-score')).toHaveTextContent('१० पैकी ९');
        expect(screen.getAllByTestId('shramsathi-gap-question')).toHaveLength(3);
        expect(screen.getByTestId('shramsathi-meter').className).not.toMatch(/red-/);
    });
});
