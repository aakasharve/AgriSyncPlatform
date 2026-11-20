import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyForAiButtons } from '@/features/mis/CopyForAiButtons';
import { misToAiJson, misToAiText } from '@/features/mis/copyForAi';
import { misFixture } from '@/test/misFixture';

/** CR-3 Task A8: the two buttons write to the person's own clipboard, or show the pack to select. */

const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

afterEach(() => {
  setClipboard(undefined);
  vi.useRealTimers();
});

describe('Copy for AI buttons (CR-3 A8)', () => {
  it('Each_button_writes_its_pack_to_the_clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const d = misFixture();
    render(<CopyForAiButtons answer={d} section="farms" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI (text)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenLastCalledWith(misToAiText(d, 'farms'));
    expect(await screen.findByText('Copied')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy as JSON' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenLastCalledWith(misToAiJson(d, 'farms'));
  });

  it('Copied_goes_back_after_two_seconds', async () => {
    vi.useFakeTimers();
    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<CopyForAiButtons answer={misFixture()} section="overview" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI (text)' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(screen.getByText('Copied')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.queryByText('Copied')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy for AI (text)' })).toBeTruthy();
  });

  it('Without_a_clipboard_the_pack_is_shown_to_select', async () => {
    setClipboard(undefined);
    const d = misFixture();
    render(<CopyForAiButtons answer={d} section="quality" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as JSON' }));
    const box = (await screen.findByRole('textbox', { name: 'Copy this text' })) as HTMLTextAreaElement;
    expect(box.value).toBe(misToAiJson(d, 'quality'));
    expect(box.readOnly).toBe(true);
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('A_refused_write_also_shows_the_pack', async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const d = misFixture();
    render(<CopyForAiButtons answer={d} section="overview" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI (text)' }));
    const box = (await screen.findByRole('textbox', { name: 'Copy this text' })) as HTMLTextAreaElement;
    expect(box.value).toBe(misToAiText(d, 'overview'));
  });

  it('A_change_of_section_clears_the_box_and_Copied', async () => {
    setClipboard(undefined);
    const d = misFixture();
    const { rerender } = render(<CopyForAiButtons answer={d} section="quality" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as JSON' }));
    expect(await screen.findByRole('textbox', { name: 'Copy this text' })).toBeTruthy();
    rerender(<CopyForAiButtons answer={d} section="farms" />);
    expect(screen.queryByRole('textbox', { name: 'Copy this text' })).toBeNull();
    expect(screen.queryByText('Copied')).toBeNull();

    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI (text)' }));
    expect(await screen.findByText('Copied')).toBeTruthy();
    rerender(<CopyForAiButtons answer={d} section="overview" />);
    expect(screen.queryByText('Copied')).toBeNull();
  });

  it('A_change_of_range_clears_the_box_and_Copied', async () => {
    setClipboard(undefined);
    const d = misFixture();
    const { rerender } = render(<CopyForAiButtons answer={d} section="quality" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI (text)' }));
    expect(await screen.findByRole('textbox', { name: 'Copy this text' })).toBeTruthy();
    const later = misFixture({ range: { from: '2026-10-18', to: '2026-11-16', days: 30 } });
    rerender(<CopyForAiButtons answer={later} section="quality" />);
    expect(screen.queryByRole('textbox', { name: 'Copy this text' })).toBeNull();

    setClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    fireEvent.click(screen.getByRole('button', { name: 'Copy for AI (text)' }));
    expect(await screen.findByText('Copied')).toBeTruthy();
    rerender(<CopyForAiButtons answer={d} section="quality" />);
    expect(screen.queryByText('Copied')).toBeNull();
  });
});
