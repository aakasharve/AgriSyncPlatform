/**
 * Local vocabulary store used by manual corrections and vocabulary review UI.
 * Server-side parsing is authoritative; this store is only a local aid.
 */

const STORAGE_KEY = 'agrilog_vocab_db_v2';

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

export interface VocabMapping {
    colloquial: string;
    standard: string;
    category: VocabCategory;
    context: string;
    confidence: number;
    usageCount: number;
    learnedDate: string;
    lastUsed: string;
    approvedByUser: boolean;
    cropType?: string;
}

export interface VocabDatabase {
    version: string;
    lastUpdated: string;
    totalMappings: number;
    mappings: VocabMapping[];
}

function nowIso(): string {
    return new Date().toISOString();
}

function normalizeDb(db: Partial<VocabDatabase> | null | undefined): VocabDatabase {
    const mappings = Array.isArray(db?.mappings) ? db!.mappings : [];
    return {
        version: db?.version || '2.0.0',
        lastUpdated: db?.lastUpdated || nowIso(),
        totalMappings: mappings.length,
        mappings,
    };
}

export function initializeVocabDB(): VocabDatabase {
    return normalizeDb({
        version: '2.0.0',
        lastUpdated: nowIso(),
        mappings: [],
    });
}

export function saveVocabDB(vocabDB: VocabDatabase): void {
    const normalized = normalizeDb(vocabDB);
    normalized.lastUpdated = nowIso();
    normalized.totalMappings = normalized.mappings.length;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}

export function loadVocabDB(): VocabDatabase {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
        const initialized = initializeVocabDB();
        saveVocabDB(initialized);
        return initialized;
    }

    try {
        return normalizeDb(JSON.parse(raw) as Partial<VocabDatabase>);
    } catch {
        const initialized = initializeVocabDB();
        saveVocabDB(initialized);
        return initialized;
    }
}

export function addApprovedMapping(vocabDB: VocabDatabase, mapping: VocabMapping): void {
    const normalized = normalizeDb(vocabDB);
    const next: VocabMapping = {
        ...mapping,
        approvedByUser: true,
        confidence: Number.isFinite(mapping.confidence) ? mapping.confidence : 1,
        usageCount: Number.isFinite(mapping.usageCount) ? mapping.usageCount : 0,
        learnedDate: mapping.learnedDate || nowIso(),
        lastUsed: nowIso(),
    };

    const index = normalized.mappings.findIndex(
        item => item.colloquial.trim().toLowerCase() === next.colloquial.trim().toLowerCase());
    if (index >= 0) {
        normalized.mappings[index] = next;
    } else {
        normalized.mappings.push(next);
    }

    saveVocabDB(normalized);
}

