// spec: 2026-08-25-prod-cutover-waves
//
// KNOWN LIMITATION, characterised on purpose (not a bug fix, not a weakening).
//
// The server refuses a clip whose DEVICE-DECLARED recordedAtUtc is before the
// start of the current voice-saving grant (403 ShramSafal.RecordedBeforeConsent).
// recordedAtUtc comes from the phone's clock; the grant start comes from the
// server's clock. Wherever the two clocks disagree, the boundary is wrong in
// one of two directions:
//
//   (1) device clock BEHIND real time: a clip genuinely recorded AFTER the
//       grant is declared as recorded BEFORE it and is REFUSED. A valid
//       recording stays on the phone (the uploader keeps it local / failed).
//   (2) device clock AHEAD of real time: a clip genuinely recorded BEFORE
//       permission (in the revoked gap) is declared as recorded AFTER the grant
//       start and is ADMITTED.
//
// These tests pin both directions as CURRENT behaviour so a future change
// (for example a server-side clock-offset estimate) has to update them
// knowingly. They do not assert that either outcome is desirable.

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class PersistVoiceClipRetainedClockSkewKnownLimitationTests
{
    // Server (real) time of the moment the current grant began.
    private static readonly DateTime GrantStart = new(2026, 10, 14, 9, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime ServerNow = GrantStart.AddHours(1);
    private static readonly TimeSpan Skew = TimeSpan.FromSeconds(90);

    [Fact(DisplayName = "KNOWN LIMITATION: device clock BEHIND - a clip genuinely recorded after the grant is refused")]
    public async Task KnownLimitation_DeviceBehind_ValidClipAfterGrant_IsRefused()
    {
        // Real time: the clip is recorded 30 s AFTER the grant began.
        var realRecordedAt = GrantStart.AddSeconds(30);
        // The device clock runs 90 s behind, so it declares a time BEFORE the grant.
        var declared = realRecordedAt - Skew;
        declared.Should().BeBefore(GrantStart, "the scenario: skew is larger than the clip's distance from the boundary");

        var (handler, store, repo) = Build();

        var result = await handler.HandleAsync(Command(declared), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be(ShramSafalErrors.RecordedBeforeConsent.Code,
            "the server judges the DECLARED time; it cannot know the device clock is behind");
        store.Persisted.Should().BeEmpty("a refused clip stores nothing");
        repo.SaveCount.Should().Be(0);
    }

    [Fact(DisplayName = "KNOWN LIMITATION: device clock AHEAD - a clip genuinely recorded before permission is admitted")]
    public async Task KnownLimitation_DeviceAhead_ClipFromRevokedGap_IsAdmitted()
    {
        // Real time: the clip is recorded 30 s BEFORE the grant (during the revoked gap).
        var realRecordedAt = GrantStart.AddSeconds(-30);
        // The device clock runs 90 s ahead, so it declares a time AFTER the grant start.
        var declared = realRecordedAt + Skew;
        declared.Should().BeAfter(GrantStart, "the scenario: skew is larger than the clip's distance from the boundary");

        var (handler, store, repo) = Build();

        var result = await handler.HandleAsync(Command(declared), CancellationToken.None);

        result.IsSuccess.Should().BeTrue(
            "the server cannot tell the declared time is wrong; the clip is admitted although it was recorded before permission");
        store.Persisted.Should().ContainSingle();
        repo.SaveCount.Should().BeGreaterThan(0);
    }

    [Fact(DisplayName = "Control: with no skew the boundary is exact (before refused, at/after admitted)")]
    public async Task Control_NoSkew_BoundaryIsExact()
    {
        var (handler, store, _) = Build();

        var before = await handler.HandleAsync(Command(GrantStart.AddSeconds(-1)), CancellationToken.None);
        before.IsSuccess.Should().BeFalse();
        before.Error.Code.Should().Be(ShramSafalErrors.RecordedBeforeConsent.Code);

        var atStart = await handler.HandleAsync(Command(GrantStart), CancellationToken.None);
        atStart.IsSuccess.Should().BeTrue();

        store.Persisted.Should().HaveCount(1);
    }

    // ---- scaffolding ------------------------------------------------------

    private static (PersistVoiceClipRetainedHandler handler, RecordingStore store, LedgerRepo repo) Build()
    {
        var repo = new LedgerRepo(GrantStart);
        var store = new RecordingStore();
        var handler = new PersistVoiceClipRetainedHandler(new AllowAll(), store, repo, new FixedClock(ServerNow));
        return (handler, store, repo);
    }

    private static PersistVoiceClipRetainedCommand Command(DateTime declaredRecordedAtUtc) => new(
        ClipId: Guid.NewGuid(),
        UserId: Guid.NewGuid(),
        RecordedAtUtc: declaredRecordedAtUtc,
        CipherBase64: Convert.ToBase64String(new byte[] { 1, 2, 3 }),
        DekId: "dek-1",
        IvBase64: "AAAA",
        AuthTagBase64: "AAAA",
        DurationSeconds: 5,
        Language: "mr-IN");

    private sealed class AllowAll : IConsentEnforcer
    {
        public Task<ConsentDecision> RequireGrantAsync(Guid userId, ConsentPurpose purpose, CancellationToken ct)
            => Task.FromResult(ConsentDecision.Allowed);
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }

    private sealed class RecordingStore : IRetainedBlobStore
    {
        public List<Guid> Persisted { get; } = new();

        public Task<Guid> PersistAsync(VoiceClipRetained metadata, byte[] cipherBytes, CancellationToken ct)
        {
            Persisted.Add(metadata.ClipId);
            return Task.FromResult(metadata.ClipId);
        }

        public Task<RetainedVoiceDeletionOutcome> DeleteRetainedVoiceForUserAsync(Guid userId, CancellationToken ct)
            => Task.FromResult(RetainedVoiceDeletionOutcome.Nothing);

        public Task<RetainedClipResult?> GetByIdAsync(Guid clipId, Guid callerUserId, CancellationToken ct)
            => Task.FromResult<RetainedClipResult?>(null);

        public Task<IReadOnlyList<VoiceClipRetainedListItem>> GetByRangeAsync(
            Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
            => Task.FromResult<IReadOnlyList<VoiceClipRetainedListItem>>(Array.Empty<VoiceClipRetainedListItem>());
    }

    /// <summary>Fake ledger: reports a fixed current-grant start (the real derivation is covered by
    /// FullHistoryGrantWindowTests and the real-Postgres tests).</summary>
    private sealed class LedgerRepo(DateTime grantStart) : FakeShramSafalRepository, IShramSafalRepository
    {
        public int SaveCount { get; private set; }

        public Task<DateTime?> GetFullHistoryCurrentGrantStartUtcAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult<DateTime?>(grantStart);

        public Task<UserConsentState?> GetUserConsentStateAsync(Guid userId, CancellationToken ct = default)
            => Task.FromResult<UserConsentState?>(null);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
            => Task.CompletedTask;

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCount++;
            return Task.CompletedTask;
        }
    }
}
