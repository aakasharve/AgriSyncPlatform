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
///
/// <para>
/// <b>One person, at most <see cref="MaxVersionsPerPersonPerDay"/> versions a
/// day.</b> The version is a header the caller writes. Without a limit per
/// person, one signed-in account sending a new made-up version on every
/// request could use up <see cref="MaxClaimsPerDay"/> on its own and stop the
/// recording for everybody until UTC midnight.
/// </para>
///
/// <para>
/// <b>Who wrote the row.</b> <c>actor_role</c> is <c>system</c> and there is no
/// actor. The control room reads only rows with that pair
/// (<c>AdminOpsRepository.GetAppSeenAsync</c>), and client ingest can never
/// write it: ingest stamps every row <c>user</c> or <c>anonymous</c>.
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

    /// <summary>
    /// The most different versions one person is recorded on in one UTC day:
    /// far more than a real person updates in a day, and far too few for one
    /// account to use up <see cref="MaxClaimsPerDay"/>. Past it a further new
    /// version from that person is not recorded that day, and one Warning per
    /// person says so. Other people are unaffected, and the count starts
    /// again with the next UTC day. A request that is not recorded anyway (no
    /// version, a malformed or wordy one, a version already recorded today)
    /// uses none of the five.
    /// </summary>
    public const int MaxVersionsPerPersonPerDay = 5;

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

        if (claims.TryAdd(personId, appVersion, out var reportPersonLimit))
        {
            return true;
        }

        if (reportPersonLimit)
        {
            // Once per person and day, so at most MaxClaimsPerDay /
            // MaxVersionsPerPersonPerDay of these in a day. A real person
            // does not get here; an account sending made-up versions does,
            // and this line is how that gets noticed.
            logger.LogWarning(
                "AppSeenPersonLimitReached: personId={PersonId} was already recorded on "
                + "{MaxVersionsPerPersonPerDay} different app versions on {DayUtc} (UTC). No further "
                + "version is recorded for this person until the next UTC day; other people are still "
                + "recorded and requests are unaffected.",
                personId,
                MaxVersionsPerPersonPerDay,
                claims.Day);
        }

        return false;
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

    /// <summary>
    /// Who has been recorded on which versions in one UTC day. It stays
    /// bounded two ways: a person is added only while the day is not full and
    /// is recorded on a version the moment they are added, so there are never
    /// more people here than claims (<see cref="MaxClaimsPerDay"/>, plus the
    /// few requests that were in flight when it filled); and each person
    /// holds at most <see cref="MaxVersionsPerPersonPerDay"/> versions of at
    /// most 32 characters. The whole object is dropped when the day moves on,
    /// which is what resets both limits.
    /// </summary>
    private sealed class DayClaims(DateOnly day)
    {
        private readonly ConcurrentDictionary<Guid, PersonVersions> _people = new();
        private int _count;
        private int _fullReported;

        public DateOnly Day { get; } = day;

        public bool IsFull => Volatile.Read(ref _count) >= MaxClaimsPerDay;

        /// <summary>
        /// True only for the first claim of this person and version today,
        /// and only while the person is under their limit for the day.
        /// <paramref name="reportPersonLimit"/> is true the first time today
        /// that this person is refused for being at the limit.
        /// </summary>
        public bool TryAdd(Guid personId, string appVersion, out bool reportPersonLimit)
        {
            var person = _people.GetOrAdd(personId, static _ => new PersonVersions());
            if (!person.TryAdd(appVersion, out reportPersonLimit))
            {
                return false;
            }

            Interlocked.Increment(ref _count);
            return true;
        }

        public bool ReportFullOnce() => Interlocked.Exchange(ref _fullReported, 1) == 0;
    }

    /// <summary>
    /// The versions one person has been recorded on today. Checking and
    /// adding happen under one lock, so two requests from the same person
    /// arriving together can neither record one version twice nor take the
    /// person past the limit. The lock is this person's alone: nobody else's
    /// request ever waits on it.
    /// </summary>
    private sealed class PersonVersions
    {
        // Almost everybody is on one version all day.
        private readonly List<string> _versions = new(capacity: 1);
        private bool _limitReported;

        public bool TryAdd(string appVersion, out bool reportLimit)
        {
            lock (_versions)
            {
                reportLimit = false;

                // Coming back on a version already recorded today is not a
                // further version, at the limit or below it.
                if (_versions.Contains(appVersion))
                {
                    return false;
                }

                if (_versions.Count >= MaxVersionsPerPersonPerDay)
                {
                    reportLimit = !_limitReported;
                    _limitReported = true;
                    return false;
                }

                _versions.Add(appVersion);
                return true;
            }
        }
    }
}
