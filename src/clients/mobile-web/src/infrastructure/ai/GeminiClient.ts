
import { GoogleGenAI } from "@google/genai";
import {
    VoiceParserPort,
    VoiceInput,
    VoiceParseResult
} from '../../application/ports';
import { LogScope } from '../../domain/types/log.types';
import { CropProfile, FarmerProfile, FarmContext } from '../../types';
import { AgriLogResponseSchema, AgriLogRawResponseSchema } from '../../domain/ai/contracts/AgriLogResponseSchema';
import { AIResponseNormalizer } from './AIResponseNormalizer';
import { assessConfidence } from '../../domain/ai/ConfidenceAssessor';
import { buildSystemInstruction } from '../../services/aiPrompts';
import { loadVocabDB } from '../../services/vocabLearner';
import { systemClock } from '../../core/domain/services/Clock';

export class GeminiClient implements VoiceParserPort {
    private client: GoogleGenAI;
    private modelId: string = "gemini-2.0-flash";

    constructor() {
        const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY
            || (import.meta as any).env.VITE_API_KEY
            || (import.meta as any).env.GEMINI_API_KEY
            || (import.meta as any).env.API_KEY;

        if (!apiKey) {
            throw new Error("Gemini API Key is missing in environment variables");
        }

        this.client = new GoogleGenAI({ apiKey });
    }

    async parseInput(
        input: VoiceInput,
        scope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        options?: { focusCategory?: string }
    ): Promise<VoiceParseResult> {
        const startTime = systemClock.nowEpoch();

        try {
            // 1. Adapter: LogScope -> FarmContext (Legacy compatibility for prompt builder)
            // This ensures Fix-02 alignment while reusing existing prompt logic
            const legacyContext = this.adaptScopeToContext(scope, crops);

            // 2. Load Vocabulary (Infrastructure concern: reading static DB)
            const vocabDB = loadVocabDB();

            // 3. Build System Instruction
            const systemInstruction = buildSystemInstruction(
                crops,
                profile,
                legacyContext,
                options?.focusCategory,
                vocabDB
            );

            // 4. Prepare Request
            let response;
            if (input.type === 'audio') {
                response = await this.client.models.generateContent({
                    model: this.modelId,
                    contents: [{
                        role: 'user',
                        parts: [{ inlineData: { mimeType: input.mimeType, data: input.data } }]
                    }],
                    config: {
                        systemInstruction,
                        responseMimeType: 'application/json'
                    }
                });
            } else {
                response = await this.client.models.generateContent({
                    model: this.modelId,
                    contents: [{
                        role: 'user',
                        parts: [{ text: input.content }]
                    }],
                    config: {
                        systemInstruction,
                        responseMimeType: 'application/json'
                    }
                });
            }

            // 5. Parse Contract (The Hardening)
            const rawText = response.text || "{}";

            // Basic JSON cleaning (often Gemini wraps in markdown)
            const cleanText = this.cleanJson(rawText);
            const rawJson = JSON.parse(cleanText);

            // LOOSE schema check is now advisory (non-blocking).
            // We still normalize even when loose parse fails to avoid voice-flow interruptions.
            const looseValidation = AgriLogRawResponseSchema.safeParse(rawJson);
            const looseIssues = looseValidation.success
                ? []
                : looseValidation.error.issues
                    .slice(0, 8)
                    .map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`);

            // 6. Normalize - The Resilient Layer
            // Fills defaults, IDs, and ensures strict contract compliance
            const normalizer = new AIResponseNormalizer();
            const normalizedData = normalizer.normalize(looseValidation.success ? looseValidation.data : rawJson);

            // 6b. Strict Schema Re-Validation
            const strictValidation = AgriLogResponseSchema.safeParse(normalizedData);
            if (!strictValidation.success) {
                const issues = strictValidation.error.issues
                    .slice(0, 8)
                    .map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`);

                return {
                    success: false,
                    error: `AI response failed strict schema validation: ${issues.join(' | ')}`,
                    provenance: {
                        source: 'ai',
                        model: this.modelId,
                        rawTranscript: normalizedData.fullTranscript || (input.type === 'text' ? input.content : undefined),
                        timestamp: systemClock.nowISO(),
                        processingTimeMs: systemClock.nowEpoch() - startTime,
                        validation: {
                            stage: 'infrastructure_parser',
                            outcome: 'fail',
                            issues
                        }
                    },
                    rawTranscript: normalizedData.fullTranscript
                };
            }
            const validatedData = strictValidation.data;

            // 7. Confidence Assessment (AV-5: DFES Voice Safety)
            // Extract per-field scores from V2 fieldConfidences if present
            const fieldScores: Record<string, number> = {};
            if (validatedData.fieldConfidences) {
                for (const [field, conf] of Object.entries(validatedData.fieldConfidences)) {
                    fieldScores[field] = conf.score;
                }
            }
            const confidenceAssessment = assessConfidence(
                validatedData,
                Object.keys(fieldScores).length > 0 ? fieldScores : undefined
            );

