using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Organizations;
using System.Data.Common;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 3 as rewritten by C21; C1, C5, C13-C16). Reads the
/// one-farm page on request. Catches nothing: a failed read escapes and the route answers 500, never an empty or
/// zero page (C14).
/// <list type="number">
/// <item><b>Scope.</b> A caller who is not a platform admin is checked against
///   <c>mis.effective_org_farm_scope</c> first; outside it, <c>null</c> and nothing else is read or opened. (The
///   route admits platform owners only, C13.)</item>
/// <item><b>Identity (P1).</b> The farm's name, owner and owner account through the audited cross-farm factory,
///   opened ONCE (reason <c>AdminFarmerHealthRepository.one-farm</c>, one audit row naming the admin). A factory
///   that can see no farm at all throws (C5), so a connection held back by row-level security answers 500, never
///   404. A farm id that does not exist returns <c>null</c> (404). The owner's phone comes from
///   <c>public.users</c> through the analytics connection (C15).</item>
/// <item><b>The farm's own rows</b>, inside ONE <see cref="RlsIdentityScope.RunAsFarmAsync{T}"/> on the scoped
///   context, as the app login: checks on entries (P6), checks per India day (P4), the top five workers (P7) and
///   the reading jobs (P10, P11). If the farm row itself does not come back under its own scope, the read throws
///   rather than answering zeros.</item>
/// <item><b>Events</b> through the analytics connection: the four closure columns (P3), problems per India day by
///   <see cref="AdminErrorFarm.FarmSql"/> and <see cref="AdminErrorFarm.CountedProblemSql"/> (P5, C1, C16) and the
///   last activity (P8).</item>
/// </list>
/// <para>
/// <b>Window.</b> The 14 India days ending today (fixed +05:30, <see cref="GetCompanyMisHandler.IstDay"/>), from
/// 00:00 India time of the first day up to the counting instant, for every windowed figure on the page.
/// </para>
/// <para>
/// <b>Test accounts</b> (<c>CompanyMis:ExcludedUserIds</c>) are left out by the person who did the counted thing:
/// entries by their saver, checks by their checker, reading jobs by the person who started them, problems by
/// <see cref="AdminErrorFarm.PersonSql"/>. The closure columns (P3) and the last activity (P8) are unchanged.
/// </para>
/// <para>
/// The farm score is not computed here (P2, plan H-SCORE): <see cref="FarmerHealthDto.Score"/> is null.
/// </para>
/// </summary>
public sealed class AdminFarmerHealthRepository(
    AnalyticsDbContext analyticsContext,
    ShramSafalDbContext db,
    CompanyMisExclusions exclusions,
    TimeProvider clock,
    IAdminDbContextFactory<ShramSafalDbContext>? adminDbFactory = null) : IAdminFarmerHealthRepository
{
    /// <summary>Days on the page: today and the 13 India days before it.</summary>
    public const int WindowDays = 14;

    /// <summary>Workers listed (P7).</summary>
    public const int TopWorkers = 5;

    // Reasons that mark an event as NOT a person's deliberate check (C24). Constants only, never copied strings.
    private static readonly string?[] NotADeliberateCheckReasons =
    [
        DailyLog.SelfAttestationReason,
        DailyLog.BackfilledAttestationReason,
        DailyLog.EnRouteConfirmReason,
        DailyLog.SpeakerOwnMarkReason,
        DailyLog.NoConfirmAuthorityMarkReason,
    ];

    // Of those, the markers meaning "checked only by the person who saved it" (C24, P6).
    private static readonly string?[] SelfCheckReasons =
    [
        DailyLog.SelfAttestationReason,
        DailyLog.BackfilledAttestationReason,
        DailyLog.SpeakerOwnMarkReason,
    ];

    public async Task<FarmerHealthDto?> GetAsync(
        Guid farmId, AdminScope scope, Guid adminUserId, CancellationToken ct = default)
    {
        var countedAtUtc = DateTime.SpecifyKind(clock.GetUtcNow().UtcDateTime, DateTimeKind.Utc);
        var today = GetCompanyMisHandler.IstDay(countedAtUtc);
        var firstDay = today.AddDays(-(WindowDays - 1));
        var window = new Window(firstDay, today, GetCompanyMisHandler.IstDayStartUtc(firstDay), countedAtUtc);

        // 1. Scope: a non-platform caller outside the farm's scope gets nothing, and nothing is opened for them.
        if (!scope.IsPlatformAdmin && !await WithAnalyticsConnectionAsync(
                conn => IsFarmInScopeAsync(conn, scope.OrganizationId, farmId, ct), ct))
        {
            return null;
        }

        // 2. Identity, through the audited factory, once.
        var identity = await ReadIdentityAsync(farmId, adminUserId, ct);
        if (identity is null)
        {
            return null;
        }

        // 3. The farm's own rows, as the app login, through row-level security, in one scope.
        var readAiJobs = scope.CanRead(ModuleKey.OpsVoice);
        var farmRows = await RlsIdentityScope.RunAsFarmAsync(
            db, farmId, identity.OwnerAccountId, actorUserId: null,
            token => ReadFarmRowsAsync(farmId, window, readAiJobs, token),
            ct);

        // 4. Events and the owner's phone, through the analytics connection.
        var readSyncState = scope.CanRead(ModuleKey.OpsErrors);
        var events = await WithAnalyticsConnectionAsync(
            conn => ReadEventsAsync(conn, farmId, identity.OwnerUserId, window, readSyncState, ct), ct);

        var timeline = new List<FarmerHealthTimelineDto>(WindowDays);
        for (var d = window.FirstDay; d <= window.LastDay; d = d.AddDays(1))
        {
            events.Closures.TryGetValue(d, out var closures);
            timeline.Add(new FarmerHealthTimelineDto(
                Date: d,
                ClosuresStarted: closures.Started,
                ClosuresSubmitted: closures.Submitted,
                ProofAttached: closures.Proof,
                SummariesViewed: closures.SummariesViewed,
                Verifications: farmRows.ChecksByDay.GetValueOrDefault(d),
                Errors: events.ProblemsByDay.GetValueOrDefault(d)));
        }

        return new FarmerHealthDto(
            FarmId: farmId,
            FarmerName: events.OwnerName,
            Phone: events.OwnerPhone,
            Score: null,
            Timeline: timeline,
            SyncState: readSyncState ? new FarmerHealthSyncStateDto(events.LastActivityUtc) : null,
            AiHealth: farmRows.AiHealth,
            Verifications: farmRows.Verifications,
            WorkerSummary: farmRows.Workers,
            FarmName: identity.FarmName);
    }

    /// <summary>
    /// The existing scope check for a non-platform caller, kept. A failed read escapes (500) rather than reading as
    /// "not in scope", which the route would answer as 404, a farm that does not exist.
    /// </summary>
    private static async Task<bool> IsFarmInScopeAsync(
        DbConnection conn, Guid orgId, Guid farmId, CancellationToken ct)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT 1 FROM mis.effective_org_farm_scope
            WHERE org_id = @org AND farm_id = @farm
            LIMIT 1
            """;
        AddParam(cmd, "@org", orgId);
        AddParam(cmd, "@farm", farmId);
        var raw = await cmd.ExecuteScalarAsync(ct);
        return raw is not null and not DBNull;
    }

    private sealed record FarmIdentity(string FarmName, Guid OwnerUserId, Guid OwnerAccountId);

    /// <summary>
    /// The farm's name, owner and owner account through the audited cross-farm factory (one audit row). Null when
    /// the farm does not exist. Throws when the factory can see no farm at all (C5).
    /// </summary>
    private async Task<FarmIdentity?> ReadIdentityAsync(Guid farmId, Guid adminUserId, CancellationToken ct)
    {
        if (adminDbFactory is null)
        {
            throw new InvalidOperationException(
                $"{nameof(AdminFarmerHealthRepository)} was built without an admin DbContext factory, so it cannot "
                + "read the farm's name and owner. Resolve it from the container.");
        }

        await using var admin = await adminDbFactory.CreateAsync(
            reason: $"{nameof(AdminFarmerHealthRepository)}.one-farm",
            actorUserId: adminUserId,
            ct: ct);

        // Forced row-level security hides every row WITHOUT an error when the connection is not privileged.
        // "This context can see no farm at all" is therefore treated as that failure, not as "no such farm".
        if (!await admin.Farms.AsNoTracking().AnyAsync(ct))
        {
            throw new InvalidOperationException(
                "The admin context can see no farm at all. ssf.farms is under forced row-level security, "
                + "which returns zero rows without an error to a connection that is not privileged; "
                + "refusing to answer that this farm does not exist.");
        }

        var key = new FarmId(farmId);
        var farm = await admin.Farms
            .AsNoTracking()
            .Where(f => f.Id == key)
            .Select(f => new { f.Name, OwnerUserId = (Guid)f.OwnerUserId, OwnerAccountId = (Guid)f.OwnerAccountId })
            .FirstOrDefaultAsync(ct);

        if (farm is null)
        {
            return null;
        }

        if (farm.OwnerAccountId == Guid.Empty)
        {
            // Row-level security keys on the owner account; with none, every per-farm read would see nothing.
            throw new InvalidOperationException(
                $"Farm {farmId} has no owner account, so its rows cannot be read through row-level security; "
                + "refusing to answer zeros for its checks, workers and reading.");
        }

        return new FarmIdentity(farm.Name, farm.OwnerUserId, farm.OwnerAccountId);
    }

    private sealed record FarmRows(
        FarmerHealthVerificationCountsDto Verifications,
        Dictionary<DateOnly, int> ChecksByDay,
        IReadOnlyList<FarmerHealthWorkerSummaryDto> Workers,
        FarmerHealthAiHealthDto? AiHealth);

    /// <summary>Runs inside the farm's own row-level security scope, as the app login.</summary>
    private async Task<FarmRows> ReadFarmRowsAsync(Guid farmGuid, Window window, bool readAiJobs, CancellationToken ct)
    {
        var farmId = new FarmId(farmGuid);

        // The farm row must come back under its own scope; otherwise every count below would be a silent zero.
        if (!await db.Farms.AsNoTracking().AnyAsync(f => f.Id == farmId, ct))
        {
            throw new InvalidOperationException(
                $"Farm {farmGuid} did not come back under its own row-level security scope; "
                + "refusing to answer zeros for its checks, workers and reading.");
        }

        var excludedUsers = exclusions.UserIds.Select(id => new UserId(id)).ToList();
        var excludedGuids = exclusions.UserIds.ToList();

        // P6: each entry saved in the window, by its latest verification status.
        var entryIds = await db.DailyLogs
            .AsNoTracking()
            .Where(l => l.FarmId == farmId
                        && l.CreatedAtUtc >= window.StartUtc
                        && l.CreatedAtUtc < window.CountedAtUtc
                        && !excludedUsers.Contains(l.OperatorUserId))
            .Select(l => l.Id)
            .ToListAsync(ct);

        var entryEvents = entryIds.Count == 0
            ? []
            : await db.VerificationEvents
                .AsNoTracking()
                .Where(v => entryIds.Contains(v.DailyLogId) && v.OccurredAtUtc < window.CountedAtUtc)
                .Select(v => new { v.Id, v.DailyLogId, v.Status, v.OccurredAtUtc, v.Reason })
                .ToListAsync(ct);

        var latestStatus = entryEvents
            .GroupBy(v => v.DailyLogId)
            .ToDictionary(
                g => g.Key,
                g => g.OrderBy(v => v.OccurredAtUtc).ThenBy(v => v.Id).Last().Status);

        // An entry whose only Confirmed/Verified events carry the self-attestation reason was checked by its own
        // saver at creation: counted as selfChecked, never as confirmed or verified.
        var hasOtherCheck = entryEvents
            .Where(v => (v.Status == VerificationStatus.Confirmed || v.Status == VerificationStatus.Verified)
                        && !NotADeliberateCheckReasons.Contains(v.Reason))
            .Select(v => v.DailyLogId)
            .ToHashSet();

        // Entries with no deliberate check that carry a self marker on any event: checked only by the saver.
        var hasSelfMarker = entryEvents
            .Where(v => SelfCheckReasons.Contains(v.Reason))
            .Select(v => v.DailyLogId)
            .ToHashSet();

        int confirmed = 0, verified = 0, disputed = 0, waiting = 0, selfChecked = 0;
        foreach (var entryId in entryIds)
        {
            switch (latestStatus.TryGetValue(entryId, out var status) ? status : (VerificationStatus?)null)
            {
                case VerificationStatus.Confirmed or VerificationStatus.Verified
                    when !hasOtherCheck.Contains(entryId):
                    if (hasSelfMarker.Contains(entryId)) selfChecked++; else waiting++;
                    break;
                case VerificationStatus.Confirmed: confirmed++; break;
                case VerificationStatus.Verified: verified++; break;
                case VerificationStatus.Disputed: disputed++; break;
                case VerificationStatus.Draft:
                case VerificationStatus.CorrectionPending:
                case null:
                    waiting++;
                    break;
                default:
                    throw new InvalidOperationException(
                        $"Entry {entryId} has a verification status this page does not know: {status}.");
            }
        }

        // P4: distinct entries per India day with a Confirmed or Verified event whose reason is neither the
        // self-attestation nor the en-route marker (null reason counts).
        var checkEvents = await db.VerificationEvents
            .AsNoTracking()
            .Where(v => (v.Status == VerificationStatus.Confirmed || v.Status == VerificationStatus.Verified)
                        && v.OccurredAtUtc >= window.StartUtc
                        && v.OccurredAtUtc < window.CountedAtUtc
                        && !excludedUsers.Contains(v.VerifiedByUserId))
            .Join(
                db.DailyLogs.AsNoTracking().Where(l => l.FarmId == farmId),
                v => v.DailyLogId,
                l => l.Id,
                (v, l) => new { v.DailyLogId, v.OccurredAtUtc, v.Reason })
            .ToListAsync(ct);

        var checksByDay = checkEvents
            .Where(e => !NotADeliberateCheckReasons.Contains(e.Reason))
            .GroupBy(e => GetCompanyMisHandler.IstDay(DateTime.SpecifyKind(e.OccurredAtUtc, DateTimeKind.Utc)))
            .ToDictionary(g => g.Key, g => g.Select(e => e.DailyLogId).Distinct().Count());

        // P7: the five workers named most often on this farm.
        var workers = await db.Workers
            .AsNoTracking()
            .Where(w => w.FarmId == farmId)
            .OrderByDescending(w => w.AssignmentCount)
            .ThenByDescending(w => w.FirstSeenUtc)
            .Take(TopWorkers)
            .Select(w => new FarmerHealthWorkerSummaryDto(w.Id, w.Name.Raw, w.AssignmentCount, w.FirstSeenUtc))
            .ToListAsync(ct);

        var aiHealth = readAiJobs
            ? await ReadReadingAsync(farmGuid, farmId, window, excludedUsers, excludedGuids, ct)
            : null;

        return new FarmRows(
            new FarmerHealthVerificationCountsDto(confirmed, verified, disputed, waiting, selfChecked),
            checksByDay,
            workers,
            aiHealth);
    }

    /// <summary>
    /// P10, P11: this farm's reading jobs started in the window, by kind. Finished = the status rule of the company
    /// voice saved share; saved = an entry of this farm (not saved by a test account) was saved from the job, as the
    /// company voice saved share counts it. Receipt and patti jobs carry no such link (see
    /// <see cref="FarmerHealthReadingDto.SavedNotRecorded"/>), so their saved share is not measured.
    /// </summary>
    private async Task<FarmerHealthAiHealthDto> ReadReadingAsync(
        Guid farmGuid, FarmId farmId, Window window, List<UserId> excludedUsers, List<Guid> excludedGuids,
        CancellationToken ct)
    {
        var jobs = await db.AiJobs
            .AsNoTracking()
            .Where(j => j.FarmId == farmGuid
                        && (j.OperationType == AiOperationType.VoiceToStructuredLog
                            || j.OperationType == AiOperationType.ReceiptToExpenseItems
                            || j.OperationType == AiOperationType.PattiImageToSaleData)
                        && j.CreatedAtUtc >= window.StartUtc
                        && j.CreatedAtUtc < window.CountedAtUtc
                        && !excludedGuids.Contains(j.UserId))
            .Select(j => new { j.Id, j.OperationType, j.Status })
            .ToListAsync(ct);

        var finished = jobs
            .Where(j => CompanyMisCalculator.IsFinishedJobStatus(j.Status.ToString()))
            .ToList();

        var finishedVoiceIds = finished
            .Where(j => j.OperationType == AiOperationType.VoiceToStructuredLog)
            .Select(j => (Guid?)j.Id)
            .ToList();

        var savedVoice = finishedVoiceIds.Count == 0
            ? 0
            : await db.DailyLogs
                .AsNoTracking()
                .Where(l => l.FarmId == farmId
                            && finishedVoiceIds.Contains(l.SourceAiJobId)
                            && l.CreatedAtUtc < window.CountedAtUtc
                            && !excludedUsers.Contains(l.OperatorUserId))
                .Select(l => l.SourceAiJobId)
                .Distinct()
                .CountAsync(ct);

        var voice = CompanyMisCalculator.Pct(savedVoice, finishedVoiceIds.Count);

        FarmerHealthReadingDto NotRecorded(AiOperationType kind) => new(
            FinishedJobs14d: finished.Count(j => j.OperationType == kind),
            SavedJobs14d: null,
            SavedPct14d: null,
            NotMeasuredReason: FarmerHealthReadingDto.SavedNotRecorded);

        return new FarmerHealthAiHealthDto(
            Voice: new FarmerHealthReadingDto(finishedVoiceIds.Count, savedVoice, voice.Value, voice.NotMeasuredReason),
            Receipt: NotRecorded(AiOperationType.ReceiptToExpenseItems),
            Patti: NotRecorded(AiOperationType.PattiImageToSaleData));
    }

    private record struct ClosureDay(int Started, int Submitted, int Proof, int SummariesViewed);

    private sealed record EventRows(
        string? OwnerPhone,
        string? OwnerName,
        Dictionary<DateOnly, ClosureDay> Closures,
        Dictionary<DateOnly, int> ProblemsByDay,
        DateTime? LastActivityUtc);

    private async Task<EventRows> ReadEventsAsync(
        DbConnection conn, Guid farmId, Guid ownerUserId, Window window, bool readLastActivity, CancellationToken ct)
    {
        // The owner's phone (C15) and display name (C23). public.users: key column "Id" (EF default, quoted); the
        // phone is "phone".
        string? phone = null;
        string? ownerName = null;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT u.phone, u.display_name
                FROM public.users u
                WHERE u."Id" = @owner
                """;
            AddParam(cmd, "@owner", ownerUserId);
            using var ur = await cmd.ExecuteReaderAsync(ct);
            if (await ur.ReadAsync(ct))
            {
                phone = ReadText(ur, 0, "phone");
                ownerName = ReadText(ur, 1, "display_name");
            }
        }

        // P3: the four closure columns, by India day. occurred_at_utc is timestamptz: AT TIME ZONE 'UTC' gives the
        // UTC wall clock, plus the fixed India offset gives the India day, whatever the session's time zone.
        var closures = new Dictionary<DateOnly, ClosureDay>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT ((occurred_at_utc AT TIME ZONE 'UTC') + @ist)::date AS day, event_type, COUNT(*)
                FROM analytics.events
                WHERE farm_id = @farm
                  AND event_type IN ('closure.started', 'closure.submitted', 'proof.attached', 'closure_summary.viewed')
                  AND occurred_at_utc >= @start
                  AND occurred_at_utc < @counted
                GROUP BY 1, 2
                """;
            AddWindowParams(cmd, farmId, window);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var day = DateOnly.FromDateTime(r.GetDateTime(0));
                var n = checked((int)r.GetInt64(2));
                closures.TryGetValue(day, out var c);
                closures[day] = r.GetString(1) switch
                {
                    "closure.started" => c with { Started = c.Started + n },
                    "closure.submitted" => c with { Submitted = c.Submitted + n },
                    "proof.attached" => c with { Proof = c.Proof + n },
                    "closure_summary.viewed" => c with { SummariesViewed = c.SummariesViewed + n },
                    var other => throw new InvalidOperationException($"Unexpected event type {other}."),
                };
            }
        }

        // P5: problems tied to this farm by the shared rule (C1, C16), by India day.
        var problems = new Dictionary<DateOnly, int>();
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = $"""
                SELECT ((occurred_at_utc AT TIME ZONE 'UTC') + @ist)::date AS day, COUNT(*)
                FROM analytics.events
                WHERE {AdminErrorFarm.FarmSql} = @farm
                  AND {AdminErrorFarm.CountedProblemSql}
                  AND occurred_at_utc >= @start
                  AND occurred_at_utc < @counted
                GROUP BY 1
                """;
            AddWindowParams(cmd, farmId, window);
            AdminErrorFarm.AddExcludedUserIds(cmd, exclusions);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                problems[DateOnly.FromDateTime(r.GetDateTime(0))] = checked((int)r.GetInt64(1));
            }
        }

        // P8: the last activity, unchanged.
        DateTime? lastActivity = null;
        if (readLastActivity)
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT MAX(occurred_at_utc) FROM analytics.events
                WHERE farm_id = @farm AND event_type IN ('sync.completed', 'log.created')
                """;
            AddParam(cmd, "@farm", farmId);
            var raw = await cmd.ExecuteScalarAsync(ct);
            lastActivity = raw switch
            {
                null or DBNull => null,
                DateTime dt => DateTime.SpecifyKind(dt, DateTimeKind.Utc),
                _ => throw new InvalidOperationException(
                    $"The last activity came back as {raw.GetType().Name}, not a time."),
            };
        }

        return new EventRows(phone, ownerName, closures, problems, lastActivity);
    }

    private static string? ReadText(DbDataReader r, int i, string column)
    {
        if (r.IsDBNull(i)) return null;
        var raw = r.GetValue(i);
        return raw switch
        {
            string s when !string.IsNullOrWhiteSpace(s) => s,
            string => null,
            _ => throw new InvalidOperationException(
                $"public.users.{column} came back as {raw.GetType().Name}, not text."),
        };
    }

    private sealed record Window(DateOnly FirstDay, DateOnly LastDay, DateTime StartUtc, DateTime CountedAtUtc);

    private async Task<T> WithAnalyticsConnectionAsync<T>(Func<DbConnection, Task<T>> work, CancellationToken ct)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            return await work(conn);
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }
    }

    private static void AddWindowParams(DbCommand cmd, Guid farmId, Window window)
    {
        AddParam(cmd, "@farm", farmId);
        AddParam(cmd, "@ist", GetCompanyMisHandler.IstOffset);
        AddParam(cmd, "@start", window.StartUtc);
        AddParam(cmd, "@counted", window.CountedAtUtc);
    }

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
