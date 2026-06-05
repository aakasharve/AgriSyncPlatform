using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShramSafal.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AdoptFarmMembershipOwnerAccountIdInModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // INTENTIONAL NO-OP. ssf.farm_memberships.owner_account_id and
            // ix_farm_memberships_owner_account_id ALREADY exist — created NOT NULL by
            // 20260516120000_AddOwnerAccountIdToFarmMemberships, which deliberately kept
            // the column OFF the EF model. This migration exists ONLY to adopt that
            // existing column/index into the EF model + snapshot (see
            // FarmMembershipConfiguration shadow property). Re-issuing AddColumn/CreateIndex
            // here would fail "already exists" on prod and DUPLICATE on a fresh DB (where
            // 20260516120000 runs first). The column's schema lifecycle stays owned by
            // 20260516120000. No DDL.
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // No-op — see Up. The column + index are owned by 20260516120000; reverting
            // model-adoption requires no schema change.
        }
    }
}
