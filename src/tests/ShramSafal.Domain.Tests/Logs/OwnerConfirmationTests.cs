// spec: plr-d10-redesign-real-integration-2026-10-25 (I27) — founder D-44 / D-46 / D-31.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// I27 — who may give a record the owner's confirmation ("मालकाकडून खात्री"), what that
/// confirmation records (who, when, which version, heard or read), and what happens to a
/// confirm request from anyone else: recorded as his mark, never counted, never refused.
/// </summary>
public sealed class OwnerConfirmationTests
{
    private static readonly Guid Farm = Guid.Parse("27000000-0000-0000-0000-000000000001");
    private static readonly Guid Owner = Guid.Parse("27000000-0000-0000-0000-000000000002");
    private static readonly Guid Worker = Guid.Parse("27000000-0000-0000-0000-000000000003");
    private static readonly Guid Mukadam = Guid.Parse("27000000-0000-0000-0000-000000000004");
    private static readonly Guid CoOwner = Guid.Parse("27000000-0000-0000-0000-000000000005");
    private static readonly DateTime Created = new(2026, 10, 30, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Now = new(2026, 10, 30, 9, 0, 0, DateTimeKind.Utc);

    // ── The authority rule, enumerated ─────────────────────────────────────

    public static IEnumerable<object[]> EveryRole() =>
        Enum.GetValues<AppRole>().Select(r => new object[] { r });

    [Theory]
    [MemberData(nameof(EveryRole))]
    public void Only_the_primary_owner_or_a_member_holding_the_owners_grant_may_confirm(AppRole role)
    {
        foreach (var hasGrant in new[] { false, true })
        {
            var expected = role == AppRole.PrimaryOwner || hasGrant;
            Assert.Equal(expected, OwnerConfirmationAuthority.MayConfirm(role, hasGrant));
        }
    }

    [Fact]
    public void A_co_owner_and_a_mukadam_get_nothing_from_their_role_alone()
    {
        Assert.False(OwnerConfirmationAuthority.MayConfirm(AppRole.SecondaryOwner, hasExplicitGrant: false));
        Assert.False(OwnerConfirmationAuthority.MayConfirm(AppRole.Mukadam, hasExplicitGrant: false));
        Assert.True(OwnerConfirmationAuthority.MayConfirm(AppRole.Mukadam, hasExplicitGrant: true));
        Assert.True(OwnerConfirmationAuthority.MayConfirm(AppRole.PrimaryOwner, hasExplicitGrant: false));
    }

    [Theory]
    [InlineData(null, true, null)]
    [InlineData("  ", true, null)]
    [InlineData("heard", true, "heard")]
    [InlineData(" read ", true, "read")]
    [InlineData("Heard", false, null)]
    [InlineData("listened", false, null)]
    public void Review_basis_is_one_of_two_words_or_not_stated(string? raw, bool ok, string? normalized)
    {
        Assert.Equal(ok, ReviewBasis.TryNormalize(raw, out var value));
        Assert.Equal(normalized, value);
    }

    // ── The record: link, version, mark, stamp ─────────────────────────────

    [Fact]
    public void A_log_starts_at_version_1_and_every_content_change_moves_it_on()
    {
        var log = NewLog(Worker);
        Assert.Equal(1, log.ContentVersion);
        log.NoteContentChanged();
        log.NoteContentChanged();
        Assert.Equal(3, log.ContentVersion);
    }

    [Fact]
    public void The_recording_link_is_set_once_and_never_repointed()
    {
        var log = NewLog(Worker);
        var clip = Guid.NewGuid();
        log.LinkVoiceClip(clip);
        log.LinkVoiceClip(clip); // the same statement again is not a change
        Assert.Equal(clip, log.VoiceClipId);
        Assert.Throws<InvalidOperationException>(() => log.LinkVoiceClip(Guid.NewGuid()));
        Assert.Throws<ArgumentException>(() => NewLog(Worker).LinkVoiceClip(Guid.Empty));
    }

    [Fact]
    public void A_speakers_own_mark_leaves_the_record_Draft_and_is_recognised_as_a_mark()
    {
        var log = NewLog(Worker);
        var mark = log.RecordMarkWithoutConfirmAuthority(Guid.NewGuid(), new UserId(Worker), Now);

        Assert.NotNull(mark);
        Assert.Equal(VerificationStatus.Draft, mark!.Status);
        Assert.Equal(DailyLog.SpeakerOwnMarkReason, mark.Reason);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.True(DailyLog.IsMarkWithoutConfirmAuthority(mark));
    }

    [Fact]
    public void A_mark_by_someone_else_names_itself_and_a_mark_on_a_non_Draft_record_writes_nothing()
    {
        var log = NewLog(Worker);
        var mark = log.RecordMarkWithoutConfirmAuthority(Guid.NewGuid(), new UserId(CoOwner), Now);
        Assert.Equal(DailyLog.NoConfirmAuthorityMarkReason, mark!.Reason);

        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Worker, new UserId(Worker), Now.AddMinutes(1));
        var before = log.VerificationEvents.Count;
        Assert.Null(log.RecordMarkWithoutConfirmAuthority(Guid.NewGuid(), new UserId(Worker), Now.AddMinutes(2)));
        Assert.Equal(before, log.VerificationEvents.Count);
        Assert.Equal(VerificationStatus.Confirmed, log.CurrentVerificationStatus);
    }

