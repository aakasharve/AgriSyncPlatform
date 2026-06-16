// spec: voice-diary-e2e-2026-05-17 (B.17)
//
// Wave 1.B end-to-end coverage for the Voice Diary stack:
//   grant FullHistoryJournal → persist clip → retrieve by range →
//   retrieve by id → revoke FullHistoryJournal → attempt persist (must
//   deny with ConsentRequired).
//
// Testcontainers Postgres + an in-memory IRetainedBlobStore fake
// (LocalStack S3 sidecar would add a 10s startup; the in-memory fake
// covers the persist + range + by-id contracts and is reused by the
// existing ErasureWorkerAnonymizationTest). [Trait("Category",
// "RequiresDocker")] so the test skips locally (feedback_avoid_docker_local_dev
// memory) and runs in CI.

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
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
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.Consent.UpdateConsent;
using ShramSafal.Sync.IntegrationTests.Privacy;
using ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryByRange;
using ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Testcontainers.PostgreSql;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.VoiceDiary;

[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class VoiceDiaryEndToEndTests : IAsyncLifetime
{
#pragma warning disable CS0618
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ServiceProvider _rootProvider = default!;
    private readonly Guid _userId = Guid.NewGuid();

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();
        await ApplyFullMigrationChainAsync(conn);

        var services = new ServiceCollection();
        services.AddLogging();
        var inMemoryConfig = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = conn,
                ["ConnectionStrings:UserDb"] = conn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(inMemoryConfig);
        services.AddShramSafalInfrastructure(inMemoryConfig);

        // In-memory IRetainedBlobStore fake (same shape as the
        // ErasureWorkerAnonymizationTest sibling — see §B.18).
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();

        // Real ConsentEnforcer over the test DbContext + a fixed clock.
        services.AddSingleton<TimeProvider>(TimeProvider.System);
        services.AddSingleton<IClock>(new TestClock(new DateTime(2026, 5, 17, 12, 0, 0, DateTimeKind.Utc)));
        services.AddScoped<IConsentEnforcer, ConsentEnforcer>();
        services.AddScoped<UpdateConsentHandler>();
        services.AddScoped<PersistVoiceClipRetainedHandler>();
        services.AddScoped<GetVoiceDiaryByRangeHandler>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null) await _rootProvider.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task Voice_diary_flow_grant_persist_read_revoke_deny()
    {
        // ── 1. Grant FullHistoryJournal ─────────────────────────────
        await using (var scope = CreateAdminScope())
        {
            var update = scope.ServiceProvider.GetRequiredService<UpdateConsentHandler>();
            var grantResult = await update.HandleAsync(new UpdateConsentCommand(
                UserId: _userId,
                FullHistoryJournal: true,
                CrossFarmAggregation: null,
                ResearchCorpusExport: null,
                LanguageShown: "mr-IN",
                ConsentTextVersion: 1,
                ClientAppVersion: "test-1.0",
                AuditDeviceId: "test-device",
                AuditIpHash: "sha256:test"));
            grantResult.IsSuccess.Should().BeTrue();
        }

        // ── 2. Persist a clip ───────────────────────────────────────
        var clipId = Guid.NewGuid();
        var cipherBytes = Encoding.UTF8.GetBytes("fake-ciphertext-bytes");
        await using (var scope = CreateAdminScope())
        {
            var persist = scope.ServiceProvider.GetRequiredService<PersistVoiceClipRetainedHandler>();
            var result = await persist.HandleAsync(new PersistVoiceClipRetainedCommand(
                ClipId: clipId,
                UserId: _userId,
                RecordedAtUtc: new DateTime(2026, 5, 17, 10, 0, 0, DateTimeKind.Utc),
                CipherBase64: Convert.ToBase64String(cipherBytes),
                DekId: "dek-test",
                IvBase64: "AAECAwQFBgcICQoLDA0ODw==",
                AuthTagBase64: "EBESExQVFhcYGRobHB0eHw==",
                DurationSeconds: 8,
                Language: "mr-IN"));

            result.IsSuccess.Should().BeTrue("FullHistoryJournal was granted in step 1");
            result.Value!.ClipId.Should().Be(clipId);
        }

        // ── 3. Retrieve by range ────────────────────────────────────
        await using (var scope = CreateAdminScope())
        {
            var range = scope.ServiceProvider.GetRequiredService<GetVoiceDiaryByRangeHandler>();
            var result = await range.HandleAsync(new GetVoiceDiaryByRangeQuery(
                _userId,
                From: new DateOnly(2026, 5, 16),
                To: new DateOnly(2026, 5, 18)));

            result.IsSuccess.Should().BeTrue();
            result.Value!.Clips.Should().HaveCount(1);
            result.Value.Clips[0].ClipId.Should().Be(clipId);
        }

        // ── 4. Retrieve by id ───────────────────────────────────────
        await using (var scope = CreateAdminScope())
        {
            var blobStore = scope.ServiceProvider.GetRequiredService<IRetainedBlobStore>();
            var clip = await blobStore.GetByIdAsync(clipId, _userId, CancellationToken.None);
            clip.Should().NotBeNull();
            clip!.ClipId.Should().Be(clipId);
            clip.UserId.Should().Be(_userId);
            clip.CipherBytes.Should().BeEquivalentTo(cipherBytes);
        }

        // ── 5. Revoke FullHistoryJournal ────────────────────────────
        await using (var scope = CreateAdminScope())
        {
            var update = scope.ServiceProvider.GetRequiredService<UpdateConsentHandler>();
            var revokeResult = await update.HandleAsync(new UpdateConsentCommand(
                UserId: _userId,
                FullHistoryJournal: false,
                CrossFarmAggregation: null,
                ResearchCorpusExport: null,
                LanguageShown: "mr-IN",
                ConsentTextVersion: 1,
                ClientAppVersion: "test-1.0",
                AuditDeviceId: "test-device",
                AuditIpHash: "sha256:test"));
            revokeResult.IsSuccess.Should().BeTrue();
            revokeResult.Value!.FullHistoryJournal.Should().BeFalse();
        }

        // ── 6. Attempt persist again — must deny ────────────────────
        await using (var scope = CreateAdminScope())
        {
            var persist = scope.ServiceProvider.GetRequiredService<PersistVoiceClipRetainedHandler>();
            var deniedResult = await persist.HandleAsync(new PersistVoiceClipRetainedCommand(
                ClipId: Guid.NewGuid(),
                UserId: _userId,
                RecordedAtUtc: new DateTime(2026, 5, 17, 14, 0, 0, DateTimeKind.Utc),
                CipherBase64: Convert.ToBase64String(cipherBytes),
                DekId: "dek-test",
                IvBase64: "AAECAwQFBgcICQoLDA0ODw==",
                AuthTagBase64: "EBESExQVFhcYGRobHB0eHw==",
                DurationSeconds: 5,
                Language: "mr-IN"));

            deniedResult.IsSuccess.Should().BeFalse(
                "FullHistoryJournal was revoked in step 5 — IConsentEnforcer must deny");
            deniedResult.Error.Code.Should().Be(ShramSafalErrors.ConsentRequired.Code);
        }
    }

    // Correct 4-phase order lives in IntegrationMigrationChain. The previous inline
    // order ran analytics-full before the SSF Phase-B chain, so DwcV2Matviews hit
    // missing ssf.workers (and the full chain hit analytics.events ordering).
    private static Task ApplyFullMigrationChainAsync(string conn)
        => IntegrationMigrationChain.ApplyAsync(conn);

    private sealed class TestClock(DateTime fixedUtc) : IClock
    {
        public DateTime UtcNow { get; } = fixedUtc;
    }

    // The test orchestrates DB setup outside the HTTP request flow, so
    // TenantTransactionMiddleware never runs to set TenantContext. The
    // tables this test touches (user_consent_state, consent_audit,
    // voice_clips_retained) are RLS-exempt — user-keyed, not farm-keyed
    // — so admin-cross-tenant scope is the correct escape per the
    // pattern documented on TenantContext.ElevateToAdminCrossTenant.
    private AsyncServiceScope CreateAdminScope()
    {
        var scope = _rootProvider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }
}
