using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Accounts.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// spec R-11 (b) (pre-launch repair, founder N-1, 26 Oct 2026) — the server-managed pilot access
    /// extension, and the one-time grant that keeps every existing pilot farm working.
    ///
    /// <para><b>Table.</b> <c>accounts.access_extensions</c>: owner account, reason, start, end,
    /// granted by, created at. Append-only: the app role gets SELECT and INSERT only (no UPDATE /
    /// DELETE), the same posture as the other append-only ledgers (421847e7).</para>
    ///
    /// <para><b>Data step (same change, so nothing locks).</b> Every owner account that exists when
    /// this migration runs and whose trial has expired or will expire before the end date gets ONE
    /// extension: reason <c>pilot-extension-2026-10</c>, from now until
    /// <see cref="PilotExtensionEndsAtUtc"/> = 2026-12-31 18:30 UTC (end of 31 Dec 2026, India time —
    /// PROPOSED to the founder), granted by the all-ones system actor. "Will expire" means the
    /// account's current subscription (Trialing/Active first, else the latest) is: none at all,
    /// PastDue, Expired, or a trial whose end falls before that date. A paid Active subscription and
    /// a deliberately Canceled or Suspended account get nothing. No subscription row is touched and
    /// no trial is started or restarted. Accounts created AFTER this migration are not covered —
    /// an admin grants theirs (POST /shramsafal/admin/access-extensions).</para>
    ///
    /// <para><b>Down</b> drops the table (and with it the extensions it granted).</para>
    /// </summary>
    public partial class AddAccessExtensions : Migration
    {
        /// <summary>PROPOSED (founder to confirm): the end of 31 Dec 2026 in India (IST = UTC+5:30).</summary>
        public const string PilotExtensionEndsAtUtc = "2026-12-31 18:30:00+00";

        public const string PilotExtensionReason = "pilot-extension-2026-10";

        /// <summary>The all-ones system actor (AgriSync.BuildingBlocks.Auditing.SystemActor).</summary>
        public const string SystemActorUserId = "ffffffff-ffff-ffff-ffff-ffffffffffff";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "access_extensions",
                schema: "accounts",
                columns: table => new
                {
                    access_extension_id = table.Column<Guid>(type: "uuid", nullable: false),
                    owner_account_id = table.Column<Guid>(type: "uuid", nullable: false),
                    reason = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    starts_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false),
                    ends_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false),
                    granted_by_user_id = table.Column<Guid>(type: "uuid", nullable: false),
                    created_at_utc = table.Column<DateTime>(type: "timestamptz", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_access_extensions", x => x.access_extension_id);
                    table.CheckConstraint("ck_access_extensions_ends_after_starts", "ends_at_utc > starts_at_utc");
                });

            migrationBuilder.CreateIndex(
                name: "ix_access_extensions_owner_account_id",
                schema: "accounts",
                table: "access_extensions",
                column: "owner_account_id");

            // Append-only grants. IF EXISTS on the roles: not every database carries both, and a
            // missing role must not fail the deploy.
            migrationBuilder.Sql(@"
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN
                GRANT USAGE ON SCHEMA accounts TO agrisync_app;
                GRANT SELECT, INSERT ON accounts.access_extensions TO agrisync_app;
                REVOKE UPDATE, DELETE, TRUNCATE ON accounts.access_extensions FROM agrisync_app;
            END IF;

            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_readonly') THEN
                GRANT USAGE ON SCHEMA accounts TO agrisync_readonly;
                GRANT SELECT ON accounts.access_extensions TO agrisync_readonly;
            END IF;
        END
        $$;
        ");

            // The one-time pilot grant (see the class remarks).
            migrationBuilder.Sql($@"
        INSERT INTO accounts.access_extensions
            (access_extension_id, owner_account_id, reason, starts_at_utc, ends_at_utc, granted_by_user_id, created_at_utc)
        SELECT gen_random_uuid(), a.owner_account_id, '{PilotExtensionReason}', now(),
               TIMESTAMPTZ '{PilotExtensionEndsAtUtc}', '{SystemActorUserId}'::uuid, now()
        FROM accounts.owner_accounts a
        LEFT JOIN LATERAL (
            SELECT s.status, s.valid_until_utc
            FROM accounts.subscriptions s
            WHERE s.owner_account_id = a.owner_account_id
            ORDER BY CASE WHEN s.status IN (1, 2) THEN 0 ELSE 1 END, s.updated_at_utc DESC
            LIMIT 1
        ) cur ON TRUE
        WHERE now() < TIMESTAMPTZ '{PilotExtensionEndsAtUtc}'
          AND (cur.status IS NULL
               OR cur.status IN (3, 4)
               OR (cur.status = 1 AND cur.valid_until_utc < TIMESTAMPTZ '{PilotExtensionEndsAtUtc}'));
        ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "access_extensions",
                schema: "accounts");
        }
    }
}
