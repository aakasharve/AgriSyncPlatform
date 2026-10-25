/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (WP-5 places) — "लॅबचा निकाल नोंदवा" in Marathi, on the
 * shared sheet frame. It was "Record lab result / Parameters / Attach lab PDF / Save result". The flow is
 * unchanged (CEI Phase 2 §4.5 task 4.2.2):
 *   1. one row per parameter code of the attached protocol (or one free row when the phone has no protocol);
 *   2. the lab report is attached through the real `captureAttachment` (file picker), linked to this test;
 *   3. a warning stays until at least one report is attached;
 *   4. "निकाल जतन करा" is off until every row has a code and a value AND a report is attached;
 *   5. on success the server's recommendations are listed.
 * One addition: those recommendations are also kept on this phone (`testRecommendations`, the table the test's
 * own page already reads), so the page's "योजनेत घाला" has something to show — before, the panel sent the
 * farmer to that page and the page could never list them. They are stored exactly as the server sent them
 * (`testsClient` maps the server's `recommendationId` to the row's `id` and keeps the server's `createdAtUtc`;
 * review B001 — the rows used to have no key and were all rejected, silently). A failed local save does not
 * undo the server save: it is logged with the test and the suggestion ids, and the panel says they were not
 * kept instead of pointing at a page that will not have them.
 * Failures are said in Marathi (`failureWords`: no permission / already moved on / report not uploaded yet /
 * try again); the server's English messages are not shown to the farmer.
 */
import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, ClipboardList, Paperclip } from 'lucide-react';
import {
    getDatabase, type DexieTestInstance, type DexieTestProtocol, type DexieTestRecommendation,
} from '../../../infrastructure/storage/DexieDatabase';
import { useFarmContext } from '../../../core/session/FarmContext';
import { captureAttachment } from '../../../application/use-cases/CaptureAttachment';
import { recordResult, type ResultInput, type RecordTestResultResponse } from '../data/testsClient';
import { settleWithin } from '../data/phoneWait';
import { BigButton } from '../../../shared/components/ui/placeUi';
import { SheetTestSummary, TestSheetFrame } from './TestSheetFrame';
import { failureWords, testName } from './testView';

/** Keep the server's suggestions on this phone. True when they were stored; a failure is logged, never swallowed. */
async function keepRecommendations(testInstanceId: string, recs: readonly DexieTestRecommendation[]): Promise<boolean> {
    if (recs.length === 0) return false;
    try {
        await getDatabase().testRecommendations.bulkPut([...recs]);
        return true;
    } catch (error) {
        console.error('[tests] result saved on the server, but its suggestions could not be kept on this phone', {
            testInstanceId,
            recommendationIds: recs.map(r => r.id),
            error,
        });
        return false;
    }
}

interface RecordResultSheetProps {
    instance: DexieTestInstance;
    protocol?: DexieTestProtocol;
    onClose: () => void;
    onSuccess: (response: RecordTestResultResponse) => void;
}

interface Row {
    parameterCode: string;
    value: string;
    unit: string;
}

const INPUT = 'min-h-[48px] min-w-0 rounded-xl bg-white px-3 text-[16px] font-bold text-stone-900 outline-none ring-1 ring-stone-300 placeholder:text-stone-400 focus:ring-2 focus:ring-emerald-500';

