using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: dfes-companion-2026-07-11 (wave-4.2) — founder decision 17: <b>one visual
    /// acceptance button, two separate legal records.</b>
    ///
    /// <para><c>ssf.terms_acceptance_events</c> is the contractual half,
    /// <c>ssf.consent_grant_events</c> the data-protection half. Two tables, not one,
    /// because withdrawing consent does not un-accept the Terms and a bundled row could
    /// not express that. A blanket "accept everything forever" is not valid consent under
    /// DPDP; consent must be specific, informed, purpose-limited and withdrawable as
    /// easily as it was given, and every one of those words is a shape constraint on
    /// these two tables.</para>
    ///
    /// <para><b>Append-only by PRIVILEGE, not by convention</b> —
    /// <c>REVOKE UPDATE, DELETE ... FROM agrisync_app</c>, exactly as
    /// <c>ssf.question_events</c> already does (20260713052440_AddDfesDataSpine). The app
    /// role physically cannot rewrite a consent decision. A withdrawal is a NEW row with
    /// <c>status = 'Withdrawn'</c>; "granted on the 3rd, withdrawn on the 9th" is the
    /// truthful shape, and an UPDATE in place would destroy the first half of it.</para>
    ///
    /// <para><b>RLS.</b> ENABLE + FORCE, with a SELF-only policy. Neither table carries a
    /// farm_id — consent belongs to a person, not to a field — so the gate is
    /// <c>agrisync.user_id</c> rather than <c>agrisync.farm_id</c>. The WITH CHECK admits
    /// a row whose <c>user_id IS NULL</c> because the gate runs BEFORE login and there is
    /// genuinely no account yet; the USING clause does NOT, so a pre-registration row is
    /// readable by no user through this policy — it has no owner to be readable by. The
    /// join key in that window is <c>pre_registration_session_id</c>.</para>
    ///
    /// <para><b>Additive.</b> Two new tables, four indexes, nothing altered and nothing
    /// backfilled. <c>Down()</c> drops only what <c>Up()</c> created — but note it drops
    /// CONSENT RECORDS, which is a destructive act in the legal sense even though it is a
    /// clean one in the schema sense. Roll back by restoring a snapshot, not by running
    /// this.</para>
    /// </summary>
    public partial class AddConsentGateLedgers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "consent_grant_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    pre_registration_session_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    notice_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    privacy_policy_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    terms_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    displayed_language = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    accepted_purpose_codes = table.Column<string>(type: "text", nullable: false),
                    data_category_codes = table.Column<string>(type: "text", nullable: false),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    app_version = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    notice_hash = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    recorded_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_consent_grant_events", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "terms_acceptance_events",
                schema: "ssf",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    event_type = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    pre_registration_session_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    notice_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    privacy_policy_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    terms_version = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    displayed_language = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    accepted_purpose_codes = table.Column<string>(type: "text", nullable: false),
                    data_category_codes = table.Column<string>(type: "text", nullable: false),
                    source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    app_version = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    notice_hash = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    recorded_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_terms_acceptance_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_consent_grant_events_session",
                schema: "ssf",
                table: "consent_grant_events",
                column: "pre_registration_session_id");

            migrationBuilder.CreateIndex(
                name: "ix_consent_grant_events_user_id",
                schema: "ssf",
                table: "consent_grant_events",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_terms_acceptance_events_session",
                schema: "ssf",
                table: "terms_acceptance_events",
                column: "pre_registration_session_id");

            migrationBuilder.CreateIndex(
                name: "ix_terms_acceptance_events_user_id",
                schema: "ssf",
                table: "terms_acceptance_events",
                column: "user_id");

            // ── RLS + append-only privileges ───────────────────────────────────────
            // Self-only read; pre-registration (user_id NULL) insertable but ownerless.
            // Append-only enforced by REVOKE, not by application discipline.
            migrationBuilder.Sql(@"
ALTER TABLE ssf.terms_acceptance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.terms_acceptance_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_self_terms_acceptance_events ON ssf.terms_acceptance_events;
CREATE POLICY p_self_terms_acceptance_events ON ssf.terms_acceptance_events
  USING      (user_id IS NOT NULL
              AND user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid)
  WITH CHECK (user_id IS NULL
              OR user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid);

ALTER TABLE ssf.consent_grant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.consent_grant_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_self_consent_grant_events ON ssf.consent_grant_events;
CREATE POLICY p_self_consent_grant_events ON ssf.consent_grant_events
  USING      (user_id IS NOT NULL
              AND user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid)
  WITH CHECK (user_id IS NULL
              OR user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT ON ssf.terms_acceptance_events TO agrisync_app;
        GRANT SELECT, INSERT ON ssf.consent_grant_events    TO agrisync_app;
        -- TRUNCATE is revoked alongside UPDATE and DELETE, and on a legal
        -- ledger that is the load-bearing one. TRUNCATE is not a row
        -- operation, so RLS never evaluates it: a single statement from the
        -- ordinary application role erases every consent record ever written,
        -- across all tenants, with the FORCE ROW LEVEL SECURITY above offering
        -- no resistance whatsoever. The same hole was found on ssf.audit_events
        -- and closed by founder ruling on 2026-08-15
        -- (20260815052139_RevokeTruncateOnAuditEvents). Re-opening it eleven
        -- days later on the DPDP consent ledger would be worse than never
        -- having closed it, because these two tables are the evidence that the
        -- consent existed at all.
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.terms_acceptance_events FROM agrisync_app;
        REVOKE UPDATE, DELETE, TRUNCATE ON ssf.consent_grant_events    FROM agrisync_app;
    END IF;
END;
$$ LANGUAGE plpgsql;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_self_consent_grant_events ON ssf.consent_grant_events;
DROP POLICY IF EXISTS p_self_terms_acceptance_events ON ssf.terms_acceptance_events;
");

            migrationBuilder.DropTable(
                name: "consent_grant_events",
                schema: "ssf");

            migrationBuilder.DropTable(
                name: "terms_acceptance_events",
                schema: "ssf");
        }
    }
}
