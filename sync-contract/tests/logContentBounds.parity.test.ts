// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — the content document's limits, zod vs server.
//
// `MutationQueue.enqueue` safe-parses every payload and THROWS on failure, and the server refuses a
// malformed document at the sync boundary (`LogContentDocument.Validate`). If the two disagreed, a
// document the phone accepted could be refused whole by the server — a farmer's details parked for
// ever — or the phone could refuse what the server would keep. So the limits are read from the C#
// SOURCE and the zod boundary is MEASURED with safeParse, never trusted by name.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    LOG_CONTENT_BUCKETS,
    LOG_CONTENT_ITEM_ID_MAX,
    LOG_CONTENT_MAX_BYTES,
    LOG_CONTENT_SCHEMA_VERSION,
    LOG_CONTENT_TRANSCRIPT_MAX,
    LogContentSchema,
    logContentByteLength,
} from '../schemas/payloads/_log_content.zod';
import { CreateDailyLogPayload } from '../schemas/payloads/create_daily_log.zod';
import { ReviseLogContentPayload } from '../schemas/payloads/revise_log_content.zod';

const here = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(
    here,
    '../..',
    'src/apps/ShramSafal/ShramSafal.Application/UseCases/Logs/Content/LogContentDocument.cs',
);
const serverSource = readFileSync(SERVER_PATH, 'utf8');

/** `public const int Name = <digits, optionally a product>;` read from the C# source. */
function csharpConst(name: string): number {
    const matches = [...serverSource.matchAll(new RegExp(`public\\s+const\\s+int\\s+${name}\\s*=\\s*([\\d\\s*]+);`, 'g'))];
    expect(matches, `expected exactly one 'public const int ${name}' in LogContentDocument.cs`).toHaveLength(1);
    return matches[0][1].split('*').map(part => Number(part.trim())).reduce((a, b) => a * b, 1);
}

/** The server's bucket list, read from the `Buckets` initializer. */
function csharpBuckets(): string[] {
    const block = serverSource.match(/IReadOnlyList<string>\s+Buckets\s*=\s*\[([\s\S]*?)\];/);
    expect(block, 'expected the Buckets list in LogContentDocument.cs').not.toBeNull();
    return [...block![1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

const withNotes = (n: number) => ({ schema: 1, inputs: [{ id: 'x', notes: 'a'.repeat(n) }] });

describe('content document limits — zod schema vs LogContentDocument.cs', () => {
    it('the constants agree', () => {
        expect(csharpConst('SchemaVersion')).toBe(LOG_CONTENT_SCHEMA_VERSION);
        expect(csharpConst('MaxBytes')).toBe(LOG_CONTENT_MAX_BYTES);
        expect(csharpConst('MaxItemIdLength')).toBe(LOG_CONTENT_ITEM_ID_MAX);
        expect(csharpConst('MaxTranscriptLength')).toBe(LOG_CONTENT_TRANSCRIPT_MAX);
        expect(csharpBuckets()).toEqual([...LOG_CONTENT_BUCKETS]);
    });

    it('the schema accepts a document of exactly MaxBytes and refuses one byte more (UTF-8 of the wire text)', () => {
        const overhead = logContentByteLength(withNotes(0));
        const atCap = withNotes(LOG_CONTENT_MAX_BYTES - overhead);
        expect(logContentByteLength(atCap)).toBe(LOG_CONTENT_MAX_BYTES);
        expect(LogContentSchema.safeParse(atCap).success).toBe(true);
        expect(LogContentSchema.safeParse(withNotes(LOG_CONTENT_MAX_BYTES - overhead + 1)).success).toBe(false);
    });

    it('Devanagari counts three bytes a character, as the server counts it', () => {
        expect(logContentByteLength({ t: 'अ' })).toBe(JSON.stringify({ t: '' }).length + 3);
    });

    it('item ids: 1 to MaxItemIdLength characters, a string', () => {
        const withId = (id: unknown) => LogContentSchema.safeParse({ schema: 1, irrigation: [{ id }] }).success;
        expect(withId('a'.repeat(LOG_CONTENT_ITEM_ID_MAX))).toBe(true);
        expect(withId('a'.repeat(LOG_CONTENT_ITEM_ID_MAX + 1))).toBe(false);
        expect(withId('')).toBe(false);
        expect(withId(7)).toBe(false);
    });

    it('his whole words: at most MaxTranscriptLength characters', () => {
        const withWords = (n: number) => LogContentSchema.safeParse({ schema: 1, fullTranscript: 'अ'.repeat(n) }).success;
        expect(withWords(LOG_CONTENT_TRANSCRIPT_MAX)).toBe(true);
        expect(withWords(LOG_CONTENT_TRANSCRIPT_MAX + 1)).toBe(false);
    });

    it('the same structural refusals the server makes', () => {
        const ok = (doc: unknown) => LogContentSchema.safeParse(doc).success;
        expect(ok({ schema: 1 })).toBe(true);
        expect(ok({ irrigation: [] })).toBe(false); // schema required
        expect(ok({ schema: 2 })).toBe(false); // only format 1 exists
        expect(ok({ schema: 1, labour: [] })).toBe(false); // labour has its own path
        expect(ok({ schema: 1, guess: true })).toBe(false); // unknown keys refused
        expect(ok({ schema: 1, inputs: {} })).toBe(false); // a bucket is a list
        expect(ok({ schema: 1, inputs: [1] })).toBe(false); // an item is an object
        expect(ok({ schema: 1, inputs: [{ productName: 'x' }] })).toBe(false); // an item has an id
        expect(ok({ schema: 1, disturbance: [] })).toBe(false); // the chip is an object
        expect(ok({ schema: 1, fullTranscript: 5 })).toBe(false); // his words are a string
    });

    it('every item field beyond id is kept exactly (passthrough), on create and on revise', () => {
        const content = {
            schema: 1,
            inputs: [{
                id: 'p1', productName: 'इथरेल', quantity: 250, unit: 'मिली', sourceText: 'इथरेल अडीचशे मिली',
                provenanceVerified: true, numbers: { dose: { certainty: 'reported', quantity: 250, spokenText: 'अडीचशे' } },
                mix: [{ id: 'm1', productName: 'इथरेल', dose: 250, unit: 'मिली' }],
            }],
        };
        const created = CreateDailyLogPayload.safeParse({
            dailyLogId: '11111111-1111-1111-1111-111111111111',
            farmId: '22222222-2222-2222-2222-222222222222',
            plotId: '33333333-3333-3333-3333-333333333333',
            cropCycleId: '44444444-4444-4444-4444-444444444444',
            logDate: '2026-10-30',
            content,
        });
        expect(created.success).toBe(true);
        expect(created.success && created.data.content).toEqual(content);

        const revised = ReviseLogContentPayload.safeParse({
            dailyLogId: '11111111-1111-1111-1111-111111111111',
            baseVersion: 2,
            content,
            revisedAtUtc: '2026-10-30T05:00:00.000Z',
        });
        expect(revised.success).toBe(true);
        expect(revised.success && revised.data.content).toEqual(content);
    });
});
