using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 3). Reads the raw
/// rows the company MIS counts from. Counts nothing; catches nothing (a failed
/// read escapes and the route answers 500, never an empty answer).
/// <list type="number">
/// <item>Farm keys (id, owner account) are listed ONCE through the audited
/// cross-farm factory; nothing else is read through that context.</item>
/// <item>Every counted farm row is read as the app role on the SCOPED context,
/// one farm per transaction, inside <see cref="RlsIdentityScope.RunAsFarmAsync{T}"/>,
/// so row-level security decides what is seen. A key whose owner account is
/// empty, or whose farm row does not come back, is counted as not readable.</item>
/// <item>Above the live-count ceiling (amendment A1) no per-farm row is read.</item>
/// <item>FPO scopes (no row-level security) on the scoped context.</item>
/// <item>OTP-verified people through the analytics connection.</item>
/// </list>
/// Every query is bounded strictly before the counting instant.
/// </summary>
public sealed class CompanyMisReader : ICompanyMisReader
{
    private readonly ShramSafalDbContext _db;
    private readonly AnalyticsDbContext _analytics;
    private readonly IAdminDbContextFactory<ShramSafalDbContext> _adminDbFactory;
    private readonly int _maxFarmsForLiveCount;

    public CompanyMisReader(
        ShramSafalDbContext db,
        AnalyticsDbContext analytics,
        IAdminDbContextFactory<ShramSafalDbContext> adminDbFactory)
        : this(db, analytics, adminDbFactory, GetCompanyMisHandler.MaxFarmsForLiveCount)
    {
    }

    /// <summary>Tests only: a small live-count ceiling (amendment A1), never configuration.</summary>
    internal CompanyMisReader(
        ShramSafalDbContext db,
        AnalyticsDbContext analytics,
        IAdminDbContextFactory<ShramSafalDbContext> adminDbFactory,
        int maxFarmsForLiveCount)
    {
        _db = db;
        _analytics = analytics;
        _adminDbFactory = adminDbFactory;
        _maxFarmsForLiveCount = maxFarmsForLiveCount;
    }

    public async Task<CompanyMisRows> ReadAsync(
        Guid adminUserId,
        DateTime sinceUtc,
        DateTime countedAtUtc,
        IReadOnlySet<Guid> excludedUserIds,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(excludedUserIds);

        // Step 1: farm keys, through the audited cross-farm factory (one audit row naming the admin).
        List<FarmKey> keys;
        await using (var admin = await _adminDbFactory.CreateAsync("CompanyMisReader.farm-keys", adminUserId, ct))
        {
            keys = await admin.Farms
                .AsNoTracking()
                .Select(f => new FarmKey((Guid)f.Id, (Guid)f.OwnerAccountId))
                .ToListAsync(ct);
        }

        var farms = new List<MisFarmRow>();
        var entries = new List<MisEntryRow>();
        var memberships = new List<MisMembershipRow>();
        var plots = new List<MisPlotRow>();
        var voiceJobs = new List<MisVoiceJobRow>();
        var notReadable = 0;
        var liveCountSkipped = keys.Count > _maxFarmsForLiveCount;

        if (!liveCountSkipped)
        {
            // Excluded accounts are left out of the first/last entry aggregates only (A5).
            var excluded = excludedUserIds.Select(id => new UserId(id)).ToList();

            // Step 2: per farm, as the app role, under row-level security.
            foreach (var key in keys)
            {
                if (key.OwnerAccountId == Guid.Empty)
                {
                    notReadable++;
                    continue;
                }

                var farm = await RlsIdentityScope.RunAsFarmAsync(
                    _db, key.FarmId, key.OwnerAccountId, actorUserId: null,
                    token => ReadFarmAsync(key.FarmId, sinceUtc, countedAtUtc, excluded, token),
                    ct);

                if (farm is null)
                {
                    notReadable++;
                    continue;
                }

                farms.Add(farm.Farm);
                entries.AddRange(farm.Entries);
                memberships.AddRange(farm.Memberships);
                plots.AddRange(farm.Plots);
                voiceJobs.AddRange(farm.VoiceJobs);
            }
        }

        // Step 3: FPO scopes, outside any farm scope (these tables carry no row-level security).
        var fpoScopes = await _db.OrganizationFarmScopes
            .AsNoTracking()
            .Where(s => s.IsActive && s.GrantedAtUtc < countedAtUtc)
            .Join(
                _db.Organizations.AsNoTracking().Where(o => o.Type == OrganizationType.FPO && o.IsActive),
                s => s.OrganizationId,
                o => o.Id,
                (s, o) => new { FarmId = (Guid)s.FarmId, o.Name, s.GrantedAtUtc })
            .ToListAsync(ct);

        // Step 4: OTP-verified people, through the analytics connection.
        var verifiedUsers = await ReadVerifiedUsersAsync(sinceUtc, countedAtUtc, ct);

        return new CompanyMisRows(
            FarmsListed: keys.Count,
            FarmsNotReadable: notReadable,
            Farms: farms,
            Entries: entries,
            Memberships: memberships,
            Plots: plots,
            VoiceJobs: voiceJobs,
            VerifiedUsers: verifiedUsers,
            FpoScopes: fpoScopes.Select(s => new MisFpoScopeRow(s.FarmId, s.Name, s.GrantedAtUtc)).ToList(),
            LiveCountSkipped: liveCountSkipped);
    }

