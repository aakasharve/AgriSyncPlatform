using System.Collections.Concurrent;
using System.Text.Json;
using AgriSync.BuildingBlocks.Analytics;

namespace AgriSync.Bootstrapper.Middleware;

/// <summary>
/// spec: control-room-app-versions-2026-11-12 (ADR 0028). Notes that a
/// signed-in person used the farmer app on a version: one <c>app.seen</c> row
/// in <c>analytics.events</c> at most once per person, app version and UTC
/// day, per server process.
///
/// <para>
/// <b>What is recorded.</b> A request is recorded only when it comes from a
/// signed-in person and its <c>X-App-Version</c> header is a well-formed
/// version that starts with a digit. A missing, malformed or wordy value
/// (<c>unknown</c> passes the sanitiser) is not a version anybody used, so
/// nothing is written for it, neither as sent nor as a placeholder.
/// </para>
///
/// <para>
/// <b>The shape of the row (ADR 0028 D2, D3).</b> <c>actor_user_id</c> and
/// <c>farm_id</c> stay EMPTY, even when the token carries a farm: the
/// weekly-active, retention and suffering readers count rows that have one of
/// them set, and merely opening the app must not move those numbers. The
/// person is <c>props.personId</c>. No device identifier, endpoint or farm is
/// written at all.
/// </para>
///
/// <para>
/// <b>It may never cost a request (D5).</b> The decision is taken BEFORE the
/// rest of the pipeline runs, from what the request said on the way in, so a
/// person whose request then fails is still seen. The write is fire-and-forget
/// on another thread and never touches the <see cref="HttpContext"/>. A failed
/// write is logged at <c>Warning</c> (the production minimum level) and is not
/// retried that day: <c>AnalyticsWriter</c> swallows database errors, so this
/// middleware cannot know a row was lost.
/// </para>
///
/// <para>
/// <b>De-duplication is in memory and best-effort (D4).</b> It is a field of
/// this instance, so after a restart, or with more than one server process, a
/// person can be recorded twice in a day. Readers count distinct people, so a
/// duplicate is harmless.
/// </para>
/// </summary>
public sealed class AppSeenMiddleware(
    RequestDelegate next,
    IServiceScopeFactory scopeFactory,
    TimeProvider clock,
    ILogger<AppSeenMiddleware> logger)
{
    /// <summary>
    /// The most person-and-version pairs one process claims in one UTC day.
    /// It bounds both the memory held here and the rows written to an
    /// append-only store. Past it nothing more is recorded that day, and one
    /// Warning says so.
    /// </summary>
    public const int MaxClaimsPerDay = 50_000;

    private const string AndroidPlatform = "android";

    private readonly object _newDayGate = new();
    private DayClaims _claims = new(DateOnly.MinValue);

    public async Task InvokeAsync(HttpContext ctx)
    {
        try
        {
            RecordIfFirstToday(ctx);
        }
        catch (Exception ex)
        {
            // Deciding reads claims and two headers and should not be able to
            // throw. If it ever does, the request still goes through.
            logger.LogWarning(
                ex,
                "AppSeenDecisionFailed: exceptionType={ExceptionType}. No app.seen row for this "
                + "request; the request itself is unaffected.",
                ex.GetType().Name);
        }

        await next(ctx);
    }

    private void RecordIfFirstToday(HttpContext ctx)
    {
        if (ClaimsUserId.TryGet(ctx.User) is not { } personId)
        {
            return;
        }

        var appVersion = RequestObservabilityProps.SanitiseAppVersion(
            ctx.Request.Headers["X-App-Version"].FirstOrDefault());

        if (appVersion is null
            || appVersion == RequestObservabilityProps.MalformedAppVersion
            || !char.IsAsciiDigit(appVersion[0]))
        {
            return;
        }

        var seenAtUtc = clock.GetUtcNow().UtcDateTime;
        if (!TryClaim(DateOnly.FromDateTime(seenAtUtc), personId, appVersion))
        {
            return;
        }

        // The whole bag, built here from values already copied off the
        // request. Exactly the keys the vocabulary lists for app.seen.
        var props = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["appVersion"] = appVersion,
            ["personId"] = personId.ToString("D"),
        };

        // The app sends "X-Client-Platform: android" from native Android only.
        // The literal is written, never the header's own text: a client can
        // put anything there. Any other value is an absent key (P4).
        if (string.Equals(
                ctx.Request.Headers["X-Client-Platform"].FirstOrDefault(),
                AndroidPlatform,
                StringComparison.OrdinalIgnoreCase))
        {
            props["platform"] = AndroidPlatform;
        }

        var propsJson = JsonSerializer.Serialize(props);

        // Fire-and-forget in a new scope: IAnalyticsWriter is scoped.
        _ = Task.Run(() => WriteAsync(seenAtUtc, appVersion, propsJson));
    }

    private async Task WriteAsync(DateTime seenAtUtc, string appVersion, string propsJson)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var analytics = scope.ServiceProvider.GetRequiredService<IAnalyticsWriter>();
            await analytics.EmitAsync(new AnalyticsEvent(
                EventId: Guid.NewGuid(),
                EventType: AnalyticsEventType.AppSeen,
                OccurredAtUtc: seenAtUtc,
                ActorUserId: null,
                FarmId: null,
                OwnerAccountId: null,
                ActorRole: "system",
                Trigger: "middleware",
                DeviceOccurredAtUtc: null,
                SchemaVersion: "v1",
                PropsJson: propsJson));
        }
        catch (Exception ex)
        {
            // Not rethrown, and not hidden: Warning is the production Serilog
            // minimum level, so this lands in the API log. The pair stays
            // claimed, so the row is not retried today.
            logger.LogWarning(
                ex,
                "AppSeenEmitFailed: appVersion={AppVersion} exceptionType={ExceptionType}. This "
                + "app.seen row is lost and is not retried today; the request was unaffected.",
                LogSafe.Text(appVersion),
                ex.GetType().Name);
        }
    }

    private bool TryClaim(DateOnly todayUtc, Guid personId, string appVersion)
    {
        var claims = ClaimsFor(todayUtc);

        if (claims.IsFull)
        {
            if (claims.ReportFullOnce())
            {
                logger.LogWarning(
                    "AppSeenDailyCapReached: {MaxClaimsPerDay} person-and-version pairs were recorded on "
                    + "{DayUtc} (UTC). No more app.seen rows are written by this process until the next "
                    + "UTC day; requests are unaffected.",
                    MaxClaimsPerDay,
                    claims.Day);
            }

            return false;
        }

        return claims.TryAdd(personId, appVersion);
    }

    /// <summary>
    /// The claims of the current UTC day, replaced when the day moves on. A
    /// request that read the clock just before midnight and arrives here just
    /// after another has started the new day keeps using the new day's claims.
    /// </summary>
    private DayClaims ClaimsFor(DateOnly todayUtc)
    {
        var current = Volatile.Read(ref _claims);
        if (todayUtc <= current.Day)
        {
            return current;
        }

        lock (_newDayGate)
        {
            current = _claims;
            if (todayUtc > current.Day)
            {
                current = new DayClaims(todayUtc);
                Volatile.Write(ref _claims, current);
            }

            return current;
        }
    }

    private sealed class DayClaims(DateOnly day)
    {
        private readonly ConcurrentDictionary<(Guid PersonId, string AppVersion), byte> _seen = new();
        private int _count;
        private int _fullReported;

        public DateOnly Day { get; } = day;

        public bool IsFull => Volatile.Read(ref _count) >= MaxClaimsPerDay;

        /// <summary>True only for the first claim of this person and version today.</summary>
        public bool TryAdd(Guid personId, string appVersion)
        {
            if (!_seen.TryAdd((personId, appVersion), 0))
            {
                return false;
            }

            Interlocked.Increment(ref _count);
            return true;
        }

        public bool ReportFullOnce() => Interlocked.Exchange(ref _fullReported, 1) == 0;
    }
}
