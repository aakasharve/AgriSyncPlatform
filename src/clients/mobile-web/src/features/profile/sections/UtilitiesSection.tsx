/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "पाणी आणि वीज" — water sources with their motors, and the electricity timetable.
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I7 / WP-5). The approved look on the REAL
 * profile; every change goes out through `onUpdate` (the page's `onUpdateProfile`), as before:
 *   - each source: name, type, how many motors ("मोटर नाही" in orange when none); open it to see its
 *     motors (HP, फेज, वीज, ठिबक), remove a motor, CHANGE the source and its motors, or remove the
 *     source (asks first — its motors go with it);
 *   - "पाण्याचा स्रोत जोडा": the two-step form (`WaterSourceWizard`);
 *   - linking a motor to a plot was a "coming soon" alert, hidden until hover — it now says लवकरच;
 *   - the electricity timetable (`ElectricityTimingConfigurator`), single- AND three-phase;
 *   - setup is saved on this phone only, and the page says so (I3, PENDING D-9).
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, P4; founder 27 Nov: "send it to server; the phone is only a door"). Once the server has
 * sent the OPEN farm's set (`farmSetup.received`), the page reads THAT set (never another farm's, never the phone profile) and every change goes through
 * the farm-setup doors (queued, offline first): save a source with its motors, remove a source, remove one motor (the source is saved with the rest).
 * The honest lines replace "फक्त या फोनवर…": a waiting change says so under its source, a saved one says nothing, a refused one keeps its words with
 * "नवीन माहिती पहा" / "माझा बदल पुन्हा करा". The "लवकरच" line becomes the motor's own plots. A person who may not change the farm setup reads only
 * (`canEdit`; the server decides again). Before the server has sent the farm's set, the page is the phone-only page it was (an old server).
 */
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Droplets, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import type { FarmerProfile, FarmMotor, WaterResource } from '../../../domain/types/farm.types';
import ElectricityTimingConfigurator from '../components/ElectricityTimingConfigurator';
import WaterSourceWizard from '../components/WaterSourceWizard';
import { BigButton, GlassCard, IconDot, SectionHead, Soon, Tap, ThisPhoneOnly } from '../../../shared/components/ui/placeUi';
import { motorLine, setupWords } from '../components/setupLabels';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { FarmSetupRefusal, LocalFarmSetup } from '../farmSetup/farmSetupLocal';
import { closeRefusedChange, removeWaterSource, saveWaterSource } from '../farmSetup/farmSetupCommands';
import { formOfSourcePayload, toFarmMotor, toWaterResource, waterSourceInputOf } from '../farmSetup/farmSetupView';
import { PageWaitingLine, ReadOnlyLine, RefusedBox, SetupMessage, WaitingLine, saveProblemWords } from '../farmSetup/FarmSetupLines';
import { farmSetupWords } from '../farmSetup/farmSetupWords';

/**
 * Repair FIX-1 round 1 (Bug 5, CTO ruling: English mode is English only on this page) — the page's words, one language at
 * a time. Marathi exactly as before; English PROPOSED (English).
 */
const UTIL_WORDS = {
    mr: {
        sources: 'पाण्याचे स्रोत', sourcesHint: 'विहीर, बोअर, कालवा, शेततळं — आणि त्यावरच्या मोटर',
        empty: 'अजून पाण्याचा स्रोत जोडलेला नाही. स्रोत आणि त्यावरची मोटर जोडा.',
        motors: (n: number) => `${n} मोटर`, noMotor: 'मोटर नाही', noMotorHere: 'या स्रोतावर अजून मोटर जोडलेली नाही.',
        drip: 'ठिबक', filter: 'फिल्टर', flow: (n: number) => `${n} लि/तास`, removeMotor: 'ही मोटर काढा',
        soon: 'मोटर कोणत्या प्लॉटला पाणी देते ते जोडणं', change: 'स्रोत आणि मोटर बदला',
        removeAsk: 'हा स्रोत आणि त्यावरच्या सगळ्या मोटर काढायच्या?', no: 'नको', yesRemove: 'हो, काढा', remove: 'हा स्रोत काढा',
        add: 'पाण्याचा स्रोत जोडा', power: 'वीज कधी असते?', powerHint: 'सिंगल फेज आणि थ्री फेज — दोन्हीची वेळ वेगळी',
    },
    en: {
        sources: 'Water sources', sourcesHint: 'Well, borewell, canal, farm pond — and the motors on them',
        empty: 'No water source added yet. Add a source and the motor on it.',
        motors: (n: number) => `${n} ${n === 1 ? 'motor' : 'motors'}`, noMotor: 'No motor', noMotorHere: 'No motor added on this source yet.',
        drip: 'Drip', filter: 'Filter', flow: (n: number) => `${n} L/hour`, removeMotor: 'Remove this motor',
        soon: 'Linking a motor to the plots it waters', change: 'Change source and motors',
        removeAsk: 'Remove this source and all the motors on it?', no: 'No', yesRemove: 'Yes, remove', remove: 'Remove this source',
        add: 'Add a water source', power: 'When is there power?', powerHint: 'Single phase and three phase — each has its own times',
    },
};

