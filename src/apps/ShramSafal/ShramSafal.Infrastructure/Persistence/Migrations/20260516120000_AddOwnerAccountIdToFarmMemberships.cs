// spec: data-principle-spine-2026-05-05/03.1
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// DATA_PRINCIPLE_SPINE_2026-05-05 Phase 03 sub-phase 03.1 — denormalise
    /// <c>owner_account_id</c> onto <c>ssf.farm_memberships</c> so the upcoming
    /// Phase 03.3 RLS policies can key on <c>(farm_id, owner_account_id)</c>
    /// without a per-query join into <c>ssf.farms</c>. Implements Conflict-Resolver
    /// R1 verdict OQ-3 (decisions-log 2026-05-16).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Up() is fail-fast and additive.</b> Steps:
    /// <list type="alphabet">
    /// <item>A. AddColumn <c>owner_account_id uuid NULL</c> on
    /// <c>ssf.farm_memberships</c>.</item>
    /// <item>B. Backfill from <c>ssf.farms.owner_account_id</c> via the existing
    /// <c>farm_id</c> join.</item>
    /// <item>C. Fail-fast guard: <c>RAISE EXCEPTION</c> if any row still has
    /// <c>owner_account_id IS NULL</c> after the backfill. Every farm has a
    /// non-null <c>owner_account_id</c> post-Phase 2 (see migration
    /// <c>20260418144911_TightenFarmOwnerAccountIdNotNull</c>), so this can
    /// only fire on a corrupt DB.</item>
    /// <item>D. AlterColumn <c>owner_account_id</c> NOT NULL + CreateIndex
    /// <c>ix_farm_memberships_owner_account_id</c>.</item>
    /// </list>
    /// </para>
    /// <para>
    /// <b>No foreign key is added.</b> The <c>owner_accounts</c> table lives in
    /// the <c>accounts</c> schema (Accounts bounded context), and the existing
    /// <c>ssf.farms.owner_account_id</c> column intentionally has no cross-schema
    /// FK either — referential integrity across context boundaries is enforced
    /// at the application layer per ADR-DS-001 (DDD bounded contexts) and the
    /// long-standing pattern. Adding a cross-schema FK here would break the
    /// Accounts/ShramSafal decoupling and force a context coupling that does
    /// not exist anywhere else in the codebase.
    /// </para>
    /// <para>
    /// <b>EF model surface intentionally not extended.</b> The new column is
    /// added at the DB level only; <c>FarmMembership</c> domain entity and
    /// <c>FarmMembershipConfiguration</c> remain untouched. Phase 03.2/03.3 will
    /// extend the EF model when <c>TenantContext</c> needs to project the value;
    /// keeping the snapshot stable on this commit makes the dispatch reviewable
    /// as "purely additive at the DB layer".
    /// </para>
    /// <para>
    /// <b>Down() is reversible.</b> Drops the index, drops the column. Production
    /// rollback is snapshot-restore per the Phase 03 plan §Rollback section.
    /// </para>
    /// </remarks>
    public partial class AddOwnerAccountIdToFarmMemberships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── A. AddColumn owner_account_id (NULL while we backfill) ───
            migrationBuilder.AddColumn<System.Guid>(
                name: "owner_account_id",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid",
                nullable: true);

            // ── B. Backfill from ssf.farms via the existing farm_id join ─
            migrationBuilder.Sql(@"
UPDATE ssf.farm_memberships fm
   SET owner_account_id = f.owner_account_id
  FROM ssf.farms f
 WHERE fm.farm_id = f.id
   AND fm.owner_account_id IS NULL;
");

            // ── C. Fail-fast guard — no NULLs may survive the backfill ───
            migrationBuilder.Sql(@"
DO $$
DECLARE
    unmapped_count int;
BEGIN
    SELECT COUNT(*) INTO unmapped_count
    FROM ssf.farm_memberships
    WHERE owner_account_id IS NULL;

    IF unmapped_count > 0 THEN
        RAISE EXCEPTION 'AddOwnerAccountIdToFarmMemberships: backfill left % farm_memberships rows with NULL owner_account_id. Every farm must have a non-null owner_account_id post-Phase 2 (migration 20260418144911); inspect ssf.farms before re-running.', unmapped_count;
    END IF;
END;
$$ LANGUAGE plpgsql;
");

            // ── D. Tighten owner_account_id to NOT NULL + CreateIndex ────
            migrationBuilder.AlterColumn<System.Guid>(
                name: "owner_account_id",
                schema: "ssf",
                table: "farm_memberships",
                type: "uuid",
                nullable: false,
                oldClrType: typeof(System.Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_farm_memberships_owner_account_id",
                schema: "ssf",
                table: "farm_memberships",
                column: "owner_account_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_farm_memberships_owner_account_id",
                schema: "ssf",
                table: "farm_memberships");

            migrationBuilder.DropColumn(
                name: "owner_account_id",
                schema: "ssf",
                table: "farm_memberships");
        }
    }
}
