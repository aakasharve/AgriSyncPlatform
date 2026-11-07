using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Claims;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.Endpoints;

namespace AgriSync.Bootstrapper.Composition;

/// <summary>
/// The HTTP rate-limit policies (<c>"auth"</c>, <c>"ai"</c>, <c>"join"</c>), moved verbatim out of
/// <c>Program.cs</c> by spec: plr-d7-m1-multiuser-2026-10-26 (step 1) so a test host can register
/// EXACTLY what production registers and prove the 429 (<c>JoinByCodeRealPostgresTests</c>);
/// before the move no test could reach these policies at all.
///
/// <para><b>E2E relaxation.</b> E2E CI runs the whole Playwright suite against one backend from a
/// single IP, so the per-IP fixed-window auth/ai limits (10/30 per minute) trip and login starts
/// returning 429 mid-suite. When the E2E harness is enabled (<c>ALLOW_E2E_SEED=true</c> — never
/// set in prod), the limits are relaxed so the suite does not self-throttle. Prod (flag absent)
/// keeps the secure limits.</para>
/// </summary>
public static class RateLimitingConfig
{
    /// <summary>"join": tries per window, per signed-in user (production value).</summary>
    public const int JoinPermitLimit = 10;

    /// <summary>"join": tries per window from ONE client network — an IPv4 address, or an IPv6
    /// /64 (see <see cref="ResolveJoinClientNetworkKey"/>) — whoever is signed in.</summary>
    public const int JoinPerClientNetworkPermitLimit = 20;

    /// <summary>"join": tries per window from EVERY caller together — the ceiling on guessing.</summary>
    public const int JoinAllCallersPermitLimit = 300;

    /// <summary>"join": the fixed window (all three "join" limits share it).</summary>
    public static readonly TimeSpan JoinWindow = TimeSpan.FromMinutes(10);

    /// <summary>lane WID fix pass 1 — identity lookups and code sends per signed-in user per <see cref="IdentityWindow"/>.</summary>
    public const int IdentityPermitLimit = 30;

    public static readonly TimeSpan IdentityWindow = TimeSpan.FromMinutes(10);

    /// <summary>spec: plr-d10 lane MU-2 — invitation-code tries per signed-in person per hour (my call).</summary>
    public const int InvitationCodePermitLimit = 10;

    /// <summary>spec: plr-d10 lane MU-2 — the invitation-code window: one hour.</summary>
    public static readonly TimeSpan InvitationCodeWindow = TimeSpan.FromHours(1);

    /// <summary>The one partition every request that is not on the "join" route falls into in the
    /// global limiter: a no-op limiter, so the global limiter changes nothing for any other route.</summary>
    private const string NotAJoinRequest = "not-join";

