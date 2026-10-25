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
 */
import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Droplets, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import type { FarmerProfile, FarmMotor, WaterResource } from '../../../domain/types/farm.types';
import ElectricityTimingConfigurator from '../components/ElectricityTimingConfigurator';
import WaterSourceWizard from '../components/WaterSourceWizard';
import { BigButton, GlassCard, IconDot, SectionHead, Soon, Tap, ThisPhoneOnly } from '../../../shared/components/ui/placeUi';
import { SOURCE_TYPE_LABEL, motorLine, pipeLabel } from '../components/setupLabels';

interface UtilitiesSectionProps {
    profile: FarmerProfile;
    onUpdate: (p: FarmerProfile) => void;
}

/** null = no form; 'new' = adding; a source id = changing that source. */
type FormState = null | 'new' | string;

const UtilitiesSection: React.FC<UtilitiesSectionProps> = ({ profile, onUpdate }) => {
    const [form, setForm] = useState<FormState>(null);
    const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const getMotorsForSource = (sourceId: string) => profile.motors.filter(m => m.linkedWaterSourceId === sourceId);

    const handleSaveSourceWithMotors = (source: WaterResource, motors: FarmMotor[]) => {
        const exists = profile.waterResources.some(w => w.id === source.id);
        onUpdate({
            ...profile,
            waterResources: exists ? profile.waterResources.map(w => (w.id === source.id ? source : w)) : [...profile.waterResources, source],
            motors: [...profile.motors.filter(m => m.linkedWaterSourceId !== source.id), ...motors],
        });
        setForm(null);
        setExpandedSourceId(source.id);
    };

    const deleteSource = (id: string) => {
        onUpdate({
            ...profile,
            waterResources: profile.waterResources.filter(w => w.id !== id),
            motors: profile.motors.filter(m => m.linkedWaterSourceId !== id),
        });
        setConfirmDeleteId(null);
    };

    const deleteMotor = (motorId: string) => {
        onUpdate({ ...profile, motors: profile.motors.filter(m => m.id !== motorId) });
    };

    const editing = form && form !== 'new' ? profile.waterResources.find(w => w.id === form) : undefined;

    return (
        <div className="space-y-3" data-testid="hub-water-power">
            <ThisPhoneOnly />
            <SectionHead title="पाण्याचे स्रोत" hint="विहीर, बोअर, कालवा, शेततळं — आणि त्यावरच्या मोटर" />

            {profile.waterResources.length === 0 && !form && (
                <GlassCard testId="sources-empty">
                    <div className="flex items-center gap-3">
                        <IconDot tone="blue"><Droplets size={22} aria-hidden="true" /></IconDot>
                        <p className="m-0 text-[15px] font-bold leading-snug text-stone-700">अजून पाण्याचा स्रोत जोडलेला नाही. स्रोत आणि त्यावरची मोटर जोडा.</p>
                    </div>
                </GlassCard>
            )}

            {profile.waterResources.map(source => {
                const linkedMotors = getMotorsForSource(source.id);
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
                                    <span className="text-stone-500">{SOURCE_TYPE_LABEL[source.type] ?? source.type}</span>
                                    {linkedMotors.length
                                        ? <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} aria-hidden="true" />{linkedMotors.length} मोटर</span>
                                        : <span className="flex items-center gap-1 text-orange-600" data-testid={`no-motor-${source.id}`}><AlertTriangle size={13} aria-hidden="true" />मोटर नाही</span>}
                                </span>
                            </span>
                            <ChevronDown size={22} className={`shrink-0 text-stone-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                        </Tap>
                        {isOpen && (
                            <div className="space-y-2 border-t border-stone-100 px-3 pb-3 pt-2.5">
                                {linkedMotors.length === 0 && <p className="m-0 text-[14px] font-bold text-stone-500">या स्रोतावर अजून मोटर जोडलेली नाही.</p>}
                                {linkedMotors.map(m => (
                                    <div key={m.id} className="flex items-start gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid={`motor-${m.id}`}>
                                        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-stone-800 text-white"><Settings2 size={19} aria-hidden="true" /></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[15.5px] font-extrabold text-stone-900">{m.name}</span>
                                            <span className="block text-[13px] font-bold text-stone-600">{motorLine(m)}</span>
                                            {m.dripDetails && (
                                                <span className="mt-1 inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-[12.5px] font-extrabold text-emerald-800 ring-1 ring-emerald-100">
                                                    <Droplets size={12} aria-hidden="true" />ठिबक{m.dripDetails.pipeSize ? `: ${pipeLabel(m.dripDetails.pipeSize)}` : ''}{m.dripDetails.hasFilter ? ' · फिल्टर' : ''}{m.dripDetails.flowRatePerHour ? ` · ${m.dripDetails.flowRatePerHour} लि/तास` : ''}
                                                </span>
                                            )}
                                        </span>
                                        <Tap onClick={() => deleteMotor(m.id)} aria-label="ही मोटर काढा" data-testid={`motor-remove-${m.id}`}
                                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-stone-500 ring-1 ring-stone-200"><Trash2 size={18} aria-hidden="true" /></Tap>
                                    </div>
                                ))}
                                <Soon what="मोटर कोणत्या प्लॉटला पाणी देते ते जोडणं" />
                                <Tap onClick={() => { setForm(source.id); setConfirmDeleteId(null); }} data-testid={`source-edit-${source.id}`}
                                    className="flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-full bg-blue-50 text-[15px] font-extrabold text-blue-800 ring-1 ring-blue-200">
                                    <Pencil size={16} aria-hidden="true" />स्रोत आणि मोटर बदला
                                </Tap>
                                {confirmDeleteId === source.id ? (
                                    <div className="rounded-2xl bg-rose-50 p-3 ring-1 ring-rose-200" data-testid={`source-remove-confirm-${source.id}`}>
                                        <p className="m-0 text-[14.5px] font-extrabold text-rose-900">हा स्रोत आणि त्यावरच्या सगळ्या मोटर काढायच्या?</p>
                                        <div className="mt-2 grid grid-cols-2 gap-2">
                                            <Tap onClick={() => setConfirmDeleteId(null)} className="min-h-[46px] rounded-full bg-white text-[14px] font-extrabold text-stone-800 ring-1 ring-stone-300">नको</Tap>
                                            <Tap onClick={() => deleteSource(source.id)} data-testid={`source-remove-yes-${source.id}`} className="min-h-[46px] rounded-full bg-rose-600 text-[14px] font-extrabold text-white">हो, काढा</Tap>
                                        </div>
                                    </div>
                                ) : (
                                    <Tap onClick={() => setConfirmDeleteId(source.id)} data-testid={`source-remove-${source.id}`}
                                        className="flex min-h-[46px] w-full items-center justify-center gap-1.5 rounded-full text-[14px] font-extrabold text-rose-700 ring-1 ring-rose-200">
                                        <Trash2 size={16} aria-hidden="true" />हा स्रोत काढा
                                    </Tap>
                                )}
                            </div>
                        )}
                    </section>
                );
            })}

            {form ? (
                <WaterSourceWizard
                    key={form}
                    initial={editing ? { source: editing, motors: getMotorsForSource(editing.id) } : undefined}
                    onSave={handleSaveSourceWithMotors}
                    onCancel={() => setForm(null)}
                />
            ) : (
                <BigButton onClick={() => setForm('new')} tone="white" testId="source-add"><Plus size={20} aria-hidden="true" />पाण्याचा स्रोत जोडा</BigButton>
            )}

            <SectionHead title="वीज कधी असते?" hint="सिंगल फेज आणि थ्री फेज — दोन्हीची वेळ वेगळी" />
            <ElectricityTimingConfigurator profile={profile} onUpdate={onUpdate} />
        </div>
    );
};

export default UtilitiesSection;
