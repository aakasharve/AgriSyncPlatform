/**
 * FOUNDER DECISION 8 (2026-08-16), wave-3.10 — a declared no-work day, with reason chips.
 *
 * Until now the `आज काम नाही` button opened a blank manual-entry screen and nothing
 * recorded a typed rain-stopped day: the acknowledgement was live for VOICE days only. A
 * farmer who could not or would not speak had no way to say "there was no work today" at
 * all.
 *
 * **The chip is OPTIONAL, by doctrine P9 — no optional field may ever reject a record.**
 * Skipping saves the day exactly as picking a chip does; the only difference is whether a
 * `DisturbanceEvent` accompanies the declaration. That is proven server-side, on real
 * Postgres, by `DeclaredNoWorkDayTests.A_declared_no_work_day_reaches_the_scorer_with_no_chips`.
 *
 * **Why the chip is collected BEFORE the save rather than after it.** The founder's
 * decision reads "chips after", and this sheet is that moment — but the SAVE happens once,
 * when he answers or skips, and never twice. `CreateDailyLogHandler` early-returns on an
 * idempotent resend (same device + clientRequestId) and re-runs only the richness
 * recompute, so a chip attached to an already-synced log would never reach the server: the
 * second mutation would be acknowledged and its new `disturbance` discarded in silence. One
 * declaration, one mutation, chip included — that is the only shape in which his reason
 * actually survives the wire.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.10)
 */
import React from 'react';
import type { BucketIssueType } from '../../../domain/types/log.types';
import { useLanguage } from '../../../i18n/LanguageContext';

export interface NoWorkReasonSheetProps {
    isOpen: boolean;
    /** Declare the day. `cause` is undefined when he skipped — the day still saves. */
    onDeclare: (cause?: BucketIssueType) => void;
    onClose: () => void;
}

/**
 * The causes a NO-WORK day can plausibly have, drawn from the EXISTING `BucketIssueType`
 * vocabulary — the same one `IssueFormSheet` offers and `LedgerDerivationService` already
 * maps onto `DisturbanceCause`. No second list, and no new table for the chips.
 *
 * PEST / DISEASE / MATERIAL_SHORTAGE are deliberately absent: they are reasons work went
 * BADLY, not reasons no work was planned. He can still record them the ordinary way.
 */
const NO_WORK_CAUSES: ReadonlyArray<{ cause: BucketIssueType; labelKey: 'weather' | 'electricity' | 'water' | 'machinery' | 'labour' | 'other' }> = [
    { cause: 'WEATHER', labelKey: 'weather' },
    { cause: 'ELECTRICITY', labelKey: 'electricity' },
    { cause: 'WATER_SOURCE', labelKey: 'water' },
    { cause: 'MACHINERY', labelKey: 'machinery' },
    { cause: 'LABOR_SHORTAGE', labelKey: 'labour' },
    { cause: 'OTHER', labelKey: 'other' },
];

export const NoWorkReasonSheet: React.FC<NoWorkReasonSheetProps> = ({ isOpen, onDeclare, onClose }) => {
    const { t } = useLanguage();

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" role="dialog" aria-modal="true">
            <div
                className="w-full bg-white rounded-t-3xl p-5"
                style={{ paddingBottom: 'calc(1.25rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}
                data-testid="no-work-reason-sheet"
            >
                {/* The declaration is already made; this asks only WHY, and never insists. */}
                <h2
                    className="text-lg text-gray-900"
                    style={{ fontFamily: "'Noto Serif Devanagari', serif" }}
                >
                    {t('dfes.noWorkToday')}
                </h2>
                <p
                    className="mt-1 text-sm text-gray-500"
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                >
                    {t('dfes.noWorkReasonPrompt')}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2">
                    {NO_WORK_CAUSES.map(({ cause, labelKey }) => (
                        <button
                            key={cause}
                            type="button"
                            data-testid={`no-work-chip-${cause}`}
                            onClick={() => onDeclare(cause)}
                            className="py-3 px-3 rounded-xl border border-gray-200 text-gray-700 text-sm hover:bg-gray-50 active:scale-95 transition-all"
                            style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                        >
                            {t(`dfes.noWorkReason.${labelKey}`)}
                        </button>
                    ))}
                </div>

                {/* P9 made visible: skipping is a first-class action, not a dismissal. */}
                <button
                    type="button"
                    data-testid="no-work-skip-reason"
                    onClick={() => onDeclare(undefined)}
                    className="mt-4 w-full py-3 rounded-xl bg-emerald-600 text-white font-medium text-sm active:scale-95 transition-transform"
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                >
                    {t('dfes.noWorkSkipReason')}
                </button>

                <button
                    type="button"
                    data-testid="no-work-cancel"
                    onClick={onClose}
                    className="mt-2 w-full py-2 text-sm text-gray-400"
                    style={{ fontFamily: "'Noto Sans Devanagari', sans-serif" }}
                >
                    {t('common.cancel')}
                </button>
            </div>
        </div>
    );
};
