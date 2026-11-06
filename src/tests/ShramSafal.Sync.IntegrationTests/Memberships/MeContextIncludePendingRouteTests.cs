// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, P11)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using User.Api;
using User.Application.Ports;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainUser = global::User.Domain.Identity.User;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, P11) — the <c>includePending</c> contract of
/// <c>GET /user/auth/me/context</c> at the ROUTE: the real <c>MapUserApi</c> endpoint and the real
/// <c>GetMeContextHandler</c>, so the query-string binding (not just the handler flag) is what is
/// proven. The three snapshot readers and the user lookup are fixed fakes — what they would read
/// from Postgres is not under test here (the seat statuses they return are the input), and the
/// handler's per-seat rules are pinned by <c>GetMeContextSeatStatusTests</c>.
///
/// <para>The installed 1.0.16 APK calls this route with no <c>includePending</c> and ignores
/// <c>status</c>: it must get Active seats only — a person whose only seat is a waiting request
/// sees the 0-farm screen, as before. This release's phone always sends
/// <c>includePending=true</c> and gets the request too, with its status and nothing of the farm.</para>
/// </summary>
public sealed class MeContextIncludePendingRouteTests : IAsyncLifetime
{
    private static readonly Guid Caller = Guid.Parse("e1e30001-0000-0000-0000-0000000000a1");
    private static readonly Guid WaitingFarm = Guid.Parse("e1e30001-0000-0000-0000-0000000000f1");
    private static readonly Guid ActiveFarm = Guid.Parse("e1e30001-0000-0000-0000-0000000000f2");