            // 8. Return Result with Provenance
            return {
                success: true,
                data: validatedData,
                confidenceAssessment,
                provenance: {
                    source: 'ai',
                    model: this.modelId,
                    promptVersion: 'v2.0-dynamic',
                    rawTranscript: validatedData.fullTranscript || (input.type === 'text' ? input.content : undefined),
                    confidenceScore: confidenceAssessment.averageScore || 0.9,
                    processingTimeMs: systemClock.nowEpoch() - startTime,
                    timestamp: systemClock.nowISO(),
                    validation: {
                        stage: 'infrastructure_parser',
                        outcome: 'pass',
                        issues: looseIssues.length > 0 ? looseIssues : undefined
                    }
                },
                rawTranscript: validatedData.fullTranscript,
                error: undefined
            };

        } catch (error: any) {
            console.error("GeminiClient Error:", error);

            // Granular error handling
            if (error instanceof SyntaxError) {
                return {
                    success: false,
                    error: "AI returned invalid JSON: " + error.message,
                    provenance: {
                        source: 'ai',
                        model: this.modelId,
                        timestamp: systemClock.nowISO(),
                        processingTimeMs: systemClock.nowEpoch() - startTime,
                        validation: {
                            stage: 'infrastructure_parser',
                            outcome: 'fail',
                            issues: [error.message]
                        }
                    }
                };
            }

            // Zod Validation Error (usually strict schema gate failure)
            if (error.name === 'ZodError') {
                const issues = Array.isArray(error.issues)
                    ? error.issues
                        .slice(0, 8)
                        .map((issue: any) => `${(issue.path || []).join('.') || 'root'}: ${issue.message}`)
                    : ['Zod validation error'];
                return {
                    success: false,
                    error: "AI response failed schema validation: " + issues.join(' | '),
                    provenance: {
                        source: 'ai',
                        model: this.modelId,
                        timestamp: systemClock.nowISO(),
                        processingTimeMs: systemClock.nowEpoch() - startTime,
                        validation: {
                            stage: 'infrastructure_parser',
                            outcome: 'fail',
                            issues
                        }
                    }
                };
            }

            return {
                success: false,
                error: error.message || "Unknown AI Processing Error"
            };
        }
    }

    private cleanJson(text: string): string {
        try {
            // 1. Remove markdown code blocks
            let cleanText = text.replace(/```json\n?|\n?```/g, "").trim();

            // 2. Extract JSON object if wrapped in other text
            const firstBrace = cleanText.indexOf('{');
            const lastBrace = cleanText.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1) {
                cleanText = cleanText.substring(firstBrace, lastBrace + 1);
            }

            // 3. Fix common JSON issues (The "Retry" Fix)
            // Fix unquoted keys: { key: "value" } -> { "key": "value" }
            // Be careful not to match inside strings. This regex is a heuristic.
            // Matches word chars followed by colon, not preceded by quote
            cleanText = cleanText.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');

            // Fix trailing commas: , } -> }
            cleanText = cleanText.replace(/,\s*}/g, '}');
            cleanText = cleanText.replace(/,\s*]/g, ']');

            return cleanText;
        } catch {
            return text;
        }
    }

    private adaptScopeToContext(scope: LogScope, crops: CropProfile[]): FarmContext {
        // LogScope: { selectedPlotIds, selectedCropIds, mode }
        // FarmContext: { selection: SelectedCropContext[] }

        // Scope uses canonical IDs. We need to map back to the UI structure expected by prompt.
        // This logic mimics the reverse mapping of what LogContext does.

        if (scope.mode === 'single' && scope.selectedPlotIds.length === 0) {
            // Farm Global
            return {
                selection: [{
                    cropId: 'FARM_GLOBAL',
                    cropName: 'Entire Farm',
                    selectedPlotIds: [],
                    selectedPlotNames: []
                }]
            };
        }

        const selections = scope.selectedCropIds.map(cropId => {
            const crop = crops.find(c => c.id === cropId);
            if (!crop) return null;

            // Find plots for this crop that are in the scope
            const relevantPlotIds = scope.selectedPlotIds.filter(pid =>
                crop.plots.some(p => p.id === pid)
            );

            const relevantPlotNames = relevantPlotIds.map(pid =>
                crop.plots.find(p => p.id === pid)?.name || 'Unknown'
            );

            return {
                cropId: crop.id,
                cropName: crop.name,
                selectedPlotIds: relevantPlotIds,
                selectedPlotNames: relevantPlotNames
            };
        }).filter(Boolean) as any[];

        return { selection: selections };
    }
}
