using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// §P0.4 — strip the raw transcript from <c>ssf.correction_events</c>,
    /// and make the EF mapping address the table that actually exists.
    ///
    /// <para>
    /// <b>Three things happen here, in this order.</b>
    /// </para>
    ///
    /// <para>
    /// <b>1. The mapping is corrected (no DDL).</b> The physical table was
    /// created by raw SQL in <c>20260504010000_AddCorrectionEvent</c> with
    /// snake_case columns and <c>ix_…</c> index names. The EF configuration
    /// never said so and the context has no snake_case convention, so the
    /// model has always addressed columns that do not exist —
    /// <c>select "UserId" from ssf.correction_events</c> answers
    /// <c>ERROR: column "UserId" does not exist</c>. Every insert through
    /// this mapping throws 42703. The scaffolder therefore wanted to emit
    /// eight <c>RenameColumn</c> and three <c>RenameIndex</c> operations
    /// from names that were never in any database; running those would fail
    /// on the first one. They are deliberately NOT here. The model is now
    /// right, so there is nothing to rename — only the snapshot moves.
    /// </para>
    ///
    /// <para>
    /// <b>2. Two real schema changes.</b> <c>original_parse_id</c> becomes
    /// nullable, because the client used to substitute a fresh random UUID
    /// when it had no originating <c>AiJob</c> — an id that matched nothing
    /// while still looking like a genuine link. And
    /// <c>prompt_content_hash</c> is added: the only tamper-evident prompt
    /// identifier, previously discarded on the way in.
    /// </para>
    ///
    /// <para>
    /// <b>3. Rows already stored are redacted.</b> Removing the transcript
    /// from the write path does nothing for rows already written, and a
    /// bleed-stop presented as a fix is worse than an honest bleed-stop.
    /// The backfill deletes transcript-bearing KEYS from the two jsonb
    /// payloads at every depth and touches nothing else — the structured
    /// correction signal (which field, what the AI said, what the farmer
    /// said instead) is the AI learning loop's only input and survives
    /// intact. The key list is kept identical to
    /// <c>TranscriptRedaction.TranscriptTextKeys</c>.
    /// </para>
    ///
    /// <para>
    /// <b>Not reversible.</b> <c>Down</c> restores the schema, not the
    /// transcripts. Removing them is the point.
    /// </para>
    /// </summary>
    public partial class StripTranscriptFromCorrectionEvents : Migration
    {
        /// <summary>
        /// Verbatim-speech keys. MUST stay in step with
        /// <c>ShramSafal.Domain.Corrections.TranscriptRedaction.TranscriptTextKeys</c>.
        /// </summary>
        private const string TranscriptKeyArraySql =
            "ARRAY['rawTranscript','fullTranscript','sourceText','english','english_redacted','rawText','transcript']";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. Schema: honest nullability + the prompt hash ──────────
            migrationBuilder.Sql(@"
ALTER TABLE ssf.correction_events
    ALTER COLUMN original_parse_id DROP NOT NULL;

ALTER TABLE ssf.correction_events
    ADD COLUMN IF NOT EXISTS prompt_content_hash varchar(64) NULL;
");

            // ── 2. Backfill: remove transcript keys from stored payloads ──
            //
            // A recursive key-stripper. It only ever OMITS keys — it never
            // adds, renames or rewrites a value, so it cannot fabricate, and
            // it is idempotent (stripping stripped json is the identity).
            migrationBuilder.Sql($@"
CREATE OR REPLACE FUNCTION ssf.fn_strip_transcript_keys(input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    transcript_keys text[] := {TranscriptKeyArraySql};
    result jsonb;
    entry  record;
    item   jsonb;
BEGIN
    IF input IS NULL THEN
        RETURN NULL;
    END IF;

    IF jsonb_typeof(input) = 'object' THEN
        result := '{{}}'::jsonb;
        FOR entry IN SELECT key, value FROM jsonb_each(input) LOOP
            IF NOT (entry.key = ANY(transcript_keys)) THEN
                result := result || jsonb_build_object(
                    entry.key, ssf.fn_strip_transcript_keys(entry.value));
            END IF;
        END LOOP;
        RETURN result;
    END IF;

    IF jsonb_typeof(input) = 'array' THEN
        result := '[]'::jsonb;
        FOR item IN SELECT value FROM jsonb_array_elements(input) LOOP
            result := result || jsonb_build_array(
                ssf.fn_strip_transcript_keys(item));
        END LOOP;
        RETURN result;
    END IF;

    -- Scalars pass through. A bare string is never assumed to be speech;
    -- only the KEY tells us that.
    RETURN input;
END;
$$;
");

            // The table is FORCE ROW LEVEL SECURITY with a per-user policy
            // (`p_user_correction_events`, keyed on the `agrisync.user_id`
            // GUC). A superuser bypasses it, but an owner-role migration
            // does NOT — under FORCE the owner is subject to the policy too,
            // and with the GUC unset the policy matches zero rows. The
            // backfill would then report success having redacted nothing.
            // Lift FORCE for the statement and put it straight back.
            //
            // FORCE is not the only thing in the way. `correction_events` is
            // append-only: UPDATE and DELETE are REVOKED from the owner, not
            // merely unheld. Measured on production 2026-08-26 the owner has
            // INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE and nothing else,
            // so the statement below raises 42501 before RLS is ever reached.
            // This one-time redaction is the deliberate exception to
            // append-only, so lift the revoke exactly the way FORCE is lifted
            // — for the statement, and straight back afterwards.
            //
            // CI runs Postgres as a superuser, where has_table_privilege is
            // unconditionally true and this branch never runs. That is why the
            // gate could not see it: it took a production boot to surface, and
            // it took production down. Do not "simplify" this away.
            migrationBuilder.Sql(@"
DO $$
DECLARE
    update_was_revoked boolean := false;
BEGIN
    IF NOT has_table_privilege(current_user, 'ssf.correction_events', 'UPDATE') THEN
        EXECUTE format('GRANT UPDATE ON ssf.correction_events TO %I', current_user);
        update_was_revoked := true;
    END IF;

    ALTER TABLE ssf.correction_events NO FORCE ROW LEVEL SECURITY;

    UPDATE ssf.correction_events
       SET original_parse_raw = ssf.fn_strip_transcript_keys(original_parse_raw),
           corrected_parse    = ssf.fn_strip_transcript_keys(corrected_parse)
     WHERE ssf.fn_strip_transcript_keys(original_parse_raw) IS DISTINCT FROM original_parse_raw
        OR ssf.fn_strip_transcript_keys(corrected_parse)    IS DISTINCT FROM corrected_parse;

    ALTER TABLE ssf.correction_events FORCE ROW LEVEL SECURITY;

    -- Restore append-only. On the failure path the whole migration
    -- transaction rolls back, which takes the GRANT with it.
    IF update_was_revoked THEN
        EXECUTE format('REVOKE UPDATE ON ssf.correction_events FROM %I', current_user);
    END IF;
END $$;
");

            // ── 3. Prove it, loudly ─────────────────────────────────────
            //
            // The failure mode this guards is a backfill that silently
            // matches nothing (RLS, a permission, a typo) and still reports
            // success — the migration would then be recorded as applied
            // while every transcript remained. Verify against the table
            // itself and refuse to complete if any row still carries one.
            migrationBuilder.Sql($@"
DO $$
DECLARE
    leftovers bigint;
BEGIN
    ALTER TABLE ssf.correction_events NO FORCE ROW LEVEL SECURITY;

    SELECT count(*) INTO leftovers
      FROM ssf.correction_events
     WHERE ssf.fn_strip_transcript_keys(original_parse_raw) IS DISTINCT FROM original_parse_raw
        OR ssf.fn_strip_transcript_keys(corrected_parse)    IS DISTINCT FROM corrected_parse;

    ALTER TABLE ssf.correction_events FORCE ROW LEVEL SECURITY;

    IF leftovers > 0 THEN
        RAISE EXCEPTION
            'P0.4 backfill did not take: % correction_events row(s) still carry transcript text.',
            leftovers;
    END IF;
END $$;
");

            // The stripper was scaffolding for the backfill, not a runtime
            // dependency — the aggregate redacts on the way in from here on.
            migrationBuilder.Sql("DROP FUNCTION IF EXISTS ssf.fn_strip_transcript_keys(jsonb);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Schema only. The transcripts are gone and stay gone — there is
            // no copy to restore them from, which is the property §P0.4 buys.
            //
            // `original_parse_id` goes back to NOT NULL. Rows recorded while
            // the column was nullable genuinely have no originating AiJob;
            // the all-zero UUID is the least dishonest stand-in available on
            // a down-migration, and it is at least recognisable as "none"
            // rather than passing for a real job id.
            migrationBuilder.Sql(@"
UPDATE ssf.correction_events
   SET original_parse_id = '00000000-0000-0000-0000-000000000000'::uuid
 WHERE original_parse_id IS NULL;

ALTER TABLE ssf.correction_events
    ALTER COLUMN original_parse_id SET NOT NULL;

ALTER TABLE ssf.correction_events
    DROP COLUMN IF EXISTS prompt_content_hash;
");
        }
    }
}
