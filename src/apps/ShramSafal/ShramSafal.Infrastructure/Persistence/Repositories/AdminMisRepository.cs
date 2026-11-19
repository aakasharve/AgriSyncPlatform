using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetWvfdHistory;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Reads the admin farms and users lists, the suffering list and the farm contacts. All queries are read-only.
///
/// <para>
/// The silent-churn read (no longer on any read path, plan CR-2e, Task 4) keeps its older graceful empty-return.
/// Nothing else here does (spec company-mis-real-numbers-2026-11-15): a failed read escapes and answers 500.
/// Confirmed farm-days are no longer read from the nightly view <c>mis.wvfd_weekly</c> (plan CR-2e, Task 6, C32):
/// the route counts them live (<c>GetWvfdHistoryHandler</c>), and All Farms counts them here through
/// <paramref name="confirmedFarmDays"/> and <see cref="ConfirmedFarmDays"/>.
/// </para>
///
/// <para>
/// <paramref name="adminDbFactory"/> is needed only by the farms list and the
/// farm contacts, the cross-farm reads here. It is optional so code that builds
/// this repository by hand for the analytics queries keeps working; the
/// container always supplies it (<c>AddShramSafalInfrastructure</c> registers
/// the factory).
/// </para>
///
/// <para>
/// <paramref name="exclusions"/> (plan CR-2e, C16) is the test-account list
/// (<c>CompanyMis:ExcludedUserIds</c>) the problem counts and the confirmed farm-days leave out. It is
/// required, so a repository built by hand cannot count test accounts by
/// forgetting it: pass <see cref="CompanyMisExclusions.None"/> to leave
/// nothing out.
/// </para>
///
/// <para>
/// <paramref name="clock"/> fixes the counting instant of All Farms' checked days (the last complete India week);
/// the system clock when not given.
/// </para>
/// </summary>
public sealed class AdminMisRepository(
    AnalyticsDbContext analyticsContext,
    CompanyMisExclusions exclusions,
    IConfirmedFarmDaysReader confirmedFarmDays,
    IAdminDbContextFactory<ShramSafalDbContext>? adminDbFactory = null,
    TimeProvider? clock = null) : IAdminMisRepository
{
    // ── Phase 4: Farms ──────────────────────────────────────────────────────
    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 4; plan CR-2e, Task 6 as replaced by C32).
    // ssf.farms and ssf.daily_logs are under FORCED row-level security, so the farm rows are read through the
    // audited cross-farm factory, opened ONCE per page load (one admin_cross_tenant audit row naming the admin).
    // Checked days, self-only days and the tier come from ConfirmedFarmDays over each farm's own rows, read as the
    // app login under row-level security with the keys of that same open (never a second open). Phones and the
    // error count come from the analytics connection (no row-level security on those). Nothing is caught: a failed
    // read answers 500, never an empty list. A farm whose rows cannot be read (no owner account, or its row did not
    // come back under its own scope) is sent with its three counts null and ConfirmedDaysNotMeasuredReason
    // "farm_unreadable", never "No entry last week"; the rest of the page answers normally (C33). Plan is always
    // null (no made-up "trial").
    public async Task<FarmsListDto> GetFarmsListAsync(
        Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default)
    {
        if (adminDbFactory is null)
        {
            throw new InvalidOperationException(
                $"{nameof(AdminMisRepository)} was built without an admin DbContext factory, so it cannot "
                + "read farms across farms. Resolve it from the container.");
        }

        var hasSearch = !string.IsNullOrWhiteSpace(search);
        var hasTier = !string.IsNullOrWhiteSpace(tier);

        var countedAtUtc = DateTime.SpecifyKind((clock ?? TimeProvider.System).GetUtcNow().UtcDateTime, DateTimeKind.Utc);
        var sinceUtc = GetCompanyMisHandler.IstDayStartUtc(ConfirmedFarmDays.LastCompleteWeekStart(countedAtUtc));

        await using var ssf = await adminDbFactory.CreateAsync(
            reason: $"{nameof(AdminMisRepository)}.farms-list",
            actorUserId: adminUserId,
            ct: ct);

        // The tier filter (C32, C33): the tier of EVERY farm, counted from keys read through this same open, BEFORE
        // paging. Above the live-count ceiling, or when any farm could not be read, it is refused (409), never
        // applied to part of the farms.
        IReadOnlyDictionary<Guid, ConfirmedFarmDays.FarmWeek?>? lastWeekOfEveryFarm = null;
        List<FarmId>? tierFarmIds = null;
        if (hasTier)
        {
            var keys = await ssf.Farms
                .AsNoTracking()
                .Select(f => new ConfirmedFarmKey((Guid)f.Id, (Guid)f.OwnerAccountId))
                .ToListAsync(ct);

            if (keys.Count == 0)
            {
                throw new InvalidOperationException(
                    "The admin context can see no farm at all. ssf.farms is under forced row-level security, "
                    + "which returns zero rows without an error to a connection that is not privileged; "
                    + "refusing to answer that no farm is in this tier.");
            }

            var rows = await confirmedFarmDays.ReadFarmsAsync(keys, sinceUtc, countedAtUtc, ct);
            if (rows.LiveCountSkipped)
            {
                return new FarmsListDto([], 0, page, pageSize)
                {
                    RefusalCode = GetFarmsListHandler.TierFilterTooManyFarmsCode,
                };
            }

            // A farm that could not be read would be silently left out of every tier.
            if (rows.FarmsNotReadable > 0)
            {
                return new FarmsListDto([], 0, page, pageSize)
                {
                    RefusalCode = GetFarmsListHandler.TierFilterNotMeasuredCode,
                };
            }

            lastWeekOfEveryFarm = ConfirmedFarmDays.LastCompleteWeek(rows, exclusions.UserIds, countedAtUtc);
            var wanted = tier!.Trim();
            tierFarmIds = lastWeekOfEveryFarm.Values
                .Where(w => w is not null && string.Equals(w.EngagementTier, wanted, StringComparison.Ordinal))
                .Select(w => new FarmId(w!.FarmId))
                .ToList();
        }

        // Forced row-level security hides every row WITHOUT an error when the connection is not privileged.
        // With no filter, "this context sees no farm at all" is treated as that failure, not as "no farms".
        if (!hasSearch && !hasTier && !await ssf.Farms.AsNoTracking().AnyAsync(ct))
        {
            throw new InvalidOperationException(
                "The admin context can see no farm at all. ssf.farms is under forced row-level security, "
                + "which returns zero rows without an error to a connection that is not privileged; "
                + "refusing to answer that there are no farms.");
        }

        var query = ssf.Farms.AsNoTracking();
        if (hasSearch)
        {
            // % and _ in the search text match literally (escaped with a backslash).
            var pattern = "%" + EscapeLike(search!.Trim()) + "%";
            query = query.Where(f => EF.Functions.ILike(f.Name, pattern, LikeEscape));
        }

        if (tierFarmIds is not null)
        {
            query = query.Where(f => tierFarmIds.Contains(f.Id));
        }

        var total = await query.CountAsync(ct);

        var farms = await query
            .OrderByDescending(f => f.CreatedAtUtc)
            .ThenBy(f => f.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(f => new
            {
                FarmId = (Guid)f.Id,
                f.Name,
                OwnerUserId = (Guid)f.OwnerUserId,
                OwnerAccountId = (Guid)f.OwnerAccountId,
                f.CreatedAtUtc,
                LastLogAt = ssf.DailyLogs.Where(l => l.FarmId == f.Id).Max(l => (DateTime?)l.CreatedAtUtc),
            })
            .ToListAsync(ct);

        if (farms.Count == 0)
        {
            return new FarmsListDto([], total, page, pageSize);
        }

        // With the tier filter every farm was already counted; otherwise only the farms on this page are read, with
        // the keys this same open returned.
        var lastWeek = lastWeekOfEveryFarm ?? await ReadLastCompleteWeekAsync(
            farms.Select(f => new ConfirmedFarmKey(f.FarmId, f.OwnerAccountId)).ToList(), sinceUtc, countedAtUtc, ct);

        var farmIds = farms.Select(f => f.FarmId).ToArray();
        var phones = await ReadPhonesAsync(farms.Select(f => f.OwnerUserId).Distinct().ToArray(), ct);
        var errors = await ReadErrors24hAsync(farmIds, ct);

        // A farm present in lastWeek was read (null = no counted entry last week); an absent farm was not read.
        var items = farms
            .Select(f =>
            {
                var read = lastWeek.TryGetValue(f.FarmId, out var week);
                return new FarmSummaryDto(
                    FarmId: f.FarmId,
                    Name: f.Name,
                    OwnerPhone: phones.TryGetValue(f.OwnerUserId, out var phone) && !string.IsNullOrEmpty(phone) ? phone : "—",
                    Plan: null,
                    Wvfd7d: week?.Wvfd,
                    SelfOnlyDays7d: week?.SelfOnlyDays,
                    EngagementTier: week?.EngagementTier,
                    ConfirmedDaysNotMeasuredReason: read ? null : GetFarmsListHandler.FarmUnreadable,
                    Errors24h: errors.GetValueOrDefault(f.FarmId),
                    LastLogAt: f.LastLogAt,
                    CreatedAt: f.CreatedAtUtc);
            })
            .ToList();

        return new FarmsListDto(items, total, page, pageSize);
    }

    /// <summary>
    /// The page's farms, read as the app login one by one (C32); never more than one page. Farms that could not be
    /// read are absent from the answer (C33).
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, ConfirmedFarmDays.FarmWeek?>> ReadLastCompleteWeekAsync(
        IReadOnlyCollection<ConfirmedFarmKey> keys, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct)
    {
        var rows = await confirmedFarmDays.ReadFarmsAsync(keys, sinceUtc, countedAtUtc, ct);
        if (rows.LiveCountSkipped)
        {
            throw new InvalidOperationException(
                $"The page asks for {keys.Count} farms, more than the live-count ceiling; refusing to send "
                + "\"No entry last week\" for farms whose entries were not read.");
        }

        return ConfirmedFarmDays.LastCompleteWeek(rows, exclusions.UserIds, countedAtUtc);
    }

    private async Task<Dictionary<Guid, string?>> ReadPhonesAsync(Guid[] userIds, CancellationToken ct)
    {
        var phones = new Dictionary<Guid, string?>();
        await WithAnalyticsConnectionAsync(async conn =>
        {
            using var cmd = conn.CreateCommand();
            // public.users: key column "Id" (EF default, quoted); the phone is the owned column "phone".
            cmd.CommandText = """
                SELECT u."Id", u.phone
                FROM public.users u
                WHERE u."Id" = ANY(@ids)
                """;
            AddParam(cmd, "@ids", userIds);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) phones[r.GetGuid(0)] = r.IsDBNull(1) ? null : r.GetString(1);
        }, ct);
        return phones;
    }

    /// <summary>
    /// Problems per farm in the last 24 hours (plan CR-2e, Task 1, F6), by the one farm rule and the one problem
    /// rule with test accounts left out (<see cref="AdminErrorFarm"/>, C1, C16), so a farm shows the same count here
    /// as on Live Health.
    /// </summary>
    private async Task<Dictionary<Guid, int>> ReadErrors24hAsync(Guid[] farmIds, CancellationToken ct)
    {
        var errors = new Dictionary<Guid, int>();
        await WithAnalyticsConnectionAsync(async conn =>
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                SELECT p.farm, COUNT(*)
                FROM (
                    SELECT {AdminErrorFarm.FarmSql} AS farm
                    FROM analytics.events
                    WHERE {AdminErrorFarm.CountedProblemSql}
                      AND occurred_at_utc >= NOW() - @window
                ) p
                WHERE p.farm = ANY(@ids)
                GROUP BY p.farm
                """;
            AddParam(cmd, "@window", AdminErrorFarm.LastDay);
            AddParam(cmd, "@ids", farmIds);
            AdminErrorFarm.AddExcludedUserIds(cmd, exclusions);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) errors[r.GetGuid(0)] = (int)r.GetInt64(1);
        }, ct);
        return errors;
    }

    private async Task WithAnalyticsConnectionAsync(Func<System.Data.Common.DbConnection, Task> work, CancellationToken ct)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try { await work(conn); }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    /// <summary>
    /// Returns the silent-churn watchlist for admins.
    ///
    /// <para>
    /// <b>Not on any read path</b> since plan CR-2e, Task 4 (C26): <c>/admin/farms/silent-churn</c> counts live
    /// through <c>GetSilentChurnHandler</c>. Kept, with its old swallowing catch, only until the CR-2d clean-up.
    /// </para>
    ///
    /// <para>
    /// Reads <c>mis.silent_churn_watchlist</c>, the matview that joins
    /// <c>mis.subscription_farms</c> (denormalised cross-aggregate
    /// projection per ADR-0004 α) with <c>analytics.events</c> to
    /// surface farms whose subscriptions are still active but have not
    /// produced a <c>log.created</c> event in the last 14 days.
    /// </para>
    ///
    /// <para>
    /// Restored on 2026-05-01 by T-IGH-03-MIS-MATVIEW-REDESIGN Bucket 1
    /// (migration <c>20260502010000_AddSubscriptionFarmsAndChurnMatviews</c>).
    /// Falls back to an empty list if the matview is empty or if the
    /// query throws — same graceful pattern as the other Get* methods.
    /// </para>
    ///
    /// <para>
    /// <b>FM-empty caveat (Path C, accepted 2026-05-03):</b>
    /// <c>mis.silent_churn_watchlist</c> depends on
    /// <c>mis.subscription_farms</c>, which joins via
    /// <c>ssf.farm_memberships</c>. That table is currently empty in
    /// production — <c>ssf.farm_memberships</c> will be populated
    /// naturally once DWC v2 Phase E ships the worker-capture flow.
    /// Until then this method returns <c>[]</c> on prod. No engineering
    /// action required; see T-BUCKET1-CHURN-FM-EMPTY for the full
    /// decision record.
    /// </para>
    /// </summary>
    public async Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            var items = new List<SilentChurnItemDto>();
            using var cmd = conn.CreateCommand();
            // Join the matview with ssf.farms (for canonical farm name as
            // a fallback) and public.users (for the primary owner's
            // phone via owner_account_memberships → user). Days_since_last_log
            // is rendered as ceil(days/7) weeks for the dashboard.
            cmd.CommandText = """
                SELECT
                    s.farm_id,
                    COALESCE(s.farm_name, 'Unknown')        AS name,
                    COALESCE(u.phone, '—')                  AS owner_phone,
                    COALESCE(s.plan_code, 'trial')          AS plan,
                    GREATEST(1, (s.days_since_last_log / 7)) AS weeks_silent,
                    s.last_log_at
                FROM mis.silent_churn_watchlist s
                LEFT JOIN accounts.owner_accounts oa
                    ON oa.owner_account_id = s.owner_account_id
                LEFT JOIN public.users u
                    ON u."Id" = oa.primary_owner_user_id
                ORDER BY s.days_since_last_log DESC
                LIMIT 50
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(new SilentChurnItemDto(
                    FarmId: r.GetGuid(0),
                    Name: r.GetString(1),
                    OwnerPhone: r.IsDBNull(2) ? "—" : r.GetString(2),
                    Plan: r.GetString(3),
                    WeeksSilent: r.GetInt32(4),
                    LastLogAt: r.IsDBNull(5) ? null : r.GetDateTime(5)));
            return items;
        }
        catch { return []; }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2, U1/U2). Read from analytics.events on request
    // by the one farm rule and the one problem rule with test accounts left out (AdminErrorFarm, C16): 7 days, 3 or
    // more, at most 50. No farm name and no ssf.farms join: names come from the contacts route, so this read opens
    // no cross-farm factory. Nothing is caught: a failed read answers 500, never an empty list.
    public async Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default)
    {
        IReadOnlyList<RepeatedProblemFarm> farms = [];
        await WithAnalyticsConnectionAsync(async conn =>
        {
            farms = await AdminErrorFarm.ReadRepeatedProblemsAsync(
                conn, AdminErrorFarm.LastWeek, minProblems: 3, maxFarms: 50, exclusions, ct);
        }, ct);

        return farms
            .Select(f => new SufferingItemDto(
                FarmId: f.FarmId,
                ProblemCount: f.ProblemCount,
                SyncProblems: f.Sync,
                EntryProblems: f.Entries,
                VoiceProblems: f.Voice,
                OtherProblems: f.Other,
                LastProblemAt: f.LastProblemAt))
            .ToList();
    }

    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1, C5). The farm rows come through the audited
    // cross-farm factory, opened once (one admin_cross_tenant audit row naming the admin); with no ids it is not
    // opened. Owner phones come from public.users on the analytics connection (C15). A factory that can see no
    // farm at all throws: forced row-level security hides rows without an error, so an empty list would lie.
    public async Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
        Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default)
    {
        if (farmIds.Count == 0)
        {
            return [];
        }

        if (adminDbFactory is null)
        {
            throw new InvalidOperationException(
                $"{nameof(AdminMisRepository)} was built without an admin DbContext factory, so it cannot "
                + "read farm names across farms. Resolve it from the container.");
        }

        var wanted = farmIds.Distinct().Select(id => new FarmId(id)).ToList();

        await using var ssf = await adminDbFactory.CreateAsync(
            reason: $"{nameof(AdminMisRepository)}.farm-contacts",
            actorUserId: adminUserId,
            ct: ct);

        if (!await ssf.Farms.AsNoTracking().AnyAsync(ct))
        {
            throw new InvalidOperationException(
                "The admin context can see no farm at all. ssf.farms is under forced row-level security, "
                + "which returns zero rows without an error to a connection that is not privileged; "
                + "refusing to answer that these farms do not exist.");
        }

        var farms = await ssf.Farms
            .AsNoTracking()
            .Where(f => wanted.Contains(f.Id))
            .Select(f => new { f.Id, f.Name, f.OwnerUserId, f.OwnerAccountId })
            .ToListAsync(ct);

        if (farms.Count == 0)
        {
            return [];
        }

        var phones = await ReadPhonesAsync(farms.Select(f => f.OwnerUserId.Value).Distinct().ToArray(), ct);

        return farms
            .Select(f => new FarmContactDto(
                FarmId: f.Id.Value,
                Name: f.Name,
                OwnerPhone: phones.TryGetValue(f.OwnerUserId.Value, out var phone) && !string.IsNullOrWhiteSpace(phone)
                    ? phone
                    : null,
                OwnerAccountId: f.OwnerAccountId.Value))
            .OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(c => c.FarmId)
            .ToList();
    }


    // ── Phase 5: Users ──────────────────────────────────────────────────────
    // spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 4). Real columns of public.users ("Id", phone,
    // display_name, created_at_utc); last sign-in = the latest refresh-token issue or use. Email is not stored
    // (null); Apps is empty. Nothing is caught: a failed read answers 500, never an empty list.
    public async Task<UsersListDto> GetUsersListAsync(
        int page, int pageSize, string? search, CancellationToken ct = default)
    {
        var fs = !string.IsNullOrWhiteSpace(search);
        var total = 0;
        var items = new List<UserSummaryDto>();

        await WithAnalyticsConnectionAsync(async conn =>
        {
            using (var countCmd = conn.CreateCommand())
            {
                countCmd.CommandText = "SELECT COUNT(*) FROM public.users u" +
                    (fs ? $" WHERE u.phone LIKE @s ESCAPE '{LikeEscape}' OR LOWER(u.display_name) LIKE LOWER(@s) ESCAPE '{LikeEscape}'" : "");
                if (fs) AddParam(countCmd, "@s", $"%{EscapeLike(search!)}%");
                var rawCount = await countCmd.ExecuteScalarAsync(ct);
                total = Convert.ToInt32(rawCount, System.Globalization.CultureInfo.InvariantCulture);
            }

            using var dataCmd = conn.CreateCommand();
            dataCmd.CommandText = """
                SELECT u."Id", u.phone, u.display_name, u.created_at_utc,
                       GREATEST(MAX(t.created_at_utc), MAX(t.last_used_at_utc)) AS last_sign_in
                FROM public.users u
                LEFT JOIN public.refresh_tokens t ON t.user_id = u."Id"
                """ +
                (fs ? $" WHERE u.phone LIKE @s2 ESCAPE '{LikeEscape}' OR LOWER(u.display_name) LIKE LOWER(@s2) ESCAPE '{LikeEscape}'" : "") +
                """

                GROUP BY u."Id"
                ORDER BY u.created_at_utc DESC, u."Id"
                LIMIT @size OFFSET @offset
                """;
            if (fs) AddParam(dataCmd, "@s2", $"%{EscapeLike(search!)}%");
            AddParam(dataCmd, "@size", pageSize);
            AddParam(dataCmd, "@offset", (page - 1) * pageSize);
            using var r = await dataCmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(new UserSummaryDto(
                    UserId: r.GetGuid(0),
                    Phone: r.IsDBNull(1) ? "—" : r.GetString(1),
                    DisplayName: r.IsDBNull(2) ? null : r.GetString(2),
                    Email: null,
                    Apps: [],
                    CreatedAt: r.GetDateTime(3),
                    LastLoginAt: r.IsDBNull(4) ? null : r.GetDateTime(4)));
        }, ct);

        return new UsersListDto(items, total, page, pageSize);
    }

    /// <summary>The LIKE escape character used by both lists' search.</summary>
    private const string LikeEscape = "\\";

    /// <summary>Makes the escape character, % and _ in user search text match literally.</summary>
    private static string EscapeLike(string text) =>
        text.Replace(LikeEscape, LikeEscape + LikeEscape, StringComparison.Ordinal)
            .Replace("%", LikeEscape + "%", StringComparison.Ordinal)
            .Replace("_", LikeEscape + "_", StringComparison.Ordinal);

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
