import React, { useState } from 'react';
import { useAppCommandsState, useAppTrustState, useAppDataState } from '../../app/context/AppFeatureContexts';
import { useAppLogState } from '../../app/context/AppFeatureContexts';
import { LogVerificationStatus } from '../../types';
import { useDataSource } from '../../app/providers/DataSourceProvider';

const TestE2EPage: React.FC = () => {
    const { currentLogContext: _currentLogContext } = useAppLogState();
    // Use the exposed service from the hook result
    const { service: _service } = useAppCommandsState();
    const { handleVerifyLog } = useAppTrustState();
    const { realHistory, mockHistory, isDemoMode } = useAppDataState();
    const { auditPort: _auditPort } = useDataSource();

    const [status, setStatus] = useState<string>('Idle');
    const [_lastLogId, setLastLogId] = useState<string | null>(null);

    const history = isDemoMode ? mockHistory : realHistory;

    const _runVoiceTest = async () => {
        setStatus('Running Voice Test...');
        try {
            // 1. Simulate Voice Input
            // We verify the SERVICE method directly to isolate it from UI state messiness
            const transcription = "Paid 500 rupees for labor for weeding on Plot A";

            // Mock AgriLogResponse as if parsing happened
            // In a real E2E we might want to test parsing, but here we test the COMMAND FLOW
            const _mockParsedData = {
                summary: transcription,
                labour: [{
                    count: 1,
                    hours: 8,
                    isPaid: true,
                    cost: 500,
                    details: "Weeding",
                }],
                missingSegments: [],
                questionsForUser: [],
                dayOutcome: "Completed",
                // ... other fields empty
                cropActivities: [], irrigation: [], inputs: [], machinery: [], activityExpenses: [], disturbance: []
            };

            // We need props for createFromVoice. 
            // Actually, handleAutoSave in the hook does this.
            // But verify if we can access the service directly.
            // The service requires (data, scope, crops, profile, provenance).

            // Let's use handleAutoSave if we want to test the HOOK integration. 
            // But TestE2EPage doesn't have easy access to valid scope/crops/profile unless we grab them from context.
            // They are available in AppFeatureContexts but might be null/empty if not selected.

            // For now, let's just use the history to verify.

            setStatus('Please use the main UI to record a log. This page monitors it.');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
        } catch (e: any) {
            setStatus(`Error: ${e.message}`);
        }
    };

    const runVerifyTest = async () => {
        const latestLog = history[0]; // Get most recent log
        if (!latestLog) {
            setStatus('No log found in history.');
            return;
        }
        setLastLogId(latestLog.id);

        setStatus(`Verifying Log ID: ${latestLog.id}...`);
        try {
            await handleVerifyLog(latestLog.id, LogVerificationStatus.APPROVED);
            setStatus(`Log ${latestLog.id} Verified! Check Console for Audit Port output.`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- T-IGH-04 ratchet: legacy `any` deferred to T-IGH-04-LINT-RATCHET-V2 follow-up.
        } catch (e: any) {
            setStatus(`Verification Failed: ${e.message}`);
        }
    };

    return (
        <div className="p-8 space-y-4">
            <h1 className="text-2xl font-bold">End-to-End Test (Voice -&gt; Log -&gt; Audit)</h1>

            <div className="p-4 border rounded bg-gray-50">
                <h2 className="font-bold">Status: {status}</h2>
                <div className="mt-2 text-sm text-gray-600">
                    <p>1. Go to Home, Select Plot, Record "Paid 500 rs for labour".</p>
                    <p>2. Come back here and click "Verify Last Log".</p>
                    <p>3. Check Console logs for "[AuditPort] Appending entry...".</p>
                </div>
            </div>

            <div className="flex gap-4">
                <button
                    onClick={runVerifyTest}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                    Verify Last Log (Approve)
                </button>
            </div>

            <div className="mt-8">
                <h3 className="font-bold text-lg mb-2">Latest Logs (History)</h3>
                <pre className="bg-gray-100 p-4 rounded overflow-auto h-64 text-xs">
                    {JSON.stringify(history.slice(0, 3), null, 2)}
                </pre>
            </div>
        </div>
    );
};

export default TestE2EPage;