    [Fact]
    public void The_owner_confirmation_stamp_records_the_version_and_the_basis_on_the_Verified_event_only()
    {
        var log = NewLog(Worker);
        log.NoteContentChanged(); // version 2
        var events = log.VerifyReachingTarget(
            VerificationStatus.Verified, null, AppRole.PrimaryOwner, new UserId(Owner), Now, Guid.NewGuid(), Guid.NewGuid());
        var verified = events[^1];

        log.StampOwnerConfirmation(verified, ReviewBasis.Read);

        Assert.Equal(2, verified.ConfirmedLogVersion);
        Assert.Equal(ReviewBasis.Read, verified.ReviewBasis);
        Assert.Null(events[0].ConfirmedLogVersion); // the en-route Confirmed hop is not the confirmation
        Assert.Throws<InvalidOperationException>(() => log.StampOwnerConfirmation(events[0], ReviewBasis.Heard));
        Assert.Throws<ArgumentException>(() => log.StampOwnerConfirmation(verified, "listened"));
    }

    // ── The handler: who reaches Verified, who leaves a mark ───────────────

    [Fact]
    public async Task The_primary_owner_confirms_his_own_auto_saved_recording_in_one_step_heard()
    {
        var (handler, repo) = Build(log: NewAutoSavedLog(Owner));

        var result = await handler.HandleAsync(Confirm(Owner, ReviewBasis.Heard));

        Assert.True(result.IsSuccess);
        var log = (await repo.GetDailyLogByIdAsync(LogId))!;
        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
        var verified = log.VerificationEvents.Single(e => e.Status == VerificationStatus.Verified);
        Assert.Equal(new UserId(Owner), verified.VerifiedByUserId);
        Assert.Equal(Now.AddMilliseconds(1), verified.OccurredAtUtc);
        Assert.Equal(1, verified.ConfirmedLogVersion);
        Assert.Equal(ReviewBasis.Heard, verified.ReviewBasis);
    }

    [Fact]
    public async Task A_granted_mukadam_confirms_a_workers_record_and_it_is_noted_as_read()
    {
        var (handler, repo) = Build(log: NewAutoSavedLog(Worker), grantMukadam: true);

        var result = await handler.HandleAsync(Confirm(Mukadam, ReviewBasis.Read));

        Assert.True(result.IsSuccess);
        var verified = (await repo.GetDailyLogByIdAsync(LogId))!.VerificationEvents.Single(e => e.Status == VerificationStatus.Verified);
        Assert.Equal(new UserId(Mukadam), verified.VerifiedByUserId);
        Assert.Equal(ReviewBasis.Read, verified.ReviewBasis);
    }

