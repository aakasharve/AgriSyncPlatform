using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32; C12). Reads the raw rows
/// confirmed farm-days are counted from, the <see cref="CompanyMisReader"/> pattern. Counts nothing; catches nothing
/// (a failed read escapes and the route answers 500, never an empty answer).
/// <list type="number">
/// <item><see cref="ReadAllAsync"/> lists farm keys (id, owner account) ONCE through the audited cross-farm factory;
/// nothing else is read through that context. <see cref="ReadFarmsAsync"/> opens no factory.</item>
/// <item>Every farm row is read as the app login on the SCOPED context, one farm per transaction, inside
/// <see cref="RlsIdentityScope.RunAsFarmAsync{T}"/>, so row-level security decides what is seen. A key whose owner
/// account is empty, or whose farm row does not come back, is counted as not readable.</item>
/// <item>Above the live-count ceiling (amendment A1) no farm row is read.</item>
/// </list>
/// Every query is bounded strictly before the counting instant.
/// </summary>
public sealed class ConfirmedFarmDaysReader : IConfirmedFarmDaysReader
{
    private readonly ShramSafalDbContext _db;
    private readonly IAdminDbContextFactory<ShramSafalDbContext> _adminDbFactory;
    private readonly int _maxFarmsForLiveCount;

    public ConfirmedFarmDaysReader(
        ShramSafalDbContext db,
        IAdminDbContextFactory<ShramSafalDbContext> adminDbFactory)
        : this(db, adminDbFactory, GetCompanyMisHandler.MaxFarmsForLiveCount)
    {
    }

    /// <summary>Tests only: a small live-count ceiling (amendment A1), never configuration.</summary>
    internal ConfirmedFarmDaysReader(
        ShramSafalDbContext db,
        IAdminDbContextFactory<ShramSafalDbContext> adminDbFactory,
        int maxFarmsForLiveCount)
    {
        _db = db;
        _adminDbFactory = adminDbFactory;
        _maxFarmsForLiveCount = maxFarmsForLiveCount;
    }

    public async Task<ConfirmedFarmDaysRows> ReadAllAsync(
        Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default)
    {
        // Farm keys, through the audited cross-farm factory (one audit row naming the admin).
        List<ConfirmedFarmKey> keys;
        await using (var admin = await _adminDbFactory.CreateAsync(
                         $"{nameof(ConfirmedFarmDaysReader)}.farm-keys", adminUserId, ct))
        {
            keys = await admin.Farms
                .AsNoTracking()
                .Select(f => new ConfirmedFarmKey((Guid)f.Id, (Guid)f.OwnerAccountId))
                .ToListAsync(ct);
        }

        return await ReadFarmsAsync(keys, sinceUtc, countedAtUtc, ct);
    }

    public async Task<ConfirmedFarmDaysRows> ReadFarmsAsync(
        IReadOnlyCollection<ConfirmedFarmKey> keys, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(keys);

        if (keys.Count > _maxFarmsForLiveCount)
        {
            return new ConfirmedFarmDaysRows(keys.Count, FarmsNotReadable: 0, [], [], [], LiveCountSkipped: true);
        }

        var farms = new List<ConfirmedFarmRow>();
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();
        var notReadable = 0;

        foreach (var key in keys)
        {
            if (key.OwnerAccountId == Guid.Empty)
            {
                notReadable++;
                continue;
            }

            var farm = await RlsIdentityScope.RunAsFarmAsync(
                _db, key.FarmId, key.OwnerAccountId, actorUserId: null,
                token => ReadFarmAsync(key.FarmId, sinceUtc, countedAtUtc, token),
                ct);

            if (farm is null)
            {
                notReadable++;
                continue;
            }

            farms.Add(farm.Farm);
            entries.AddRange(farm.Entries);
            checks.AddRange(farm.Checks);
        }

        return new ConfirmedFarmDaysRows(keys.Count, notReadable, farms, entries, checks, LiveCountSkipped: false);
    }

    /// <summary>Runs inside the farm's own scope. Null when the farm row does not come back.</summary>
    private async Task<FarmRows?> ReadFarmAsync(
        Guid farmGuid, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct)
    {
        var farmId = new FarmId(farmGuid);

        var farm = await _db.Farms
            .AsNoTracking()
            .Where(f => f.Id == farmId)
            .Select(f => new { OwnerUserId = (Guid)f.OwnerUserId })
            .FirstOrDefaultAsync(ct);

        if (farm is null)
        {
            return null;
        }

        var inWindow = _db.DailyLogs
            .AsNoTracking()
            .Where(l => l.FarmId == farmId && l.CreatedAtUtc >= sinceUtc && l.CreatedAtUtc < countedAtUtc);

        var entries = await inWindow
            .Select(l => new { l.Id, OperatorUserId = (Guid)l.OperatorUserId, l.CreatedAtUtc })
            .ToListAsync(ct);

        // Every event on those entries before the counting instant; the rule picks Confirmed / Verified itself.
        var checks = entries.Count == 0
            ? []
            : await _db.VerificationEvents
                .AsNoTracking()
                .Where(v => v.OccurredAtUtc < countedAtUtc)
                .Join(
                    inWindow,
                    v => v.DailyLogId,
                    l => l.Id,
                    (v, l) => new
                    {
                        v.DailyLogId,
                        v.Status,
                        v.Reason,
                        VerifiedByUserId = (Guid)v.VerifiedByUserId,
                        v.OccurredAtUtc,
                    })
                .ToListAsync(ct);

        return new FarmRows(
            new ConfirmedFarmRow(farmGuid, farm.OwnerUserId),
            entries.Select(e => new ConfirmedEntryRow(e.Id, farmGuid, e.OperatorUserId, e.CreatedAtUtc)).ToList(),
            checks.Select(c => new ConfirmedCheckRow(
                c.DailyLogId, c.Status, c.Reason, c.VerifiedByUserId, c.OccurredAtUtc)).ToList());
    }

    private sealed record FarmRows(
        ConfirmedFarmRow Farm,
        List<ConfirmedEntryRow> Entries,
        List<ConfirmedCheckRow> Checks);
}