    /// <summary>Runs inside the farm's own scope. Null when the farm row does not come back.</summary>
    private async Task<FarmRows?> ReadFarmAsync(
        Guid farmGuid, DateTime sinceUtc, DateTime countedAtUtc, List<UserId> excluded, CancellationToken ct)
    {
        var farmId = new FarmId(farmGuid);

        var farm = await _db.Farms
            .AsNoTracking()
            .Where(f => f.Id == farmId)
            .Select(f => new { OwnerUserId = (Guid)f.OwnerUserId, f.CreatedAtUtc })
            .FirstOrDefaultAsync(ct);

        if (farm is null)
        {
            return null;
        }

        var counted = _db.DailyLogs
            .AsNoTracking()
            .Where(l => l.FarmId == farmId && l.CreatedAtUtc < countedAtUtc && !excluded.Contains(l.OperatorUserId));
        var firstEntryUtc = await counted.MinAsync(l => (DateTime?)l.CreatedAtUtc, ct);
        var lastEntryUtc = await counted.MaxAsync(l => (DateTime?)l.CreatedAtUtc, ct);

        var entries = await _db.DailyLogs
            .AsNoTracking()
            .Where(l => l.FarmId == farmId && l.CreatedAtUtc >= sinceUtc && l.CreatedAtUtc < countedAtUtc)
            .Select(l => new
            {
                OperatorUserId = (Guid)l.OperatorUserId,
                l.CreatedAtUtc,
                IsVoice = l.Provenance.Source == Source.Voice,
                l.ContentVersion,
                l.SourceAiJobId,
            })
            .ToListAsync(ct);

        var memberships = await _db.FarmMemberships
            .AsNoTracking()
            .Where(m => m.FarmId == farmId)
            .Select(m => new { UserId = (Guid)m.UserId, m.Role, m.Status })
            .ToListAsync(ct);

        var plots = await _db.Plots
            .AsNoTracking()
            .Where(p => p.FarmId == farmId)
            .Select(p => p.AreaInAcres)
            .ToListAsync(ct);

        var jobs = await _db.AiJobs
            .AsNoTracking()
            .Where(j => j.FarmId == farmGuid
                        && j.OperationType == AiOperationType.VoiceToStructuredLog
                        && j.CreatedAtUtc >= sinceUtc
                        && j.CreatedAtUtc < countedAtUtc)
            .Select(j => new { j.Id, j.UserId, j.CreatedAtUtc, j.Status })
            .ToListAsync(ct);

        var jobIds = jobs.Select(j => j.Id).ToList();
        var latencies = jobIds.Count == 0
            ? []
            : await _db.AiJobAttempts
                .AsNoTracking()
                .Where(a => jobIds.Contains(a.AiJobId) && a.IsSuccess && a.AttemptedAtUtc < countedAtUtc)
                .Select(a => new { a.AiJobId, a.LatencyMs })
                .ToListAsync(ct);
        var latenciesByJob = latencies
            .GroupBy(a => a.AiJobId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<int>)g.Select(a => a.LatencyMs).ToList());

        return new FarmRows(
            new MisFarmRow(farmGuid, farm.OwnerUserId, farm.CreatedAtUtc, lastEntryUtc, firstEntryUtc),
            entries.Select(e => new MisEntryRow(
                farmGuid, e.OperatorUserId, e.CreatedAtUtc, e.IsVoice, e.ContentVersion, e.SourceAiJobId)).ToList(),
            memberships.Select(m => new MisMembershipRow(farmGuid, m.UserId, m.Role.ToString(), (int)m.Status)).ToList(),
            plots.Select(a => new MisPlotRow(farmGuid, a)).ToList(),
            jobs.Select(j => new MisVoiceJobRow(
                j.Id, farmGuid, j.UserId, j.CreatedAtUtc, j.Status.ToString(),
                latenciesByJob.TryGetValue(j.Id, out var ms) ? ms : [])).ToList());
    }

    private async Task<IReadOnlyList<MisUserRow>> ReadVerifiedUsersAsync(
        DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct)
    {
        var users = new List<MisUserRow>();
        var conn = _analytics.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            // public.users: key column "Id" (EF default, quoted). No phone number is read.
            cmd.CommandText = """
                SELECT u."Id", u.phone_verified_at_utc
                FROM public.users u
                WHERE u.phone_verified_at_utc >= @since
                  AND u.phone_verified_at_utc < @counted
                """;
            AddParam(cmd, "@since", DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc));
            AddParam(cmd, "@counted", DateTime.SpecifyKind(countedAtUtc, DateTimeKind.Utc));

            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                users.Add(new MisUserRow(r.GetGuid(0), DateTime.SpecifyKind(r.GetDateTime(1), DateTimeKind.Utc)));
            }

            return users;
        }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }

    private sealed record FarmKey(Guid FarmId, Guid OwnerAccountId);

    private sealed record FarmRows(
        MisFarmRow Farm,
        List<MisEntryRow> Entries,
        List<MisMembershipRow> Memberships,
        List<MisPlotRow> Plots,
        List<MisVoiceJobRow> VoiceJobs);
}
