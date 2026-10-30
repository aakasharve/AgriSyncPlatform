// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36, D-31, D-13)
//
// The improvement permission and the two additive consent facts, on REAL Postgres, through
// the real handlers, the real store and the real fail-closed gate, connected as the
// NON-SUPERUSER, NON-BYPASSRLS application role (doctrine E3: security proofs run as the
// real role). Proves:
//   1. Default OFF; an ON under the current words is the only YES; a withdrawal is a new row
//      and the gate follows it; an ON under older words is stored as sent and is a NO.
//   2. The table is append-only by PRIVILEGE: the app role cannot UPDATE / DELETE / TRUNCATE.
//   3. Self-only RLS: without the caller's identity nothing is visible or writable, and one
//      person can never see or write another's choice.
//   4. The old switches never count: CrossFarmAggregation / ResearchCorpusExport ON, with no
//      improvement row, is still a NO.
//   5. GET /consent/me reads the newest linked notice acceptance through the caller's RLS
//      scope, and the "keep my original voice" words version round-trips through the column.
//
// Native Postgres (REQUIRES_POSTGRES_ROOT_CONN), self-skipping when the server is genuinely
// absent, loud when it answers and refuses.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Privacy;
using ShramSafal.Application.UseCases.Consent.GetConsent;
using ShramSafal.Application.UseCases.Consent.ImprovementPermission;
using ShramSafal.Application.UseCases.Consent.LinkConsentGateToUser;
using ShramSafal.Application.UseCases.Consent.UpdateConsent;
using ShramSafal.Domain.Consent;
using ShramSafal.Infrastructure;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Consent;

