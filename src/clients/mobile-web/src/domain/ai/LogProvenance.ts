
export interface LogProvenance {
    source: 'manual' | 'ai';
    model?: string;
    promptVersion?: string;
    rawTranscript?: string;
    confidenceScore?: number;
    processingTimeMs?: number;
    timestamp: string;
    validation?: {
        stage: 'infrastructure_parser' | 'application_contract_gate';
        outcome: 'pass' | 'fail';
        issues?: string[];
    };
}
