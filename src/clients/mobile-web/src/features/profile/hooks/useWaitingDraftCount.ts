/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I17) — how many offline notes are waiting for the farmer's
 * review. Lane OF (founder D-59): bill / sale-slip photos only — voice recordings moved to आवाज नोंदी, counted by
 * `listWaitingVoiceNotes`. The same list the review page reads, so
 * the row's number and the page's rows always agree. The setup hub shows that row only
 * while this is above zero. A phone database that cannot be read counts as "none waiting" for the row
 * only — nothing is marked or changed here.
 */
import { useEffect, useState } from 'react';
import { listUnreviewedAiResults } from '../../../infrastructure/sync/PendingAiResultsReader';

export function useWaitingDraftCount(): number {
    const [count, setCount] = useState(0);
    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                // Lane OF (D-59) — voice recordings live in आवाज नोंदी now; this row keeps the bill / slip photos only.
                const waiting = (await listUnreviewedAiResults()).filter(job => job.operationType !== 'voice_parse');
                if (alive) setCount(waiting.length);
            } catch {
                // keep 0: the row stays hidden rather than promising notes nobody can list
            }
        })();
        return () => { alive = false; };
    }, []);
    return count;
}
