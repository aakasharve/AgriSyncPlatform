// @vitest-environment jsdom
/**
 * Phase 4 Task 4.1 — AiTestModeBanner unit tests.
 *
 * Per repo convention (see OfflineConflictPage.test.tsx): global vitest
 * environment stays 'node'; React-rendering tests opt into jsdom via the
 * per-file directive above and import jest-dom matchers per-file.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiTestModeBanner } from '../AiTestModeBanner';

describe('AiTestModeBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('renders nothing when flag is off', () => {
    const { container } = render(<AiTestModeBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders banner when flag is on', () => {
    localStorage.setItem('agrisync_ai_test_mode', 'true');
    render(<AiTestModeBanner />);
    expect(screen.getByText(/AI TEST MODE/i)).toBeInTheDocument();
  });

  it('shows bucket focus when set', () => {
    localStorage.setItem('agrisync_ai_test_mode', 'true');
    localStorage.setItem('agrisync_ai_test_bucket', 'inputs');
    render(<AiTestModeBanner />);
    expect(screen.getByText(/bucket: inputs/i)).toBeInTheDocument();
  });

  it('shows capture count when set', () => {
    localStorage.setItem('agrisync_ai_test_mode', 'true');
    localStorage.setItem('agrisync_ai_test_capture_count', '3');
    render(<AiTestModeBanner />);
    expect(screen.getByText(/3 captured/i)).toBeInTheDocument();
  });
});
