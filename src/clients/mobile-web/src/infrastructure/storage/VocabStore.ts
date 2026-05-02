/**
 * VocabStore — thin localStorage adapter for the voice vocabulary database.
 *
 * Purpose-named storage adapter (Sub-plan 04 §DoD): the
 * features/voice/vocab/vocabStore.ts module owns the vocab business logic
 * (normalize, addApprovedMapping, etc.) and delegates raw read/write to
 * this adapter so localStorage usage stays inside infrastructure/storage/.
 */

const STORAGE_KEY = 'agrilog_vocab_db_v2';

export function readVocabRaw(): string | null {
    return localStorage.getItem(STORAGE_KEY);
}

export function writeVocabRaw(serialized: string): void {
    localStorage.setItem(STORAGE_KEY, serialized);
}
