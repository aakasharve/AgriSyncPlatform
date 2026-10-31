// lane 2b (P11) — a seat seeded the PRE-2b way (a label, maybe the one labour switch) put through the
// 2b migration's OWN carry-over UPDATE, so a suite that means "a सहमालक / मुकादम / granted member as
// he stands on an upgraded farm" tests exactly what the upgrade gives him, never a copy of its rules.
using System;
using System.Threading.Tasks;
using Npgsql;
using ShramSafal.Infrastructure.Persistence.Migrations;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

internal static class UpgradedSeats
{
    /// <summary>
    /// Runs <see cref="SplitFarmAuthorities.CarryCurrentPowersUpdate"/> on <paramref name="farmId"/>'s
    /// seats only. Call it ONCE, right after seeding them (the upgrade runs once on a real farm).
    /// </summary>
    public static async Task CarryAsync(NpgsqlConnection db, Guid farmId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = SplitFarmAuthorities.CarryCurrentPowersUpdate + " AND m.farm_id = @farm;";
        cmd.Parameters.AddWithValue("farm", farmId);
        await cmd.ExecuteNonQueryAsync();
    }
}
