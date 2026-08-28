// spec: correctionevent-server-persistence
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Widen <c>prompt_version</c> 20 -&gt; 256 on <c>ssf.correction_events</c> and
    /// 64 -&gt; 256 on <c>ssf.golden_set_candidate</c>.
    ///
    /// <para><b>Why 256 and not 32 or 64.</b> Every sibling prompt_version in ssf
    /// (ai_jobs, ai_job_attempts, cost_entries, daily_logs, farm_operations at 32;
    /// golden_set_candidate, transcript_history at 64) stores
    /// <c>Provenance.PromptVersion</c>, which AiOrchestrator hard-codes to the
    /// literal "v1". This column stores what
    /// <c>AiPromptLineage.ResolvePromptVersion</c> returns: the modular prompt
    /// MANIFEST from <c>BuildVersionString</c> -
    /// <c>base:{v};output:{v};buckets:{8 id:version pairs};disturbance:{v};hash:{16 hex}</c>
    /// - which measures 158 characters with every module at v1, and 169 if each
    /// reaches a two-digit version. Sizing to 64 "to match the siblings" would
    /// still raise 22001 on every row; the fix would look done and change nothing.
    /// 256 holds today's 158 with headroom and stays the same order of magnitude
    /// as the family.</para>
    ///
    /// <para><b>Why there is no grant-lift here, and why that is not an oversight.</b>
    /// Migration 20260815080242 on this same table needed a conditional
    /// GRANT UPDATE / NO FORCE ROW LEVEL SECURITY dance and, when it was first
    /// written without one, took production down for 20 minutes with SQLSTATE
    /// 42501. That migration issued an UPDATE: it rewrote row CONTENTS, and
    /// correction_events is append-only with UPDATE and DELETE revoked.
    ///
    /// This migration issues neither DML nor a table rewrite. Increasing the
    /// length limit of a varchar has been metadata-only since PostgreSQL 9.2 -
    /// verified empirically on PG 16 by relfilenode identity: widening left both
    /// the table and the index filenode UNCHANGED, while a control NARROWING moved
    /// both. ALTER TABLE checks table OWNERSHIP, never UPDATE, and RLS does not
    /// apply to DDL at all. Precedent in this same history:
    /// 20260703191514_WidenExtractorCodeShaTo64 widened seven columns the same way
    /// with no grant-lift and no incident.
    ///
    /// Copying the grant-lift here would briefly GRANT UPDATE on an append-only
    /// trust ledger to satisfy a requirement that does not exist - strictly worse
    /// than doing nothing.</para>
    ///
    /// <para><b>Down.</b> Narrowing back to 20/64 WOULD rewrite the table and would
    /// FAIL outright once any row holds a value longer than the target. It is kept
    /// faithful to the forward direction rather than made "safe", because a Down
    /// that silently truncates a trust-ledger identifier is worse than one that
    /// refuses. Production never runs Down: rollback is redeploying the previous
    /// API, and a wider column accepts every value the older binary can send.</para>
    /// </summary>
    [DbContext(typeof(ShramSafalDbContext))]
    [Migration("20260828061500_WidenCorrectionEventPromptVersion")]
    public partial class WidenCorrectionEventPromptVersion : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "prompt_version",
                schema: "ssf",
                table: "correction_events",
                type: "character varying(256)",
                maxLength: 256,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(20)",
                oldMaxLength: 20);

            migrationBuilder.AlterColumn<string>(
                name: "prompt_version",
                schema: "ssf",
                table: "golden_set_candidate",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(64)",
                oldMaxLength: 64,
                oldNullable: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "prompt_version",
                schema: "ssf",
                table: "golden_set_candidate",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(256)",
                oldMaxLength: 256,
                oldNullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "prompt_version",
                schema: "ssf",
                table: "correction_events",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(256)",
                oldMaxLength: 256);
        }
    }
}
