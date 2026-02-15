
import { VoiceInput, VoiceParserPort, VoiceParseResult } from '../ports';
import { LogScope } from '../../domain/types/log.types';
import { CropProfile, FarmerProfile } from '../../types';
import { runAiContractGate, isContractGateFailure } from '../services/AiContractGate';

/**
 * Use-case: Parse voice/text input into a draft log structure.
 * 
 * This is the first step in the "Voice Command" flow.
 * It does NOT create database records. It converts unstructured input into structured intent.
 */
export async function parseVoiceToDraft(
    input: VoiceInput,
    scope: LogScope,
    crops: CropProfile[],
    profile: FarmerProfile,
    parser: VoiceParserPort,
    options?: { focusCategory?: string }
): Promise<VoiceParseResult> {
    // Phase 4 Hook: Compression or Format conversion could happen here

    // Pass options (e.g. focusCategory for re-recording) to parser
    const parserResult = await parser.parseInput(input, scope, crops, profile, options);

    // Application boundary gate: strict contract enforcement before data reaches UI/write flow
    if (!parserResult.success || !parserResult.data) {
        return parserResult;
    }

    const gateResult = runAiContractGate(parserResult.data, parserResult.provenance);

    if (isContractGateFailure(gateResult)) {
        return {
            success: false,
            error: gateResult.error,
            provenance: gateResult.provenance,
            rawTranscript: parserResult.rawTranscript
        };
    }

    // Phase 4 Hook: Analytics tracking of token usage / latency

    return {
        ...parserResult,
        data: gateResult.data,
        provenance: gateResult.provenance
    };
}
