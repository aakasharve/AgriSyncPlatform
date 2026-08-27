// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// DailyLoopInsight — renders the Task 1A `insight.line` verbatim when
// `insight.render` is true; renders nothing when false (the dignity
// contract's safe default).
import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import DailyLoopInsight from '../DailyLoopInsight';
import type { Insight } from '../../../intelligence/insightTypes';

afterEach(() => {
    cleanup();
});

describe('DailyLoopInsight', () => {
    it('renders the insight line verbatim when render is true', () => {
        const insight: Insight = {
            key: 'continuity',
            render: true,
            trustLabel: 'derived',
            line: 'आजपर्यंत ५ वेळा नोंद झाली.',
        };

        render(<DailyLoopInsight insight={insight} />);

        expect(screen.getByTestId('daily-loop-insight')).toHaveTextContent('आजपर्यंत ५ वेळा नोंद झाली.');
    });

    it('renders nothing when render is false', () => {
        const insight: Insight = { key: 'continuity', render: false, trustLabel: 'derived', line: '' };

        const { container } = render(<DailyLoopInsight insight={insight} />);

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId('daily-loop-insight')).not.toBeInTheDocument();
    });
});
