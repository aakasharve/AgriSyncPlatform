/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I8) — "this month's cost" report, the same server
 * report the English `ExportButton` asked for (`monthly-cost`, this year and month, the same file name),
 * through the same `useExportReport`. It is its own button only so every word is Marathi and a failure is
 * SAID: `ExportButton` shows "PDF saved to Downloads" in English and says nothing when the report fails.
 */
import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useExportReport } from '../../export';
import { Tap } from '../../../shared/components/ui/placeUi';

type Outcome = 'idle' | 'done' | 'failed';

export const MonthlyCostPdfButton: React.FC<{ farmId: string; testId: string }> = ({ farmId, testId }) => {
    const { exportReport, isExporting } = useExportReport();
    const [outcome, setOutcome] = useState<Outcome>('idle');

    useEffect(() => {
        if (outcome !== 'done') return;
        const timer = window.setTimeout(() => setOutcome('idle'), 2200);
        return () => window.clearTimeout(timer);
    }, [outcome]);

    const run = async () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        setOutcome('idle');
        const ok = await exportReport('monthly-cost', { farmId, year, month, fileName: `monthly-cost-${year}-${month}.pdf` });
        setOutcome(ok ? 'done' : 'failed');
    };

    return (
        <div className="space-y-1.5">
            <Tap onClick={() => { void run(); }} disabled={isExporting} data-testid={testId}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border-2 border-emerald-600 bg-white px-4 text-[15px] font-extrabold text-emerald-800 disabled:opacity-60">
                <Download size={19} aria-hidden="true" />
                {isExporting ? 'अहवाल तयार होत आहे…' : 'या महिन्याच्या खर्चाचा अहवाल'}
            </Tap>
            {outcome === 'done' && <p className="m-0 text-center text-[13.5px] font-extrabold text-emerald-800" role="status">अहवाल तयार झाला ✓</p>}
            {outcome === 'failed' && <p className="m-0 text-center text-[13.5px] font-extrabold text-rose-700" role="alert">अहवाल काढता आला नाही. थोड्या वेळानं पुन्हा प्रयत्न करा.</p>}
        </div>
    );
};
