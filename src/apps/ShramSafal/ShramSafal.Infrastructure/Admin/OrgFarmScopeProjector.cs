using System.Text.Json;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Admin;

/// <summary>
/// Maintains mis.effective_org_farm_scope — the materialized JOIN target that
/// admin MIS queries use to filter rows by org scope. Writing is centralised
/// here so grant/revoke handlers (Explicit/Invited), the lineage projector
/// (TemplateLineage), and the nightly reconciler cannot fall out of sync.
///
/// Raw SQL with Npgsql-typed parameters — EF LINQ cannot express UPSERT
/// (ON CONFLICT) and mis.* tables are not mapped as DbSets.
/// </summary>
internal sealed class OrgFarmScopeProjector(
    ShramSafalDbContext db,
    IAnalyticsWriter analytics) : IOrgFarmScopeProjector
{
    public async Task UpsertExplicitAsync(Guid orgId, Guid farmId, string source, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync(
            $@"INSERT INTO mis.effective_org_farm_scope (org_id, farm_id, source, refreshed_at_utc)
               VALUES ({orgId}, {farmId}, {source}, NOW())
               ON CONFLICT (org_id, farm_id) DO UPDATE SET
                 source = EXCLUDED.source,
                 refreshed_at_utc = NOW()",
            ct);
    }

    public async Task RemoveAsync(Guid orgId, Guid farmId, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync(
            $@"DELETE FROM mis.effective_org_farm_scope
               WHERE org_id = {orgId} AND farm_id = {farmId}",
            ct);
    }

    public Task RefreshLineageAsync(Guid orgId, CancellationToken ct)
    {
        // W0-A stub: lineage-derived projection requires joining ScheduleTemplate +
        // PlannedActivity which is a W1 concern. No-op until W1 CEI-01 admin surfaces
        // land — callers are already calling through the port so the wire-up won't
        // need to change.
        return Task.CompletedTask;
    }

    public async Task<int> ReconcileAllAsync(CancellationToken ct)
    {
        // Compare ssf.organization_farm_scopes (active, non-PlatformWildcard rows)
        // against mis.effective_org_farm_scope (non-PlatformWildcard).
        // Every ssf row should have a matching mis row; every mis row (other than
        // TemplateLineage which is projector-owned) should have a matching ssf row.
        var ssfRows = await db.OrganizationFarmScopes
            .Where(s => s.IsActive && s.Source != FarmScopeSource.PlatformWildcard)
            .Select(s => new { OrgId = s.OrganizationId, FarmId = s.FarmId.Value })
            .ToListAsync(ct);

        var misRows = new HashSet<(Guid, Guid)>();
        var conn = db.Database.GetDbConnection();
        await conn.OpenAsync(ct);
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "SELECT org_id, farm_id FROM mis.effective_org_farm_scope " +
                "WHERE source <> 'PlatformWildcard'";
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                misRows.Add((reader.GetGuid(0), reader.GetGuid(1)));
            }
        }
        finally
        {
            await conn.CloseAsync();
        }

        var ssfSet = ssfRows.Select(r => (r.OrgId, r.FarmId)).ToHashSet();

        var missingInMis = ssfSet.Except(misRows).Count();
        var orphanedInMis = misRows.Except(ssfSet).Count();
        var drift = missingInMis + orphanedInMis;

        if (drift > 0)
        {
            await analytics.EmitAsync(new AnalyticsEvent(
                EventId: Guid.NewGuid(),
                EventType: AnalyticsEventType.AdminScopeDriftDetected,
                OccurredAtUtc: DateTime.UtcNow,
                ActorUserId: null,
                FarmId: null,
                OwnerAccountId: null,
                ActorRole: "system",
                Trigger: "reconciler",
                DeviceOccurredAtUtc: null,
                SchemaVersion: "v1",
                PropsJson: JsonSerializer.Serialize(new
                {
                    driftCount = drift,
                    missingInMis,
                    orphanedInMis
                })),
                ct);
        }

        return drift;
    }
}
