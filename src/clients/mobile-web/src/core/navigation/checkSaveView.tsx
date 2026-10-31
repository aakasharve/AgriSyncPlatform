/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-58 = 2A) — what the आजची कामे tab shows for a
 * parse the voice auto-save did not save by itself (nothing understood, Sathi thinks it was another plot, or the phone
 * could not write it). It was the old hand-filled form (MULCHING / PRUNING); now it is "तपासा आणि जतन करा", saying what
 * is unclear, with his words always on it:
 *
 *   - "पुन्हा सांगा" opens THE one mic (MIC-1) on the same plots (and the same past day, D-60), the parse put down first;
 *   - "बोलता येत नसेल तर इथे लिहा" sends what he types through the same understanding;
 *   - the place chip opens the canonical crop → plot steps, Sathi's guess marked (rule CTX-1); the day chip opens the
 *     calendar (rule TAP-1);
 *   - "जतन करा" / "पुन्हा जतन करा" saves through the voice save itself (`saveCheckedDraft`: same unconfirmed capture,
 *     same clip link) and lands on the ONE result screen.
 */
import React, { useMemo, useState } from 'react';
import type { LogScope } from '../../types';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { getDateKey } from '../domain/services/DateKeyService';
import { draftProvenance } from '../../features/voice/draftProvenance';
import { bindDraftAfterSave, draftAfterSave, draftDay, draftDecline } from '../../features/voice/draftFacts';
import { TypedSheet } from '../../features/voice/components/recorder/TypedEntry';
import CheckSaveScreen from '../../features/logs/components/checkSave/CheckSaveScreen';
import { checkSaveWords } from '../../features/logs/components/checkSave/checkSaveWords';
import {
    checkCaseOf, guessScope, hasPlace, placeLabel, previewLogs, understoodOf,
} from '../../features/logs/components/checkSave/checkSaveModel';
import { DayPickSheet } from '../../features/logs/components/dayPick/DayPickSheet';
import { dayFull, dayRel } from '../../features/logs/components/dayPick/dayWords';
import { PlacePickerSheet } from '../../features/context/components/PlacePickerSheet';
import { requestSpeak } from '../speak/speakStore';
import type { AppRouterContext } from './routeContext';

type Open = 'place' | 'day' | 'type' | null;

export const CheckSaveHost: React.FC<{ ctx: AppRouterContext }> = ({ ctx }) => {
    const language = useOptionalLanguage()?.language;
    const w = checkSaveWords(language);
    const draft = ctx.draftLog;
    const todayKey = getDateKey();
    const decline = draftDecline(draft);
    const kind = draft ? checkCaseOf(draft, decline?.reason) : 'unclear';
    const startPlace = hasPlace(ctx.logScope) ? ctx.logScope : null;
    // Another plot: nothing is chosen for him until he picks it in the canonical steps.
    const [chosen, setChosen] = useState<LogScope | null>(kind === 'otherPlot' ? null : startPlace);
    const [day, setDay] = useState<string>(() => draftDay(draft) ?? todayKey);
    const [open, setOpen] = useState<Open>(null);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState(false);
    const logs = useMemo(() => (draft ? previewLogs(draft, chosen, ctx.crops, ctx.farmerProfile) : []), [draft, chosen, ctx.crops, ctx.farmerProfile]);
    const understood = useMemo(() => understoodOf(logs, language), [logs, language]);
    if (!draft) return null;

    const guess = guessScope(draft);
    const typed = decline?.recording?.typed === true;
    const pastDay = day !== todayKey ? day : undefined;

    // "पुन्हा सांगा" / typing: the parse is put down, then THE one mic opens on the same plots (and day). Deferred one
    // turn, so the mic never sees this parse still waiting and hands him back here.
    const speakAgain = (text?: string) => {
        if (chosen && kind === 'otherPlot') ctx.setLogScope(chosen);
        ctx.setDraftLog(null);
        ctx.setMode('voice');
        // Fix 2 (carried): whoever waited for THIS draft to be saved waits for the words said again instead.
        const afterSave = draftAfterSave(draft);
        window.setTimeout(() => {
            requestSpeak({
                purpose: 'addToDay',
                context: { place: 'current', ...(pastDay && { date: pastDay }), ...(text && { typed: text }) },
                returnTo: { route: 'main', mainView: 'log' },
                ...(afterSave && { onLanded: landing => { if (landing.kind === 'saved') afterSave(landing.logIds); } }),
            });
        }, 0);
    };

    const save = () => {
        if (!chosen || saving || !ctx.saveCheckedDraft) return;
        setSaving(true);
        setFailed(false);
        void ctx.saveCheckedDraft(draft, draftProvenance(draft), { scope: chosen, dateKey: pastDay, recording: decline?.recording })
            .then(written => {
                setSaving(false);
                if (!written) { setFailed(true); return; }
                // Fix 2 (carried): the request that said it again hears "saved" (the old recording leaves आवाज नोंदी), once.
                const afterSave = draftAfterSave(draft);
                bindDraftAfterSave(draft, undefined);
                afterSave?.(written.map(l => l.id));
                // The result screen's "आणखी सांगा" speaks for the place he chose here.
                ctx.setLogScope(chosen);
                ctx.setDraftLog(null);
            });
    };

    const daysWithRecords = new Set(ctx.history.map(l => l.date));
    return (
        <>
            <CheckSaveScreen
                kind={kind}
                transcript={(draft.fullTranscript ?? '').trim()}
                typed={typed}
                understood={understood}
                placeLabel={placeLabel(chosen, ctx.crops, language, w.wholeFarm)}
                chosenLabel={placeLabel(startPlace, ctx.crops, language, w.wholeFarm)}
                guessLabel={placeLabel(guess, ctx.crops, language, w.wholeFarm)}
                dayLabel={dayRel(day, todayKey, language)}
                dayNote={pastDay ? w.dayNote(dayFull(pastDay, language)) : undefined}
                saving={saving}
                saveFailed={failed}
                kept={!typed}
                onSayAgain={() => speakAgain()}
                onType={() => setOpen('type')}
                onPickPlace={() => setOpen('place')}
                onPickDay={() => setOpen('day')}
                onSave={save}
            />
            {open === 'place' && (
                <PlacePickerSheet
                    crops={ctx.crops}
                    marked={guess ? { plotIds: guess.selectedPlotIds, label: w.guessTag } : chosen ? { plotIds: chosen.selectedPlotIds, label: w.nowTag } : undefined}
                    forDay={pastDay ? dayRel(pastDay, todayKey, language) : undefined}
                    onPick={scope => { setChosen(scope); setOpen(null); }}
                    onClose={() => setOpen(null)}
                />
            )}
            {open === 'day' && (
                <DayPickSheet value={day} note={w.dayFor} hasRecords={key => daysWithRecords.has(key)} todayKey={todayKey}
                    onPick={key => { setDay(key); setOpen(null); }} onClose={() => setOpen(null)} />
            )}
            {open === 'type' && <TypedSheet onClose={() => setOpen(null)} onSend={text => { setOpen(null); speakAgain(text); }} />}
        </>
    );
};

export default CheckSaveHost;
