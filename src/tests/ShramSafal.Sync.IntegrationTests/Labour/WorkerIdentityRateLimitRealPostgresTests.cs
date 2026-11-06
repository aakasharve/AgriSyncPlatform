// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID fix pass 1 (review M2, L1) and fix pass 2 (N4). The identity lookups and
// code sends (scan-resolve, the number check, link/start, send-code) carry the per-user request limit, so none of them
// can be looped to list cards or verified numbers, or to make ShramSafal's SMS header spam numbers. This host registers
// the limiter through the SAME RateLimitingConfig.AddAgriSyncRateLimiting Program.cs calls.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Composition;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api.Endpoints;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Labour;

[Trait("Category", "RequiresPostgres")]
public sealed class WorkerIdentityRateLimitRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    protected override void AddHostServices(IServiceCollection services) => services.AddAgriSyncRateLimiting(e2eHarnessEnabled: false);

    protected override void MapHostRoutes(WebApplication app) => app.UseRateLimiter();

    [Fact]
    public async Task The_identity_lookups_and_code_sends_carry_the_per_user_limit_by_its_shared_name()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var endpoints = HostServices.GetRequiredService<EndpointDataSource>().Endpoints;
        // Fix pass 2 (N4): the link itself and the phone verify too.
        foreach (var name in new[]
                 {
                     "ResolveWorkerCard", "CheckWorkerPhone", "StartWorkerLink", "SendWorkerPhoneCode", "LinkWorkerIdentity",
                     "VerifyWorkerPhone",
                 })
        {
            var endpoint = endpoints.Single(e => e.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName == name);
            var limit = endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>();
            limit.Should().NotBeNull($"{name} must carry the request limit");
            limit!.PolicyName.Should().Be(WorkerIdentityEndpoints.IdentityRateLimitPolicy);
        }
    }

    [Fact]
    public async Task The_31st_lookup_in_the_window_is_refused_and_other_people_are_unaffected()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var url = $"/shramsafal/farms/{FarmA}/labour/identity/resolve";
        for (var i = 0; i < RateLimitingConfig.IdentityPermitLimit; i++)
        {
            using var tryN = await SendAsync(HttpMethod.Post, url, Owner, new { code = "SS-ZZZZ-ZZZZ" });
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"lookup {i + 1} is within the limit");
        }

        using (var refused = await SendAsync(HttpMethod.Post, url, Owner, new { code = "SS-ZZZZ-ZZZZ" }))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "a person cannot loop card codes");
        }

        using var other = await SendAsync(HttpMethod.Post, url, Mukadam, new { code = "SS-ZZZZ-ZZZZ" });
        other.StatusCode.Should().Be(HttpStatusCode.NotFound, "the limit is per signed-in person");
    }

    /// <summary>Fix pass 2 (N4) — typing card codes straight into the link (which looks the card up itself) is limited too.</summary>
    [Fact]
    public async Task The_31st_link_try_in_the_window_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var url = $"/shramsafal/farms/{FarmA}/labour/identity/link";
        for (var i = 0; i < RateLimitingConfig.IdentityPermitLimit; i++)
        {
            using var tryN = await SendAsync(HttpMethod.Post, url, Owner, new { cardCode = "SS-ZZZZ-ZZZZ", id = Guid.NewGuid() });
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"link try {i + 1} is within the limit");
        }

        using var refused = await SendAsync(HttpMethod.Post, url, Owner, new { cardCode = "SS-ZZZZ-ZZZZ", id = Guid.NewGuid() });
        refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "a person cannot loop card codes through the link");
    }

    /// <summary>Fix pass 2 (N4) — and the phone verify (a code read back) is limited per person as well.</summary>
    [Fact]
    public async Task The_31st_verify_try_in_the_window_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var url = $"/shramsafal/farms/{FarmA}/labour/field-operators/{FieldOperator}/phone/verify";
        for (var i = 0; i < RateLimitingConfig.IdentityPermitLimit; i++)
        {
            using var tryN = await SendAsync(HttpMethod.Post, url, Owner, new { ticket = Guid.NewGuid(), code = "1234" });
            tryN.StatusCode.Should().NotBe(HttpStatusCode.TooManyRequests, $"verify try {i + 1} is within the limit");
        }

        using var refused = await SendAsync(HttpMethod.Post, url, Owner, new { ticket = Guid.NewGuid(), code = "1234" });
        refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests, "a person cannot loop codes at the verify");
    }
}