const RecordResultSheet: React.FC<RecordResultSheetProps> = ({ instance, protocol, onClose, onSuccess }) => {
    const { currentFarmId } = useFarmContext();
    const paramCodes = useMemo(() => protocol?.parameterCodes ?? [], [protocol]);

    const [rows, setRows] = useState<Row[]>(() =>
        paramCodes.length > 0
            ? paramCodes.map(code => ({ parameterCode: code, value: '', unit: '' }))
            : [{ parameterCode: '', value: '', unit: '' }],
    );
    const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isAttaching, setIsAttaching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successRecs, setSuccessRecs] = useState<RecordTestResultResponse | null>(null);
    const [recsKept, setRecsKept] = useState(false);

    const allFilled = rows.length > 0 && rows.every(r => r.value.trim() !== '' && r.parameterCode.trim() !== '');
    const canSave = allFilled && attachmentIds.length > 0 && !isSaving;

    const updateRow = (i: number, patch: Partial<Row>) => {
        setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    };

    const handleAttach = async () => {
        if (!currentFarmId || isAttaching) return;
        setIsAttaching(true);
        setError(null);
        try {
            const record = await captureAttachment({
                source: 'file',
                farmId: currentFarmId,
                linkedEntityId: instance.id,
                linkedEntityType: 'TestInstance',
            });
            setAttachmentIds(prev => (prev.includes(record.id) ? prev : [...prev, record.id]));
        } catch {
            setError('फाइल जोडता आली नाही. पुन्हा प्रयत्न करा.');
        } finally {
            setIsAttaching(false);
        }
    };

    // A second tap can land before React has re-rendered the button as disabled.
    const inFlight = useRef(false);
    const dismissed = useRef(false);

    const handleSave = async () => {
        if (!canSave || inFlight.current) return;
        inFlight.current = true;
        setIsSaving(true);
        setError(null);
        const results: ResultInput[] = rows.map(r => ({
            parameterCode: r.parameterCode.trim(),
            parameterValue: r.value.trim(),
            unit: r.unit.trim(),
        }));
        let response: RecordTestResultResponse;
        try {
            response = await recordResult(instance.id, results, attachmentIds);
        } catch (e) {
            setError(failureWords(e, 'निकाल जतन झाला नाही. पुन्हा प्रयत्न करा.'));
            inFlight.current = false;
            setIsSaving(false);
            return;
        }
        // Saved on the server: from here the sheet only shows the outcome (the save button never comes back).
        // Never hold the outcome behind a hung phone database (review N1): 2 s, then say they were not kept.
        setRecsKept(await settleWithin(keepRecommendations(instance.id, response.recommendations), false));
        setSuccessRecs(response);
    };

    const handleDismissSuccess = () => {
        if (!successRecs || dismissed.current) return;
        dismissed.current = true;
        onSuccess(successRecs);
    };

    return (
        <TestSheetFrame title="लॅबचा निकाल नोंदवा" icon={<ClipboardList size={22} aria-hidden="true" />} tone="green"
            onClose={onClose} busy={isSaving} testId="record-sheet">
            {successRecs ? (
                <SuccessPanel response={successRecs} recsKept={recsKept} onDismiss={handleDismissSuccess} />
            ) : (
                <>
                    <SheetTestSummary instance={instance} name={testName(instance, protocol)} />

                    <div className="mt-4 space-y-2">
                        <p className="m-0 text-[13.5px] font-extrabold text-stone-700">घटक आणि आकडे</p>
                        {rows.map((row, i) => (
                            <div key={`${paramCodes[i] ?? 'row'}-${i}`} className="grid grid-cols-[1fr_1fr_0.8fr] gap-2" data-testid={`record-row-${i}`}>
                                <input type="text" value={row.parameterCode} readOnly={paramCodes.length > 0}
                                    onChange={e => updateRow(i, { parameterCode: e.target.value })}
                                    placeholder="घटक" aria-label="घटक" data-testid={`record-code-${i}`}
                                    className={`${INPUT} ${paramCodes.length > 0 ? 'bg-stone-50' : ''}`} />
                                <input type="text" inputMode="decimal" value={row.value}
                                    onChange={e => updateRow(i, { value: e.target.value })}
                                    placeholder="आकडा" aria-label="आकडा" data-testid={`record-value-${i}`} className={INPUT} />
                                <input type="text" value={row.unit}
                                    onChange={e => updateRow(i, { unit: e.target.value })}
                                    placeholder="एकक" aria-label="एकक" data-testid={`record-unit-${i}`} className={INPUT} />
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 space-y-2">
                        <BigButton onClick={handleAttach} tone="white" disabled={isAttaching || !currentFarmId} testId="record-attach">
                            <Paperclip size={20} aria-hidden="true" />
                            {isAttaching
                                ? 'जोडत आहे…'
                                : attachmentIds.length > 0
                                    ? `रिपोर्ट जोडला (${attachmentIds.length}) — आणखी जोडा`
                                    : 'लॅबच्या रिपोर्टची फाइल जोडा'}
                        </BigButton>
                        {attachmentIds.length === 0 && (
                            <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[13.5px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200" data-testid="record-needs-report">
                                निकाल जतन करायला लॅबच्या रिपोर्टची फाइल जोडा.
                            </p>
                        )}
                    </div>

                    {error && (
                        <p className="m-0 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[13.5px] font-extrabold text-rose-700 ring-1 ring-rose-200" data-testid="record-error">
                            {error}
                        </p>
                    )}

                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <BigButton onClick={onClose} tone="white" disabled={isSaving} testId="record-cancel">रद्द करा</BigButton>
                        <BigButton onClick={handleSave} disabled={!canSave} testId="record-save">
                            {isSaving ? 'जतन करत आहे…' : 'निकाल जतन करा'}
                        </BigButton>
                    </div>
                </>
            )}
        </TestSheetFrame>
    );
};

const SuccessPanel: React.FC<{ response: RecordTestResultResponse; recsKept: boolean; onDismiss: () => void }> = ({ response, recsKept, onDismiss }) => (
    <div className="mt-4 space-y-3" data-testid="record-success">
        <p className="m-0 flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-[15px] font-extrabold text-emerald-800 ring-1 ring-emerald-200">
            <CheckCircle2 size={20} aria-hidden="true" />निकाल जतन झाला
        </p>

        {response.recommendations.length > 0 ? (
            <>
                <p className="m-0 text-[13.5px] font-extrabold text-stone-700">सल्ला ({response.recommendations.length})</p>
                <ul className="m-0 list-none space-y-2 p-0">
                    {response.recommendations.map(rec => (
                        <li key={rec.id} className="rounded-2xl bg-white p-3 text-[15px] font-bold text-stone-900 ring-1 ring-stone-200">
                            {rec.titleMr?.trim() || rec.titleEn}
                        </li>
                    ))}
                </ul>
                {recsKept ? (
                    <p className="m-0 text-[13px] font-semibold leading-snug text-stone-600" data-testid="record-recs-where">
                        हे सल्ले योजनेत घालायचे असतील तर “निकाल आला” मधली ही चाचणी उघडा.
                    </p>
                ) : (
                    <p className="m-0 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-bold leading-snug text-amber-900 ring-1 ring-amber-200" data-testid="record-recs-not-kept">
                        हे सल्ले या फोनवर ठेवता आले नाहीत — आत्ताच लिहून घ्या.
                    </p>
                )}
            </>
        ) : (
            <p className="m-0 text-[14px] font-semibold text-stone-600">या निकालावर नवीन सल्ला नाही.</p>
        )}

        <BigButton onClick={onDismiss} testId="record-done">ठीक आहे</BigButton>
    </div>
);

export default RecordResultSheet;