    private WebApplication? _app;
    private HttpClient _client = default!;
    private readonly FixedMemberships _memberships = new();
    private readonly FixedInvitations _invitations = new();

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Never opened: every reader the route uses is replaced below.
            ["ConnectionStrings:UserDb"] = "Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused",
            ["Jwt:SigningKey"] = "test-signing-key-for-route-binding-only-0123456789",
            ["Jwt:AccessTokenMinutes"] = "15",
        });

        // The REAL User module registration and route...
        builder.Services.AddUserApi(builder.Configuration);
        // ...with the test identity (X-Test-UserId) as the default scheme instead of a JWT...
        builder.Services
            .AddAuthentication(o =>
            {
                o.DefaultScheme = "Test";
                o.DefaultAuthenticateScheme = "Test";
                o.DefaultChallengeScheme = "Test";
            })
            .AddScheme<AuthenticationSchemeOptions, JoinByCodeTestAuthHandler>("Test", _ => { });
        // ...and fixed inputs for what the handler reads.
        var user = DomainUser.RegisterViaOtp(
            new UserId(Caller), DomainPhone.Create("8888888888"), "Test User", "unusable", DateTime.UtcNow);
        builder.Services.AddScoped<IUserRepository>(_ => new SingleUserRepository(user));
        builder.Services.AddScoped<IAccountsSnapshotReader, NoAccounts>();
        builder.Services.AddScoped<IAffiliationSnapshotReader, NoAffiliation>();
        builder.Services.AddSingleton<IFarmMembershipSnapshotReader>(_memberships);
        builder.Services.AddSingleton<IMeInvitationSnapshotReader>(_invitations);
        builder.Services.AddSingleton<IClock, SystemClockFake>();

        _app = builder.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.MapUserApi();
        await _app.StartAsync();
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }

    [Theory]
    [InlineData("/user/auth/me/context")]
    [InlineData("/user/auth/me/context?includePending=false")]
    public async Task Without_includePending_an_old_app_gets_Active_seats_only(string url)
    {
        _memberships.Seats = new[] { Seat(WaitingFarm, "PendingApproval"), Seat(ActiveFarm, "Active") };
        (await FarmIdsAsync(url)).Should().Equal(new[] { ActiveFarm },
            "an older app ignores status and would show a waiting request as a farm it can open");

        _memberships.Seats = new[] { Seat(WaitingFarm, "PendingApproval") };
        using var doc = await GetJsonAsync(url);
        doc.RootElement.GetProperty("farms").GetArrayLength().Should().Be(0, "the old app's 0-farm screen, as before");
        doc.RootElement.GetProperty("alerts").EnumerateArray()
            .Select(a => a.GetProperty("kind").GetString())
            .Should().Contain("no_farms_yet");
    }

    [Fact]
    public async Task With_includePending_true_the_request_is_listed_with_its_status_and_nothing_of_the_farm()
    {
        _memberships.Seats = new[] { Seat(WaitingFarm, "PendingApproval"), Seat(ActiveFarm, "Active") };

        using var doc = await GetJsonAsync("/user/auth/me/context?includePending=true");
        var farms = doc.RootElement.GetProperty("farms").EnumerateArray().ToList();
        farms.Select(f => f.GetProperty("farmId").GetGuid()).Should().BeEquivalentTo(new[] { WaitingFarm, ActiveFarm });

        var waiting = farms.Single(f => f.GetProperty("farmId").GetGuid() == WaitingFarm);
        waiting.GetProperty("status").GetString().Should().Be("PendingApproval");
        waiting.GetProperty("farmCode").ValueKind.Should().Be(JsonValueKind.Null, "no code for a person not let in");
        waiting.GetProperty("plan").GetString().Should().Be("Free", "the 'nothing known' plan, never the owner's");
        waiting.GetProperty("capabilities").EnumerateObject().Select(p => p.Value.GetBoolean())
            .Should().OnlyContain(v => v == false, "no permissions on a farm he has not been let into");

        // CONTROL: the Active seat keeps its code.
        farms.Single(f => f.GetProperty("farmId").GetGuid() == ActiveFarm)
            .GetProperty("farmCode").GetString().Should().Be("K7M2QP");
    }

    // spec: plr-d10 lane MU-2 (MU design §6) — the person's waiting invitations ride /me/context for this release's phone,
    // beside the farms and never among them (visible ≠ operational); an older app's body is unchanged.
    [Fact]
    public async Task With_includePending_the_waiting_invitations_are_listed_apart_from_the_farms()
    {
        var invitation = Guid.Parse("e1e30001-0000-0000-0000-0000000000d1");
        _memberships.Seats = new[] { Seat(ActiveFarm, "Active") };
        _invitations.Waiting = new[]
        {
            new MeInvitationSnapshot(invitation, "पाटील फार्म", "Ramrao", "Family", "रमेश", "ChosenPlots", new[] { "प्लॉट 1" },
                new[] { new MeAuthoritySnapshot("TakeAttendance", null) }, DateTime.UtcNow.AddDays(6), NamesAWorker: false),
        };

        using var doc = await GetJsonAsync("/user/auth/me/context?includePending=true");
        doc.RootElement.GetProperty("farms").EnumerateArray().Select(f => f.GetProperty("farmId").GetGuid())
            .Should().Equal(new[] { ActiveFarm }, "an invitation is never a farm");
        var card = doc.RootElement.GetProperty("invitations").EnumerateArray().Single();
        card.GetProperty("invitationId").GetGuid().Should().Be(invitation);
        card.GetProperty("label").GetString().Should().Be("Family");
        card.GetProperty("plotNames").EnumerateArray().Select(p => p.GetString()).Should().Equal("प्लॉट 1");
        card.TryGetProperty("code", out _).Should().BeFalse();

        using var old = await GetJsonAsync("/user/auth/me/context");
        old.RootElement.TryGetProperty("invitations", out var none).Should().BeTrue();
        none.ValueKind.Should().Be(JsonValueKind.Null, "an older app's request reads nothing new");
    }

    private async Task<List<Guid>> FarmIdsAsync(string url)
    {
        using var doc = await GetJsonAsync(url);
        return doc.RootElement.GetProperty("farms").EnumerateArray().Select(f => f.GetProperty("farmId").GetGuid()).ToList();
    }

    private async Task<JsonDocument> GetJsonAsync(string url)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Test-UserId", Caller.ToString());
        using var response = await _client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body);
    }

    private static FarmMembershipSnapshot Seat(Guid farmId, string status) => new(
        FarmId: new FarmId(farmId),
        FarmName: status == "Active" ? "Jadhav Wadi" : "Shinde Mala",
        FarmCode: "K7M2QP",
        OwnerAccountId: new OwnerAccountId(Guid.Parse("e1e30001-0000-0000-0000-0000000000c1")),
        Role: status == "Active" ? "Mukadam" : "Worker",
        Status: status,
        JoinedVia: "SelfJoin",
        GrantedAtUtc: DateTime.UtcNow.AddDays(-1),
        LastSeenAtUtc: null,
        Subscription: new SubscriptionSnapshot("Active", "ShramSafalPro", DateTime.UtcNow.AddDays(30)));

    private sealed class FixedMemberships : IFarmMembershipSnapshotReader
    {
        public IReadOnlyList<FarmMembershipSnapshot> Seats { get; set; } = Array.Empty<FarmMembershipSnapshot>();

        public Task<IReadOnlyList<FarmMembershipSnapshot>> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(Seats);
    }

    private sealed class FixedInvitations : IMeInvitationSnapshotReader
    {
        public IReadOnlyList<MeInvitationSnapshot> Waiting { get; set; } = Array.Empty<MeInvitationSnapshot>();

        public Task<IReadOnlyList<MeInvitationSnapshot>> GetWaitingForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(Waiting);
    }

    private sealed class NoAccounts : IAccountsSnapshotReader
    {
        public Task<AccountsSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(new AccountsSnapshot(Array.Empty<OwnerAccountSnapshot>()));
    }

    private sealed class NoAffiliation : IAffiliationSnapshotReader
    {
        public Task<AffiliationSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default)
            => Task.FromResult(new AffiliationSnapshot(null, 0, 0, 0));
    }

    private sealed class SystemClockFake : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }

    private sealed class SingleUserRepository(DomainUser user) : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