    [Fact]
    public async Task The_old_result_screen_tap_by_the_speaker_is_kept_as_his_mark_never_Verified_and_never_refused()
    {
        var (handler, repo) = Build(log: NewAutoSavedLog(Mukadam), grantMukadam: true);

        var result = await handler.HandleAsync(Confirm(Mukadam, reviewBasis: null) with { ReviewBasisOmittedOnV2 = true });

        Assert.True(result.IsSuccess); // an older phone's queue keeps moving (P11)
        Assert.Equal("Draft", result.Value!.LastVerificationStatus);
        Assert.DoesNotContain(result.Value.VerificationEvents, e => e.Status == "Draft" && e.Reason == DailyLog.SpeakerOwnMarkReason);
        var log = (await repo.GetDailyLogByIdAsync(LogId))!;
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.Contains(log.VerificationEvents, e => e.Reason == DailyLog.SpeakerOwnMarkReason && e.VerifiedByUserId == new UserId(Mukadam));
        var audit = Assert.Single(repo.AuditEvents);
        Assert.Equal("ConfirmRequestNotCounted", audit.Action);
    }

    [Fact]
    public async Task Even_the_primary_owners_old_result_screen_tap_is_his_mark_his_new_save_and_confirm_counts()
    {
        var (handler, repo) = Build(log: NewAutoSavedLog(Owner));

        var old = await handler.HandleAsync(Confirm(Owner, reviewBasis: null) with { ReviewBasisOmittedOnV2 = true });
        Assert.True(old.IsSuccess);
        Assert.Equal(VerificationStatus.Draft, (await repo.GetDailyLogByIdAsync(LogId))!.CurrentVerificationStatus);

        var deliberate = await handler.HandleAsync(Confirm(Owner, ReviewBasis.Read));
        Assert.True(deliberate.IsSuccess);
        Assert.Equal(VerificationStatus.Verified, (await repo.GetDailyLogByIdAsync(LogId))!.CurrentVerificationStatus);
    }

    [Fact]
    public async Task A_granted_mukadam_may_still_confirm_his_own_record_deliberately_founder_2026_08_27()
    {
        var (handler, repo) = Build(log: NewAutoSavedLog(Mukadam), grantMukadam: true);

        var result = await handler.HandleAsync(Confirm(Mukadam, ReviewBasis.Heard));

        Assert.True(result.IsSuccess);
        var verified = (await repo.GetDailyLogByIdAsync(LogId))!.VerificationEvents.Single(e => e.Status == VerificationStatus.Verified);
        Assert.Equal(new UserId(Mukadam), verified.VerifiedByUserId);
        Assert.Equal(ReviewBasis.Heard, verified.ReviewBasis);
    }

    [Fact]
    public async Task A_co_owner_the_primary_owner_gave_the_switch_to_confirms_founder_D44()
    {
        var (handler, repo) = Build(log: NewAutoSavedLog(Worker));
        repo.SetLabourGrant(Farm, CoOwner);

        var result = await handler.HandleAsync(Confirm(CoOwner, ReviewBasis.Read));

        Assert.True(result.IsSuccess);
        var verified = (await repo.GetDailyLogByIdAsync(LogId))!.VerificationEvents.Single(e => e.Status == VerificationStatus.Verified);
        Assert.Equal(new UserId(CoOwner), verified.VerifiedByUserId);
    }

    [Fact]
    public async Task A_co_owners_confirm_on_someone_elses_record_is_a_mark_not_the_owners_confirmation()
    {
        var (handler, repo) = Build(log: NewAutoSavedLog(Worker));

        var result = await handler.HandleAsync(Confirm(CoOwner, ReviewBasis.Heard));

        Assert.True(result.IsSuccess);
        var log = (await repo.GetDailyLogByIdAsync(LogId))!;
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.Contains(log.VerificationEvents, e => e.Reason == DailyLog.NoConfirmAuthorityMarkReason);
        Assert.DoesNotContain(log.VerificationEvents, e => e.Status == VerificationStatus.Verified);
    }

    [Fact]
    public async Task A_confirm_naming_a_version_the_record_has_moved_past_is_refused_with_a_three_segment_Conflict()
    {
        var log = NewAutoSavedLog(Worker);
        log.NoteContentChanged(); // the record is now version 2; the reviewer saw version 1
        var (handler, repo) = Build(log: log);

        var result = await handler.HandleAsync(Confirm(Owner, ReviewBasis.Read, expectedVersion: 1));

        Assert.False(result.IsSuccess);
        Assert.Equal("ShramSafal.LogVersion.Conflict", result.Error.Code);
        Assert.Equal(VerificationStatus.Draft, (await repo.GetDailyLogByIdAsync(LogId))!.CurrentVerificationStatus);
        Assert.Empty(repo.AuditEvents);

        var current = await handler.HandleAsync(Confirm(Owner, ReviewBasis.Read, expectedVersion: 2));
        Assert.True(current.IsSuccess);
        Assert.Equal(2, (await repo.GetDailyLogByIdAsync(LogId))!.VerificationEvents
            .Single(e => e.Status == VerificationStatus.Verified).ConfirmedLogVersion);
    }

