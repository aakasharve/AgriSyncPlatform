// spec: 2026-08-25-prod-cutover-waves (voice archive consent boundary)
//
// WHEN DID THE CURRENT CONTINUOUS GRANT OF VOICE CLOUD-SAVE START?
//
// The phone cannot know this for itself: if consent is revoked and re-granted
// from ANOTHER device (or while this one is offline / uninstalled) it never sees
// `false`. So GET /consent/me carries `fullHistoryJournalGrantedSinceUtc`,
// computed read-side from the append-only consent_audit ledger.
//
// Real Postgres, connected as the NON-SUPERUSER application role (agrisync_app),
// the real UpdateConsentHandler / GetConsentHandler / ConsentEnforcer. Time is a
// controllable TimeProvider so every transition has its own distinct instant.
//
// Native Postgres (REQUIRES_POSTGRES_ROOT_CONN), self-skipping when the server
// is genuinely absent, loud when it answers and refuses.

using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.Consent.GetConsent;
using ShramSafal.Application.UseCases.Consent.UpdateConsent;
using ShramSafal.Infrastructure;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Consent;

[Trait("Category", "RequiresPostgres")]
public sealed class ConsentGrantWindowRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly Guid UserA = Guid.Parse("c0a00000-0000-0000-0000-000000000001");
    private static readonly Guid UserB = Guid.Parse("c0b00000-0000-0000-0000-000000000002");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _root;
    private readonly SteppedTime _time = new(new DateTimeOffset(2026, 10, 14, 6, 0, 0, TimeSpan.Zero));

    public async Task InitializeAsync()
    {
        var baseConn = IntegrationPostgres.ResolveRootConnection();
        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_consent_window_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = IntegrationPostgres.AppRoleUser,
            Password = IntegrationPostgres.AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<TimeProvider>(_time);
        services.AddSingleton<IClock>(new SteppedClock(_time));
        services.AddScoped<IConsentEnforcer, ShramSafal.Infrastructure.Privacy.ConsentEnforcer>();
        services.AddScoped<UpdateConsentHandler>();
        services.AddScoped<GetConsentHandler>();
        _root = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_root is not null) await _root.DisposeAsync();
        if (_skip || string.IsNullOrEmpty(_scratchDbName)) return;
        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // best-effort teardown
        }
    }

    private void SkipIfPostgresUnavailable()
    {
        if (_skip) output.WriteLine($"[SKIPPED] {_skipReason} - NO DATABASE WAS EXERCISED; this run proves nothing.");
        Skip.If(_skip, _skipReason);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /// <summary>Advance the clock one minute, apply the change, return the instant it happened.</summary>
    private async Task<DateTime> ToggleAsync(
        Guid user, bool? fullHistory = null, bool? crossFarm = null, bool? research = null)
    {
        _time.Advance(TimeSpan.FromMinutes(1));
        var at = _time.GetUtcNow().UtcDateTime;
        await using var scope = Scope();
        var update = scope.ServiceProvider.GetRequiredService<UpdateConsentHandler>();
        var result = await update.HandleAsync(new UpdateConsentCommand(
            UserId: user, FullHistoryJournal: fullHistory, CrossFarmAggregation: crossFarm,
            ResearchCorpusExport: research,
            LanguageShown: "mr-IN", ConsentTextVersion: 1, ClientAppVersion: "test-1.0",
            AuditDeviceId: "test-device", AuditIpHash: "sha256:test"));
        result.IsSuccess.Should().BeTrue();
        return at;
    }

    private async Task<GetConsentResult> GetAsync(Guid user)
    {
        await using var scope = Scope();
        var result = await scope.ServiceProvider.GetRequiredService<GetConsentHandler>().HandleAsync(user);
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private async Task<long> AuditCountAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.consent_audit";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private AsyncServiceScope Scope()
    {
        var scope = _root!.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }

    private static void ShouldBe(DateTime? actual, DateTime expected)
    {
        actual.Should().NotBeNull();
        actual!.Value.Should().BeCloseTo(expected, TimeSpan.FromMilliseconds(5));
    }

    // ── the proofs ───────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Never_granted_has_no_start()
    {
        SkipIfPostgresUnavailable();
        var state = await GetAsync(UserA);
        state.FullHistoryJournal.Should().BeFalse();
        state.FullHistoryJournalGrantedSinceUtc.Should().BeNull();
    }

    [SkippableFact]
    public async Task First_grant_is_the_start()
    {
        SkipIfPostgresUnavailable();
        var t1 = await ToggleAsync(UserA, fullHistory: true);
        var state = await GetAsync(UserA);
        state.FullHistoryJournal.Should().BeTrue();
        ShouldBe(state.FullHistoryJournalGrantedSinceUtc, t1);
    }

    [SkippableFact]
    public async Task Grant_revoke_regrant_moves_the_start_to_the_regrant_and_revoked_has_none()
    {
        SkipIfPostgresUnavailable();
        var t1 = await ToggleAsync(UserA, fullHistory: true);
        await ToggleAsync(UserA, fullHistory: false);

        // Revoked: no current grant, even though grantedAtUtc is still the first-ever grant.
        var revoked = await GetAsync(UserA);
        revoked.FullHistoryJournal.Should().BeFalse();
        revoked.FullHistoryJournalGrantedSinceUtc.Should().BeNull();
        revoked.GrantedAtUtc.Should().NotBeNull("the server's grantedAtUtc is the FIRST grant and is not reset");
        ShouldBe(revoked.GrantedAtUtc, t1);

        _time.Advance(TimeSpan.FromHours(3)); // the gap in which clips must NOT qualify
        var t3 = await ToggleAsync(UserA, fullHistory: true);

        var regranted = await GetAsync(UserA);
        regranted.FullHistoryJournal.Should().BeTrue();
        ShouldBe(regranted.FullHistoryJournalGrantedSinceUtc, t3);
        regranted.FullHistoryJournalGrantedSinceUtc!.Value.Should().BeAfter(t1);
        // The unusable field stays on the first grant: that is why the new field exists.
        ShouldBe(regranted.GrantedAtUtc, t1);
    }

    [SkippableFact]
    public async Task Repeated_toggles_always_report_the_latest_grant()
    {
        SkipIfPostgresUnavailable();
        DateTime last = default;
        for (var i = 0; i < 6; i++)
        {
            last = await ToggleAsync(UserA, fullHistory: true);
            (await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc.Should().NotBeNull();
            ShouldBe((await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc, last);
            await ToggleAsync(UserA, fullHistory: false);
            (await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc.Should().BeNull();
        }

        var final = await ToggleAsync(UserA, fullHistory: true);
        ShouldBe((await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc, final);
        final.Should().BeAfter(last);
    }

    [SkippableFact]
    public async Task Other_purposes_and_idempotent_regrants_do_not_move_the_start()
    {
        SkipIfPostgresUnavailable();
        var t1 = await ToggleAsync(UserA, fullHistory: true);
        await ToggleAsync(UserA, crossFarm: true);
        await ToggleAsync(UserA, research: true);
        await ToggleAsync(UserA, crossFarm: false);
        await ToggleAsync(UserA, fullHistory: true); // true -> true: a ledger row, but no new grant
        await ToggleAsync(UserA, research: false);

        ShouldBe((await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc, t1);
    }

    [SkippableFact]
    public async Task Other_purposes_interleaved_across_a_revoke_still_start_at_the_regrant()
    {
        SkipIfPostgresUnavailable();
        await ToggleAsync(UserA, fullHistory: true, crossFarm: true);
        await ToggleAsync(UserA, fullHistory: false);       // other purpose stays ON
        await ToggleAsync(UserA, crossFarm: false);         // a row while full-history is OFF
        await ToggleAsync(UserA, research: true);           // and another
        var regrant = await ToggleAsync(UserA, fullHistory: true);
        await ToggleAsync(UserA, research: false);

        ShouldBe((await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc, regrant);
    }

    [SkippableFact]
    public async Task Another_users_history_never_leaks_in()
    {
        SkipIfPostgresUnavailable();
        var a1 = await ToggleAsync(UserA, fullHistory: true);
        await ToggleAsync(UserB, fullHistory: true);
        await ToggleAsync(UserB, fullHistory: false);
        var b3 = await ToggleAsync(UserB, fullHistory: true);

        ShouldBe((await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc, a1);
        ShouldBe((await GetAsync(UserB)).FullHistoryJournalGrantedSinceUtc, b3);

        await ToggleAsync(UserB, fullHistory: false);
        ShouldBe((await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc, a1);
        (await GetAsync(UserB)).FullHistoryJournalGrantedSinceUtc.Should().BeNull();
    }

    [SkippableFact]
    public async Task Enforcer_deny_rows_in_the_ledger_do_not_disturb_the_start()
    {
        SkipIfPostgresUnavailable();
        // Denied while OFF writes a ledger row (old == new, full-history OFF).
        await using (var scope = Scope())
        {
            var enforcer = scope.ServiceProvider.GetRequiredService<IConsentEnforcer>();
            (await enforcer.RequireGrantAsync(UserA, ConsentPurpose.FullHistoryJournal, CancellationToken.None))
                .IsAllowed.Should().BeFalse();
            await scope.ServiceProvider
                .GetRequiredService<ShramSafal.Infrastructure.Persistence.ShramSafalDbContext>()
                .SaveChangesAsync();
        }

        _time.Advance(TimeSpan.FromMinutes(1));
        var t = await ToggleAsync(UserA, fullHistory: true);

        // Denied for ANOTHER purpose while full-history is ON: a row with full-history ON.
        await using (var scope = Scope())
        {
            var enforcer = scope.ServiceProvider.GetRequiredService<IConsentEnforcer>();
            _time.Advance(TimeSpan.FromMinutes(1));
            (await enforcer.RequireGrantAsync(UserA, ConsentPurpose.CrossFarmAggregation, CancellationToken.None))
                .IsAllowed.Should().BeFalse();
            await scope.ServiceProvider
                .GetRequiredService<ShramSafal.Infrastructure.Persistence.ShramSafalDbContext>()
                .SaveChangesAsync();
        }

        ShouldBe((await GetAsync(UserA)).FullHistoryJournalGrantedSinceUtc, t);
    }

    [SkippableFact]
    public async Task Reading_the_start_never_writes_the_ledger()
    {
        SkipIfPostgresUnavailable();
        await ToggleAsync(UserA, fullHistory: true);
        var before = await AuditCountAsync();
        for (var i = 0; i < 3; i++) await GetAsync(UserA);
        (await AuditCountAsync()).Should().Be(before);
    }

    [SkippableFact]
    public async Task Wire_name_is_camelCase_fullHistoryJournalGrantedSinceUtc()
    {
        SkipIfPostgresUnavailable();
        var t = await ToggleAsync(UserA, fullHistory: true);
        var state = await GetAsync(UserA);

        // Same serializer family Results.Ok uses in a minimal API.
        var json = JsonSerializer.Serialize(state, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.TryGetProperty("fullHistoryJournalGrantedSinceUtc", out var since).Should().BeTrue();
        DateTime.Parse(since.GetString()!, null, System.Globalization.DateTimeStyles.RoundtripKind)
            .Should().BeCloseTo(t, TimeSpan.FromMilliseconds(5));
        since.GetString().Should().EndWith("Z", "the phone parses it as UTC");
    }

    private sealed class SteppedTime(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;
        public void Advance(TimeSpan by) => _now += by;
        public override DateTimeOffset GetUtcNow() => _now;
    }

    private sealed class SteppedClock(SteppedTime time) : IClock
    {
        public DateTime UtcNow => time.GetUtcNow().UtcDateTime;
    }
}
