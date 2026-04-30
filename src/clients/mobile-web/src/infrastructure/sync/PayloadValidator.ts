// Sub-plan 02 Task 9: validate sync mutation payloads against the
// canonical Zod schemas in sync-contract/schemas/payloads/ before
// enqueueing them. Catches malformed payloads at the offline boundary
// rather than at the server (where the response would be lost on a
// flaky network and require a manual operator escalation).
//
// Today (post-Task 8): 4 mutations have strict schemas; the other 28
// are z.unknown() scaffolds. The validator returns `ok: true` for
// scaffolded mutations so the boundary stays open until
// T-IGH-02-PAYLOADS hardens them.
//
// Schema lookup uses the catalog's `payloadSchema` property as the key
// into the barrel-exported map, so renaming a payload schema is a
// single-source-of-truth change in mutation-types.json.
import * as payloads from '../../../../../../sync-contract/schemas/payloads';
import {
    isSyncMutationType,
    SYNC_MUTATION_CATALOG,
    type SyncMutationType,
} from './SyncMutationCatalog';

export type ValidationResult =
    | { ok: true }
    | { ok: false; errors: { path: string; message: string }[] };

interface MinimalZodSchema {
    safeParse: (v: unknown) => {
        success: boolean;
        error?: { issues: { path: (string | number)[]; message: string }[] };
    };
}

const SCHEMA_BY_KEY = payloads as unknown as Record<string, MinimalZodSchema>;

export function validatePayload(
    mutation: SyncMutationType | string,
    payload: unknown
): ValidationResult {
    if (!isSyncMutationType(mutation)) {
        return {
            ok: false,
            errors: [{ path: '', message: `unknown mutation type: ${String(mutation)}` }],
        };
    }
    const descriptor = SYNC_MUTATION_CATALOG[mutation];
    const schemaKey = `${descriptor.payloadSchema}Payload`;
    const schema = SCHEMA_BY_KEY[schemaKey];
    if (!schema || typeof schema.safeParse !== 'function') {
        // Schema not yet authored or not exported under the expected name.
        // Accept the payload and rely on backend rejection. T-IGH-02-PAYLOADS
        // tracks the hardening that closes this gap.
        return { ok: true };
    }
    const result = schema.safeParse(payload);
    if (result.success) return { ok: true };
    return {
        ok: false,
        errors: (result.error?.issues ?? []).map((i) => ({
            path: i.path.join('.'),
            message: i.message,
        })),
    };
}
