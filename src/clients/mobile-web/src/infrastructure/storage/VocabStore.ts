/**
 * VocabStore — thin localStorage adapter for the voice vocabulary database.
 *
 * Purpose-named storage adapter (Sub-plan 04 §DoD): the
 * features/voice/vocab/vocabStore.ts module owns the vocab business logic
 * (normalize, addApprovedMapping, etc.) and delegates raw read/write to
 * this adapter so localStorage usage stays inside infrastructure/storage/.
 *
 * P0.1: the key was RAW, so the words one farmer taught the app — village
 * names, worker names, crop nicknames — were read back by the next farmer on
 * the same handset. It is now scoped per farmer through `storageNamespace`; the
 * incumbent's existing vocabulary is copied into their scope by
 * `adoptUnscopedBusinessKeys` and is never deleted.
 */

import { storageNamespace } from './StorageNamespace';

const STORAGE_KEY = 'agrilog_vocab_db_v2';

export function readVocabRaw(): string | null {
    return localStorage.getItem(storageNamespace.getKey(STORAGE_KEY));
}

export function writeVocabRaw(serialized: string): void {
    localStorage.setItem(storageNamespace.getKey(STORAGE_KEY), serialized);
}
