/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes E1 + OF) — THE "बदला" screen's data and save, opened by
 * `openCorrection(logId)` from the result screen, आढावा and the saved card (moved out of `SpeakHost`, unchanged in what it
 * owns: the ONE mic for the change, the save as a new content version).
 *
 * Lane OF (founder D-61 = 5A + rule TAP-1): ONE working copy of the entry (`tapEdit.ts`). What he says or types is merged
 * into it (the existing rule: a part he spoke of replaces that part), and every tap changes it too; "जतन करा" sends the
 * difference — queued, so a tap change works with no internet (P10).
 * Lane OF (founder D-57 = 1A): a record the हजेरी door saved opens THAT DAY in the हजेरी वही (the people are changed
 * there, by tapping), for someone who may open हजेरी; anyone else is told where it can be changed.
 * Lane OF-M fix pass 3 (call 1): someone who did not make the entry and does not check money keeps its prices as saved
 * (`pricesKept.ts`), told in one plain line; every other part stays his to change.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DailyLog } from '../../types';
import { useOptionalLanguage } from '../../i18n/LanguageContext';
import { getSessionUserId } from '../../infrastructure/storage/AuthTokenStore';
import { mayShowFarmMoney } from '../../features/labour/homeAttendanceDoor';
import { requestLabourOpening } from '../../features/labour/labourOpening';
import CorrectionScreen from '../../features/logs/components/correction/CorrectionScreen';
import { correctionWords } from '../../features/logs/components/correction/correctionWords';
import {
    blockerChange, isLabourDoorLog, mergeCorrection, revisionUpdates, saysAnything, spokenAsLog,
} from '../../features/logs/components/correction/correctionModel';
import { saveSpokenCorrection, type SaveCorrectionDeps, type SaveOutcome } from '../../features/logs/components/correction/saveCorrection';
import { refusalLines, useRefusedChange, type RefusedChange } from '../../features/logs/components/correction/refusedRevision';
import { moneyNotFollowedLines, useMoneyNotFollowedOf } from '../../features/logs/components/correction/moneyNotFollowed';
import { hasPricedLine, isPricedPart, keepSavedPrices } from '../../features/logs/components/correction/pricesKept';
import { useCreatedOnThisPhone } from '../../features/logs/components/correction/madeOnThisPhone';
import {
    afterOf, canRemove, newItem, partnersOf, tapRows, tapUpdates, withItem, withNew, withRestored, withoutItem, type AddKind, type TapBucket, type TapRow,
} from '../../features/logs/components/correction/tapEdit';
import { AddKindSheet, TapEditSheet, TypeChangeSheet } from '../../features/logs/components/correction/TapEditSheet';
import { canMoveSavedEntry, canQueueLabourCountOffline, isSamePlace, queueSavedEntryMove, type SavedEntryMove } from '../../features/logs/components/correction/correctionCapabilities';
import { placeWords } from '../../shared/names/placeWords';
import { isConfirmed } from '../../features/logs/components/voiceResult/resultModel';
import { useLastSyncAt } from '../../features/logs/components/voiceResult/useRecordingTrust';
import { dayFull } from '../../features/logs/components/dayPick/dayWords';
import { DayPickSheet } from '../../features/logs/components/dayPick/DayPickSheet';
import { PlacePickerSheet } from '../../features/context/components/PlacePickerSheet';
import { idGenerator } from '../domain/services/IdGenerator';
import { formatFarmerLogTime } from '../navigation/helpers';
import type { AppRouterContext } from '../navigation/routeContext';
import { useBackDismiss } from '../navigation/useBackDismiss';
import { FARM_GLOBAL } from './speakFlow';
import { closeCorrection, requestSpeak, setCorrectionWorking, type CorrectionSession, type SpeakLanding, type SpeakPlace, setCorrectionProposal } from './speakStore';

/** What the router gives the "बदला" screen to save with (the language is the screen's own). */
export type CorrectionSaveDeps = Omit<SaveCorrectionDeps, 'language'>;

/**
 * The entry's own place, for the mic that speaks its change: its plot, else the whole farm — the recorder works on a
 * plot or the whole farm only, so a crop-level entry is spoken in the whole farm's context (review B006: never a mic
 * that cannot start). Its words are read for that one entry either way.
 */
export function placeOfLog(log: DailyLog): SpeakPlace {
    const sel = log.context?.selection?.[0];
    const plotId = sel?.selectedPlotIds?.[0];
    if (!sel || sel.cropId === FARM_GLOBAL || !plotId) return { cropId: FARM_GLOBAL };
    return { cropId: sel.cropId, plotId };
}

