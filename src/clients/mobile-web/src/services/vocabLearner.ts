/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Smart Vocabulary Learner
 * 
 * Learns new colloquial/dialect Marathi terms and maps them to standard vocabulary.
 * Creates a reusable vocabulary database that improves over time.
 * 
 * Example: "बाया" (colloquial) → "बायका" (standard) for female labourers
 */

import { AgriLogResponse } from '../types';

/**
 * Vocabulary mapping entry
 */
export interface VocabMapping {
    colloquial: string;           // Dialect/informal term (e.g., "बाया")
    standard: string;             // Standard/formal term (e.g., "बायका")
    category: VocabCategory;      // What it refers to
    context: string;              // Usage context
    confidence: number;           // 0-1, how confident we are
    usageCount: number;           // How many times seen
    learnedDate: string;          // When first learned
    lastUsed: string;             // Last usage date
    approvedByUser: boolean;      // User confirmed mapping
    cropType?: string;            // Crop this term belongs to (e.g., "Grape", "Pomegranate")
}

export type VocabCategory =
    | 'labour_male'
    | 'labour_female'
    | 'irrigation'
    | 'machinery'
    | 'fertilizer'
    | 'pesticide'
    | 'measurement'
    | 'action'
    | 'harvesting'
    | 'time'
    | 'other';

/**
 * Vocabulary Database
 */
export interface VocabDatabase {
    version: string;
    lastUpdated: string;
    totalMappings: number;
    mappings: VocabMapping[];
}

/**
 * Initialize vocabulary database with seed mappings
 */
