import React from 'react';
import { useAppNavigationState } from '../app/context/AppFeatureContexts';
import { BookOpen, FlaskConical, Bot, Coins, Leaf, Mic, Activity } from 'lucide-react';
import { LedgerDefaults, LabourShift, CropProfile } from '../types';
import NotificationTestComponent from '../shared/components/NotificationTestComponent';
import HarvestComingSoon from '../features/logs/components/harvest/HarvestComingSoon';
import { useLanguage } from '../i18n/LanguageContext';
import { idGenerator } from '../core/domain/services/IdGenerator';
// spec: voice-diary-e2e-2026-05-17 (D.19) — Settings entry for the
// FullHistoryJournal consent toggle. Lives next to the existing
// Voice Journal "Open" CTA so the toggle is discoverable in the same
// surface that opens the Voice Diary page.
import VoiceRetainedConsentToggle from '../features/consent/VoiceRetainedConsentToggle';
import { toVoiceDiaryLocale } from '../i18n/voiceDiaryTranslations';

interface SettingsPageProps {
    defaults: LedgerDefaults;
    onUpdateDefaults: (defaults: LedgerDefaults) => void;
    crops: CropProfile[];
}

const SettingsPage: React.FC<SettingsPageProps> = ({
    defaults,
    onUpdateDefaults
}) => {
    const { setCurrentRoute } = useAppNavigationState();
    const { t, language } = useLanguage();

    const handleDefaultChange = (category: keyof LedgerDefaults, field: string, value: unknown) => {
        onUpdateDefaults({
            ...defaults,
            [category]: {
                ...defaults[category],
                [field]: value
            }
        });
    };

    const _addShift = () => {
        const newShift: LabourShift = {
            id: `shift_${idGenerator.generate()}`,
            name: 'New Shift',
            defaultRateMale: 300,
            defaultRateFemale: 200
        };
        const newShifts = [...(defaults.labour.shifts || []), newShift];
        handleDefaultChange('labour', 'shifts', newShifts);
    };

    const _updateShift = (id: string, field: keyof LabourShift, value: unknown) => {
        const newShifts = defaults.labour.shifts.map(s => s.id === id ? { ...s, [field]: value } : s);
        handleDefaultChange('labour', 'shifts', newShifts);
    };

    const _deleteShift = (id: string) => {
        const newShifts = defaults.labour.shifts.filter(s => s.id !== id);
        handleDefaultChange('labour', 'shifts', newShifts);
    };

    return (
        <div className="space-y-6 pb-24">

            {/* Voice Journal — stays on Settings (Voice Diary is out of scope of the Setup-Hub migration) */}
            <div className="glass-panel p-5 mb-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 text-stone-700">
                        <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-700 shadow-sm">
                            <Mic size={22} strokeWidth={2.5} />
                        </div>
                        <div>
                            <h4 className="font-bold text-lg">Voice Journal</h4>
                            <p className="text-xs text-stone-500 mt-1 leading-relaxed max-w-[280px]">
                                Replay recent voice logs saved on this device for 30 days.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => setCurrentRoute('voiceDiary')}
                        className="shrink-0 rounded-xl bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800 transition-colors hover:bg-emerald-200 active:scale-95"
                    >
                        <BookOpen size={16} className="inline-block mr-1.5 align-[-3px]" />
                        Open
                    </button>
                </div>
            </div>

            {/* spec: voice-diary-e2e-2026-05-17 (D.19) — FullHistoryJournal
                consent toggle. Mounted directly below the Voice Journal CTA
                so the user can grant retention right where they discover
                the diary surface. */}
            <div className="mb-6">
                <VoiceRetainedConsentToggle
                    locale={toVoiceDiaryLocale(language)}
                    onOpenVoiceDiary={() => setCurrentRoute('voiceDiary')}
                />
            </div>

            <div className="pt-4">
                <h3 className="text-xl font-display font-black text-stone-800 px-1">{t('settings.ledgerConfig')}</h3>
            </div>

            <div className="glass-panel p-5">
                <div className="flex items-center gap-4 text-stone-700">
                    <div className="bg-amber-100 p-3 rounded-2xl text-amber-700 shadow-sm"><Coins size={22} strokeWidth={2.5} /></div>
                    <div>
                        <h4 className="font-bold text-lg">Pricing moved to Finance Manager</h4>
                        <p className="text-xs text-stone-500 mt-1 leading-relaxed max-w-[280px]">
                            Configure wages, rates, and item prices from <span className="font-bold text-stone-700">Profile → Finance Manager → Price Book</span>.
                        </p>
                    </div>
                </div>
            </div>

            {/* 4. Harvest — coming soon (spec D4, Task 6). Harvest config alone
                persisted fine, but it sets a farmer up for a sale/session
                flow that has no backend and never did — same honest surface
                as the Income tab's Harvest section. */}
            <div className="glass-panel p-0 overflow-hidden">
                <div className="w-full p-5 flex items-center gap-4 text-stone-700">
                    <div className="bg-emerald-100 p-3 rounded-2xl text-emerald-700 shadow-sm"><Leaf size={22} strokeWidth={2.5} /></div>
                    <div>
                        <h4 className="font-bold text-lg">{t('settings.harvestConfig')}</h4>
                        <p className="text-xs text-stone-400 font-medium mt-0.5">{t('settings.harvestDescription')}</p>
                    </div>
                </div>
                <HarvestComingSoon language={language} />
            </div>

            {/* Engineer-only tools — hidden from farmers in production builds. */}
            {import.meta.env.DEV && (
                <>
                    {/* Notification Tester */}
                    <NotificationTestComponent />

                    {/* Developer Tools */}
                    <div className="glass-panel p-5 mt-6">
                        <h3 className="font-bold text-stone-800 text-lg mb-4">Developer Tools</h3>
                        <div className="space-y-2">
                            <button
                                onClick={() => setCurrentRoute('test-e2e')}
                                className="w-full py-3 px-4 bg-stone-100 text-stone-700 font-bold rounded-xl hover:bg-stone-200 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
                            >
                                <FlaskConical size={20} />
                                Open End-to-End Test Page
                            </button>
                            <button
                                onClick={() => setCurrentRoute('ai-admin')}
                                className="w-full py-3 px-4 bg-emerald-100 text-emerald-800 font-bold rounded-xl hover:bg-emerald-200 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
                            >
                                <Bot size={20} />
                                Open AI Operations (Admin)
                            </button>
                            <button
                                onClick={() => setCurrentRoute('ops-admin')}
                                className="w-full py-3 px-4 bg-blue-50 text-blue-800 font-bold rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
                            >
                                <Activity size={20} />
                                Open Ops Health (Admin)
                            </button>
                            {/* spec: data-principle-spine-2026-05-05/10.4 — admin PII review queue. */}
                            <button
                                onClick={() => setCurrentRoute('piiReview')}
                                className="w-full py-3 px-4 bg-amber-50 text-amber-800 font-bold rounded-xl hover:bg-amber-100 transition-colors flex items-center justify-center gap-2 active:scale-[0.98]"
                            >
                                <Bot size={20} />
                                Open PII Review Queue (Admin)
                            </button>
                        </div>
                    </div>
                </>
            )}

        </div>
    );
};

export default SettingsPage;