    public static IServiceCollection AddAgriSyncRateLimiting(this IServiceCollection services, bool e2eHarnessEnabled)
    {
        var authPermitLimit = e2eHarnessEnabled ? 100_000 : 10;
        var aiPermitLimit = e2eHarnessEnabled ? 100_000 : 30;
        var joinPermitLimit = e2eHarnessEnabled ? 100_000 : JoinPermitLimit;
        var joinPerClientNetworkPermitLimit = e2eHarnessEnabled ? 100_000 : JoinPerClientNetworkPermitLimit;
        var joinAllCallersPermitLimit = e2eHarnessEnabled ? 100_000 : JoinAllCallersPermitLimit;
        var identityPermitLimit = e2eHarnessEnabled ? 100_000 : IdentityPermitLimit;
        var invitationCodePermitLimit = e2eHarnessEnabled ? 100_000 : InvitationCodePermitLimit;

        services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = (rateLimitContext, _) =>
            {
                rateLimitContext.HttpContext.Response.Headers["Retry-After"] =
                    RetryAfterSeconds(rateLimitContext.Lease).ToString(CultureInfo.InvariantCulture);
                return ValueTask.CompletedTask;
            };

            options.AddPolicy("auth", httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ResolveRemoteIpRateLimitPartitionKey(httpContext),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = authPermitLimit,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    }));

            options.AddPolicy("ai", httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ResolveAiRateLimitPartitionKey(httpContext),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = aiPermitLimit,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    }));

            // spec: plr-d10 lane WID fix pass 1 (review M2, L1) — the worker-identity lookups and code sends: per
            // signed-in user (the same resolver as "ai"), 30 a 10-minute window — plenty for an owner adding a gang by
            // their cards, far too few to list cards or verified numbers, or to loop SMS at numbers. The per-farm and
            // per-user DAILY code caps and the wrong-try bound live in WorkerIdentityService beside the per-number ones.
            options.AddPolicy(ShramSafal.Api.Endpoints.WorkerIdentityEndpoints.IdentityRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ResolveAiRateLimitPartitionKey(httpContext),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = identityPermitLimit,
                        Window = IdentityWindow,
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    }));

            // spec: plr-d10 lane MU-2 — the personal invitation's code routes (find, accept, decline). Eight digits are
            // 10^8 values; per signed-in person (the same resolver as "ai") 10 tries an hour, and per-network and
            // all-callers limits below, so fresh accounts from one network share one budget. Fix round 1 (review L-8):
            // those two are the invitation door's OWN budgets (the same sizes as the join door's, separate partitions),
            // so a farm-code flood never blocks an invitation claim, nor the other way round. A guessed code still only
            // ASKS unless it named the guesser's own proven number.
            options.AddPolicy(ShramSafal.Api.Endpoints.PersonalInvitationEndpoints.InvitationCodeRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ResolveAiRateLimitPartitionKey(httpContext),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = invitationCodePermitLimit,
                        Window = InvitationCodeWindow,
                        QueueLimit = 0,
                        AutoReplenishment = true,
                    }));

            // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — POST /shramsafal/join/by-code. A farm
            // code is 6 characters (~1.07 billion values): short enough to type, so short enough to
            // guess at. 10 tries per 10 minutes is plenty for a farmer fixing a typo. Keyed per
            // signed-in user, falling back to the IP — the same resolver as "ai". The policy NAME is
            // the route's own constant, so the two can never drift apart.
            //
            // A per-USER limit alone does not bound guessing: whoever can make several accounts
            // spends 10 tries on each. Password self-registration (POST /user/auth/register) is
            // closed unless Auth:AllowPasswordRegistration is on (test stacks only) and a password
            // login never marks a phone verified (spec I19, D-23), but a test stack with the switch
            // on, or one person holding several numbers, can still do it. The two limits that DO
            // bound it are the per-network and global limits below, which apply to this same route.
            options.AddPolicy(MembershipEndpoints.JoinRateLimitPolicy, httpContext =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: ResolveAiRateLimitPartitionKey(httpContext),
                    factory: _ => JoinWindowLimit(joinPermitLimit)));

            // spec: plr-d7-m1-multiuser-2026-10-26 (step 1, SEC-1) — the "join" route is ALSO
            // bounded per client network and across every caller together. Three limits, all on
            // the one 10-minute window; a try is answered only when all three have room:
            //   1. per signed-in user  10  — the "join" policy above (the endpoint limiter);
            //   2. per client network  20  — one IPv4 address or one IPv6 /64, whoever signs in,
            //                                so fresh accounts from one machine share one budget;
            //   3. all callers         300 — the hard ceiling: however many accounts and addresses
            //                                a guesser holds, ≤ 300 codes are tried per 10 minutes.
            //
            // HOW. ASP.NET Core gives an endpoint exactly ONE named policy, and a policy is ONE
            // partition (one key, one limiter), so 2 and 3 cannot live inside "join". They are the
            // middleware's GlobalLimiter, a PartitionedRateLimiter.CreateChained of two limiters
            // that both act ONLY on an endpoint carrying the "join" policy (every other request
            // gets a no-op limiter and is untouched). The middleware asks the global limiter first,
            // then the endpoint policy, and answers 429 through the same OnRejected (Retry-After
            // from the refusing limiter's own window). So the route still declares one thing —
            // .RequireRateLimiting("join") — and removing it removes all three limits at once,
            // which is what the route-metadata test in JoinByCodeRealPostgresTests guards.
            //
            // ORDER IS DELIBERATE: network first, then the ceiling. A chained fixed-window permit
            // taken before a later link refuses is not given back, so the earlier link pays for the
            // refusal. With the network first, a request from a network that is already out of
            // tries is refused before it touches the ceiling — one machine can spend at most its
            // own 20 of the shared 300, and draining the ceiling (which would shut the door on
            // every farmer for the rest of the window) needs at least 15 separate networks.
            //
            // The CLIENT IP is Connection.RemoteIpAddress as UseForwardedHeaders leaves it, with
            // CreateForwardedHeadersOptions below (Program.cs and the tests use that one
            // definition). X-Forwarded-For is honoured only from the loopback proxy (nginx on the
            // same machine, Kestrel on localhost:5000) and only its LAST entry — the address nginx
            // itself saw — so a header a phone or a script sets is never believed.
            options.GlobalLimiter = PartitionedRateLimiter.CreateChained(
                PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
                    CodeDoorOf(httpContext) is { } door
                        ? RateLimitPartition.GetFixedWindowLimiter(
                            partitionKey: door + ResolveJoinClientNetworkKey(httpContext),
                            factory: _ => JoinWindowLimit(joinPerClientNetworkPermitLimit))
                        : RateLimitPartition.GetNoLimiter(NotAJoinRequest)),
                PartitionedRateLimiter.Create<HttpContext, string>(httpContext =>
                    CodeDoorOf(httpContext) is { } door
                        ? RateLimitPartition.GetFixedWindowLimiter(
                            partitionKey: door + "join:all-callers",
                            factory: _ => JoinWindowLimit(joinAllCallersPermitLimit))
                        : RateLimitPartition.GetNoLimiter(NotAJoinRequest)));
        });

        return services;
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, SEC-1) — how the server learns the client's
    /// IP, in ONE place: <c>Program.cs</c> passes this to <c>UseForwardedHeaders</c>, and the
    /// rate-limit tests use the same call, so the per-network "join" limit is proven against the
    /// real rule rather than a copy. Unchanged from what <c>Program.cs</c> configured inline:
    /// <c>X-Forwarded-For</c> / <c>-Proto</c>, with the framework defaults that matter here —
    /// believed only from a loopback proxy (<c>KnownProxies</c> / <c>KnownNetworks</c>), and only
    /// the LAST address in the header (<c>ForwardLimit = 1</c>): the one the local nginx appended.
    /// Any address a client wrote into the header itself sits to the left of it and is ignored.
    /// </summary>
    public static ForwardedHeadersOptions CreateForwardedHeadersOptions() => new()
    {
        ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    };

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, SEC-1) — the per-network "join" key. An IPv4
    /// address is one key; an IPv6 address is keyed by its /64, because a single phone or home
    /// line is handed a whole /64 and could otherwise step to a fresh address on every try. An
    /// IPv4-mapped IPv6 address counts as the IPv4 address it carries. No address at all (a
    /// test server, a unix socket) is one shared key — stricter, never looser.
    /// </summary>
    public static string ResolveJoinClientNetworkKey(HttpContext context)
    {
        var ip = context.Connection.RemoteIpAddress;
        if (ip is null)
        {
            return "join-net:unknown";
        }

        if (ip.IsIPv4MappedToIPv6)
        {
            ip = ip.MapToIPv4();
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var bytes = ip.GetAddressBytes();
            Array.Clear(bytes, 8, 8);
            return $"join-net:{new IPAddress(bytes)}/64";
        }

        return $"join-net:{ip}";
    }

    /// <summary>
    /// Which code door a request is at, as the prefix of its network and all-callers partitions: <c>""</c> for an endpoint
    /// carrying the "join" policy (its partition keys stay exactly as they were), <c>"invitation:"</c> for the personal
    /// invitation's code routes (lane MU-2 fix round 1, review L-8: their own budgets), <c>null</c> for anything else.
    /// </summary>
    private static string? CodeDoorOf(HttpContext context) =>
        context.GetEndpoint()?.Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName switch
        {
            MembershipEndpoints.JoinRateLimitPolicy => string.Empty,
            ShramSafal.Api.Endpoints.PersonalInvitationEndpoints.InvitationCodeRateLimitPolicy => "invitation:",
            _ => null,
        };

    private static FixedWindowRateLimiterOptions JoinWindowLimit(int permitLimit) => new()
    {
        PermitLimit = permitLimit,
        Window = JoinWindow,
        QueueLimit = 0,
        AutoReplenishment = true
    };

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the <c>Retry-After</c> a refused request
    /// carries. It used to be a fixed "60" for every policy, which was right for the 1-minute
    /// "auth" / "ai" windows and wrong for "join" (10 minutes): a phone that obeyed it retried
    /// into another 429 for up to nine more minutes. The fixed-window limiter reports its own
    /// wait as lease metadata, so the header now follows the policy that refused (still 60 for
    /// the 1-minute windows). 60 remains the fallback if a limiter reports nothing.
    /// </summary>
    public static int RetryAfterSeconds(RateLimitLease lease)
    {
        if (lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfter) && retryAfter > TimeSpan.Zero)
        {
            return (int)Math.Ceiling(retryAfter.TotalSeconds);
        }

        return 60;
    }

    public static string ResolveRemoteIpRateLimitPartitionKey(HttpContext context)
    {
        return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }

    public static string ResolveAiRateLimitPartitionKey(HttpContext context)
    {
        var subject =
            context.User.FindFirst("sub")?.Value ??
            context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (!string.IsNullOrWhiteSpace(subject))
        {
            return $"user:{subject}";
        }

        return $"ip:{ResolveRemoteIpRateLimitPartitionKey(context)}";
    }
}
