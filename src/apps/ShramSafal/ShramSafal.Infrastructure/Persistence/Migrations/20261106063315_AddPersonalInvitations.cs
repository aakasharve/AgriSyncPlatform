using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5; founder D-22, D-26; register F79). The
    /// personal invitation: the owner decides who a person is on his farm (label, plots, authorities and their ends) before
    /// that person joins; seven days, single use, an eight-digit code.
    ///
    /// <para><b>One new table, <c>ssf.farm_personal_invitations</c>,</b> FORCE ROW LEVEL SECURITY from birth on its own
    /// <c>farm_id</c> (F8 — a direct tenant column, never an EXISTS through a parent), with three policies:</para>
    /// <list type="bullet">
    /// <item><c>p_tenant_farm_personal_invitations</c> — the farm's own rows, read and written, under
    /// <c>agrisync.farm_id</c> (the owner's routes; a claim after its farm scope is published);</item>
    /// <item><c>p_invitee_phone_select_farm_personal_invitations</c> — SELECT only: the rows that named the number in
    /// <c>agrisync.invitee_phone</c> (the caller's PROVEN number, read by the server from its own record);</item>
    /// <item><c>p_invite_code_select_farm_personal_invitations</c> — SELECT only: the one row whose code is
    /// <c>agrisync.invite_code</c>.</item>
    /// </list>
    /// <para>Both invitee settings are written only by <c>PersonalInvitationTenantScope</c> (in the allow-listed
    /// <c>CallerFarmTenantScope.cs</c>); a session that never set them sees nothing through those doors, and no write policy
    /// is widened. The app role gets SELECT, INSERT and UPDATE (an invitation's status moves; nothing is ever deleted:
    /// DELETE and TRUNCATE are not granted). <c>farm_id</c> references <c>ssf.farms</c> (RESTRICT).</para>
    ///
    /// <para><b>Three nullable columns on <c>ssf.farm_memberships</c>:</b> <c>relationship_label</c> (CHECK-constrained to
    /// the four labels or NULL), <c>personal_invitation_id</c> and <c>field_operator_id</c>. Every existing row reads NULL:
    /// no label is guessed for an old सहमालक seat (D-8, P4), and no existing seat changes (P10).</para>
    ///
    /// <para><b>Behaviour (E8).</b> Additive: no existing column, constraint or policy changes, so the deployed binary runs
    /// unchanged against the migrated schema (it never names the new columns or table). The behaviour change this lane
    /// makes — the farm QR only ASKS to join — is in code, not here.</para>
    ///
    /// <para><b>Down() destroys data, stated before it ever runs.</b> It drops the table — every waiting, used, declined and
    /// withdrawn invitation is forgotten (their audit rows stay) — and the three membership columns: a seat claimed from an
    /// invitation keeps its role, status, authorities and plots, but कुटुंब becomes indistinguishable from सहमालक again
    /// (F79), a waiting claim loses the invitation the owner's one tap would apply (it stays an ordinary PendingApproval seat
    /// he can approve the general way), and a worker-to-login link is forgotten (the identity event that recorded it
    /// stays). Rolling back after invitations were used is a founder decision.</para>
    /// </summary>
    public partial class AddPersonalInvitations : Migration
    {
        internal const string SecuritySql = @"
ALTER TABLE ssf.farm_memberships ADD CONSTRAINT ck_farm_memberships_relationship_label
  CHECK (relationship_label IS NULL OR relationship_label IN ('CoOwner', 'Family', 'Mukadam', 'Worker'));
ALTER TABLE ssf.farm_personal_invitations ADD CONSTRAINT ""FK_farm_personal_invitations_farms_farm_id""
  FOREIGN KEY (farm_id) REFERENCES ssf.farms (""Id"") ON DELETE RESTRICT;

ALTER TABLE ssf.farm_personal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.farm_personal_invitations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_tenant_farm_personal_invitations ON ssf.farm_personal_invitations;
CREATE POLICY p_tenant_farm_personal_invitations ON ssf.farm_personal_invitations
  USING      (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid)
  WITH CHECK (farm_id = NULLIF(current_setting('agrisync.farm_id', true), '')::uuid);
DROP POLICY IF EXISTS p_invitee_phone_select_farm_personal_invitations ON ssf.farm_personal_invitations;
CREATE POLICY p_invitee_phone_select_farm_personal_invitations ON ssf.farm_personal_invitations
  FOR SELECT
  USING (
    invited_phone_e164 IS NOT NULL
    AND invited_phone_e164 = NULLIF(current_setting('agrisync.invitee_phone', true), '')
  );
DROP POLICY IF EXISTS p_invite_code_select_farm_personal_invitations ON ssf.farm_personal_invitations;
CREATE POLICY p_invite_code_select_farm_personal_invitations ON ssf.farm_personal_invitations
  FOR SELECT
  USING (code = NULLIF(current_setting('agrisync.invite_code', true), ''));

DO $$
BEGIN
    -- A new table gets its grants in the migration that creates it (20260831180408_AddAttendanceMarks's lesson).
    -- No DELETE, no TRUNCATE: an invitation ends by its status, and its row stays as history.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        GRANT SELECT, INSERT, UPDATE ON ssf.farm_personal_invitations TO agrisync_app;
        IF has_table_privilege('agrisync_app', 'ssf.farm_personal_invitations', 'DELETE')
           OR has_table_privilege('agrisync_app', 'ssf.farm_personal_invitations', 'TRUNCATE') THEN
            REVOKE DELETE, TRUNCATE ON ssf.farm_personal_invitations FROM agrisync_app;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
        GRANT SELECT ON ssf.farm_personal_invitations TO agrisync_readonly;
    END IF;
END
$$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "field_operator_id",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "personal_invitation_id",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "relationship_label",
                schema: "ssf",
                table: "farm_memberships",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "farm_personal_invitations",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_id = table.Column<Guid>(type: "uuid", nullable: false),
                    farm_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    invited_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    label = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    person_name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    invited_phone_e164 = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    field_operator_id = table.Column<Guid>(type: "uuid", nullable: true),
                    plot_scope = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    authorities = table.Column<string>(type: "jsonb", nullable: false),
                    code = table.Column<string>(type: "character(8)", fixedLength: true, maxLength: 8, nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    expires_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    status = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    claimed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    claimed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    waits_for_owner = table.Column<bool>(type: "boolean", nullable: false),
                    membership_id = table.Column<Guid>(type: "uuid", nullable: true),
                    owner_approved_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    worker_linked = table.Column<bool>(type: "boolean", nullable: false),
                    ended_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ended_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    replaced_by_invitation_id = table.Column<Guid>(type: "uuid", nullable: true),
                    scope_plot_ids = table.Column<List<Guid>>(type: "uuid[]", nullable: false),
                    scope_plot_names = table.Column<List<string>>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_farm_personal_invitations", x => x.id);
                    table.CheckConstraint("ck_farm_personal_invitations_code", "code ~ '^[0-9]{8}$'");
                    table.CheckConstraint("ck_farm_personal_invitations_label", "label IN ('CoOwner', 'Family', 'Mukadam', 'Worker')");
                    table.CheckConstraint("ck_farm_personal_invitations_plot_scope", "(plot_scope = 'ChosenPlots') = (cardinality(scope_plot_ids) > 0) AND cardinality(scope_plot_ids) = cardinality(scope_plot_names) AND plot_scope IN ('AllPlots', 'ChosenPlots', 'OwnWork')");
                    table.CheckConstraint("ck_farm_personal_invitations_status", "status IN ('Waiting', 'Accepted', 'Declined', 'Withdrawn')");
                });

            migrationBuilder.CreateIndex(
                name: "ix_farm_personal_invitations_farm_created",
                schema: "ssf",
                table: "farm_personal_invitations",
                columns: new[] { "farm_id", "created_at_utc" });

            migrationBuilder.CreateIndex(
                name: "ix_farm_personal_invitations_phone_waiting",
                schema: "ssf",
                table: "farm_personal_invitations",
                column: "invited_phone_e164",
                filter: "status = 'Waiting' AND invited_phone_e164 IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ux_farm_personal_invitations_code",
                schema: "ssf",
                table: "farm_personal_invitations",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_farm_personal_invitations_farm_phone_waiting",
                schema: "ssf",
                table: "farm_personal_invitations",
                columns: new[] { "farm_id", "invited_phone_e164" },
                unique: true,
                filter: "status = 'Waiting' AND invited_phone_e164 IS NOT NULL");

            migrationBuilder.Sql(SecuritySql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // DATA-DESTROYING (see the class remarks): every invitation is forgotten; the membership columns go. The audit
            // rows of each change stay.
            migrationBuilder.Sql(@"
DROP POLICY IF EXISTS p_invite_code_select_farm_personal_invitations ON ssf.farm_personal_invitations;
DROP POLICY IF EXISTS p_invitee_phone_select_farm_personal_invitations ON ssf.farm_personal_invitations;
DROP POLICY IF EXISTS p_tenant_farm_personal_invitations ON ssf.farm_personal_invitations;
ALTER TABLE ssf.farm_memberships DROP CONSTRAINT IF EXISTS ck_farm_memberships_relationship_label;
");

            migrationBuilder.DropTable(
                name: "farm_personal_invitations",
                schema: "ssf");

            migrationBuilder.DropColumn(
                name: "field_operator_id",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "personal_invitation_id",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "relationship_label",
                schema: "ssf",
                table: "farm_memberships");
        }
    }
}
