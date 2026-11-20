using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A2). Creates <c>ssf.control_room_people</c>: the founder's list of approved
    /// numbers, one row per team member, with the starting role and the per-person ticks (<c>text[]</c>). It exists because the sign-in
    /// door must know a number before any account exists, and the per-person ticks fit nowhere on <c>organization_memberships</c> (keyed by
    /// account, no number, no ticks).
    ///
    /// <para><b>Behaviour: ADDITIVE.</b> One new table and nothing else: no column on any existing table, no policy, no grant on any other
    /// table, no data. The binary deployed before this release never names the table, so it runs unchanged against the migrated schema.</para>
    ///
    /// <para><b>Why no row-level security.</b> The table holds staff access data, not a farm's own data: no <c>farm_id</c>, no farmer path
    /// reads it, and every door that touches it is gated in the application (the Platform seat plus the module key). It is on the
    /// <c>RlsExemptionAllowlistTests</c> list with that reason, as <c>organization_memberships</c> and <c>schedule_checks</c> are.</para>
    ///
    /// <para><b>Why no foreign keys.</b> The account (<c>user_id</c>) and seat (<c>membership_id</c>) are plain columns: the person row must
    /// outlive an account that is removed or erased, and the door must be able to say "approved" before an account exists. Two partial
    /// unique indexes keep one ACTIVE row per number and one ACTIVE row per account; a removed row stays beside the new one.</para>
    ///
    /// <para><b>Grants.</b> <c>agrisync_app</c> gets SELECT, INSERT and UPDATE. DELETE and TRUNCATE are revoked (removal is a flag; nothing
    /// is hard-deleted), with the effective-privilege guard copied from <c>20261017080742_EnforceAppendOnlyLedgerGrants</c>: the migration
    /// RAISES if the app role can still delete or truncate, naming every role the privilege flows through.</para>
    ///
    /// <para><b>Erasure.</b> KEEP: ShramSafal's own staff access record, never a farmer's data; named in <c>ErasureWorker.cs</c>.</para>
    ///
    /// <para><b>Down()</b> raises while the table holds a row (the list is the founder's record and History explains it), else drops only
    /// the table this migration made.</para>
    /// </summary>
    public partial class AddControlRoomPeople : Migration
    {
        /// <summary>The exact SQL <see cref="Up"/> runs after the table exists; tests execute this same text.</summary>
        internal const string GrantsSql = @"
DO $$
DECLARE
    v_rel      regclass := 'ssf.control_room_people'::regclass;
    v_owner    name;
    v_priv     text;
    v_holders  text;
    v_failures text := '';
BEGIN
    -- Harnesses that build the schema without BootstrapDbRoles have no app role.
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
        RAISE NOTICE 'agrisync_app does not exist; control-room people grants not applicable here.';
        RETURN;
    END IF;

    -- The people list is current state the founder changes: read, add, change. Removal is a flag, never a delete.
    GRANT SELECT, INSERT, UPDATE ON ssf.control_room_people TO agrisync_app;
    IF has_table_privilege('agrisync_app', v_rel, 'DELETE')
       OR has_table_privilege('agrisync_app', v_rel, 'TRUNCATE') THEN
        REVOKE DELETE, TRUNCATE ON ssf.control_room_people FROM agrisync_app;
    END IF;

    -- The guard, copied from 20261017080742_EnforceAppendOnlyLedgerGrants: the EFFECTIVE privilege, not the ACL text.
    SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = v_rel;
    FOREACH v_priv IN ARRAY ARRAY['DELETE', 'TRUNCATE'] LOOP
        IF has_table_privilege('agrisync_app', v_rel, v_priv) THEN
            SELECT string_agg(
                       CASE WHEN a.grantee = 0 THEN 'PUBLIC'
                            WHEN a.grantee = 'agrisync_app'::regrole THEN 'agrisync_app (direct grant)'
                            ELSE a.grantee::regrole::text || ' (inherited by membership'
                                 || CASE WHEN a.grantee = c.relowner THEN ', table owner' ELSE '' END || ')'
                       END, ', ')
              INTO v_holders
              FROM pg_class c,
                   aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
             WHERE c.oid = v_rel
               AND a.privilege_type = v_priv
               AND (a.grantee = 0 OR pg_has_role('agrisync_app', a.grantee, 'USAGE'));

            v_failures := v_failures || format(E'
  %s %s via %s', v_rel, v_priv,
                COALESCE(v_holders, 'superuser (agrisync_app bypasses privilege checks)'));
        END IF;
    END LOOP;

    IF v_failures <> '' THEN
        RAISE EXCEPTION
            'ssf.control_room_people is still deletable or truncatable by agrisync_app after the revoke (runner %):%',
            current_user, v_failures
            USING HINT = 'A REVOKE on agrisync_app cannot remove a privilege it inherits from another role. Remove the membership or move the table to an owner agrisync_app is not a member of (a role-model decision), then re-run.';
    END IF;
END $$;
";

        /// <summary>The exact SQL <see cref="Down"/> runs before it drops the table.</summary>
        internal const string DownGuardSql = @"
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM ssf.control_room_people) THEN
        RAISE EXCEPTION 'ssf.control_room_people still holds rows; Down() would destroy the founder''s list of approved numbers. Take a snapshot and remove the rows deliberately first.';
    END IF;
END $$;
";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "control_room_people",
                schema: "ssf",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    phone_e164 = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    display_name = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    starting_role = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ticks = table.Column<string[]>(type: "text[]", nullable: false, defaultValueSql: "'{}'"),
                    user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    membership_id = table.Column<Guid>(type: "uuid", nullable: true),
                    is_active = table.Column<bool>(type: "boolean", nullable: false),
                    added_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    added_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    changed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    removed_by_user_id = table.Column<Guid>(type: "uuid", nullable: true),
                    removed_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    kept_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_control_room_people", x => x.id);
                    table.CheckConstraint("ck_control_room_people_starting_role", "starting_role IN ('admin','field_operator','viewer')");
                });

            migrationBuilder.CreateIndex(
                name: "ux_control_room_people_active_phone",
                schema: "ssf",
                table: "control_room_people",
                column: "phone_e164",
                unique: true,
                filter: "is_active");

            migrationBuilder.CreateIndex(
                name: "ux_control_room_people_active_user",
                schema: "ssf",
                table: "control_room_people",
                column: "user_id",
                unique: true,
                filter: "is_active AND user_id IS NOT NULL");

            migrationBuilder.Sql(GrantsSql);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(DownGuardSql);

            migrationBuilder.DropTable(
                name: "control_room_people",
                schema: "ssf");
        }
    }
}
