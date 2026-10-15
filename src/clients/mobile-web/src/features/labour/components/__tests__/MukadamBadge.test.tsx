// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MukadamBadge } from '../LabourUiKit';

afterEach(() => cleanup());

describe('MukadamBadge uses the registry role word', () => {
    it('shows मुकादम, not जबाबदार', () => {
        render(<MukadamBadge />);
        expect(screen.getByText('मुकादम')).toBeTruthy();
        expect(screen.queryByText('जबाबदार')).toBeNull();
    });
});