    // ── Review B1: only the PRIMARY OWNER's own save is confirmed at save time ──

    public static IEnumerable<object[]> EveryRoleAndGrantState() =>
        Enum.GetValues<AppRole>().SelectMany(r => new[] { new object[] { r, false }, new object[] { r, true } });

    [Theory]
    [MemberData(nameof(EveryRoleAndGrantState))]
    public void Save_time_self_attestation_is_the_primary_owners_alone_whatever_the_grant(AppRole role, bool hasGrant)
    {
        // The grant is deliberately NOT an input at save: a grant holder (a co-owner included)
        // confirms his own record only by the deliberate act in the review sheet.
        var log = NewLog(Owner);

        var attested = log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), role, Created);

        var expected = role == AppRole.PrimaryOwner;
        Assert.Equal(expected, attested);
        Assert.Equal(expected, OwnerConfirmationAuthority.MaySelfAttestAtSave(role));
        if (expected)
        {
            Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
            var verified = log.VerificationEvents.Single(e => e.Status == VerificationStatus.Verified);
            Assert.Equal(1, verified.ConfirmedLogVersion);
            Assert.Null(verified.ReviewBasis); // he wrote it: neither "heard" nor "read" is true
            Assert.Equal(DailyLog.SelfAttestationReason, verified.Reason);
        }
        else
        {
            Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
            Assert.Empty(log.VerificationEvents);
            // ...even where the same role and grant may confirm deliberately.
            Assert.True(!hasGrant || OwnerConfirmationAuthority.MayConfirm(role, hasGrant));
        }
    }

    [Theory]
    [InlineData(AppRole.SecondaryOwner)]
    [InlineData(AppRole.Agronomist)]
    [InlineData(AppRole.FpcTechnicalManager)]
    public void Roles_that_hold_both_FSM_edges_still_do_not_self_attest_their_own_save(AppRole role)
    {
        Assert.True(VerificationStateMachine.CanTransitionWithRole(VerificationStatus.Draft, VerificationStatus.Confirmed, role));
        Assert.True(VerificationStateMachine.CanTransitionWithRole(VerificationStatus.Confirmed, VerificationStatus.Verified, role));

        var log = NewLog(CoOwner);
        Assert.False(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), role, Created));
        Assert.False(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), role, Created.AddDays(1),
            DailyLog.BackfilledAttestationReason)); // the backfill walks the same line
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
    }

    [Fact]
    public void The_primary_owners_re_attest_after_a_change_records_the_new_version()
    {
        var log = NewLog(Owner);
        Assert.True(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, Created));

        // A task added: the version moves on and the day re-opens (AddLogTaskHandler's order).
        log.NoteContentChanged();
        log.Edit(Guid.NewGuid(), new UserId(Owner), Created.AddMinutes(5));
        Assert.True(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, Created.AddMinutes(6)));

        var latest = log.VerificationEvents.Where(e => e.Status == VerificationStatus.Verified).OrderBy(e => e.OccurredAtUtc).Last();
        Assert.Equal(2, latest.ConfirmedLogVersion);
    }

    // ── Review S2: a dispute is the owner's decision too ─────────────────────

    [Fact]
    public async Task A_co_owners_dispute_without_the_grant_is_kept_as_a_mark_the_status_does_not_move()
    {
        var (handler, repo) = Build(log: VerifiedOwnerLog());

        var result = await handler.HandleAsync(Dispute(CoOwner));

        Assert.True(result.IsSuccess); // an older phone's queue keeps moving (P11)
        var log = (await repo.GetDailyLogByIdAsync(LogId))!;
        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
        Assert.DoesNotContain(log.VerificationEvents, e => e.Status == VerificationStatus.Disputed);
        var audit = Assert.Single(repo.AuditEvents);
        Assert.Equal("ConfirmRequestNotCounted", audit.Action);
        using var payload = System.Text.Json.JsonDocument.Parse(audit.Payload);
        Assert.Equal("Disputed", payload.RootElement.GetProperty("requested").GetString());
        // His words are kept, not dropped (P10).
        Assert.Equal("काम अपूर्ण", payload.RootElement.GetProperty("requestedReason").GetString());
    }

    [Fact]
    public async Task A_co_owner_holding_the_owners_grant_disputes_and_it_counts()
    {
        var (handler, repo) = Build(log: VerifiedOwnerLog());
        repo.SetLabourGrant(Farm, CoOwner);

        var result = await handler.HandleAsync(Dispute(CoOwner));

        Assert.True(result.IsSuccess, result.Error?.ToString());
        Assert.Equal(VerificationStatus.Disputed, (await repo.GetDailyLogByIdAsync(LogId))!.CurrentVerificationStatus);
    }

    // ── Review N4: what the transitions endpoint may offer ────────────────────

    public static IEnumerable<object[]> EveryRoleGrantAndTarget() =>
        Enum.GetValues<AppRole>().SelectMany(r => new[] { false, true }.SelectMany(g =>
            Enum.GetValues<VerificationStatus>().Select(t => new object[] { r, g, t })));

    [Theory]
    [MemberData(nameof(EveryRoleGrantAndTarget))]
    public void The_owners_decision_is_offered_only_to_someone_it_counts_from(AppRole role, bool hasGrant, VerificationStatus to)
    {
        var isOwnersDecision = to is VerificationStatus.Verified or VerificationStatus.Disputed;
        var expected = !isOwnersDecision || OwnerConfirmationAuthority.MayConfirm(role, hasGrant);
        Assert.Equal(expected, OwnerConfirmationAuthority.MayBeOffered(to, role, hasGrant));
    }

    private static DailyLog VerifiedOwnerLog()
    {
        var log = NewLog(Owner);
        Assert.True(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, Created));
        return log;
    }

    private static VerifyLogCommand Dispute(Guid caller) => new(
        LogId, VerificationStatus.Disputed, Reason: "काम अपूर्ण", VerifiedByUserId: caller);

    // ── helpers ─────────────────────────────────────────────────────────────

    private static readonly Guid LogId = Guid.Parse("27000000-0000-0000-0000-0000000000aa");

    private static DailyLog NewLog(Guid speaker) => DailyLog.Create(
        LogId, new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(speaker),
        new DateOnly(2026, 10, 30), idempotencyKey: null, location: null, createdAtUtc: Created);

    private static DailyLog NewAutoSavedLog(Guid speaker)
    {
        var log = NewLog(speaker);
        log.MarkAutoSavedFromVoice(Guid.NewGuid(), Created);
        return log;
    }

    private static VerifyLogCommand Confirm(Guid caller, string? reviewBasis, int? expectedVersion = null) => new(
        LogId, VerificationStatus.Verified, Reason: null, VerifiedByUserId: caller,
        ReviewBasis: reviewBasis, ExpectedLogVersion: expectedVersion);

    private static (VerifyLogHandler Handler, InMemoryShramSafalRepository Repo) Build(DailyLog log, bool grantMukadam = false)
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(log);
        repo.SetMembership(Farm, Owner, AppRole.PrimaryOwner);
        repo.SetMembership(Farm, CoOwner, AppRole.SecondaryOwner);
        repo.SetMembership(Farm, Mukadam, AppRole.Mukadam);
        repo.SetMembership(Farm, Worker, AppRole.Worker);
        if (grantMukadam)
        {
            repo.SetLabourGrant(Farm, Mukadam);
        }

        var clock = new FixedClock(Now);
        var autoVerify = new OnLogVerifiedAutoVerifyJobCard(
            repo, new VerifyJobCardForPayoutHandler(repo, clock), clock,
            NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);
        var handler = new VerifyLogHandler(
            repo, new SequentialIds(), clock, new AllowAll(), new NoAnalytics(), autoVerify);
        return (handler, repo);
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }

    private sealed class SequentialIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class AllowAll : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
