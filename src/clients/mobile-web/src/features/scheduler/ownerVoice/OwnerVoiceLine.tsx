// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b; fills slice 10's empty slot) - the orange line on the Schedule tab: "N आवाज" with "ऐका", ONLY while at least one
// message of the schedules this plot follows is unheard on THIS plot. At 0 it draws nothing (slice 10's slot hides itself). The count and the unheard list are read live from what
// the phone holds, so a played clip (its "heard" waiting in the outbox) takes the count down at once. It writes nothing.
import React from 'react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { OwnerVoiceSlot } from '../schedulePage/OwnerVoiceSlot';
import { unheardCounts as unheardCountsOf, unheardFor } from './ownerVoiceModel';
import type { OwnerMessage } from './ownerVoiceTypes';
import { useOwnerClipPrefetch, useOwnerVoiceHost, useOwnerVoiceView } from './useOwnerVoice';
import { ownerVoiceWords } from './ownerVoiceWords';

export const OwnerVoiceLine: React.FC<{ versionIds: readonly string[]; fromNameOf: (versionId: string) => string; onListen?: (message: OwnerMessage) => void }> = ({ versionIds, fromNameOf, onListen }) => {
    const host = useOwnerVoiceHost();
    const view = useOwnerVoiceView(host !== null);
    useOwnerClipPrefetch(host?.farmId, view.messages);
    const words = ownerVoiceWords(useOptionalLanguage()?.language === 'en' ? 'en' : 'mr');
    if (!host) return null;
    const unheard = unheardFor(view, host.plotId, versionIds);
    if (unheard.length === 0) return null;
    return (
        <OwnerVoiceSlot voices={[{ id: unheard[0].id, title: words.voices(unheard.length), fromName: fromNameOf(unheard[0].scheduleVersionId), heard: false }]} playLabel={words.listen}
            onPlay={() => onListen?.(unheard[0])} />
    );
};

/** "N आवाज" per schedule version for the tiles (the version the messages came from); empty with no host. */
export function useUnheardCounts(versionIds: readonly string[]): Record<string, number> {
    const host = useOwnerVoiceHost();
    const view = useOwnerVoiceView(host !== null);
    const counts = React.useMemo(() => (host ? unheardCountsOf(view, host.plotId, versionIds) : {}), [host, view, versionIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
    return counts;
}