/** Where the entry is, as the record names it ("द्राक्ष · सोनाका"; the crop alone for a crop-level entry). */
const entryPlaceLabel = (log: DailyLog, crops: AppRouterContext['crops'], language: string | null | undefined, wholeFarm: string): string => {
    const sel = log.context?.selection?.[0];
    if (!sel || sel.cropId === FARM_GLOBAL) return wholeFarm;
    const crop = crops.find(c => c.id === sel.cropId);
    // Lane OF fix 1 (10): the shared rule — a plot named after its crop is said alone.
    return placeWords(crop?.name ?? sel.cropName, sel.selectedPlotNames ?? [], language);
};

const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

type Sheet = { kind: 'edit'; bucket: TapBucket; id: string; added?: boolean } | { kind: 'add' } | { kind: 'type' } | { kind: 'plot' } | { kind: 'day' } | null;

/** Lane OF-S — the plain lines for a refused change (lane OF-M fix pass 3: a refused price change also says who may). */
const refusedLines = (refused: RefusedChange | null, language: string | undefined): string[] | undefined =>
    (refused ? refusalLines(refused, language) : undefined);

export const CorrectionHost: React.FC<{
    ctx: AppRouterContext; correction: CorrectionSession; speaking: boolean; save: CorrectionSaveDeps | null;
    readRefused: (logId: string) => Promise<RefusedChange | null>; readMoneyNotFollowed: (logId: string) => Promise<string[]>;
}> = ({ ctx, correction, speaking, save, readRefused, readMoneyNotFollowed }) => {
    const language = useOptionalLanguage()?.language;
    const log = ctx.history.find(l => l.id === correction.logId);
    const [saving, setSaving] = useState(false);
    const [failed, setFailed] = useState<'labour' | 'other' | null>(null);
    const [offline, setOffline] = useState(false);
    const [working, setWorking] = useState<DailyLog | null>(null);
    const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
    const [sheet, setSheet] = useState<Sheet>(null);
    const [keepOne, setKeepOne] = useState(false);
    const [move, setMove] = useState<SavedEntryMove>({});
    const [spoken, setSpoken] = useState<{ transcript: string; typed: boolean; nothing: boolean; labourNotChanged?: boolean } | undefined>(undefined);
    const applied = useRef<CorrectionSession['proposal']>(null);
    const serverRefused = useRefusedChange(log?.id, readRefused);
    // Lane OF-M — the money of his saved changes that could not follow them, and why; read again when a sync lands (fix
    // pass 1, review 10), so an answer that arrives while this screen is open is said here.
    const moneyNotFollowed = useMoneyNotFollowedOf(log ? [log.id] : [], readMoneyNotFollowed, useLastSyncAt());
    // A record that is no longer here (deleted meanwhile) has nothing to change: the screen closes.
    useEffect(() => { if (!log) closeCorrection(); }, [log]);
    // Lane OF (D-57) — a हजेरी-door record: that day in the हजेरी वही, for someone who may open हजेरी.
    const toHajeri = !!log && isLabourDoorLog(log) && ctx.canOpenAttendanceFromHome;
    const latestCtx = useRef(ctx);
    latestCtx.current = ctx;
    const hajeriDay = toHajeri ? log?.date : undefined;
    useEffect(() => {
        if (!hajeriDay) return;
        const c = latestCtx.current;
        closeCorrection();
        requestLabourOpening({ screen: 'day', date: hajeriDay });
        if (c.openPlace) c.openPlace('labour'); else c.setCurrentRoute('labour');
    }, [hajeriDay]);
    useBackDismiss(!!log && !speaking && !saving && sheet === null, closeCorrection);

    const sessionUserId = getSessionUserId();
    // Lane OF-M fix pass 5 (N5) — the maker as the server decides it: the person who sends the create. Its stamp says so
    // once its pull is back; before that a non-owner's phone stamps the primary owner, so its own outbox decides.
    const madeHere = useCreatedOnThisPhone(log?.id);
    const isMaker = (!!log?.meta?.createdByOperatorId && log.meta.createdByOperatorId === sessionUserId) || madeHere;
    const hideMoney = !mayShowFarmMoney(ctx.farmRole, ctx.maySeeMoney) && !isMaker;
    // Lane OF-M fix pass 3 (call 1) — only the entry's maker, or someone who checks money, changes its prices (the server
    // refuses anyone else's price change whole). Not known (no farm context yet) = not held back here; the server decides.
    // TODO(D-12): when money can be approved, approved money will be changed only by someone who checks money.
    const pricesLocked = !!log && !isMaker && ctx.mayReviewMoney === false;
    const base = useMemo(() => {
        const copy = working ?? log;
        return copy && log && pricesLocked ? keepSavedPrices(log, copy) : copy;
    }, [working, log, pricesLocked]);

    // What he said (or typed) is merged into the working copy once (a part he spoke of replaces that part).
    const proposal = correction.proposal;
    useEffect(() => {
        if (!log || !proposal || applied.current === proposal || !base) return;
        applied.current = proposal;
        const fresh = spokenAsLog(proposal.draft, log, { crops: ctx.crops, profile: ctx.farmerProfile });
        const merged = fresh ? mergeCorrection(base, proposal.draft, fresh) : null;
        const before = JSON.stringify(afterOf(base, removed));
        const next = merged?.after ?? base;
        const shown = pricesLocked ? keepSavedPrices(log, next) : next; // a price he said is not taken (call 1)
        setSpoken({
            transcript: (proposal.draft.fullTranscript ?? '').trim(),
            typed: proposal.typed,
            nothing: !saysAnything(proposal.draft) || JSON.stringify(afterOf(shown, removed)) === before,
            labourNotChanged: merged?.labourNotChanged,
        });
        setWorking(next);
    }, [log, proposal, base, removed, ctx.crops, ctx.farmerProfile, pricesLocked]);

    const rows = useMemo(() => {
        if (!log || !base) return [];
        const all = tapRows(log, base, removed, language);
        // A priced part is not removed by someone who may not change its price (call 1).
        return pricesLocked ? all.map(r => (isPricedPart(log, r.bucket, r.id) ? { ...r, removable: false } : r)) : all;
    }, [log, base, removed, language, pricesLocked]);
    const after = useMemo(() => (base ? afterOf(base, removed) : undefined), [base, removed]);
    // Lane OF fix 1 (L7): what he says next is understood against what he sees (his taps applied), not the saved version.
    const logId = log?.id;
    useEffect(() => {
        if (!logId || !after) return undefined;
        setCorrectionWorking({ logId, log: after });
        return () => setCorrectionWorking(null);
    }, [logId, after]);
    if (!log || !base || !after || toHajeri) return null;

    const updates = {
        ...tapUpdates(log, after),
        ...(JSON.stringify(log.disturbance ?? null) !== JSON.stringify(after.disturbance ?? null) && { disturbance: after.disturbance }),
    };
    const canMove = canMoveSavedEntry();
    // OF-S: a move of a SAVED entry (plot / day) — only once the server can carry it (`correctionCapabilities`).
    // Lane OF-S fix 1 (B006): choosing the place or day it already has is not a change.
    const moving = canMove && ((!!move.scope && !isSamePlace(log, move.scope)) || (!!move.dateKey && move.dateKey !== log.date));
    const changed = Object.keys(updates).length > 0 || moving;
    const blockers = blockerChange(log, after, language);

    const speak = (typed?: string) => {
        setFailed(null);
        // Review B004: a change needs the internet to be understood — offline nothing is recorded or kept.
        if (isOffline()) { setOffline(true); return; }
        setOffline(false);
        requestSpeak({
            purpose: 'correctEntry',
            context: { place: placeOfLog(log), logId: log.id, ...(typed && { typed }) },
            returnTo: { route: ctx.currentRoute, mainView: ctx.mainView },
            onLanded: (landing: SpeakLanding) => {
                if (landing.kind === 'parsed') setCorrectionProposal({ draft: landing.draft, typed: landing.typed });
                // Something already waited on the log tab and he was taken to it: this screen steps aside (nothing saved).
                if (landing.kind === 'handedOver') closeCorrection();
            },
        });
    };

    const toggle = (row: TapRow) => {
        // What moves with this row (fix 1, M6): planned work and its reminder notes, a reminder and its own task.
        const group = [row.id, ...partnersOf(row.gone ? log : base, row.id)];
        if (row.gone) {
            // A saved part his words left out comes back as it was saved (fix 1, L7).
            setWorking(group.reduce((w, id) => withRestored(w, log, id), base));
            setKeepOne(false);
            return;
        }
        if (row.removed) {
            setRemoved(prev => { const n = new Set(prev); group.forEach(id => n.delete(id)); return n; });
            setKeepOne(false);
            return;
        }
        if (!canRemove(rows, row.id)) { setKeepOne(true); return; }
        setKeepOne(false);
        // A part he added here and removes again simply goes; a saved part is struck through until he brings it back.
        if (row.isNew) setWorking(withoutItem(base, row.bucket, row.id));
        else setRemoved(prev => { const n = new Set(prev); group.forEach(id => n.add(id)); return n; });
    };

    const addKind = (kind: AddKind) => {
        const item = newItem(kind, idGenerator);
        setWorking(withNew(base, kind, item));
        setSheet({ kind: 'edit', bucket: kind, id: item.id as string, added: true });
    };

    const doSave = () => {
        if (!changed || saving) return;
        if (!save) { setFailed('other'); return; } // a preview: nothing can be saved, and it says so
        // A worker count goes as a labour correction: queued since lane OF-S; posted now (needs the internet) only if
        // that switch is ever turned back off.
        if (updates.labour && isOffline() && !canQueueLabourCountOffline()) { setFailed('labour'); return; }
        setSaving(true);
        setFailed(null);
        const merge = { updates, replaced: [], after, labourNotChanged: false };
        const content = Object.keys(updates).length > 0
            ? saveSpokenCorrection({ ...save, language: language === 'en' ? 'en' : 'mr' }, log, revisionUpdates(log, merge))
            : Promise.resolve<SaveOutcome>({ ok: true });
        void content
            .then(async (outcome): Promise<SaveOutcome> => {
                if (!outcome.ok || !moving) return outcome;
                // Lane OF-S — queued like every other change; written on this phone through the same edit path.
                await queueSavedEntryMove(log, move, { crops: ctx.crops, updateLog: save.updateLog, setHistory: save.setHistory, profile: save.profile });
                return outcome;
            })
            .catch((error: unknown): SaveOutcome => {
                // Never silent: what failed is kept in the log; he is told it was not saved and can press again.
                console.error('CorrectionHost: the change could not be saved', error);
                return { ok: false, reason: 'other' };
            })
            .then(outcome => { setSaving(false); if (outcome.ok) closeCorrection(); else setFailed(outcome.reason); });
    };

    const words = correctionWords(language);
    const editing = sheet?.kind === 'edit' ? (base[sheet.bucket] as Array<{ id?: string }> | undefined)?.find(i => i.id === sheet.id) : undefined;
    const closeEdit = () => {
        // A part he started to add and cancelled is not kept.
        if (sheet?.kind === 'edit' && sheet.added) setWorking(withoutItem(base, sheet.bucket, sheet.id));
        setSheet(null);
    };
    return (
        <>
            <CorrectionScreen
                timeLabel={formatFarmerLogTime(log.meta?.createdAtISO)}
                placeLabel={entryPlaceLabel(log, ctx.crops, language, words.wholeFarm)}
                dayLabel={dayFull(move.dateKey ?? log.date, language)}
                confirmed={isConfirmed(log)}
                spoken={spoken}
                rows={hideMoney ? rows.map(r => (r.part === 'expense' ? { ...r, text: '—', was: r.was === undefined ? undefined : '—' } : r)) : rows}
                blockers={blockers}
                changed={changed}
                keepOne={keepOne}
                refused={isLabourDoorLog(log)}
                saving={saving}
                saveFailed={failed !== null}
                saveFailedReason={failed ?? undefined}
                offline={offline}
                serverRefused={!!serverRefused}
                serverRefusedLines={refusedLines(serverRefused, language)}
                // Money is not talked about to someone who may not see it (the screen's own rule).
                moneyNotFollowedLines={hideMoney ? [] : moneyNotFollowedLines(moneyNotFollowed, language)}
                pricesLockedLine={pricesLocked && hasPricedLine(log) ? words.pricesLocked : undefined}
                canMove={canMove}
                onSpeak={() => speak()}
                onType={() => { if (isOffline()) { setOffline(true); return; } setSheet({ kind: 'type' }); }}
                onSave={doSave}
                // Back: nothing is saved.
                onBack={() => { if (!saving) closeCorrection(); }}
                onEditRow={row => setSheet({ kind: 'edit', bucket: row.bucket, id: row.id })}
                onToggleRow={toggle}
                onAdd={() => setSheet({ kind: 'add' })}
                onChangePlot={canMove ? () => setSheet({ kind: 'plot' }) : undefined}
                onChangeDay={canMove ? () => setSheet({ kind: 'day' }) : undefined}
            />
            {sheet?.kind === 'edit' && editing && (
                <TapEditSheet bucket={sheet.bucket} item={editing} labourNeedsNet={isOffline() && !canQueueLabourCountOffline()}
                    onCancel={closeEdit}
                    onOk={next => { setWorking(withItem(base, sheet.bucket, sheet.id, () => next as { id?: string })); setSheet(null); }} />
            )}
            {sheet?.kind === 'add' && <AddKindSheet onPick={addKind} onCancel={() => setSheet(null)} />}
            {sheet?.kind === 'type' && <TypeChangeSheet onCancel={() => setSheet(null)} onSend={text => { setSheet(null); speak(text); }} />}
            {sheet?.kind === 'plot' && (
                <PlacePickerSheet crops={ctx.crops} marked={{ plotIds: log.context?.selection?.[0]?.selectedPlotIds ?? [], label: words.changePlot }}
                    onPick={scope => { setMove(m => ({ ...m, scope })); setSheet(null); }} onClose={() => setSheet(null)} />
            )}
            {sheet?.kind === 'day' && (
                <DayPickSheet value={move.dateKey ?? log.date} onPick={key => { setMove(m => ({ ...m, dateKey: key })); setSheet(null); }} onClose={() => setSheet(null)} />
            )}
        </>
    );
};

export default CorrectionHost;