interface UtilitiesSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
    /**
     * repair D-9 - the OPEN farm's set as this phone knows it. Absent, or not received (an old server) = the phone-only page, as before. `null` = still
     * being read: nothing is drawn that could be tapped, so a change is never made on the wrong side for a moment.
     */
    farmSetup?: LocalFarmSetup | null;
    /** repair D-9 - this person may change the farm setup on the open farm (absent = yes, the phone-only page). */
    canEdit?: boolean;
    /** repair D-9 - the open farm's plots, for the motor's "which plots it waters". */
    plots?: readonly { id: string; name: string }[];
    /** repair D-9 (P10) - the move question of what this phone held before, drawn at the top of the page (server mode only). */
    moveCard?: React.ReactNode;
}

/** null = no form; 'new' = adding; a source id = changing that source. */
type FormState = null | 'new' | string;

interface SourceView {
    source: WaterResource;
    motors: FarmMotor[];
    state: 'saved' | 'waiting' | 'refused';
    refusal: FarmSetupRefusal | null;
}

const UtilitiesSection: React.FC<UtilitiesSectionProps> = ({ profile, onUpdate, farmSetup, canEdit = true, plots = [], moveCard }) => {
    const language = useOptionalLanguage()?.language;
    const words = language === 'en' ? UTIL_WORDS.en : UTIL_WORDS.mr;
    const labels = setupWords(language);
    const setupW = farmSetupWords(language);
    const [form, setForm] = useState<FormState>(null);
    /** "माझा बदल पुन्हा करा": the form opens with what he typed (on top of the new version). */
    const [redoInitial, setRedoInitial] = useState<{ source: WaterResource; motors: FarmMotor[] } | null>(null);
    const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const server = farmSetup?.received === true ? farmSetup : null;
    const mayEdit = server ? canEdit : true;
    const loading = farmSetup === null;

    const views: SourceView[] = server
        ? server.waterSources.map(s => ({ source: toWaterResource(s.item), motors: s.item.motors.map(m => toFarmMotor(m, s.item.id)), state: s.state, refusal: s.refusal }))
        : profile.waterResources.map(source => ({ source, motors: profile.motors.filter(m => m.linkedWaterSourceId === source.id), state: 'saved', refusal: null }));
    const viewOf = (id: string) => views.find(v => v.source.id === id);

    /** A change through the farm-setup door; a save that cannot be queued says why and keeps the form. */
    const send = async (change: () => Promise<unknown>): Promise<boolean> => {
        try {
            await change();
            setMessage(null);
            return true;
        } catch (error) {
            const said = saveProblemWords(error, language);
            if (said) { setMessage(said); return false; }
            throw error;
        }
    };

    const handleSaveSourceWithMotors = async (source: WaterResource, motors: FarmMotor[]) => {
        if (server) {
            if (!(await send(() => saveWaterSource(waterSourceInputOf(server.farmId, source, motors))))) return;
        } else {
            const exists = profile.waterResources.some(w => w.id === source.id);
            onUpdate({
                ...profile,
                waterResources: exists ? profile.waterResources.map(w => (w.id === source.id ? source : w)) : [...profile.waterResources, source],
                motors: [...profile.motors.filter(m => m.linkedWaterSourceId !== source.id), ...motors],
            });
        }
        setForm(null);
        setRedoInitial(null);
        setExpandedSourceId(source.id);
    };

    const deleteSource = async (id: string) => {
        if (server) {
            if (!(await send(() => removeWaterSource({ farmId: server.farmId, waterSourceId: id })))) return;
        } else {
            onUpdate({
                ...profile,
                waterResources: profile.waterResources.filter(w => w.id !== id),
                motors: profile.motors.filter(m => m.linkedWaterSourceId !== id),
            });
        }
        setConfirmDeleteId(null);
    };

    const deleteMotor = async (sourceId: string, motorId: string) => {
        if (server) {
            const v = viewOf(sourceId);
            if (!v) return;
            await send(() => saveWaterSource(waterSourceInputOf(server.farmId, v.source, v.motors.filter(m => m.id !== motorId))));
            return;
        }
        onUpdate({ ...profile, motors: profile.motors.filter(m => m.id !== motorId) });
    };

    const seeNew = async (refusal: FarmSetupRefusal) => { await closeRefusedChange(refusal.rowId); };
    const redo = async (sourceId: string, refusal: FarmSetupRefusal) => {
        await closeRefusedChange(refusal.rowId);
        setRedoInitial(formOfSourcePayload(refusal.payload));
        setForm(sourceId);
    };

    /** The plots a motor waters (repair D-9: from the plots' water links of the open farm). */
    const plotsOfMotor = (motorId: string): string[] => {
        if (!server) return [];
        const ids = [...server.plotWater.values()].filter(p => p.item.links.some(l => l.motorId === motorId)).map(p => p.item.plotId);
        return plots.filter(p => ids.includes(p.id)).map(p => p.name);
    };

    const editingView = form && form !== 'new' ? viewOf(form) : undefined;
    const initial = redoInitial ?? (editingView ? { source: editingView.source, motors: editingView.motors } : undefined);

    if (loading) return <div className="space-y-3" data-testid="hub-water-power" aria-busy="true" />;

    return (
        <div className="space-y-3" data-testid="hub-water-power">
            {server ? <PageWaitingLine count={server.waitingCount} language={language} /> : <ThisPhoneOnly language={language} />}
            {server && !mayEdit && <ReadOnlyLine language={language} />}
            {server && moveCard}
            <SetupMessage text={message} />
            <SectionHead title={words.sources} hint={words.sourcesHint} />

            {views.length === 0 && !form && (
                <GlassCard testId="sources-empty">
                    <div className="flex items-center gap-3">
                        <IconDot tone="blue"><Droplets size={22} aria-hidden="true" /></IconDot>
                        <p className="m-0 text-[15px] font-bold leading-snug text-stone-700">{words.empty}</p>
                    </div>
                </GlassCard>
            )}

            {views.map(({ source, motors: linkedMotors, state, refusal }) => {
                const isOpen = expandedSourceId === source.id;
                return (
                    <section key={source.id} data-testid={`source-${source.id}`}
                        className="overflow-hidden rounded-3xl border border-white/60 bg-white/80 shadow-[0_4px_18px_-8px_rgba(28,25,23,0.18)] backdrop-blur-md">
                        <Tap onClick={() => setExpandedSourceId(isOpen ? null : source.id)} aria-expanded={isOpen} data-testid={`source-toggle-${source.id}`}
                            className="flex min-h-[68px] w-full items-center gap-3 px-3.5 py-2.5 text-left">
                            <IconDot tone="blue"><Droplets size={22} aria-hidden="true" /></IconDot>
                            <span className="min-w-0 flex-1">
                                <span className="block text-[16.5px] font-extrabold text-stone-900">{source.name}</span>
                                <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold">
                                    <span className="text-stone-500">{labels.sourceType[source.type] ?? source.type}</span>
                                    {linkedMotors.length
                                        ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} aria-hidden="true" />{words.motors(linkedMotors.length)}</span>
                                        : <span className="flex items-center gap-1 text-orange-600" data-testid={`no-motor-${source.id}`}><AlertTriangle size={13} aria-hidden="true" />{words.noMotor}</span>}
                                </span>
                            </span>
                            <ChevronDown size={22} className={`shrink-0 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                        </Tap>
                        {(state === 'waiting' || refusal) && (
                            <div className="px-3.5 pb-2.5">
                                {state === 'waiting' && <WaitingLine language={language} />}
                                {refusal && <RefusedBox refusal={refusal} language={language} onSeeNew={() => { void seeNew(refusal); }}
                                    onRedo={mayEdit && refusal.mutationType.endsWith('.save') ? () => { void redo(source.id, refusal); } : undefined} />}
                            </div>
                        )}
                        {isOpen && (
                            <div className="space-y-2 border-t border-stone-100 px-3 pb-3 pt-2.5">
                                {linkedMotors.length === 0 && <p className="m-0 text-[14px] font-bold text-stone-500">{words.noMotorHere}</p>}
                                {linkedMotors.map(m => {
                                    const watered = plotsOfMotor(m.id);
                                    return (
                                        <div key={m.id} className="flex items-start gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid={`motor-${m.id}`}>
                                            <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-stone-800 text-white"><Settings2 size={19} aria-hidden="true" /></span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-[15.5px] font-extrabold text-stone-900">{m.name}</span>
                                                <span className="block text-[13px] font-bold text-stone-600">{motorLine(m, language)}</span>
                                                {m.dripDetails && (
                                                    <span className="mt-1 inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[12.5px] font-extrabold text-emerald-800 ring-1 ring-emerald-100">
                                                        <Droplets size={12} aria-hidden="true" />{words.drip}{m.dripDetails.pipeSize ? `: ${labels.pipe(m.dripDetails.pipeSize)}` : ''}{m.dripDetails.hasFilter ? ` · ${words.filter}` : ''}{m.dripDetails.flowRatePerHour ? ` · ${words.flow(m.dripDetails.flowRatePerHour)}` : ''}
                                                    </span>
                                                )}
                                                {server && (
                                                    <span className="mt-1 block text-[13px] font-bold text-stone-600 [overflow-wrap:anywhere]" data-testid={`motor-plots-${m.id}`}>
                                                        {setupW.motorWaters}: {watered.length > 0 ? watered.join(', ') : setupW.motorWatersNone}
                                                    </span>
                                                )}
                                            </span>
                                            {mayEdit && (
                                                <Tap onClick={() => { void deleteMotor(source.id, m.id); }} aria-label={words.removeMotor} data-testid={`motor-remove-${m.id}`}
                                                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-500 ring-1 ring-stone-200"><Trash2 size={18} aria-hidden="true" /></Tap>
                                            )}
                                        </div>
                                    );
                                })}
                                {!server && <Soon what={words.soon} language={language} />}
                                {mayEdit && (
                                    <Tap onClick={() => { setRedoInitial(null); setForm(source.id); setConfirmDeleteId(null); }} data-testid={`source-edit-${source.id}`}
                                        className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-full bg-blue-50 text-[15px] font-extrabold text-blue-800 ring-1 ring-blue-200">
                                        <Pencil size={16} aria-hidden="true" />{words.change}
                                    </Tap>
                                )}
                                {mayEdit && (confirmDeleteId === source.id ? (
                                    <div className="rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-200" data-testid={`source-remove-confirm-${source.id}`}>
                                        <p className="m-0 text-[14.5px] font-extrabold text-rose-900">{words.removeAsk}</p>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <Tap onClick={() => setConfirmDeleteId(null)} className="min-h-[46px] rounded-full bg-white text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300">{words.no}</Tap>
                                            <Tap onClick={() => { void deleteSource(source.id); }} data-testid={`source-remove-yes-${source.id}`} className="min-h-[46px] rounded-full bg-rose-600 text-[14px] font-extrabold text-white">{words.yesRemove}</Tap>
                                        </div>
                                    </div>
                                ) : (
                                    <Tap onClick={() => setConfirmDeleteId(source.id)} data-testid={`source-remove-${source.id}`}
                                        className="flex min-h-[46px] w-full items-center justify-center gap-1.5 rounded-full text-[14px] font-extrabold text-rose-700 ring-1 ring-rose-200">
                                        <Trash2 size={16} aria-hidden="true" />{words.remove}
                                    </Tap>
                                ))}
                            </div>
                        )}
                    </section>
                );
            })}

            {form ? (
                <WaterSourceWizard
                    key={`${form}:${redoInitial ? 'redo' : 'own'}`}
                    initial={initial}
                    onSave={(source, motors) => { void handleSaveSourceWithMotors(source, motors); }}
                    onCancel={() => { setForm(null); setRedoInitial(null); }}
                    serverIds={!!server}
                />
            ) : mayEdit && (
                <BigButton onClick={() => setForm('new')} tone="white" testId="source-add"><Plus size={20} aria-hidden="true" />{words.add}</BigButton>
            )}

            <SectionHead title={words.power} hint={words.powerHint} />
            <ElectricityTimingConfigurator profile={profile} onUpdate={onUpdate} farmSetup={server} canEdit={mayEdit} />
        </div>
    );
};

export default UtilitiesSection;
