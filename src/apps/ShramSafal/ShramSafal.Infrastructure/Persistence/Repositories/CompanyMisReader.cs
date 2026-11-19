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
/// <item>Plan CR-2c, only for <see cref="ReadForCompanyMisAsync"/> (amendment E3):
/// the Company MIS additions, inside the same per-farm scope for farm rows, and
/// the non-farm reads (<c>app.seen</c>) through the analytics connection.</item>
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

    public Task<CompanyMisRows> ReadAsync(
        Guid adminUserId,
        DateTime sinceUtc,
        DateTime countedAtUtc,
        IReadOnlySet<Guid> excludedUserIds,
        CancellationToken ct = default) =>
        ReadCoreAsync(adminUserId, sinceUtc, additionsSinceUtc: null, countedAtUtc, excludedUserIds, ct);

    public Task<CompanyMisRows> ReadForCompanyMisAsync(
        Guid adminUserId,
        DateTime sinceUtc,
        DateTime additionsSinceUtc,
        DateTime countedAtUtc,
        IReadOnlySet<Guid> excludedUserIds,
        CancellationToken ct = default)
    {
        if (additionsSinceUtc < sinceUtc || additionsSinceUtc > countedAtUtc)
        {
            throw new ArgumentOutOfRangeException(
                nameof(additionsSinceUtc), "The additions start must lie between sinceUtc and countedAtUtc.");
        }

        return ReadCoreAsync(adminUserId, sinceUtc, additionsSinceUtc, countedAtUtc, excludedUserIds, ct);
    }

    /// <summary>
    /// The one pass. <paramref name="additionsSinceUtc"/> null: exactly the CR-2a read. Otherwise the Company MIS
    /// additions are read too (plan CR-2c), from that instant up to the counting instant.
    /// </summary>
    private async Task<CompanyMisRows> ReadCoreAsync(
        Guid adminUserId,
        DateTime sinceUtc,
        DateTime? additionsSinceUtc,
        DateTime countedAtUtc,
        IReadOnlySet<Guid> excludedUserIds,
        CancellationToken ct)
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
        var understandingDays = new List<MisUnderstandingDayRow>();
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
                    token => ReadFarmAsync(key.FarmId, sinceUtc, additionsSinceUtc, countedAtUtc, excluded, token),
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

                if (farm.Additions is { } additions)
                {
                    understandingDays.AddRange(additions.UnderstandingDays);
                }
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

        // Step 5 (CR-2c, Company MIS only): the non-farm additions, through the analytics connection. They run
        // whatever the farm list said: they are not farm rows.
        IReadOnlyList<MisAppSeenRow> appSeen = [];
        if (additionsSinceUtc is { } additionsSince)
        {
            appSeen = await ReadAppSeenAsync(additionsSince, countedAtUtc, ct);
        }

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
            LiveCountSkipped: liveCountSkipped)
        {
            AppSeen = appSeen,
            UnderstandingDays = understandingDays,
        };
    }

    /// <summary>
    /// Runs inside the farm's own scope. Null when the farm row does not come back. With
    /// <paramref name="additionsSinceUtc"/> (Company MIS only) the CR-2c farm rows are read too, in the same scope.
    /// </summary>
    private async Task<FarmRows?> ReadFarmAsync(
        Guid farmGuid,
        DateTime sinceUtc,
        DateTime? additionsSinceUtc,
        DateTime countedAtUtc,
        List<UserId> excluded,
        CancellationToken ct)
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

        FarmAdditions? additions = null;
        if (additionsSinceUtc is { } additionsSince)
        {
            additions = new FarmAdditions(
                await ReadUnderstandingDaysAsync(farmGuid, additionsSince, countedAtUtc, ct));
        }

        return new FarmRows(
            new MisFarmRow(farmGuid, farm.OwnerUserId, farm.CreatedAtUtc, lastEntryUtc, firstEntryUtc),
            entries.Select(e => new MisEntryRow(
                farmGuid, e.OperatorUserId, e.CreatedAtUtc, e.IsVoice, e.ContentVersion, e.SourceAiJobId)).ToList(),
            memberships.Select(m => new MisMembershipRow(farmGuid, m.UserId, m.Role.ToString(), (int)m.Status)).ToList(),
            plots.Select(a => new MisPlotRow(farmGuid, a)).ToList(),
            jobs.Select(j => new MisVoiceJobRow(
                j.Id, farmGuid, j.UserId, j.CreatedAtUtc, j.Status.ToString(),
                latenciesByJob.TryGetValue(j.Id, out var ms) ? ms : [])).ToList(),
            additions);
    }

    /// <summary>
    /// CR-2c #10, #49 (one query per farm, inside the farm's scope: <c>daily_richness_aggregates</c> is farm_id
    /// row-level-security gated). The farm's stored days from the India day of <paramref name="sinceUtc"/> to the
    /// counting day. Each row's score is worked out here by the calculator's one rule
    /// (<see cref="CompanyMisCalculator.UnderstandingScoreOf"/>) so the breakdown is not held in memory.
    /// </summary>
    private async Task<List<MisUnderstandingDayRow>> ReadUnderstandingDaysAsync(
        Guid farmGuid, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct)
    {
        var firstDay = CompanyMisCalculator.IstDay(sinceUtc);
        var lastDay = CompanyMisCalculator.IstDay(countedAtUtc);

        var days = await _db.DailyRichnessAggregates
            .AsNoTracking()
            .Where(a => a.FarmId == farmGuid && a.LocalDate >= firstDay && a.LocalDate <= lastDay)
            .Select(a => new { a.LocalDate, a.DayClassification, a.ComponentsJson })
            .ToListAsync(ct);

        return days
            .Select(d => new MisUnderstandingDayRow(
                farmGuid, d.LocalDate, d.DayClassification.ToString(), CompanyMisCalculator.UnderstandingScoreOf(d.ComponentsJson)))
            .ToList();
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

    /// <summary>
    /// CR-2c #52. The <c>app.seen</c> rows the SERVER wrote (no actor, role <c>system</c>: the same filter as the
    /// app-versions page, <c>AdminOpsRepository.GetAppSeenAsync</c>, amendment E9), with the platform the server
    /// stamped. A row whose person is not an id, or that names no version, cannot be counted on any version and is
    /// skipped, as on that page. Every person is read; test accounts are left out by the calculator.
    /// </summary>
    private async Task<IReadOnlyList<MisAppSeenRow>> ReadAppSeenAsync(
        DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct)
    {
        var rows = new List<MisAppSeenRow>();
        var conn = _analytics.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    props->>'personId'   AS person_id,
                    props->>'appVersion' AS app_version,
                    props->>'platform'   AS platform,
                    occurred_at_utc
                FROM analytics.events
                WHERE event_type = 'app.seen'
                  AND actor_user_id IS NULL
                  AND actor_role = 'system'
                  AND occurred_at_utc >= @since
                  AND occurred_at_utc < @counted
                """;
            AddParam(cmd, "@since", DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc));
            AddParam(cmd, "@counted", DateTime.SpecifyKind(countedAtUtc, DateTimeKind.Utc));

            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                if (r.IsDBNull(0) || !Guid.TryParse(r.GetString(0), out var personId)) continue;
                if (r.IsDBNull(1) || string.IsNullOrWhiteSpace(r.GetString(1))) continue;

                rows.Add(new MisAppSeenRow(
                    personId,
                    r.GetString(1),
                    DateTime.SpecifyKind(r.GetDateTime(3), DateTimeKind.Utc),
                    r.IsDBNull(2) ? null : r.GetString(2)));
            }

            return rows;
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
        List<MisVoiceJobRow> VoiceJobs,
        FarmAdditions? Additions);

    /// <summary>CR-2c: one farm's Company MIS rows; null in <see cref="FarmRows"/> when ReadAsync asked.</summary>
    private sealed record FarmAdditions(
        List<MisUnderstandingDayRow> UnderstandingDays);
}
