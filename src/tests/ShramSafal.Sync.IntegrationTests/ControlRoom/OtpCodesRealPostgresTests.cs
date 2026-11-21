// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-A1, S-A2)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Sync.IntegrationTests.Analytics;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Domain.Security;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.ControlRoom;

/// <summary>
/// spec: trusted-control-room-2026-11-20 (CR-3 fix wave). The one code table, <c>public.otp_challenges</c>, on a real
/// database, through the REAL code repository (the User module's own composition):
/// <list type="bullet">
/// <item>S-A1: migration <c>AddOtpChallengePurpose</c> applies over rows written before it, and those rows (and a row an
/// older binary writes after it) read as farmer-app codes; the farmer app and the door each see only their own codes.</item>
/// <item>S-A2: a burst of parallel wrong guesses on one code never checks more than its maximum, and the code is locked
/// afterwards (the attempt is counted in one conditional statement before any guess is checked).</item>
/// </list>
/// The parallel guesses run as the application role (doctrine E3: <see cref="AdminCountingRealPostgresHarness.GuardAsync"/>
/// first). Made-up numbers only; nothing is ever texted.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OtpCodesRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private const string BeforePurpose = "20261107061500_AddNewPhoneQuestion";
    private const string FarmerTen = "9000000611";
    private const string RacedTen = "9000000612";

    protected override string ScratchPrefix => "ssf_cr3_otp";

    protected override Task SeedAsync(NpgsqlConnection superuser) =>
        // Production parity: the app role writes its own code table (public tables are provisioned outside the
        // migration chain; the harness grants SELECT only).
        ExecAsync(superuser, $"GRANT SELECT, INSERT, UPDATE ON public.otp_challenges TO {IntegrationPostgres.AppRoleUser};");

    // ── S-A1: the migration and old rows ───────────────────────────────────

    [SkippableFact]
    public async Task The_purpose_migration_applies_over_old_rows_and_they_read_as_farmer_codes()
    {
        await GuardAsync();

        var name = $"ssf_cr3_otpmig_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(AdminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{name}\"");
        }

        var conn = new NpgsqlConnectionStringBuilder(SuperuserConn) { Database = name }.ConnectionString;
        try
        {
            var options = new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(conn).Options;
            await using (var before = new UserDbContext(options))
            {
                await before.Database.GetService<IMigrator>().MigrateAsync(BeforePurpose);
            }

            var oldRow = Guid.NewGuid();
            await using (var db = new NpgsqlConnection(conn))
            {
                await db.OpenAsync();
                await ExecAsync(db, """
                    INSERT INTO public.otp_challenges ("Id", phone_number_normalized, otp_hash, created_at_utc, expires_at_utc, max_attempts, attempt_count, status)
                    VALUES (@id, @phone, 'example-not-a-hash', NOW(), NOW() + INTERVAL '5 minutes', 5, 0, 1);
                    """, ("id", oldRow), ("phone", FarmerTen));
            }

            await using (var after = new UserDbContext(options))
            {
                await after.Database.MigrateAsync();
            }

            // An older binary keeps inserting without the column: its row is a farmer code too (the constant default).
            var olderBinaryRow = Guid.NewGuid();
            await using (var db = new NpgsqlConnection(conn))
            {
                await db.OpenAsync();
                await ExecAsync(db, """
                    INSERT INTO public.otp_challenges ("Id", phone_number_normalized, otp_hash, created_at_utc, expires_at_utc, max_attempts, attempt_count, status)
                    VALUES (@id, '9000000613', 'example-not-a-hash', NOW(), NOW() + INTERVAL '5 minutes', 5, 0, 1);
                    """, ("id", olderBinaryRow));

                await using var cmd = db.CreateCommand();
                cmd.CommandText = "SELECT purpose FROM public.otp_challenges WHERE \"Id\" = ANY(@ids)";
                cmd.Parameters.AddWithValue("ids", new[] { oldRow, olderBinaryRow });
                var purposes = new List<short>();
                await using (var r = await cmd.ExecuteReaderAsync())
                {
                    while (await r.ReadAsync()) purposes.Add(r.GetInt16(0));
                }

                purposes.Should().Equal((short)1, (short)1);
            }

            await using (var users = BuildUserProvider(conn))
            await using (var scope = UserScope(users))
            {
                var codes = scope.ServiceProvider.GetRequiredService<IOtpChallengeRepository>();
                var farmer = await codes.GetPendingByPhoneAsync(FarmerTen, OtpPurpose.FarmerApp);
                farmer.Should().NotBeNull("a row written before the migration is a farmer-app code");
                farmer!.Id.Should().Be(oldRow);
                farmer.Purpose.Should().Be(OtpPurpose.FarmerApp);
                (await codes.GetPendingByPhoneAsync(FarmerTen, OtpPurpose.ControlRoomDoor)).Should().BeNull("the door never sees it");

                // One pending code per number PER DOOR: a door code for the same number can now be pending beside it.
                await codes.AddAsync(OtpChallenge.Issue(Guid.NewGuid(), FarmerTen, "example-not-a-hash", DateTime.UtcNow, TimeSpan.FromMinutes(5), 5, OtpPurpose.ControlRoomDoor));
                await codes.SaveChangesAsync();
                (await codes.GetPendingByPhoneAsync(FarmerTen, OtpPurpose.ControlRoomDoor)).Should().NotBeNull();
                (await codes.CountIssuedSinceAsync(FarmerTen, OtpPurpose.FarmerApp, DateTime.UtcNow.AddHours(-1))).Should().Be(1, "each door counts only its own codes");
            }

            // The column holds one of the two known values.
            await using (var db = new NpgsqlConnection(conn))
            {
                await db.OpenAsync();
                var act = async () => await ExecAsync(db, """
                    INSERT INTO public.otp_challenges ("Id", phone_number_normalized, otp_hash, created_at_utc, expires_at_utc, max_attempts, attempt_count, status, purpose)
                    VALUES (@id, '9000000614', 'example-not-a-hash', NOW(), NOW() + INTERVAL '5 minutes', 5, 0, 1, 3);
                    """, ("id", Guid.NewGuid()));
                (await act.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("23514");
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var admin = new NpgsqlConnection(AdminConn);
            await admin.OpenAsync();
            await ExecAsync(admin, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", ("db", name));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{name}\"");
        }
    }

    // ── S-A2: the attempt counter cannot be raced ──────────────────────────

    [SkippableFact]
    public async Task Parallel_wrong_guesses_never_check_more_than_the_maximum_and_the_code_ends_locked()
    {
        await GuardAsync();

        const int maxAttempts = 5;
        const int guesses = 24;
        await using var users = BuildUserProvider(AppConn);
        var codeId = Guid.NewGuid();
        await using (var scope = UserScope(users))
        {
            var codes = scope.ServiceProvider.GetRequiredService<IOtpChallengeRepository>();
            await codes.AddAsync(OtpChallenge.Issue(codeId, RacedTen, CountingHasher.Of("123456"), DateTime.UtcNow, TimeSpan.FromMinutes(5), maxAttempts));
            await codes.SaveChangesAsync();
        }

        var hasher = new CountingHasher();
        using var start = new ManualResetEventSlim(false);
        var burst = Enumerable.Range(0, guesses).Select(i => Task.Run(async () =>
        {
            start.Wait();
            await using var scope = UserScope(users);
            var handler = new VerifyOtpHandler(
                scope.ServiceProvider.GetRequiredService<IOtpChallengeRepository>(),
                new NoAccounts(), new NoSessions(), hasher, new NoTokens(), new GuidIds(), new SystemClock(),
                NullLogger<VerifyOtpHandler>.Instance, new NoAnalytics());
            var wrong = (900000 + i).ToString(System.Globalization.CultureInfo.InvariantCulture);
            var result = await handler.HandleAsync(new VerifyOtpCommand(
                RacedTen, wrong, null, new DeviceSessionRequest("phone-race", false, null, "android")));
            return result.IsSuccess ? "success" : result.Error.Code;
        })).ToList();
        start.Set();
        var answers = await Task.WhenAll(burst);

        Output.WriteLine($"[EVIDENCE] {guesses} parallel wrong guesses: checked={hasher.Checks} answers={string.Join(",", answers.GroupBy(a => a).Select(g => $"{g.Key}x{g.Count()}"))}");
        hasher.Checks.Should().Be(maxAttempts, "no more guesses are ever checked than the code allows, whatever the burst");
        answers.Should().NotContain("success");

        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT attempt_count, status FROM public.otp_challenges WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", codeId);
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue();
        r.GetInt32(0).Should().Be(maxAttempts, "the stored count never passes the maximum");
        r.GetInt32(1).Should().Be((int)OtpChallengeStatus.LockedOut, "the code is locked afterwards");
    }

    // ── harness ────────────────────────────────────────────────────────────

    /// <summary>The User module as the host composes it (its own context and repositories) on <paramref name="connection"/>.</summary>
    private static ServiceProvider BuildUserProvider(string connection)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:UserDb"] = connection,
        }).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        global::User.Infrastructure.DependencyInjection.AddUserInfrastructure(services, config);
        return services.BuildServiceProvider();
    }

    /// <summary>A scope as the anonymous sign-in routes run (the tenant interceptor refuses an unscoped command).</summary>
    private static AsyncServiceScope UserScope(ServiceProvider users)
    {
        var scope = users.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }

    /// <summary>Counts every guess that is actually checked against the stored code.</summary>
    private sealed class CountingHasher : IPasswordHasher
    {
        private int _checks;

        public int Checks => Volatile.Read(ref _checks);

        public static string Of(string code) => "h:" + code;

        public string Hash(string plainText) => Of(plainText);

        public bool Verify(string plainText, string hash)
        {
            Interlocked.Increment(ref _checks);
            return hash == Of(plainText);
        }
    }

    private sealed class NoAccounts : IUserRepository
    {
        public Task<global::User.Domain.Identity.User?> GetByIdAsync(Guid id, CancellationToken ct = default) => throw new InvalidOperationException("A wrong guess never reaches the account.");
        public Task<global::User.Domain.Identity.User?> GetByPhoneAsync(string phone, CancellationToken ct = default) => throw new InvalidOperationException("A wrong guess never reaches the account.");
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => throw new InvalidOperationException("A wrong guess never reaches the account.");
        public Task AddAsync(global::User.Domain.Identity.User user, CancellationToken ct = default) => throw new InvalidOperationException("A wrong guess never makes an account.");
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NoSessions : IRefreshTokenRepository
    {
        public Task<global::User.Domain.Security.RefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) => throw new InvalidOperationException("No session in this test.");
        public Task AddAsync(global::User.Domain.Security.RefreshToken refreshToken, CancellationToken ct = default) => throw new InvalidOperationException("No session in this test.");
        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => throw new InvalidOperationException("No session in this test.");
        public Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => throw new InvalidOperationException("No session in this test.");
        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => throw new InvalidOperationException("No session in this test.");
        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) => throw new InvalidOperationException("No session in this test.");
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NoTokens : IJwtTokenService
    {
        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending, bool controlRoomDoor = false) =>
            throw new InvalidOperationException("A wrong guess never gets a token.");

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending, bool controlRoomDoor = false) =>
            throw new InvalidOperationException("A wrong guess never gets a token.");
    }

    private sealed class GuidIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
