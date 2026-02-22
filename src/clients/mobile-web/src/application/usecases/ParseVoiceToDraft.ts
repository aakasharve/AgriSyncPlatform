
import { VoiceInput, VoiceParserPort, VoiceParseResult } from '../ports';
import { LogScope } from '../../domain/types/log.types';
import { CropProfile, FarmerProfile } from '../../types';

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
    return parser.parseInput(input, scope, crops, profile, options);
}
