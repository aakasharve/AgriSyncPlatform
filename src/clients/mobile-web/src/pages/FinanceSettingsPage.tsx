/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "हिशोबाची सेटिंग", the real Finance Settings
 * in the founder-approved look (PLR-D9 `FinanceTools.tsx`). It keeps both numbers — the big-amount limit
 * and the double-entry window — saved through the SAME `financeService.saveSettings`, with the same
 * fallback to the stored value when a field is left blank or zero.
 *
 * Said plainly, because it is true today: nothing reads these two numbers yet. The server sets an entry
 * aside on its own fixed rule, so the page does not promise that a changed limit changes the तपासायचे list
 * — it says using them is still to come (P5). GST was a checkbox marked "(later)" that nothing read; it is
 * "लवकरच" now (जीएसटी, in Devanagari), as in the approved look, and the stored value is kept as it was.
 */
import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { AppRoute } from '../types';
import { financeService } from '../features/finance/financeService';
import { MoneyPage } from '../features/finance/components/MoneyPage';
import { FINANCE_TITLE } from '../features/finance/moneyLabels';
import { BigButton, GlassCard, Soon, TextField, ThisPhoneOnly } from '../shared/components/ui/placeUi';

interface FinanceSettingsPageProps {
    currentRoute: AppRoute;
    onNavigate: (route: AppRoute) => void;
    onBack?: () => void;
}

const FinanceSettingsPage: React.FC<FinanceSettingsPageProps> = ({ currentRoute, onNavigate, onBack }) => {
    const current = financeService.getSettings();
    const [threshold, setThreshold] = useState(String(current.highAmountThreshold));
    const [windowMinutes, setWindowMinutes] = useState(String(current.duplicateWindowMinutes));
    const [saved, setSaved] = useState(false);

    const save = () => {
        financeService.saveSettings({
            highAmountThreshold: Number(threshold) || current.highAmountThreshold,
            duplicateWindowMinutes: Number(windowMinutes) || current.duplicateWindowMinutes,
            gstEnabled: current.gstEnabled
        });
        setSaved(true);
    };

    return (
        <MoneyPage title={FINANCE_TITLE['finance-settings']} testId="fin-settings" currentRoute={currentRoute} onNavigate={onNavigate} onBack={onBack}>
            <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">फक्त नियम इथे. दर "{FINANCE_TITLE['finance-price-book']}" मध्ये आहेत.</p>
            <ThisPhoneOnly />

            <GlassCard>
                <TextField label="मोठ्या रकमेची तपासणी मर्यादा (₹)" type="number" value={threshold}
                    onChange={v => { setThreshold(v); setSaved(false); }} testId="fin-threshold" />
            </GlassCard>
            <GlassCard>
                <TextField label="दुहेरी नोंद ओळखण्याचा वेळ (मिनिटे)" type="number" value={windowMinutes}
                    onChange={v => { setWindowMinutes(v); setSaved(false); }} testId="fin-dup-window" />
            </GlassCard>
            <Soon what="इथं लिहिलेली मर्यादा आणि वेळ नोंदी तपासताना वापरणं" />

            <GlassCard testId="fin-gst">
                <p className="m-0 mb-2 text-[15px] font-extrabold text-stone-900">जीएसटी हिशोब</p>
                <Soon what="बिलावरचा जीएसटी वेगळा दाखवणं" />
            </GlassCard>

            <BigButton onClick={save} testId="fin-settings-save"><CheckCircle2 size={20} aria-hidden="true" />सेटिंग जतन करा</BigButton>
            {saved && <p className="m-0 text-center text-[14px] font-extrabold text-emerald-800" role="status" data-testid="fin-settings-saved">जतन झालं ✓</p>}
        </MoneyPage>
    );
};

export default FinanceSettingsPage;