[Trait("Category", "RequiresPostgres")]
public sealed class ImprovementPermissionRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly Guid UserA = Guid.Parse("d1a00000-0000-0000-0000-00000000000a");
    private static readonly Guid UserB = Guid.Parse("d1b00000-0000-0000-0000-00000000000b");
    private const string Current = CurrentConsentWording.ImprovementPermissionVersion;

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _root;
    private readonly MovableClock _clock = new(new DateTime(2026, 10, 30, 6, 0, 0, DateTimeKind.Utc));

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
        _scratchDbName = $"ssf_improvement_{Guid.NewGuid():N}";
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
        services.AddSingleton<IClock>(_clock);
        services.AddSingleton<TimeProvider>(_clock.AsTimeProvider());
        services.AddSingleton<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<GetImprovementPermissionHandler>();
        services.AddScoped<SetImprovementPermissionHandler>();
        services.AddScoped<GetConsentHandler>();
        services.AddScoped<UpdateConsentHandler>();
        services.AddScoped<LinkConsentGateToUserHandler>();
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

    // ── the proofs ───────────────────────────────────────────────────────

    [SkippableFact]
    public async Task The_app_role_is_a_real_role_not_a_superuser_and_not_bypassrls()
    {
        SkipIfPostgresUnavailable();
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user";
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue();
        r.GetBoolean(0).Should().BeFalse("a superuser would make every RLS proof below vacuous");
        r.GetBoolean(1).Should().BeFalse("BYPASSRLS would make every RLS proof below vacuous");
    }

    [SkippableFact]
    public async Task Default_is_off_and_only_an_on_under_the_current_words_counts()
    {
        SkipIfPostgresUnavailable();

        (await MayUseAsync(UserA)).Should().BeFalse("no row = OFF, the default");
        (await GetAsync(UserA)).Allowed.Should().BeFalse();

        (await SetAsync(UserA, true, "improve-2026-01-01.1")).AllowedUnderCurrentWording.Should().BeFalse();
        (await MayUseAsync(UserA)).Should().BeFalse("an ON against other words is stored, never counted");

        _clock.Advance(TimeSpan.FromMinutes(1));
        (await SetAsync(UserA, true, Current)).AllowedUnderCurrentWording.Should().BeTrue();
        (await MayUseAsync(UserA)).Should().BeTrue();

        _clock.Advance(TimeSpan.FromMinutes(1));
        await SetAsync(UserA, false, Current);
        (await MayUseAsync(UserA)).Should().BeFalse("a withdrawal stops future selection");

        (await CountRowsAsync(UserA)).Should().Be(3, "every choice is its own row; none was overwritten");
    }

    [SkippableFact]
    public async Task One_person_can_never_see_or_count_another_persons_choice()
    {
        SkipIfPostgresUnavailable();
        await SetAsync(UserA, true, Current);

        (await MayUseAsync(UserA)).Should().BeTrue();
        (await MayUseAsync(UserB)).Should().BeFalse();
        (await GetAsync(UserB)).Allowed.Should().BeFalse();

        // As the app role with B's identity, A's row does not exist.
        (await AppRoleCountAsync(asUser: UserB)).Should().Be(0);
        // As the app role with no identity at all, nothing exists.
        (await AppRoleCountAsync(asUser: null)).Should().Be(0);
        (await AppRoleCountAsync(asUser: UserA)).Should().Be(1);
    }

    [SkippableFact]
    public async Task The_app_role_cannot_write_a_row_in_someone_elses_name_or_without_an_identity()
    {
        SkipIfPostgresUnavailable();
        var asB = async () => await AppRoleInsertAsync(rowUser: UserA, asUser: UserB);
        var anonymous = async () => await AppRoleInsertAsync(rowUser: UserA, asUser: null);
        (await asB.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        (await anonymous.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        (await CountRowsAsync(UserA)).Should().Be(0);
    }

    [SkippableTheory]
    [InlineData("UPDATE ssf.improvement_permission_events SET allowed = true")]
    [InlineData("DELETE FROM ssf.improvement_permission_events")]
    [InlineData("TRUNCATE ssf.improvement_permission_events")]
    public async Task The_table_is_append_only_for_the_app_role(string statement)
    {
        SkipIfPostgresUnavailable();
        await SetAsync(UserA, true, Current);

        var act = async () =>
        {
            await using var db = new NpgsqlConnection(_appConn);
            await db.OpenAsync();
            await using var tx = await db.BeginTransactionAsync();
            await SetIdentityAsync(db, UserA);
            await using var cmd = db.CreateCommand();
            cmd.CommandText = statement;
            await cmd.ExecuteNonQueryAsync();
            await tx.CommitAsync();
        };
        (await act.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        (await MayUseAsync(UserA)).Should().BeTrue("the row survived");
    }

    [SkippableFact]
    public async Task The_old_switches_never_count_as_this_permission()
    {
        SkipIfPostgresUnavailable();
        await using (var scope = Scope())
        {
            var update = scope.ServiceProvider.GetRequiredService<UpdateConsentHandler>();
            (await update.HandleAsync(new UpdateConsentCommand(
                UserA, FullHistoryJournal: true, CrossFarmAggregation: true, ResearchCorpusExport: true,
                LanguageShown: "mr-IN", ConsentTextVersion: 1, ClientAppVersion: "1.0.15"))).IsSuccess.Should().BeTrue();
        }

        (await MayUseAsync(UserA)).Should().BeFalse(
            "D-36: an ambiguous old switch must not count as the improvement permission");
    }

    [SkippableFact]
    public async Task Consent_me_reads_the_newest_linked_notice_through_the_callers_scope()
    {
        SkipIfPostgresUnavailable();
        (await GetConsentAsync(UserA)).AcceptedNoticeVersion.Should().BeNull();

        await LinkAsync(UserA, "notice-2026-10-25.1", "s-1");
        _clock.Advance(TimeSpan.FromMinutes(5));
        await LinkAsync(UserA, CurrentConsentWording.NoticeVersion, "s-2");

        var mine = await GetConsentAsync(UserA);
        mine.CurrentNoticeVersion.Should().Be(CurrentConsentWording.NoticeVersion);
        mine.AcceptedNoticeVersion.Should().Be(CurrentConsentWording.NoticeVersion);
        mine.NoticeAcceptedAtUtc.Should().NotBeNull();

        (await GetConsentAsync(UserB)).AcceptedNoticeVersion.Should().BeNull("A's acceptance is not B's");
    }

    [SkippableFact]
    public async Task An_account_with_an_erasure_request_is_never_a_licence()
    {
        SkipIfPostgresUnavailable();
        await SetAsync(UserA, true, Current);
        (await MayUseAsync(UserA)).Should().BeTrue();

        await using (var db = new NpgsqlConnection(_superuserConn))
        {
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText =
                "INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc) " +
                "VALUES (@id, @u, NULL, 0, now())";
            cmd.Parameters.AddWithValue("id", Guid.NewGuid());
            cmd.Parameters.AddWithValue("u", UserA);
            await cmd.ExecuteNonQueryAsync();
        }

        (await MayUseAsync(UserA)).Should().BeFalse("the ON row stays as evidence; it licenses nothing any more");
        (await CountRowsAsync(UserA)).Should().Be(1, "the consent record itself is kept, not rewritten");
        await SetAsync(UserB, true, Current);
        (await MayUseAsync(UserB)).Should().BeTrue("one person's erasure says nothing about another");
    }

    [SkippableFact]
    public async Task Consent_me_prefers_the_current_notice_over_a_later_old_apk_tick()
    {
        SkipIfPostgresUnavailable();
        await LinkAsync(UserA, CurrentConsentWording.NoticeVersion, "s-current");
        _clock.Advance(TimeSpan.FromHours(2));
        await LinkAsync(UserA, "notice-2026-10-25.1", "s-old-apk"); // newer timestamp, older notice

        (await GetConsentAsync(UserA)).AcceptedNoticeVersion.Should().Be(
            CurrentConsentWording.NoticeVersion,
            "a later tick on an old APK must not make him look as if he never accepted the current notice");
    }

    [SkippableFact]
    public async Task The_voice_choice_words_round_trip_and_an_older_phone_clears_them()
    {
        SkipIfPostgresUnavailable();
        const string words = "voice-keep-2026-10-30.1";

        await UpdateAsync(UserA, fullHistory: true, wording: words);
        (await GetConsentAsync(UserA)).FullHistoryJournalWordingVersion.Should().Be(words);

        await UpdateAsync(UserA, fullHistory: false, wording: null);   // an older phone
        (await GetConsentAsync(UserA)).FullHistoryJournalWordingVersion.Should().BeNull();
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private AsyncServiceScope Scope()
    {
        var scope = _root!.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }

    private async Task<bool> MayUseAsync(Guid user)
    {
        await using var scope = Scope();
        return await scope.ServiceProvider.GetRequiredService<IImprovementPermissionGate>()
            .MayUseForImprovementAsync(user);
    }

    private async Task<ImprovementPermissionResult> GetAsync(Guid user)
    {
        await using var scope = Scope();
        var result = await scope.ServiceProvider.GetRequiredService<GetImprovementPermissionHandler>().HandleAsync(user);
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private async Task<ImprovementPermissionResult> SetAsync(Guid user, bool allowed, string wording)
    {
        await using var scope = Scope();
        var result = await scope.ServiceProvider.GetRequiredService<SetImprovementPermissionHandler>()
            .HandleAsync(new SetImprovementPermissionCommand(user, allowed, wording, "mr", "1.0.18"));
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private async Task<GetConsentResult> GetConsentAsync(Guid user)
    {
        await using var scope = Scope();
        var result = await scope.ServiceProvider.GetRequiredService<GetConsentHandler>().HandleAsync(user);
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private async Task UpdateAsync(Guid user, bool fullHistory, string? wording)
    {
        _clock.Advance(TimeSpan.FromMinutes(1));
        await using var scope = Scope();
        var result = await scope.ServiceProvider.GetRequiredService<UpdateConsentHandler>().HandleAsync(
            new UpdateConsentCommand(user, fullHistory, null, null, "mr-IN", 1, "1.0.18",
                FullHistoryJournalWordingVersion: wording));
        result.IsSuccess.Should().BeTrue();
    }

    private async Task LinkAsync(Guid user, string noticeVersion, string sessionId)
    {
        await using var scope = Scope();
        var handler = scope.ServiceProvider.GetRequiredService<LinkConsentGateToUserHandler>();
        var callerScope = scope.ServiceProvider.GetRequiredService<ShramSafal.Application.Ports.ICallerUserTenantScope>();
        var result = await callerScope.RunForCallerAsync(user, token => handler.HandleAsync(
            new LinkConsentGateToUserCommand(
                UserId: user,
                PreRegistrationSessionId: sessionId,
                NoticeVersion: noticeVersion,
                PrivacyPolicyVersion: "privacy-2026-10-30.1",
                TermsVersion: "terms-2026-10-25.1",
                DisplayedLanguage: "mr",
                AcceptedPurposeCodes: ["ACCOUNT_AUTHENTICATION"],
                DataCategoryCodes: ["IDENTITY_AND_CONTACT"],
                Source: "app",
                AppVersion: "1.0.18",
                DisplayedNoticeText: "notice text " + noticeVersion), token));
        result.IsSuccess.Should().BeTrue();
    }

    private async Task<long> CountRowsAsync(Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.improvement_permission_events WHERE user_id = @u";
        cmd.Parameters.AddWithValue("u", user);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<long> AppRoleCountAsync(Guid? asUser)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        if (asUser is { } u) await SetIdentityAsync(db, u);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.improvement_permission_events";
        var n = Convert.ToInt64(await cmd.ExecuteScalarAsync());
        await tx.CommitAsync();
        return n;
    }

    private async Task AppRoleInsertAsync(Guid rowUser, Guid? asUser)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        if (asUser is { } u) await SetIdentityAsync(db, u);
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "INSERT INTO ssf.improvement_permission_events " +
            "(\"Id\", user_id, allowed, wording_version, language_shown, app_version, chosen_at_utc) " +
            "VALUES (@id, @u, true, @w, 'mr', 'x', now())";
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("u", rowUser);
        cmd.Parameters.AddWithValue("w", Current);
        await cmd.ExecuteNonQueryAsync();
        await tx.CommitAsync();
    }

    // Test-only: establishes the same transaction-scoped identity RlsIdentityScope does, on a
    // raw connection, so the policy can be probed directly.
    private static async Task SetIdentityAsync(NpgsqlConnection db, Guid user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.user_id', @u, true)";
        cmd.Parameters.AddWithValue("u", user.ToString());
        await cmd.ExecuteScalarAsync();
    }

    private sealed class MovableClock(DateTime start) : IClock
    {
        private DateTime _now = start;
        public DateTime UtcNow => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
        public TimeProvider AsTimeProvider() => new Provider(this);

        private sealed class Provider(MovableClock clock) : TimeProvider
        {
            public override DateTimeOffset GetUtcNow() => new(clock.UtcNow);
        }
    }
}