export function initializeVocabDB(): VocabDatabase {
    return {
        version: '1.0.0',
        lastUpdated: new Date().toISOString(),
        totalMappings: 12,
        mappings: [
            // Labour terms
            {
                colloquial: 'बाया',
                standard: 'बायका',
                category: 'labour_female',
                context: 'Female workers/labourers',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'माणूस',
                standard: 'माणसे',
                category: 'labour_male',
                context: 'Male workers/people',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'कामवाला',
                standard: 'कामगार',
                category: 'labour_male',
                context: 'Worker/labourer',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // Irrigation terms
            {
                colloquial: 'पाणी दिलं',
                standard: 'पाणी दिले',
                category: 'irrigation',
                context: 'Gave water / irrigated',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'ड्रिप',
                standard: 'ठिबक',
                category: 'irrigation',
                context: 'Drip irrigation',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // Machinery terms
            {
                colloquial: 'ट्रक्टर',
                standard: 'ट्रॅक्टर',
                category: 'machinery',
                context: 'Tractor',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // Grape Specific
            {
                colloquial: 'घड',
                standard: 'घड',
                category: 'action',
                cropType: 'Grape',
                context: 'Bunch of grapes',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'बांधणी',
                standard: 'बांधणी',
                category: 'action',
                cropType: 'Grape',
                context: 'Tying (usually bunches)',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'छाटणी',
                standard: 'छाटणी',
                category: 'action',
                cropType: 'Grape',
                context: 'Thinning/Pruning',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // Pomegranate Specific
            {
                colloquial: 'बहरात',
                standard: 'बहरात',
                category: 'action',
                cropType: 'Pomegranate',
                context: 'In flowering/fruiting season',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // Other Crops
            {
                colloquial: 'तोडणी',
                standard: 'तोडणी',
                category: 'harvesting',
                context: 'Harvesting/Picking',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'लागवड',
                standard: 'लागवड',
                category: 'action',
                context: 'Planting/Sowing',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // Inputs terms
            {
                colloquial: 'दवा',
                standard: 'औषध',
                category: 'pesticide',
                context: 'Medicine/pesticide',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'स्प्रे',
                standard: 'फवारणी',
                category: 'action',
                context: 'Spray/spraying',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // Measurement terms
            {
                colloquial: 'लिटर',
                standard: 'लीटर',
                category: 'measurement',
                context: 'Litre (standard spelling)',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'तास',
                standard: 'तास',
                category: 'time',
                context: 'Hour (already standard)',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },

            // More colloquial variants
            {
                colloquial: 'येत',
                standard: 'येते',
                category: 'other',
                context: 'Comes/coming (grammar)',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            },
            {
                colloquial: 'जात',
                standard: 'जाते',
                category: 'other',
                context: 'Goes/going (grammar)',
                confidence: 1.0,
                usageCount: 0,
                learnedDate: new Date().toISOString(),
                lastUsed: '',
                approvedByUser: true
            }
        ]
    };
}

/**
 * Normalize voice transcript using learned vocabulary
 */
export function normalizeTranscript(
    transcript: string,
    vocabDB: VocabDatabase
): { normalized: string; replacements: Array<{ from: string; to: string }> } {

    let normalized = transcript;
    const replacements: Array<{ from: string; to: string }> = [];

    // Sort by length descending to match longer phrases first
    const sortedMappings = [...vocabDB.mappings].sort(
        (a, b) => b.colloquial.length - a.colloquial.length
    );

    for (const mapping of sortedMappings) {
        if (mapping.approvedByUser && mapping.confidence >= 0.7) {
            const regex = new RegExp(mapping.colloquial, 'gi');
            if (regex.test(normalized)) {
                normalized = normalized.replace(regex, mapping.standard);
                replacements.push({
                    from: mapping.colloquial,
                    to: mapping.standard
                });

                // Update usage count
                mapping.usageCount++;
                mapping.lastUsed = new Date().toISOString();
            }
        }
    }

    return { normalized, replacements };
}

/**
 * Learn new vocabulary from Gemini's parsed output
 * Extract terms that Gemini understood but might not be in our DB
 */
export async function learnFromParsedLog(
    originalTranscript: string,
    parsedLog: AgriLogResponse,
    vocabDB: VocabDatabase
): Promise<VocabMapping[]> {

    console.log('🧠 Learning new vocabulary from:', originalTranscript);

    const newMappings: VocabMapping[] = [];

    // Use Gemini to extract potential new vocabulary
    const prompt = buildVocabLearningPrompt(originalTranscript, parsedLog);

    try {
        const response = await callGeminiForVocabLearning(prompt);
        const suggested = parseVocabSuggestions(response);

        for (const suggestion of suggested) {
            // Check if already exists
            const exists = vocabDB.mappings.find(
                m => m.colloquial.toLowerCase() === suggestion.colloquial.toLowerCase()
            );

            if (!exists) {
                newMappings.push({
                    ...suggestion,
                    usageCount: 1,
                    learnedDate: new Date().toISOString(),
                    lastUsed: new Date().toISOString(),
                    approvedByUser: false // Needs user approval
                });
            }
        }

        console.log(`✅ Learned ${newMappings.length} new terms`);
        return newMappings;

    } catch (error) {
        console.error('Failed to learn vocabulary:', error);
        return [];
    }
}

/**
 * Build prompt for vocabulary learning
 */
function buildVocabLearningPrompt(
    transcript: string,
    parsedLog: AgriLogResponse
): string {
    return `तू एक मराठी भाषा तज्ञ आहेस. खालील वाक्य आणि त्याचे अर्थ पाहून, नवीन बोलीभाषा शब्द शोधा.

मूळ वाक्य: "${transcript}"

समजलेला अर्थ:
- Tasks: ${parsedLog.cropActivities?.map(a => a.title).join(', ') || 'नाही'}
- Labour: ${parsedLog.labour && parsedLog.labour.length > 0 ? `${parsedLog.labour.length} entries` : 'नाही'}
- Irrigation: ${parsedLog.irrigation && parsedLog.irrigation.length > 0 ? parsedLog.irrigation.map(i => i.method).join(', ') : 'नाही'}
- Machinery: ${parsedLog.machinery && parsedLog.machinery.length > 0 ? parsedLog.machinery.map(m => m.type).join(', ') : 'नाही'}
- Inputs: ${parsedLog.inputs && parsedLog.inputs.length > 0 ? parsedLog.inputs.map(i => i.mix.map(m => m.productName).join(', ')).join(' | ') : 'नाही'}

तुझे काम:
1. वाक्यातील बोलीभाषा/अनौपचारिक शब्द ओळखा
2. त्यांचे प्रमाणित/शुद्ध मराठी शब्द सांगा
3. श्रेणी नेमा (labour_male, labour_female, irrigation, etc.)

JSON फॉरमॅट:
[
  {
    "colloquial": "बोलीचा शब्द",
    "standard": "प्रमाणित शब्द",
    "category": "श्रेणी",
    "context": "अर्थ वर्णन",
    "confidence": 0.0-1.0
  }
]

फक्त नवीन/अनौपचारिक शब्द शोधा. सामान्य शब्द वगळा.`;
}

/**
 * Call Gemini for vocabulary learning
 */
async function callGeminiForVocabLearning(prompt: string): Promise<string> {
    const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

    if (!API_KEY) {
        throw new Error('Gemini API key not configured');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 1024,
            }
        })
    });

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

/**
 * Parse vocabulary suggestions from Gemini response
 */
function parseVocabSuggestions(response: string): VocabMapping[] {
    try {
        // Extract JSON
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return [];

        const suggestions = JSON.parse(jsonMatch[0]);
        return suggestions.map((s: any) => ({
            colloquial: s.colloquial,
            standard: s.standard,
            category: s.category as VocabCategory,
            context: s.context,
            confidence: s.confidence,
            usageCount: 0,
            learnedDate: '',
            lastUsed: '',
            approvedByUser: false
        }));
    } catch (error) {
        console.error('Failed to parse vocab suggestions:', error);
        return [];
    }
}

/**
 * Save vocabulary database to localStorage
 */
export function saveVocabDB(vocabDB: VocabDatabase): void {
    vocabDB.lastUpdated = new Date().toISOString();
    vocabDB.totalMappings = vocabDB.mappings.length;

    localStorage.setItem('agrilog_vocab_db', JSON.stringify(vocabDB));
    console.log(`💾 Saved vocabulary DB with ${vocabDB.totalMappings} mappings`);
}

/**
 * Load vocabulary database from localStorage
 */
export function loadVocabDB(): VocabDatabase {
    const stored = localStorage.getItem('agrilog_vocab_db');

    if (stored) {
        try {
            const db = JSON.parse(stored);
            console.log(`📖 Loaded vocabulary DB with ${db.totalMappings} mappings`);
            return db;
        } catch (error) {
            console.error('Failed to parse vocab DB, initializing new one');
        }
    }

    // Initialize new DB if none exists
    const newDB = initializeVocabDB();
    saveVocabDB(newDB);
    return newDB;
}

/**
 * Add user-approved mapping to database
 */
export function addApprovedMapping(
    vocabDB: VocabDatabase,
    mapping: VocabMapping
): void {
    mapping.approvedByUser = true;

    const existing = vocabDB.mappings.findIndex(
        m => m.colloquial.toLowerCase() === mapping.colloquial.toLowerCase()
    );

    if (existing >= 0) {
        vocabDB.mappings[existing] = mapping;
    } else {
        vocabDB.mappings.push(mapping);
    }

    saveVocabDB(vocabDB);
    console.log(`✅ Approved mapping: "${mapping.colloquial}" → "${mapping.standard}"`);
}

/**
 * Get statistics about vocabulary learning
 */
export function getVocabStats(vocabDB: VocabDatabase) {
    return {
        total: vocabDB.totalMappings,
        approved: vocabDB.mappings.filter(m => m.approvedByUser).length,
        pending: vocabDB.mappings.filter(m => !m.approvedByUser).length,
        mostUsed: vocabDB.mappings
            .sort((a, b) => b.usageCount - a.usageCount)
            .slice(0, 10),
        recentlyLearned: vocabDB.mappings
            .sort((a, b) => new Date(b.learnedDate).getTime() - new Date(a.learnedDate).getTime())
            .slice(0, 10)
    };
}
