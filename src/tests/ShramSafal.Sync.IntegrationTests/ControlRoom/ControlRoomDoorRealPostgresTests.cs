// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, AM1)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomDoor;
using ShramSafal.Domain.ControlRoom;
using ShramSafal.Infrastructure;
using ShramSafal.Sync.IntegrationTests.Analytics;
using User.Application.Ports;
using User.Application.Ports.External;
using User.Application.UseCases.Auth;
using User.Application.UseCases.Auth.StartOtp;
using User.Domain.Security;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.ControlRoom;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, AM1). The door's History rows on a real database, as the
/// application role (doctrine E3: <see cref="AdminCountingRealPostgresHarness.GuardAsync"/> first). A refused try and a
/// code that could not be sent keep the LAST FOUR digits of the number and nothing else about it: no full number and no
/// hash of it of any kind (an unsalted hash prefix plus the last four recovers the whole number in under a second, and
/// History can never be erased). Made-up GUIDs and obviously fake numbers only.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ControlRoomDoorRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private const string UnknownTen = "9000000417";
    private const string ListedTen = "9000000418";
    private static readonly Guid Founder = Guid.Parse("00000000-0000-0000-0000-00000c3a6d01");
    private static readonly Guid ListedPerson = Guid.Parse("c3a60000-0000-0000-0000-000000000418");

    protected override string ScratchPrefix => "ssf_cr3_door";

    protected override Task SeedAsync(NpgsqlConnection superuser) =>
        ExecAsync(superuser, """
            INSERT INTO ssf.control_room_people
                (id, phone_e164, display_name, starting_role, is_active, added_by_user_id, added_at_utc, changed_at_utc)
            VALUES (@id, @phone, 'Example: Asha', 'viewer', true, @by, NOW(), NOW());
            """,
            ("id", ListedPerson), ("phone", "+91" + ListedTen), ("by", Founder));

    // ── a refused try ────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_refused_try_is_written_as_the_door_sentinel_with_only_the_last_four_digits()
    {
        await GuardAsync();

        var row = await RefuseAsync(UnknownTen);

        row.Action.Should().Be(ControlRoomHistoryAction.DoorRefused);
        row.EntityType.Should().Be(ControlRoomHistoryAction.EntityType);
        row.ActorUserId.Should().Be(SystemActor.ControlRoomDoor);
        row.EntityId.Should().Be(SystemActor.ControlRoomDoor, "no person matched: the subject is the door itself");
        row.FarmId.Should().BeNull();
        PayloadKeys(row.Payload).Should().Equal("step", "phoneTail", "reason");
        using (var payload = JsonDocument.Parse(row.Payload))
        {
            payload.RootElement.GetProperty("step").GetString().Should().Be("send");
            payload.RootElement.GetProperty("phoneTail").GetString().Should().Be("0417");
            payload.RootElement.GetProperty("reason").GetString().Should().Be("not_listed");
        }

        AssertNoFullNumber(row, UnknownTen);
    }

    [SkippableFact]
    public async Task A_refused_try_row_holds_no_hash_of_the_number()
    {
        await GuardAsync();

        var row = await RefuseAsync(UnknownTen);

        AssertNoHashOfTheNumber(row, UnknownTen);
    }

    // ── a code that could not be sent ────────────────────────────────────────

    [SkippableFact]
    public async Task A_code_not_sent_row_keeps_only_the_last_four_digits()
    {
        await GuardAsync();

        var row = await NotSentAsync(ListedTen);

        row.Action.Should().Be(ControlRoomHistoryAction.CodeNotSent);
        row.ActorUserId.Should().Be(SystemActor.ControlRoomDoor);
        row.EntityId.Should().Be(ListedPerson, "the approved person the code was for");
        PayloadKeys(row.Payload).Should().Equal("phoneTail", "reason");
        using (var payload = JsonDocument.Parse(row.Payload))
        {
            payload.RootElement.GetProperty("phoneTail").GetString().Should().Be("0418");
            payload.RootElement.GetProperty("reason").GetString().Should().Be("msg91.http_error");
        }

        AssertNoFullNumber(row, ListedTen);
    }

    [SkippableFact]
    public async Task A_code_not_sent_row_holds_no_hash_of_the_number()
    {
        await GuardAsync();

        var row = await NotSentAsync(ListedTen);

        AssertNoHashOfTheNumber(row, ListedTen);
    }

    // ── assertions ───────────────────────────────────────────────────────────

    private static void AssertNoFullNumber(HistoryRow row, string tenDigits)
    {
        var text = row.AllColumns;
        text.Should().NotContain(tenDigits, "no full number anywhere in the row");
        text.Should().NotContain(tenDigits[..6], "not even the first six digits");
        Regex.IsMatch(row.Payload, @"\d{5,}").Should().BeFalse("the payload holds no run of five or more digits");
    }

    private static void AssertNoHashOfTheNumber(HistoryRow row, string tenDigits)
    {
        Regex.IsMatch(row.Payload, "[0-9a-fA-F]{12,}").Should().BeFalse("no run of 12 or more hexadecimal characters in the payload");

        var text = row.AllColumns.ToLowerInvariant();
        foreach (var form in new[] { tenDigits, "91" + tenDigits, "+91" + tenDigits })
        {
            var hex = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(form))).ToLowerInvariant();
            for (var length = 8; length <= hex.Length; length++)
            {
                text.Should().NotContain(hex[..length], $"no prefix ({length} characters) of the SHA-256 of '{form[^4..]}' form");
            }
        }
    }

    private static IReadOnlyList<string> PayloadKeys(string payload)
    {
        using var doc = JsonDocument.Parse(payload);
        return doc.RootElement.EnumerateObject().Select(p => p.Name).ToList();
    }

    // ── the two writers ──────────────────────────────────────────────────────

    /// <summary>The door decides an unknown number and records the refusal, in a request scope as the skip-list makes it.</summary>
    private async Task<HistoryRow> RefuseAsync(string tenDigits)
    {
        await using var provider = BuildDoorProvider(failSms: false);
        await using (var scope = AdminScope(provider))
        {
            var door = scope.ServiceProvider.GetRequiredService<ControlRoomDoor>();
            var decision = await door.DecideAsync(tenDigits, CancellationToken.None);
            decision.Outcome.Should().Be(DoorOutcome.NotApproved);
            await door.RecordRefusedAsync(decision, "send", "Example-device", "sha256:Example-ip", CancellationToken.None);
        }

        return await TheOnlyRowAsync();
    }

    /// <summary>The background sender's failure path: a provider refusal lands as a <c>code_not_sent</c> row.</summary>
    private async Task<HistoryRow> NotSentAsync(string tenDigits)
    {
        await using var provider = BuildDoorProvider(failSms: true);
        var sender = new ControlRoomCodeSender(
            new ControlRoomCodeQueue(), provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ControlRoomCodeSender>.Instance);
        await sender.SendOneAsync(
            new ControlRoomCodeRequest(tenDigits, tenDigits[^4..], "Example-device", "sha256:Example-ip", DateTime.UtcNow),
            CancellationToken.None);

        return await TheOnlyRowAsync();
    }

    private async Task<HistoryRow> TheOnlyRowAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT to_jsonb(a)::text, entity_type, entity_id, action, actor_user_id, farm_id, payload::text
            FROM ssf.audit_events a WHERE entity_type = 'control_room';
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("exactly one History row was written");
        var row = new HistoryRow(
            AllColumns: reader.GetString(0),
            EntityType: reader.GetString(1),
            EntityId: reader.GetGuid(2),
            Action: reader.GetString(3),
            ActorUserId: reader.GetGuid(4),
            FarmId: reader.IsDBNull(5) ? null : reader.GetGuid(5),
            Payload: reader.GetString(6));
        (await reader.ReadAsync()).Should().BeFalse("exactly one History row was written");
        return row;
    }

    private sealed record HistoryRow(string AllColumns, string EntityType, Guid EntityId, string Action, Guid ActorUserId, Guid? FarmId, string Payload);

    /// <summary>
    /// The production shape of the ShramSafal services (as <c>BuildProvider</c>), plus the door, a phone directory that
    /// knows no account (the number is nobody's in the User module), and the User handler the sender runs, over a
    /// refusing SMS stand-in. Nothing is ever texted.
    /// </summary>
    private ServiceProvider BuildDoorProvider(bool failSms)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = AppConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = SuperuserConn,
            ["ConnectionStrings:UserDb"] = AppConn,
        }).Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddDbContext<AnalyticsDbContext>(o => o.UseNpgsql(AppConn));
        services.AddSingleton<IClock, SystemClock>();
        services.AddSingleton<IControlRoomPhoneDirectory, NoAccounts>();
        services.AddScoped<ControlRoomDoor>();

        services.AddSingleton<IOtpChallengeRepository, NoCodes>();
        services.AddSingleton<ISmsSender>(new RefusingSms(failSms));
        services.AddSingleton<IPasswordHasher, PlainHasher>();
        services.AddSingleton(Options.Create(new OtpPolicyOptions()));
        services.AddSingleton<IAnalyticsWriter, NoAnalytics>();
        services.AddTransient<StartOtpHandler>();
        return services.BuildServiceProvider();
    }

    private sealed class NoAccounts : IControlRoomPhoneDirectory
    {
        public Task<ControlRoomAccount?> FindByPhoneAsync(string tenDigits, CancellationToken ct) => Task.FromResult<ControlRoomAccount?>(null);
        public Task<ControlRoomAccount?> FindByUserAsync(Guid userId, CancellationToken ct) => Task.FromResult<ControlRoomAccount?>(null);
    }

    private sealed class NoCodes : IOtpChallengeRepository
    {
        public Task AddAsync(OtpChallenge challenge, CancellationToken ct = default) => throw new InvalidOperationException("No code is stored in this test.");
        public Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, OtpPurpose purpose, CancellationToken ct = default) => Task.FromResult<OtpChallenge?>(null);
        public Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, OtpPurpose purpose, DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(0);
        public Task<bool> TryCountAttemptAsync(OtpChallenge challenge, DateTime utcNow, CancellationToken ct = default) => throw new InvalidOperationException("No code is checked in this test.");
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class RefusingSms(bool fail) : ISmsSender
    {
        public Task<Result<SmsDispatchReceipt>> SendOtpAsync(string phoneNumberInternational, string otpCode, CancellationToken cancellationToken = default) =>
            fail
                ? Task.FromResult(Result.Failure<SmsDispatchReceipt>(Error.Internal("msg91.http_error", "MSG91 returned HTTP 503.")))
                : throw new InvalidOperationException("Nothing is sent in this test.");

        public Task<Result<SmsDispatchReceipt>> SendCodeWithTemplateAsync(string phoneNumberInternational, string code, string templateId, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("Nothing is sent in this test.");
    }

    private sealed class PlainHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "h:" + plainText;
        public bool Verify(string plainText, string hash) => hash == "h:" + plainText;
    }

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
