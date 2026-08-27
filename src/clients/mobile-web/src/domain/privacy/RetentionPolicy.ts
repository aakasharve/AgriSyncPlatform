// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// HOW LONG WE KEEP THINGS — the one place the answer lives.
//
// Founder decision 3 (2026-08-17): "Pick a deletion date for saved voice recordings."
// Before this file there was no answer anywhere. `VoiceClipRetention.ts` had a 30-day
// number for the on-device processing tier and `aws/snapshot/lifecycle-policy.json` had
// 607 days for backups; nothing else had a horizon at all, and the optional Voice Diary
// agreement (`public/consent/agreement_en.md` §1) told the farmer his clips were kept
// "forever".
//
// ── THE RULE THIS FILE OBEYS ────────────────────────────────────────────────────────
// Every entry below states what ACTUALLY happens today, and names the file or the
// mechanism that makes it happen. Where a rule is applied by a person rather than by
// code or by infrastructure, `mechanism` says `'on-request'` and it is not dressed up as
// automatic. A retention notice that promises a deletion nothing performs is worse than
// no notice: the farmer stops asking, and the deletion still never happens.
//
// So: DO NOT add a number here that no code and no S3 lifecycle rule enforces. Either
// wire the enforcement in the same change, or write the truth and mark it `'on-request'`.
//
// ── WHY A NUMBER IS MISSING IN TWO PLACES, AND WHY THAT IS NOT AN OVERSIGHT ─────────
// `serverRawVoiceEvidence` and `voiceDiaryRetainedClips` carry `days: null`. Both are
// deliberate:
//
//   • The raw evidence bucket (`agrisync-raw-ap-south-1`) has NO lifecycle policy in
//     production — verified 2026-08-15 against the live bucket, and a standing founder
//     ruling of the same date says raw voice audio ages out of it never. Writing "90
//     days" here would be a number the infrastructure contradicts, and applying an S3
//     Expiration to satisfy this file would delete farmer voice irrecoverably.
//   • Voice Diary clips are the "keep my full history" feature. A timer on them would
//     contradict the very consent that creates them.
//
// Both are still RETENTION RULES — "kept until you close the account or ask us to delete
// it" is a rule, it is simply an event and not a clock. What each one is NOT allowed to
// be is silent.
//
// ── WHAT READS THIS ─────────────────────────────────────────────────────────────────
// `public/legal/privacy_{mr,en}.md` states these same rules to the farmer, and
// `features/legal/__tests__/legalDocuments.test.ts` fails if a number here stops
// appearing there. That test is the only thing keeping the document and the code from
// drifting, so do not delete it when a number changes — change both.

/** Bumped whenever any rule below changes. The privacy notice carries the same string. */
export const RETENTION_POLICY_VERSION = 'retention-2026-08-17.1';

/** How a rule is actually applied. There is no third option, and no aspirational one. */
export type RetentionMechanism =
    /** Code or S3 lifecycle applies it without anyone deciding to. */
    | 'automatic'
    /** A person at ARVE performs it when the farmer asks. Nothing runs on a timer. */
    | 'on-request';

export interface RetentionRule {
    id:
        | 'deviceVoiceClip'
        | 'serverRawVoiceEvidence'
        | 'voiceDiaryRetainedClips'
        | 'farmWorkRecords'
        | 'databaseBackups'
        | 'consentAndAuditRecords';
    /**
     * Days after which the data goes, or `null` when the rule is an EVENT ("when the
     * account closes", "when he asks") rather than a clock. Never a number nobody
     * enforces — see the header.
     */
    days: number | null;
    mechanism: RetentionMechanism;
    /**
     * The file, worker or infrastructure object that performs it. A real path, so a
     * reader can check the claim rather than take it. `'no automated enforcement'` is an
     * allowed and honest value; a made-up path is not.
     */
    enforcedBy: string;
}

export const RETENTION_RULES: readonly RetentionRule[] = [
    {
        // The clip sits in Dexie on his own phone while Sathi turns it into a work
        // record, then goes. This is the only voice horizon that has ever been real.
        id: 'deviceVoiceClip',
        days: 30,
        mechanism: 'automatic',
        enforcedBy: 'infrastructure/voice/VoiceClipRetention.ts → purgeExpiredProcessingVoiceClips',
    },
    {
        // The cold-tier copy kept as the evidence behind a saved record. No expiry rule
        // exists on the bucket and a founder ruling (2026-08-15) says none should.
        id: 'serverRawVoiceEvidence',
        days: null,
        mechanism: 'on-request',
        enforcedBy: 'no automated enforcement — no S3 lifecycle Expiration on agrisync-raw-ap-south-1',
    },
    {
        // Only exists if he switched the optional retention consent ON. Erasure deletes
        // them for real; switching the consent back OFF does not, today.
        id: 'voiceDiaryRetainedClips',
        days: null,
        mechanism: 'automatic',
        enforcedBy: 'Infrastructure/Privacy/ErasureWorker.cs → IRetainedBlobStore.DeleteRetainedVoiceForUserAsync',
    },
    {
        // Logs, labour, costs. Erasure ANONYMISES rather than deletes: the farm figures
        // survive without a person attached. Disclosed in the notice in those words.
        id: 'farmWorkRecords',
        days: null,
        mechanism: 'automatic',
        enforcedBy: 'Infrastructure/Privacy/ErasureWorker.cs → 5-rule anonymise manifest',
    },
    {
        // 30 days STANDARD → 30 IA → 547 GLACIER → expired. Real, and already applied.
        id: 'databaseBackups',
        days: 607,
        mechanism: 'automatic',
        enforcedBy: 'aws/snapshot/lifecycle-policy.json → snapshot-current-version-tiering.Expiration',
    },
    {
        // Kept, and by design un-deletable: the migration REVOKEs UPDATE and DELETE on
        // both consent ledgers from the app role. His proof of what he was told.
        id: 'consentAndAuditRecords',
        days: null,
        mechanism: 'automatic',
        enforcedBy: 'Migrations/20260816170524_AddConsentGateLedgers.cs → REVOKE UPDATE, DELETE',
    },
] as const;

/** Lookup by id. Throws rather than returning undefined — a missing rule is a bug. */
export function retentionRule(id: RetentionRule['id']): RetentionRule {
    const found = RETENTION_RULES.find((r) => r.id === id);
    if (!found) throw new Error(`No retention rule declared for '${id}'.`);
    return found;
}

/** Every day-count actually stated, for the document-vs-code drift test. */
export const RETENTION_DAY_NUMBERS: readonly number[] = RETENTION_RULES
    .map((r) => r.days)
    .filter((d): d is number => d !== null);
