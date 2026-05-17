// spec: data-principle-spine-2026-05-05/06.1
using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.1 — consent domain
    /// tables. Ships <c>ssf.user_consent_state</c> (mutable, one row per
    /// user) AND <c>ssf.consent_audit</c> (append-only ledger).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Timestamp deviation from plan.</b> Plan §6.1.4 specifies the
    /// migration file <c>20260511000000_ConsentDomain</c>, but the
    /// Phase 03–05 migrations have already shipped at timestamps
    /// 2026-05-15 through 2026-05-18 (latest:
    /// <c>20260518000000_PrivacyEdge</c>). A 2026-05-11 stamp would
    /// re-order EF's migration history and force every dev environment
    /// to re-baseline. Shipped at <c>20260519000000</c> instead — the
    /// next free slot after PrivacyEdge — so the migration applies LAST
    /// in the natural chronological order and the <c>agrisync_app</c>
    /// role (created by <c>20260515090000_BootstrapDbRoles</c>) exists
    /// when this migration's GRANT block runs.
    /// </para>
    ///
    /// <para>
    /// <b>Two tables in one migration.</b> The live consent state and
    /// the audit ledger are written in the same handler transaction
    /// (every state change emits an audit row), so they MUST land
    /// together — splitting would create a window where the state table
    /// exists but the audit ledger does not, and the handler would
    /// crash.
    /// </para>
    ///
    /// <para>
    /// <b>RLS exemption (Phase 06 envelope decision).</b> Neither table
    /// gets Row-Level Security in this migration. The rows are
    /// <b>user-keyed</b> not farm-keyed; the Phase 03 RLS policy keyed
    /// on <c>agrisync.farm_id</c> would filter every row out. Defence
    /// is at the handler boundary via <c>ICurrentUser</c> — the
    /// endpoint reads <c>sub</c> from the JWT and the handler scopes
    /// every read/write to that user. Both table names are added to
    /// <c>RlsExemptionAllowlistTests.ExpectedRlsExemptions</c> so the
    /// architecture test stays green. See ADR-DS-008.
    /// </para>
    ///
    /// <para>
    /// <b>Append-only ledger doctrine (consent_audit).</b> The migration
    /// REVOKEs UPDATE + DELETE on <c>ssf.consent_audit</c> from
    /// <c>agrisync_app</c> — mirrors the Phase 04
    /// <c>20260517000000_HardenAuditIntegrity</c> doctrine applied to
    /// <c>audit_events</c>. <c>user_consent_state</c> keeps SELECT /
    /// INSERT / UPDATE but DELETE is revoked too — once a user has a
    /// consent row we never physically delete it; revocation flips
    /// booleans + stamps <c>withdrawn_at_utc</c> instead so DPDP audit
    /// can reconstruct "this user was once granted X, then withdrew on
    /// date Y".
    /// </para>
    ///
    /// <para>
    /// <b>jsonb for state snapshots.</b> <c>old_state_json</c> +
    /// <c>new_state_json</c> are <c>jsonb</c> (not <c>text</c>) so the
    /// DPDP §16 export can JSON-query without re-parsing in C#. The
    /// Phase 04 <c>audit_events.payload</c> column uses <c>text</c> for
    /// historical reasons; consent_audit gets the better contract from
    /// day one. (Open-question resolution: plan §6.1.4 sketch wrote
    /// <c>type: "jsonb"</c> in the migration column block but described
    /// it as <c>text</c> in the body prose — the migration code wins.)
    /// </para>
    ///
    /// <para>
    /// <b>IF EXISTS grant guard.</b> The REVOKE / GRANT block uses the
    /// same <c>agrisync_app</c>-exists guard pattern as
    /// <c>20260518000000_PrivacyEdge</c> so the migration is safe to
    /// re-run on test environments that use <c>EnsureCreatedAsync</c>
    /// (which skips the migrations history but still applies the table
    /// shape).
    /// </para>
    /// </remarks>
    public partial class ConsentDomain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── 1. consent_audit ──────────────────────────────────────
            // Append-only ledger. jsonb for state snapshots; index on
            // (user_id, occurred_at_utc) for per-user replay during
            // DPDP §16 export. Append-only enforced by the grant block
            // below (REVOKE UPDATE+DELETE).
            migrationBuilder.CreateTable(
                name: "consent_audit",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    old_state_json = table.Column<string>(type: "jsonb", nullable: false),
                    new_state_json = table.Column<string>(type: "jsonb", nullable: false),
                    actor_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    occurred_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    consent_text_version = table.Column<int>(type: "integer", nullable: false),
                    language_shown = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    app_version = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    device_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ip_hash = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_consent_audit", x => x.id);
                });

            // ── 2. user_consent_state ─────────────────────────────────
            // Mutable state, one row per user. No RLS (user-keyed; see
            // class remarks). Grants applied at the bottom of this
            // migration alongside the consent_audit grants.
            migrationBuilder.CreateTable(
                name: "user_consent_state",
                schema: "ssf",
                columns: table => new
                {
                    user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    full_history_journal = table.Column<bool>(type: "boolean", nullable: false),
                    cross_farm_aggregation = table.Column<bool>(type: "boolean", nullable: false),
                    research_corpus_export = table.Column<bool>(type: "boolean", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    granted_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    withdrawn_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    current_token_kid = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_consent_state", x => x.user_id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_consent_audit_user_occurred",
                schema: "ssf",
                table: "consent_audit",
                columns: new[] { "user_id", "occurred_at_utc" });

            // ── 3. Grants ─────────────────────────────────────────────
            // See <remarks> above for the append-only + no-delete
            // rationale on both tables.
            migrationBuilder.Sql(@"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE ON ssf.user_consent_state TO agrisync_app;
        REVOKE DELETE ON ssf.user_consent_state FROM agrisync_app;

        GRANT SELECT, INSERT ON ssf.consent_audit TO agrisync_app;
        REVOKE UPDATE, DELETE ON ssf.consent_audit FROM agrisync_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "consent_audit",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "user_consent_state",
                schema: "ssf");
        }
    }
}
