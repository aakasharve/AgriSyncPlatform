/**
 * spec: pre-launch-repair L2a (D-19 "honest upload states") — one money entry's (or one bill's) standing in
 * words: पाठवणे बाकी (on this phone, not yet acknowledged; founder D-40 / D-45) ·
 * शेतनोंदीत जमा ✓ (the server acknowledged it) · मदत कराल का? (it needs the farmer). The label comes from
 * the one state → words pairing (`SYNC_HONESTY_I18N_KEYS`), never restated here. In Marathi, because the
 * pages that show it (खरेदी, वही) are Marathi pages. `null` = no evidence either way → nothing is shown.
 * A plain chip, not the header's button, so it can sit inside a tappable card.
 */
import React from 'react';
import { t } from '../../../i18n/translations';
import { SYNC_HONESTY_I18N_KEYS, type SyncHonestyClaim, type SyncHonestyState } from '../../sync/status/syncHonestyState';
import { Chip, type Tone } from '../../../shared/components/ui/placeUi';

// Founder D-40 / D-45 (2026-10-27): an entry still on this phone reads "पाठवणे बाकी" — never a "saved" word
// before the server has it. The header chip moves to the same words with lane L4b.
const NOT_SENT_YET = 'पाठवणे बाकी';

const TONE: Record<SyncHonestyState, Tone> = { ON_PHONE: 'amber', ON_SERVER: 'stone', NEEDS_FIX: 'rose' };

export const MoneyStateChip: React.FC<{ claim: SyncHonestyClaim; testId?: string }> = ({ claim, testId }) => {
    if (!claim) return null;
    return (
        <span data-testid={testId} data-state={claim}>
            <Chip tone={TONE[claim]}>{claim === 'ON_PHONE' ? NOT_SENT_YET : t(SYNC_HONESTY_I18N_KEYS[claim], 'mr')}</Chip>
        </span>
    );
};
