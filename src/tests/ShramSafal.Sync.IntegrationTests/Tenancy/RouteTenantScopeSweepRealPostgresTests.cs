// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 (register F99, carried from the MU-4 third review).
//
// Some ShramSafal REST routes never opened the caller's farm scope: their first query failed closed in
// TenantConnectionInterceptor ("no tenant claim set and not in admin scope") and the route answered 500 to everyone.
// MU-3 fix 1 (F94) fixed four by hand. This sweep finds them all instead of trusting a list: EVERY route the module maps,
// through the real host (its routes, the real auth/authorization/TenantTransactionMiddleware pipeline and the real
// TenantConnectionInterceptor), on a real Postgres as agrisync_app (E3 first), called by a signed-in member of a seeded farm.
// The rule: a route never answers 500. A made-up id is 404, a bad body 400, a refusal 403.
//
// Each variant is one fact (a fresh seeded database each), so one variant's writes never change another's answers:
//   MadeUpIds       the owner, his own farm, every other id made up, every query value and body field filled;
//   BareRequest     the owner, his own farm, only the required query values, an empty body ({});
//   AnotherFarm     the owner naming ANOTHER farmer's farm (a refusal path must not 500 either);
//   OwnRecordsSeat  a कामगार of the farm (a seat that reads only his own records), as MadeUpIds;
//   RealRecords     the owner, the farm's REAL records (its plot, season, log, job card, test, worker): a made-up id
//                   stops at the first not-found, so only real ids reach a handler step that runs after the gate.
// The few routes F99 leaves answering 500 are NAMED in KnownOpen with their reason (admin routes the brief says to list,
// a route with no authorization that must keep failing closed, two defects that are not scope faults); any other 500 fails.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Errors;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class RouteTenantScopeSweepRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    public enum Variant { MadeUpIds, BareRequest, AnotherFarm, OwnRecordsSeat, RealRecords }

    private static readonly NullabilityInfoContext Nullability = new();

    /// <summary>
    /// The routes lane F99 leaves answering 500, each NAMED here with its reason and reported to the orchestrator, never
    /// silently tolerated: any route NOT on this list that answers 500 fails the sweep. Remove an entry when its route is fixed.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> KnownOpen = new Dictionary<string, string>
    {
        // Admin routes (the brief: list, do not fix): each resolves the caller's admin scope before any scope is open.
        ["GET /shramsafal/ai/config"] = "admin route; AdminScopeHelper's first read runs with no scope",
        ["PUT /shramsafal/ai/config"] = "admin route; AdminScopeHelper's first read runs with no scope",
        ["GET /shramsafal/ai/dashboard"] = "admin route; AdminScopeHelper's first read runs with no scope",
        ["GET /shramsafal/ai/health"] = "admin route; AdminScopeHelper's first read runs with no scope",
        // Failing closed is the only thing that stops it today: it checks no authority at all, so opening a scope would let
        // ANY signed-in person write the platform's global price list. It needs an admin gate first (not this lane's call).
        ["POST /shramsafal/finance/price-config"] = "no authorization at all; left failing closed",
        // Creating a farm: there is no farm to open yet. The phone creates farms through /bootstrap/first-farm.
        ["POST /shramsafal/farms"] = "creates a farm; no farm scope exists to open (needs the bootstrap technique)",
        // Not a scope fault: a bad body reaches the database (text that is not JSON into a json column; a missing field).
        ["POST /shramsafal/corrections"] = "not a scope fault: body not validated before the json column (22P02) or null",
        // Its farm scope is now opened and its farm reads pass; what fails next is the weekly report's read of mis.* on the
        // analytics connection: no migration grants the app role (or mis_reader membership) SELECT there (42501). A grant
        // is a schema change, which this lane may not make.
        ["GET /shramsafal/reports/farm-week/{farmId:guid}"] = "not a scope fault now: the app role has no SELECT on mis.* (42501)",
        // Not a scope fault: ShramSafalRepository.GetScheduleTemplateByIdAsync includes Stages, which the EF map ignores.
        ["POST /shramsafal/schedule-templates/{id}/clone"] = "not a scope fault: Include of an unmapped navigation (Stages)",
        ["POST /shramsafal/schedule-templates/{id}/edit"] = "not a scope fault: Include of an unmapped navigation (Stages)",
        ["POST /shramsafal/schedule-templates/{id}/publish"] = "not a scope fault: Include of an unmapped navigation (Stages)",
    };

    /// <summary>
    /// What Program.cs registers beside the module, so a route answers here as it does in production rather than failing on a
    /// missing service: the retained-voice store (its dev shape: no bucket, so the S3 path is never taken) and a stand-in for
    /// the KMS key service (the same one <see cref="Security.TenantDekEndpointRealPostgresTests"/> uses).
    /// </summary>
    protected override void AddHostServices(IServiceCollection services)
    {
        services.AddSingleton<Amazon.S3.IAmazonS3>(_ => new Amazon.S3.AmazonS3Client(
            new Amazon.Runtime.AnonymousAWSCredentials(),
            new Amazon.S3.AmazonS3Config { ServiceURL = "http://127.0.0.1:1", ForcePathStyle = true }));
        services.AddOptions<ShramSafal.Infrastructure.Privacy.RetainedBlobStoreOptions>();
        services.AddScoped<ShramSafal.Application.Privacy.Ports.IRetainedBlobStore, ShramSafal.Infrastructure.Privacy.S3RetainedBlobStore>();
        services.AddSingleton<AgriSync.BuildingBlocks.Security.ITenantDekService>(new Security.TestKmsStandInTenantDekService());

        // The analytics database is Postgres in production (Program.cs AddAnalytics → UseNpgsql), and the owner's weekly
        // report reads it with raw SQL; the shared host keeps it in memory, where that read cannot run at all.
        services.RemoveAll<Microsoft.EntityFrameworkCore.Infrastructure.IDbContextOptionsConfiguration<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>>();
        services.RemoveAll<Microsoft.EntityFrameworkCore.DbContextOptions<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>>();
        services.AddDbContext<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>(o => o.UseNpgsql(AppConn));
    }

    [Theory]
    [InlineData(Variant.MadeUpIds)]
    [InlineData(Variant.BareRequest)]
    [InlineData(Variant.AnotherFarm)]
    [InlineData(Variant.OwnRecordsSeat)]
    [InlineData(Variant.RealRecords)]
    public async Task No_route_answers_500(Variant variant)
    {
        await AssertAppRoleIsNotVacuousAsync();
        // The production host's own startup line (Program.cs): the PDF library's Community licence.
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

        var routes = Routes();
        routes.Count.Should().BeGreaterThan(120, "the sweep must see the module's whole route table, or it proves nothing");
        Output.WriteLine($"[SWEEP] variant={variant} routes={routes.Count}");

        var caller = variant == Variant.OwnRecordsSeat ? Worker : Owner;
        var answers = new List<(Route Route, int Status, string Detail)>();
        foreach (var route in routes)
        {
            var (url, body) = Request(route, variant);
            var (status, detail) = await AskAsync(route.Method, url, caller, body);
            answers.Add((route, status, detail));
            Output.WriteLine($"[ROUTE] {status} {route.Method} {route.Template} -> {url} {detail}");
        }

        var counts = answers.GroupBy(a => a.Status).OrderBy(g => g.Key).Select(g => $"{g.Key}={g.Count()}");
        Output.WriteLine($"[SWEEP] variant={variant} answers: {string.Join(" ", counts)}");

        var failed = answers.Where(a => a.Status == 500).ToList();
        foreach (var (route, _, detail) in failed)
        {
            var known = KnownOpen.TryGetValue($"{route.Method} {route.Template}", out var why) ? $" [KNOWN-OPEN: {why}]" : string.Empty;
            Output.WriteLine($"[500] {variant} {route.Method} {route.Template} :: {detail}{known}");
        }

        foreach (var (route, status, _) in answers.Where(a => a.Status != 500 && KnownOpen.ContainsKey($"{a.Route.Method} {a.Route.Template}")))
        {
            Output.WriteLine($"[KNOWN-OPEN now {status}] {variant} {route.Method} {route.Template} — remove it from the list once fixed in every variant");
        }

        failed.Where(a => !KnownOpen.ContainsKey($"{a.Route.Method} {a.Route.Template}"))
            .Select(a => $"{a.Route.Method} {a.Route.Template} :: {a.Detail}")
            .Should().BeEmpty($"no route answers 500 ({variant}): a made-up id is 404, a bad body 400, a refusal 403");
    }

    // ── The route table ─────────────────────────────────────────────────────────────────

    private sealed record Route(string Method, string Template, RouteEndpoint Endpoint, MethodInfo? Handler);

    /// <summary>
    /// Every route of the real host, GETs first, then the writes, and last the two that can end the caller's own standing
    /// (his own exit, his own erasure request) so they cannot change another route's answer.
    /// </summary>
    private List<Route> Routes()
    {
        var routes = HostServices.GetRequiredService<EndpointDataSource>().Endpoints
            .OfType<RouteEndpoint>()
            .SelectMany(e => (e.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? ["GET"])
                .Select(m => new Route(m, "/" + (e.RoutePattern.RawText ?? string.Empty).TrimStart('/'), e,
                    e.Metadata.OfType<MethodInfo>().FirstOrDefault())))
            .ToList();

        static int Order(Route r) =>
            r.Template.Contains("self-exit", StringComparison.Ordinal) || r.Template.Contains("erasure", StringComparison.Ordinal) ? 2
            : r.Method == "GET" ? 0
            : 1;

        return routes.OrderBy(Order).ThenBy(r => r.Template, StringComparer.Ordinal).ThenBy(r => r.Method, StringComparer.Ordinal).ToList();
    }

    // ── One request per route ───────────────────────────────────────────────────────────

    private (string Url, object? Body) Request(Route route, Variant variant)
    {
        var routeParameters = route.Endpoint.RoutePattern.Parameters.Select(p => p.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var path = Regex.Replace(route.Template, @"\{([^}:=?]+)[^}]*\}", m =>
        {
            var name = m.Groups[1].Value;
            var constrained = m.Value.Contains(":guid", StringComparison.OrdinalIgnoreCase);
            return Uri.EscapeDataString(constrained || name.EndsWith("id", StringComparison.OrdinalIgnoreCase)
                ? GuidFor(name, variant, ResourceBefore(route.Template, m.Index)).ToString()
                : "x");
        });

        var services = HostServices.GetRequiredService<IServiceProviderIsService>();
        var query = new List<string>();
        JsonNode? body = null;
        var takesBody = route.Method is "POST" or "PUT" or "PATCH";
        foreach (var parameter in route.Handler?.GetParameters() ?? [])
        {
            var name = parameter.Name ?? string.Empty;
            switch (Source(parameter, routeParameters, services))
            {
                case "query":
                    if (variant == Variant.BareRequest && IsOptional(parameter))
                    {
                        break;
                    }

                    foreach (var value in QueryValues(name, parameter.ParameterType, variant))
                    {
                        query.Add($"{Uri.EscapeDataString(name)}={Uri.EscapeDataString(value)}");
                    }

                    break;
                case "body":
                    body = variant == Variant.BareRequest ? new JsonObject() : Json(name, parameter.ParameterType, variant, 0);
                    break;
            }
        }

        // A write whose handler reads the request itself (a form, a stream) still gets a body.
        if (takesBody && body is null)
        {
            body = new JsonObject();
        }

        var url = query.Count == 0 ? path : $"{path}?{string.Join('&', query)}";
        return (url, body);
    }

    /// <summary>How minimal APIs bind a parameter: route, query, body, or nothing the caller sends (a service, the user).</summary>
    private static string Source(ParameterInfo parameter, HashSet<string> routeParameters, IServiceProviderIsService services)
    {
        var type = parameter.ParameterType;
        if (parameter.GetCustomAttribute<FromServicesAttribute>() is not null
            || type == typeof(ClaimsPrincipal) || type == typeof(HttpContext) || type == typeof(HttpRequest)
            || type == typeof(HttpResponse) || type == typeof(CancellationToken)
            || typeof(IFormFile).IsAssignableFrom(Nullable.GetUnderlyingType(type) ?? type)
            || typeof(IFormFileCollection).IsAssignableFrom(type) || typeof(IFormCollection).IsAssignableFrom(type))
        {
            return "none";
        }

        if (parameter.GetCustomAttribute<FromRouteAttribute>() is not null || routeParameters.Contains(parameter.Name ?? string.Empty))
        {
            return "route";
        }

        if (parameter.GetCustomAttribute<FromQueryAttribute>() is not null)
        {
            return "query";
        }

        if (parameter.GetCustomAttribute<FromBodyAttribute>() is not null)
        {
            return "body";
        }

        if (parameter.GetCustomAttribute<FromHeaderAttribute>() is not null)
        {
            return "none";
        }

        if (IsSimple(type))
        {
            return "query";
        }

        return services.IsService(type) ? "none" : "body";
    }

    private static bool IsOptional(ParameterInfo parameter) =>
        parameter.HasDefaultValue
        || Nullable.GetUnderlyingType(parameter.ParameterType) is not null
        || (!parameter.ParameterType.IsValueType && Nullability.Create(parameter).WriteState == NullabilityState.Nullable);

    private static bool IsSimple(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        if (type.IsArray)
        {
            return IsSimple(type.GetElementType()!);
        }

        return type.IsPrimitive || type.IsEnum || type == typeof(string) || type == typeof(Guid) || type == typeof(decimal)
            || type == typeof(DateOnly) || type == typeof(DateTime) || type == typeof(DateTimeOffset) || type == typeof(TimeOnly)
            || type == typeof(TimeSpan);
    }

    private static IEnumerable<string> QueryValues(string name, Type type, Variant variant)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        if (type.IsArray)
        {
            yield return Scalar(name, type.GetElementType()!, variant)?.ToString() ?? "x";
            yield break;
        }

        var value = Scalar(name, type, variant);
        yield return value switch
        {
            null => "x",
            bool b => b ? "true" : "false",
            _ when type.IsEnum => Enum.GetName(type, value) ?? value.ToString()!,
            _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? "x",
        };
    }

    /// <summary>A plausible value for a field named <paramref name="name"/>: the caller's farm for a farm id, a made-up
    /// (or, for <see cref="Variant.RealRecords"/>, the farm's real) id for any other, and an ordinary value otherwise.</summary>
    private static object? Scalar(string name, Type type, Variant variant)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        var lower = name.ToLowerInvariant();
        if (type == typeof(Guid))
        {
            return GuidFor(name, variant, resource: null);
        }

        if (type == typeof(string))
        {
            return lower switch
            {
                "groupby" => "day",
                "window" => "week",
                "entitytype" => "DailyLog",
                "currencycode" or "currency" => "INR",
                "categoryid" or "category" => "fertilizer",
                "croptype" or "cropname" or "cropkey" => "Grapes",
                "stage" or "stagename" => "Vegetative",
                "reason" => "Other",
                "status" => "Confirmed",
                "activitytype" => "spray",
                "unit" => "kg",
                "role" => "Worker",
                "phone" or "phonenumber" => "9300000999",
                "code" or "farmcode" or "joincode" => "ZZ99ZZ",
                "since" => "2026-10-01T00:00:00Z",
                _ when lower.EndsWith("date", StringComparison.Ordinal) => WorkDay,
                _ when lower.Contains("clientcommandid", StringComparison.Ordinal) || lower.Contains("requestid", StringComparison.Ordinal)
                    => $"f99-{Guid.NewGuid():N}",
                _ => "f99",
            };
        }

        if (type == typeof(DateOnly))
        {
            return lower.StartsWith("to", StringComparison.Ordinal) ? "2026-10-31"
                : lower.StartsWith("from", StringComparison.Ordinal) ? "2026-10-01"
                : WorkDay;
        }

        if (type == typeof(DateTime) || type == typeof(DateTimeOffset))
        {
            return "2026-10-30T06:00:00Z";
        }

        if (type == typeof(TimeOnly))
        {
            return "06:00";
        }

        if (type == typeof(TimeSpan))
        {
            return "01:00:00";
        }

        if (type == typeof(bool))
        {
            return false;
        }

        if (type.IsEnum)
        {
            var values = Enum.GetValues(type);
            return values.Length > 0 ? values.GetValue(0) : 0;
        }

        if (type == typeof(int) || type == typeof(long) || type == typeof(short))
        {
            return lower == "year" ? 2026 : lower == "month" ? 10 : 1;
        }

        if (type == typeof(decimal) || type == typeof(double) || type == typeof(float))
        {
            return 1;
        }

        return null;
    }

    /// <summary>The JSON body a type binds from, every field filled (depth-bounded).</summary>
    private static JsonNode? Json(string name, Type type, Variant variant, int depth)
    {
        var underlying = Nullable.GetUnderlyingType(type) ?? type;
        if (IsSimple(underlying) && !underlying.IsArray)
        {
            var value = Scalar(name, underlying, variant);
            return value switch
            {
                null => null,
                _ when underlying.IsEnum => JsonValue.Create(Convert.ToInt32(value, System.Globalization.CultureInfo.InvariantCulture)),
                Guid g => JsonValue.Create(g),
                string s => JsonValue.Create(s),
                bool b => JsonValue.Create(b),
                int i => JsonValue.Create(i),
                _ => JsonValue.Create(Convert.ToDecimal(value, System.Globalization.CultureInfo.InvariantCulture)),
            };
        }

        if (underlying == typeof(JsonElement) || underlying == typeof(JsonDocument) || underlying == typeof(object)
            || underlying == typeof(JsonNode) || underlying == typeof(JsonObject))
        {
            return new JsonObject();
        }

        if (typeof(IDictionary).IsAssignableFrom(underlying)
            || underlying.GetInterfaces().Any(i => i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IDictionary<,>))
            || (underlying.IsGenericType && (underlying.GetGenericTypeDefinition() == typeof(IReadOnlyDictionary<,>)
                || underlying.GetGenericTypeDefinition() == typeof(IDictionary<,>))))
        {
            return new JsonObject();
        }

        var element = underlying.IsArray ? underlying.GetElementType()
            : typeof(IEnumerable).IsAssignableFrom(underlying) && underlying.IsGenericType ? underlying.GetGenericArguments()[0]
            : null;
        if (element is not null)
        {
            var array = new JsonArray();
            if (depth < 3 && Json(Singular(name), element, variant, depth + 1) is { } item)
            {
                array.Add(item);
            }

            return array;
        }

        var obj = new JsonObject();
        if (depth >= 4)
        {
            return obj;
        }

        foreach (var property in underlying.GetProperties(BindingFlags.Public | BindingFlags.Instance).Where(p => p.GetIndexParameters().Length == 0))
        {
            var key = JsonNamingPolicy.CamelCase.ConvertName(property.Name);
            obj[key] = Json(property.Name, property.PropertyType, variant, depth + 1);
        }

        return obj;
    }

    private static string Singular(string name) => name.EndsWith('s') ? name[..^1] : name;

    /// <summary>The resource a route id names: the path segment just before it ("/job-cards/{id}" → "job-cards").</summary>
    private static string? ResourceBefore(string template, int index)
    {
        var before = template[..index].TrimEnd('/');
        var slash = before.LastIndexOf('/');
        return slash < 0 ? null : before[(slash + 1)..];
    }

    private static Guid GuidFor(string name, Variant variant, string? resource)
    {
        var lower = name.ToLowerInvariant();
        if (lower.Contains("farm", StringComparison.Ordinal) && !lower.Contains("farmer", StringComparison.Ordinal))
        {
            return variant == Variant.AnotherFarm ? FarmB : FarmA;
        }

        if (variant != Variant.RealRecords)
        {
            return Guid.NewGuid();
        }

        if (lower == "id" && resource is not null)
        {
            return resource switch
            {
                "job-cards" => JobCard,
                "test-instances" => TestRecord,
                "planned-activities" => Planned,
                "logs" => OwnerLog,
                "attachments" => FarmPhoto,
                "cost-entry" => Cost,
                "assignments" => OwnerCrew,
                "field-operators" => FieldOperator,
                _ => Guid.NewGuid(),
            };
        }

        return lower switch
        {
            "plotid" => PlotA,
            "cycleid" or "cropcycleid" => CycleA,
            "dailylogid" or "logid" or "sourcelogid" => OwnerLog,
            "costentryid" => Cost,
            "jobcardid" => JobCard,
            "testinstanceid" => TestRecord,
            "plannedactivityid" => Planned,
            "attachmentid" => FarmPhoto,
            "fieldoperatorid" => FieldOperator,
            "dayledgerid" => Ledger,
            "labourassignmentid" or "assignmentid" => OwnerCrew,
            _ when lower.Contains("userid", StringComparison.Ordinal) => Worker,
            _ => Guid.NewGuid(),
        };
    }

    // ── The answer ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The status the production host answers. An exception escaping the pipeline is what the production exception handler
    /// (GlobalExceptionHandler → ProblemDetailsFactory) turns into a status: 403 for UnauthorizedAccessException, the
    /// AppException's own, and 500 for everything else — so it is classified by that same rule here, and its message kept.
    /// </summary>
    private async Task<(int Status, string Detail)> AskAsync(string method, string url, Guid user, object? body)
    {
        try
        {
            using var response = await SendAsync(new HttpMethod(method), url, user, body);
            var text = await response.Content.ReadAsStringAsync();
            var status = (int)response.StatusCode;
            return (status, status >= 400 && status != 404 ? "body: " + Trim(text) : string.Empty);
        }
        catch (Exception ex)
        {
            var root = ex;
            while (root is AggregateException { InnerException: { } inner })
            {
                root = inner;
            }

            var status = root switch
            {
                UnauthorizedAccessException => 403,
                AppException app => app.StatusCode,
                _ => 500,
            };
            return (status, $"{root.GetType().Name}: {Trim(root.Message)}{(root.InnerException is { } i ? $" <- {i.GetType().Name}: {Trim(i.Message)}" : string.Empty)}");
        }
    }

    private static string Trim(string text)
    {
        var line = text.ReplaceLineEndings(" ");
        return line.Length > 300 ? line[..300] : line;
    }
}
